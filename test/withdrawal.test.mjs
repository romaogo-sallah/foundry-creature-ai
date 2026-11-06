import test from 'node:test';
import assert from 'node:assert/strict';
import {withdrawalCandidates,withdrawalPosition} from '../src/framework/withdrawal.mjs';
import {tacticalBehaviors as system,defaultBehaviorConfiguration} from '../src/framework/tactical-behaviors.mjs';
import {fixture} from './helpers/ogre-fixture.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
const ns='foundry-creature-ai';
function state(){return {actionsRemaining:3,bonusMovementActions:0,nearestEnemy:9,self:{cell:{x:10,y:10}},visited:[],
  enemies:[{id:'scout-a',distance:45,physicalPath:true,tactics:{role:'ranged',rangeIncrement:60}},
    {id:'scout-b',distance:65,physicalPath:true,tactics:{role:'ranged',rangeIncrement:60}}],moves:[],
  behavior:{configuration:system.configuration({},defaultBehaviorConfiguration('ogre-boss')),
    context:{health:0.36,forceRatio:0.5,visibleEnemies:2,knownEnemies:2,immediateAttack:false}},diagnostics:{}};}
function move(x,distances,{blocked=false,kind='stride',risk=0}={}){return {x,y:10,kind,cost:10,path:[{x:10,y:10},{x,y:10}],reactionRisk:risk,
  nearestEnemy:Math.min(...distances)/5,targets:Object.fromEntries(distances.map((distance,i)=>[`scout-${i?'b':'a'}`,{distance,physicalPath:!blocked}]))};}
const end={id:'end',kind:'endTurn',legal:true,actionCost:0,assessment:{value:0}};

test('the round 18/19 Ogre Boss situation keeps withdrawing from archers beyond 30 feet',()=>{
  const s=state();s.moves=[move(12,[60,75])];const result=system.decide(s,[end]);
  assert.equal(result.diagnostics.tactic.planId,'avoiding');assert.equal(result.chosen.kind,'stride');
  assert.equal(result.chosen.features.avoidance,true);assert.ok(result.diagnostics.tactic.goal.desiredDistance>65);
});

test('breaking every firing line can beat a longer exposed retreat, even when it closes distance',()=>{
  const s=state();s.moves=[move(12,[70,80]),move(9,[40,60],{blocked:true})];
  const result=system.decide(s,[end]);assert.equal(result.chosen.destination.x,9);
  assert.equal(withdrawalPosition(s,s.moves[1]).safe,true);
});

test('concealment and cover reduce exposure but do not turn a nearby archer into a safe threat',()=>{
  const s=state();s.withdrawal=Object.fromEntries(s.enemies.map(e=>[e.id,{incoming:{coverBonus:4,concealed:true}}]));
  assert.equal(withdrawalPosition(s).safe,false);s.moves=[move(12,[70,80])];
  const candidates=withdrawalCandidates(s,system.select(s));assert.ok(candidates.length);
});

test('a genuinely blocked withdrawal can hold instead of moving endlessly',()=>{
  const s=state();s.enemies.forEach(e=>e.physicalPath=false);s.moves=[move(12,[70,80],{blocked:true})];
  assert.deepEqual(withdrawalCandidates(s,system.select(s)),[]);
});

test('withdrawal respects movement risk, restraints, visited squares and restricted actions',()=>{
  const s=state();s.moves=[move(12,[60,75],{risk:50})];assert.equal(withdrawalCandidates(s,system.select(s)).length,0);
  s.moves=[move(12,[60,75])];s.self.immobile=true;assert.equal(withdrawalCandidates(s,system.select(s)).length,0);
  s.self.immobile=false;s.visited=['12,10'];assert.equal(withdrawalCandidates(s,system.select(s)).length,0);
  s.visited=[];s.actionsRemaining=0;s.bonusMovementActions=1;
  const [choice]=withdrawalCandidates(s,system.select(s));assert.equal(choice.actionCost,0);assert.equal(choice.bonusActionCost,1);
  s.moves[0].kind='crawl';assert.equal(withdrawalCandidates(s,system.select(s)).length,0);
});

test('available safer movement takes precedence over regripping an unusable distant weapon',()=>{
  const s=state();s.moves=[move(12,[60,75])];
  const regrip={id:'regrip',kind:'regrip',legal:true,actionCost:1,assessment:{value:16.5}};
  const result=system.decide(s,[regrip,end]);assert.equal(result.chosen.kind,'stride');
  assert.match(result.rejected.find(e=>e.id==='regrip').reason,/safer retreat/);
  s.moves=[];assert.equal(system.decide(s,[regrip,end]).chosen.kind,'regrip','trapped creatures can still prepare a counterattack');
});

test('a prepared native Ogre Boss offers retreat moves from beyond 30 feet against a visible archer',async()=>{
  const f=fixture();f.actor.hitPoints.value=20;f.player.document.x=1200;
  f.player.actor.system.actions=[{type:'strike',item:{isRanged:true,isMelee:false,system:{range:{increment:120}}}}];
  f.adapter.parts().javelin.system.quantity=0;
  await f.boss.document.setFlag(ns,'config',{...f.boss.document.getFlag(ns,'config'),packMorale:false});
  const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
  const snapshot=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
  assert.ok(snapshot.enemies[0].distance>30);assert.equal(snapshot.enemies[0].tactics.rangeIncrement,120);
  const decision=adapter.decide(snapshot);assert.equal(decision.diagnostics.tactic.planId,'avoiding');
  assert.equal(decision.chosen.kind,'stride');assert.equal(decision.chosen.features.avoidance,true);
});
