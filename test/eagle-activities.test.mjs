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
test('flight cost doubles all upward steps, halves all downward steps and preserves higher terrain costs',()=>{
 const from={i:0,j:0,k:0};
 assert.equal(flightStepCost(5,from,{i:0,j:0,k:1},5),10);
 assert.equal(flightStepCost(10,from,{i:1,j:0,k:1},10),20,'an expensive upward diagonal doubles the full distance');
 assert.equal(flightStepCost(15,from,{i:1,j:0,k:1},10),20,'ordinary difficulty is not stacked on top of the ascent multiplier');
 assert.equal(flightStepCost(5,from,{i:0,j:0,k:-1},5),2.5);
 assert.equal(flightStepCost(2.5,from,{i:0,j:0,k:-1},5),2.5,'another provider already applying the discount is not halved again');
 assert.equal(flightStepCost(5,from,{i:1,j:0,k:-1},5),2.5);
 assert.equal(flightStepCost(10,from,{i:1,j:1,k:-1},10),5);
 assert.equal(flightStepCost(30,from,{i:1,j:0,k:1},10),30,'a higher native cost is preserved');
 assert.equal(flightStepCost(Infinity,from,{i:0,j:0,k:-1},5),Infinity);
});
test('an airborne Eagle can see ground targets, reserves its last action for Fly and cannot Stride in midair',async()=>{
 const f=fixture({altitude:15}),ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1};
 const state=await f.adapter.snapshot(ledger);assert.equal(state.enemies.length,1);assert.equal(state.moves.length,0);
 const choice=f.adapter.decide(state).chosen;
 assert.equal(choice.kind,'fly');assert.ok(choice.destination.elevation>=15);
 await f.adapter.saveLedger(ledger);
 const result=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(result.actionsRemaining,0);
 assert.equal(f.boss.document.getFlag(ns,'flight').round,game.combat.round);
});
test('lethal flight loss lands the corpse and reports falling damage without granting another action',async()=>{
 const f=fixture({altitude:15});f.actor.hitPoints.value=0;
 const result=await resolveFlightFall(f.boss,{reactions:f.reactions,applyDamage:true});
 assert.equal(result.fall,true);assert.equal(f.boss.document.elevation,0);assert.equal(f.calls.some(c=>c[0]==='arrest'),false);
 assert.equal(f.calls.find(c=>c[0]==='fall-damage')[1],7);
});
test('the last action climbs to 25 feet after attacking a ten-foot-tall reach-ten enemy, even after Fly was used',async()=>{
 const f=fixture({altitude:10});tallEnemy(f);f.boss.document.x=400;
 await f.boss.document.setFlag(ns,'flight',{combatId:game.combat.id,round:game.combat.round});
 const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1};
 const state=await f.adapter.snapshot(ledger),choice=f.adapter.decide(state).chosen;
 assert.equal(choice.kind,'fly');assert.equal(choice.features.flightRetreat,true);
 assert.equal(choice.destination.elevation,25);
 assert.equal(state.flight.moves.find(m=>m.x===choice.destination.x&&m.y===choice.destination.y&&m.elevation===25).safety.safe,true);
 const result=await f.adapter.execute(choice,ledger,{valid:()=>true});
 assert.equal(Boolean(result.pause),false);assert.equal(f.boss.document.elevation,25);
});

test('a safe flyer does not spend its last two actions on a Dive that leaves it in melee reach',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 const state=await f.adapter.snapshot({...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2});
 assert.equal(state.flight.safety.safe,true);
 assert.notEqual(f.adapter.decide(state).chosen.kind,'eagleDive');
});

test('a reduced Fly speed refuses a Dive whose return climb cannot fit one Fly action',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.actor.system.attributes.speed.otherSpeeds.find(s=>s.type==='fly').value=20;
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.equal(state.flight.speed,20);assert.equal(state.flight.dives.length,0);
 const result=await new TurnRunner(f.adapter).run();
 assert.equal(result.uncertain,false);assert.equal(f.calls.some(c=>c[0]==='attack'),false);
 assert.ok(f.boss.document.elevation>=25);
});
