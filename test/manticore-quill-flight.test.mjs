import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/quill-fixture.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {setSpikesRemaining} from '../src/foundry/spike-supply.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {usePlanningWorker} from './helpers/browser-worker.mjs';
usePlanningWorker();
const adapter=f=>createCreatureAdapter(f.boss,null,{reactions:f.reactions});

test('quill flyers take off, shoot from above reach and spend one action remaining airborne',async()=>{
 const f=fixture();f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
 const ai=adapter(f),result=await new TurnRunner(ai).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 assert.ok(f.boss.document.elevation>=25);assert.ok(f.calls.some(c=>c[0]==='attack'));
 assert.ok(f.calls.filter(c=>c[0]==='attack').every(c=>c[2]===ai.parts().spike.item.id));
});

test('an airborne quill Manticore holds a good firing position and reserves its final Fly action',async()=>{
 const f=fixture({altitude:25}),ai=adapter(f),state=await ai.snapshot(await ai.readLedger(ai.turnKey()));
 assert.equal(state.flight.planning.backend,'worker');assert.equal(ai.decide(state).chosen.kind,'spikeVolley');
 const result=await new TurnRunner(ai).run();assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,2);assert.ok(f.boss.document.elevation>=25);
 assert.equal(f.calls.filter(c=>c[0]==='move').length,0,'hover maintenance does not become pointless lateral circling');
 assert.equal(f.boss.document.getFlag('foundry-creature-ai','flight').round,game.combat.round);
});

test('quill flyers close poor range rather than repeatedly wasting shots at -6',async()=>{
 const f=fixture({altitude:25,size:24});f.player.document.x=1900;
 const ai=adapter(f),state=await ai.snapshot(await ai.readLedger(ai.turnKey())),chosen=ai.decide(state).chosen;
 assert.equal(state.flight.ranged,true);assert.equal(chosen.kind,'fly');
 assert.ok(chosen.destination.x>state.flight.origin.x,'close the horizontal distance while remaining airborne');
});

test('empty quill supply switches to a measured melee flight pass instead of ending with no attack',async()=>{
 const f=fixture({altitude:25});f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;await setSpikesRemaining(f.actor,0);
 const ai=adapter(f),state=await ai.snapshot(await ai.readLedger(ai.turnKey()));
 assert.equal(state.flight.ranged,false);assert.ok(state.flight.hunt);
 assert.ok(!ai.candidates(state).some(c=>c.kind==='spikeVolley'||c.strikeId===ai.parts().spike.item.id));
 const result=await new TurnRunner(ai).run();assert.equal(result.uncertain,false);
 const attacks=f.calls.filter(c=>c[0]==='attack');assert.equal(attacks.length,1);assert.notEqual(attacks[0][2],ai.parts().spike.item.id);
 assert.ok(f.boss.document.elevation>=25);
});
