import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,tallEnemy,addCeiling} from './helpers/eagle-fixture.mjs';
import {usePlanningWorker} from './helpers/browser-worker.mjs';
usePlanningWorker();
import {creatureProfile,createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {flightStepCost} from '../src/foundry/flight-costs.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {resolveFlightFall} from '../src/foundry/flight-falling.mjs';
import {flightThreats,flightSafety} from '../src/foundry/flight-safety.mjs';
const ns='foundry-creature-ai';
test('saved behavior choices from the ground-only fallback adopt the intrinsic flight capability',async()=>{
 const f=fixture();
 f.flags.set('token-boss:foundry-creature-ai:behaviors',{components:['recovery','movement','strikes']});
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),state=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
 assert.ok(state.behavior.configuration.components.includes('flight'));
 assert.ok(state.behavior.configuration.components.includes('diving'));
 assert.equal(adapter.decide(state).chosen.kind,'fly');
});
test('a grounded Eagle gets 3D flight routes including ascent and approach',async()=>{
 const f=fixture(),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 assert.equal(state.flight.speed,60);assert.ok(state.flight.moves.some(move=>move.elevation>=10));
 assert.ok(f.adapter.candidates(state).some(c=>c.kind==='fly'));assert.equal(f.calls.length,0,'preview has no rolls, moves or resource mutations');
});
test('a stopped Dive spends two actions but does not roll or spend MAP for its unattempted Talon Strike',async()=>{
 const f=fixture({altitude:15}),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 const dive=f.adapter.candidates(state).find(c=>c.kind==='eagleDive');assert.ok(dive);
 f.boss.document.move=async()=>false;
 f.adapter.decide=s=>({chosen:f.adapter.candidates(s).find(c=>c.id===dive.id),diagnostics:s.diagnostics});
 const result=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(result.actionsRemaining,1);assert.equal(result.attacksMade,0);assert.equal(result.uncertain,false);
 assert.equal(f.calls.some(c=>c[0]==='attack'),false);
});
test('flight clearance includes enemy elevation, body height and ordinary melee reach without needing a reaction',async()=>{
 const f=fixture({altitude:10});tallEnemy(f);
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 const threats=flightThreats(f.adapter,state,()=>f.player);
 assert.equal(threats[0].safeElevation,25);
 const point={...f.player.document};
 assert.equal(flightSafety(f.adapter,{...point,elevation:20},threats).safe,false);
 assert.equal(flightSafety(f.adapter,{...point,elevation:25},threats).safe,true);
 f.player.document.elevation=10;
 assert.equal(flightThreats(f.adapter,state,()=>f.player)[0].safeElevation,35,'a raised enemy raises the safe altitude');
});

test('a low ceiling produces a sideways escape rather than an illegal climb or an unsafe hover',async()=>{
 const f=fixture({altitude:10});tallEnemy(f);f.boss.document.x=400;
 canvas.scene.levels={get:()=>({elevation:{bottom:0,top:20}})};
 addCeiling(f,20);
 const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1};
 const state=await f.adapter.snapshot(ledger),choice=f.adapter.decide(state).chosen;
 assert.equal(choice.kind,'fly');assert.equal(choice.features.flightRetreat,true);
 assert.ok(choice.destination.elevation<=20);
 const move=state.flight.moves.find(m=>m.x===choice.destination.x&&m.y===choice.destination.y&&m.elevation===choice.destination.elevation);
 assert.equal(move.safety.safe,true);
 assert.ok(Math.abs(choice.destination.x-state.flight.origin.x)>0||Math.abs(choice.destination.y-state.flight.origin.y)>0);
});

test('Dive endpoints include the east and south sides of a Large footprint',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.player.document.width=2;f.player.document.height=2;f.player.w=200;f.player.h=200;
 Object.defineProperty(f.player,'mechanicalBounds',{get:()=>new PIXI.Rectangle(f.player.document.x,f.player.document.y,200,200)});
 f.boss.document.x=1000;
 f.boss.constrainMovementPath=path=>[path,path.at(-1).x<700];
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.ok(state.flight.dives.some(d=>d.destination.x===7),'the east perimeter is two cells beyond the top-left, not one');
 assert.ok(state.flight.dives.some(d=>d.destination.y===4),'the south perimeter is also enumerated');
});
