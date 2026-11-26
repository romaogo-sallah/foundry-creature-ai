import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {CombatLab,assertCombat,renderCombatReport} from '../src/simulation/combat-lab.mjs';
import {combatLabScenarios} from '../src/simulation/scenarios.mjs';
import {gridFromAscii} from '../src/simulation/virtual-grid.mjs';
import {combatFrames} from '../src/simulation/replay.mjs';
import {decisionGraphRecord,simulationDecisions} from '../src/simulation/decision-tree.mjs';
import {buildDecisionGraph} from '../src/foundry/decision-graph.mjs';

const reportDirectory=new URL('../.scratch/combat-lab/',import.meta.url);
const reportPath=scenario=>new URL(`${scenario.id}.md`,reportDirectory);
const ogresVsKobolds=JSON.parse(await readFile(new URL('../simulations/ogres-vs-kobolds.json',import.meta.url),'utf8'));
const grandBattlefield=JSON.parse(await readFile(new URL('../simulations/six-ogres-vs-six-kobolds.json',import.meta.url),'utf8'));
let ogresVsKoboldsReport;
const runOgresVsKobolds=()=>ogresVsKoboldsReport??=new CombatLab(ogresVsKobolds).run();

async function save(report,scenario){
  await mkdir(reportDirectory,{recursive:true});const path=reportPath(scenario);await writeFile(path,renderCombatReport(report),'utf8');return fileURLToPath(path);
}

test('virtual grid exposes walls, cover, alternating diagonals and safe routing without Foundry',()=>{
  const {grid}=gridFromAscii(['.......','..#.+..','.......']);
  assert.equal(grid.sight({x:0,y:1},{x:6,y:1}).lineOfSight,false);
  assert.equal(grid.sight({x:3,y:0},{x:5,y:2}).coverBonus,2);
  const paths=grid.reachable({x:0,y:0},{speed:15});
  assert.equal(paths.find(entry=>entry.cell.x===2&&entry.cell.y===2).cost,15,'two diagonals alternate 5 ft then 10 ft');
  assert.ok(Number.isFinite(grid.routeDistance({x:0,y:1},[{x:6,y:1}])),'navigation routes around a blocked cell');
});

test('reverse route fields preserve cardinal and alternating-diagonal costs for repeated destination scoring',()=>{
  const {grid}=gridFromAscii(['.....','.....','.....','.....','.....']),goals=[{x:4,y:4}],field=grid.routeField(goals);
  assert.equal(field.distance({x:4,y:2}),2);assert.equal(field.distance({x:2,y:2}),3);
  assert.equal(field.distance({x:0,y:0}),6);assert.equal(grid.routeDistance({x:0,y:0},goals),6);
});

test('obscuring squares apply concealment when a targeting ray crosses or ends inside them',()=>{
  const {grid}=gridFromAscii(['.......','..??...','.......']);
  assert.equal(grid.sight({x:0,y:1},{x:6,y:1}).concealmentDC,5);
  assert.equal(grid.sight({x:0,y:0},{x:1,y:0}).concealmentDC,null);
  assert.equal(grid.sight({x:0,y:1},{x:2,y:1}).concealmentDC,5);
});

test('saved Ogre versus Kobold starting conditions retain distance and bounded terrain zones',()=>{
  assert.equal(ogresVsKobolds.actors.length,4);
  assert.equal(ogresVsKobolds.actors.find(actor=>actor.id==='kobold-one').position.x-
    ogresVsKobolds.actors.find(actor=>actor.id==='ogre-one').position.x,24);
  assert.equal(ogresVsKobolds.terrainZones.cover.length,6);assert.equal(ogresVsKobolds.terrainZones.obscuring.length,2);
  for(const zone of ogresVsKobolds.terrainZones.cover){assert.ok(zone.cells.length<=2,`${zone.id} is at most two squares`);
    for(const [x,y]of zone.cells)assert.equal(ogresVsKobolds.map[y][x],'+');}
  for(const zone of ogresVsKobolds.terrainZones.obscuring){assert.ok(zone.cells.length<=2,`${zone.id} is at most two squares`);
    for(const [x,y]of zone.cells)assert.equal(ogresVsKobolds.map[y][x],'?');}
  assert.ok(ogresVsKobolds.map.every(row=>row.length===29));
});

test('grand battlefield is a 300-foot square with two six-creature teams and varied terrain',()=>{
  assert.equal(grandBattlefield.map.length,60);assert.ok(grandBattlefield.map.every(row=>row.length===60));
  assert.equal(grandBattlefield.actors.length,12);
  assert.deepEqual(Object.fromEntries(['ogres','kobolds'].map(team=>[team,grandBattlefield.actors.filter(actor=>actor.team===team).length])),{ogres:6,kobolds:6});
  assert.equal(grandBattlefield.terrainZones.walls.length,6);assert.equal(grandBattlefield.terrainZones.cover.length,12);
  assert.equal(grandBattlefield.terrainZones.obscuring.length,6);assert.equal(grandBattlefield.terrainZones.difficult.length,4);
  assert.equal(grandBattlefield.terrainZones.pits.length,4);
  for(const actor of grandBattlefield.actors)assert.equal(grandBattlefield.map[actor.position.y][actor.position.x],actor.marker);
});

test('grand battlefield first round remains responsive and every Strike targets the opposing team',()=>{
  const report=new CombatLab(grandBattlefield,{maxRounds:1}).run(),teams=Object.fromEntries(grandBattlefield.actors.map(actor=>[actor.id,actor.team]));
  assert.equal(report.rounds[0].turns.length,12);assert.equal(report.findings.some(finding=>finding.severity==='error'),false);
  const strikes=report.rounds[0].turns.flatMap(turn=>turn.decisions.filter(decision=>decision.chosen?.kind==='strike')
    .map(decision=>({actorId:turn.actorId,targetId:decision.chosen.targetId})));
  assert.ok(strikes.length>0);for(const strike of strikes)assert.notEqual(teams[strike.actorId],teams[strike.targetId],`${strike.actorId} cannot Strike ally ${strike.targetId}`);
});

test('saved Ogre versus Kobold encounter runs through the production planner without structural errors',()=>{
  const report=runOgresVsKobolds();
  assert.ok(report.metrics.decisions>0);assert.equal(report.finalActors.length,4);
  assert.ok(report.rounds.flatMap(round=>round.turns).every(turn=>turn.decisions.every(decision=>decision.trace?.schema==='foundry-creature-ai/planning-trace@2')));
  assert.equal(report.findings.some(finding=>finding.severity==='error'),false);
  const frames=combatFrames(ogresVsKobolds,report),last=frames.at(-1);
  assert.equal(frames.length,report.metrics.decisions+1);
  assert.deepEqual(last.actors.map(actor=>({id:actor.id,hp:actor.hp,position:actor.position,alive:actor.alive})),
    report.finalActors.map(actor=>({id:actor.id,hp:actor.hp,position:actor.position,alive:actor.alive})));
  const entries=simulationDecisions(report,ogresVsKobolds);assert.equal(entries.length,report.metrics.decisions);
  for(const entry of entries){const graph=buildDecisionGraph(decisionGraphRecord(entry.decision));
    assert.ok(graph.nodes.some(node=>node.data.id==='planning-root'),`${entry.id} retains its planning root`);
    assert.ok(graph.nodes.length>1,`${entry.id} exposes a nontrivial decision graph`);assert.ok(graph.edges.length>0,`${entry.id} connects its graph`);}
  const first=entries[0].decision.trace,incoming=new Set(first.edges.map(edge=>edge.target));
  assert.ok(first.nodes.length<40,'the first decision is a pruned causal graph rather than a candidate dump');
  assert.ok(first.nodes.every(node=>node.id==='planning-root'||incoming.has(node.id)),'the graph has no structural orphans');
  assert.equal(first.nodes.some(node=>node.kind==='fact'||node.kind==='engagement'),false,'uncausal diagnostics are not rendered as branches');
  assert.deepEqual(first.nodes.filter(node=>node.kind==='or'&&node.layer===3&&node.status!=='pruned').map(node=>node.detail.planId),
    ['ranged','aggressive','defensive'],'every surviving tactic remains visible before shared actions converge');
  assert.ok(first.nodes.filter(node=>node.kind==='and').every(node=>node.detail.timeline.length>1),'one-step actions do not get fake method nodes');
  const actionIds=first.nodes.filter(node=>node.kind==='primitive'&&node.detail?.timeline).map(node=>node.detail.candidateId);
  assert.equal(new Set(actionIds).size,actionIds.length,'merged candidates appear once');
});

test('reload weapons unload after firing and cannot fire again before reloading',()=>{
  const report=runOgresVsKobolds();
  for(const actorId of ['kobold-one','kobold-two']){
    const decisions=report.rounds.flatMap(round=>round.turns.filter(turn=>turn.actorId===actorId).flatMap(turn=>turn.decisions));
    assert.ok(decisions.some(decision=>decision.chosen?.kind==='reload'),`${actorId} reloads its crossbow`);
    let loaded=true,shots=0,reloads=0;
    for(const decision of decisions){
      if(decision.chosen?.kind==='strike'&&decision.chosen.id.includes('crossbow')){
        assert.equal(loaded,true,`${actorId} only fires a loaded crossbow`);loaded=false;shots++;
      }else if(decision.chosen?.kind==='reload'&&decision.chosen.id.includes('crossbow')){
        assert.equal(loaded,false,`${actorId} does not reload an already loaded crossbow`);loaded=true;reloads++;
      }
    }
    assert.ok(shots>1,`${actorId} fires enough times to exercise reload persistence`);assert.ok(reloads>=shots-1);
    const weapon=report.finalActors.find(actor=>actor.id===actorId).weapons.find(entry=>entry.id==='crossbow');
    assert.equal(weapon.ammunition,20-shots,'each shot consumes one bolt');assert.equal(weapon.loaded,loaded);
  }
});

test('melee-primary ogres charge at full speed while ranged-primary kobolds keep ranged tactics',()=>{
  const report=new CombatLab(grandBattlefield,{maxRounds:1}).run(),turns=report.rounds[0].turns;
  for(const turn of turns.filter(entry=>entry.actorId.startsWith('ogre-'))){
    assert.equal(turn.decisions.length,3);assert.ok(turn.decisions.every(decision=>decision.plan?.id==='charge'));
    assert.ok(turn.decisions.every(decision=>decision.chosen?.kind==='stride'));
    assert.ok(turn.decisions.every(decision=>decision.effect.destination),'every charge action changes position');
  }
  for(const turn of turns.filter(entry=>entry.actorId.startsWith('kobold-')))
    assert.ok(turn.decisions.every(decision=>decision.plan?.id!=='charge'),'a crossbow skulk does not mistake its backup sword for its primary role');
});

for(const scenario of combatLabScenarios)test(`combat lab: ${scenario.name}`,async t=>{
  const report=new CombatLab(scenario).run(),path=await save(report,scenario);assertCombat(report,scenario.expect);
  assert.doesNotThrow(()=>structuredClone(report));assert.ok(report.rounds.length);
  const decisions=report.rounds.flatMap(round=>round.turns.flatMap(turn=>turn.decisions));
  assert.ok(decisions.some(decision=>decision.trace?.schema==='foundry-creature-ai/planning-trace@2'),'production hierarchy trace is retained');
  assert.match(renderCombatReport(report),/Top candidates:/);
  t.diagnostic(`${report.outcome.status}${report.outcome.winner?` (${report.outcome.winner})`:''}; ${report.metrics.decisions} decisions; report: ${path}`);
  for(const finding of report.findings)t.diagnostic(`${finding.severity.toUpperCase()} ${finding.code}: ${finding.message}`);
});

test('combat simulation is deterministic for a fixed seed',()=>{
  const scenario=combatLabScenarios[0],first=new CombatLab(scenario).run(),second=new CombatLab(scenario).run();
  assert.deepEqual(second,first);
});

test('range scenario closes before its first attack and records every scored alternative',()=>{
  const report=new CombatLab(combatLabScenarios.find(scenario=>scenario.id==='ranged-closes-before-bad-shot')).run();
  const turn=report.rounds[0].turns.find(entry=>entry.actorId==='javelin');
  assert.equal(turn.decisions[0].chosen.kind,'stride');
  const firstStrike=turn.decisions.find(decision=>decision.chosen.kind==='strike');
  assert.equal(firstStrike.effect.rangePenalty,0);assert.ok(firstStrike.alternatives.length>1);assert.ok(firstStrike.chosen.terms.length);
});
