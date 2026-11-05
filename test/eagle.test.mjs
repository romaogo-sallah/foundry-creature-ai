import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tallEnemy} from './helpers/eagle-fixture.mjs';
import {usePlanningWorker} from './helpers/browser-worker.mjs';
usePlanningWorker();
import {creatureProfile,createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {flightStepCost} from '../src/foundry/flight-costs.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {resolveFlightFall} from '../src/foundry/flight-falling.mjs';
import {flightThreats,flightSafety} from '../src/foundry/flight-safety.mjs';
const ns='foundry-creature-ai';
test('the supplied Eagle binds native Beak, agile Talon, 60-foot flight and two-action Dive',()=>{
 const f=fixture();assert.equal(creatureProfile(f.actor).id,'eagle');
 const parts=f.adapter.parts();assert.equal(parts.talon.item.name,'Talon');assert.equal(parts.dive.actionCost.value,2);
 assert.equal(parts.unsupported.length,0);assert.equal(parts.talon.variants[1].penalty,-4);
 assert.equal(createCreatureAdapter(f.boss).profileId,'eagle');
});
test('the complete controller first stages at altitude, then attacks and escapes on the next turn',async()=>{
 const f=fixture();f.player.document.x=1000;
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const ledger=await adapter.readLedger(adapter.turnKey()),state=await adapter.snapshot(ledger);
 const offered=adapter.candidates(state);
 assert.ok(!offered.some(c=>['stride','step','crawl'].includes(c.kind)));
 assert.equal(adapter.decide(state).chosen.kind,'fly');
 const result=await new TurnRunner(adapter).run();
 assert.equal(result.done,true);assert.equal(result.uncertain,false);
 assert.equal(f.calls.some(c=>c[0]==='attack'),false,'the opening turn builds a hunting position');
 assert.ok(f.boss.document.elevation>=15,'the Eagle finishes above the known threat height and reach');
 const moves=f.calls.filter(c=>c[0]==='move');assert.ok(moves.length);
 assert.ok(moves.every(c=>c[2].every(p=>p.action==='fly')));
 game.combat.round++;
 assert.equal(adapter.decide(await adapter.snapshot(await adapter.readLedger(adapter.turnKey()))).chosen.kind,'eagleDive');
 const next=await new TurnRunner(adapter).run();
 assert.equal(next.uncertain,false);assert.ok(f.calls.some(c=>c[0]==='attack'));
 assert.ok(f.boss.document.elevation>=15);
});
test('Eagle Dive requires a ten-foot descent and executes movement before one native agile Talon Strike',async()=>{
 const f=fixture({altitude:15}),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 const dive=f.adapter.candidates(state).find(c=>c.kind==='eagleDive');assert.ok(dive);
 assert.ok(dive.path[0].elevation-dive.destination.elevation>=10);assert.equal(dive.actionCost,2);assert.equal(dive.mapIncreases,1);
 f.adapter.decide=s=>({chosen:f.adapter.candidates(s).find(c=>c.id===dive.id),diagnostics:s.diagnostics});
 const result=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(result.actionsRemaining,1);assert.equal(result.attacksMade,1);
 const attack=f.calls.find(c=>c[0]==='attack');assert.ok(attack);assert.equal(attack[2],f.adapter.parts().talon.item.id);
 assert.ok(f.calls.findIndex(c=>c[0]==='move')<f.calls.indexOf(attack));
 assert.equal(f.boss.document.getFlag(ns,'flight').round,game.combat.round);
});
test('Arrest a Fall uses the shared reaction and prevents damage on a successful native Acrobatics check',async()=>{
 const f=fixture({altitude:15});f.actor.conditionsSet.add('prone');
 const result=await resolveFlightFall(f.boss,{reactions:f.reactions,applyDamage:true});
 assert.equal(result.fall,true);assert.equal(f.boss.document.elevation,0);
 assert.equal(f.calls.filter(c=>c[0]==='arrest').length,1);assert.equal(f.calls.some(c=>c[0]==='fall-damage'),false);
 assert.equal(f.actor.getFlag(ns,'reaction').kind,'arrest-a-fall');assert.equal(f.reactions.available(f.boss),false);
});

test('a complete Eagle turn Dives, attacks, then ends above the ogre reach instead of attacking twice',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const opening=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
 const choice=adapter.decide(opening).chosen;
 assert.equal(choice.kind,'eagleDive','start with the two-action activity instead of a Fly/Beak substitution');
 assert.equal(choice.features.turnPlan.actionCost,3);
 assert.deepEqual(choice.features.turnPlan.steps.map(step=>[step.kind,step.actionCost]),[['eagleDive',2],['fly',1]]);
 const result=await new TurnRunner(adapter).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);
 assert.equal(f.boss.document.elevation,25);
 assert.equal(f.calls.find(c=>c[0]==='attack')[2],adapter.parts().talon.item.id);
 const last=f.calls.filter(c=>['attack','move'].includes(c[0])).at(-1);
 assert.equal(last[0],'move','the last action retreats after the attack');
});

test('all four corners of a Large ten-foot-tall enemy use native three-axis reach at elevations ten and fifteen',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.player.document.width=2;f.player.document.height=2;f.player.w=200;f.player.h=200;
 Object.defineProperty(f.player,'mechanicalBounds',{get:()=>new PIXI.Rectangle(f.player.document.x,f.player.document.y,200,200)});
 const cell=f.adapter.cell(f.player.document);
 for(const [dx,dy] of [[-1,-1],[2,-1],[-1,2],[2,2]]){
  const point={x:cell.x+dx,y:cell.y+dy};
  const near=f.adapter.targetAt(point,f.player,[],{...f.adapter.topLeft(point),elevation:10});
  const far=f.adapter.targetAt(point,f.player,[],{...f.adapter.topLeft(point),elevation:15});
  assert.equal(near.distance,5);assert.equal(near.inReach,true);
  assert.equal(far.distance,10);assert.equal(far.inReach,false);
 }
});

test('blocked escape routes reject an otherwise clear Dive before actions or rolls are spent',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.boss.constrainMovementPath=path=>[path,path.at(-1).elevation>path[0].elevation];
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.equal(state.flight.dives.length,0);
 assert.notEqual(f.adapter.decide(state).chosen.kind,'eagleDive');
 assert.equal(f.calls.length,0);
});
