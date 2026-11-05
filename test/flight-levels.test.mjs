import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,addCeiling} from './helpers/eagle-fixture.mjs';
import {usePlanningWorker} from './helpers/browser-worker.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {flightBounds,floorBelow} from '../src/foundry/flight-surfaces.mjs';
import {flightPath,flightPoint,flightCollision} from '../src/foundry/flight-movement.mjs';
import {flightRoutePlanner} from '../src/foundry/flight-route-planner.mjs';
import {clearSightPath,clearAttackPath} from '../src/foundry/attack-path.mjs';
import {flightWorkerSnapshot,flightWorldStamp} from '../src/foundry/flight-worker-snapshot.mjs';
import {targetKnowledge} from '../src/foundry/target-memory.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
usePlanningWorker();
function levels(f){
 const contents=[{id:'ground',elevation:{bottom:0,top:20}},{id:'sky',elevation:{bottom:20,top:60}}];
 canvas.scene.levels={contents,get:id=>contents.find(l=>l.id===id)};return contents;
}

test('level boundaries alone create neither a ceiling nor an upper-level floor',()=>{
 const f=fixture({altitude:25});levels(f);f.boss.document.level='sky';
 assert.ok(flightBounds(f.boss).top>=60);assert.equal(floorBelow(f.boss),0);
 assert.equal(flightPoint(f.adapter,{x:2,y:2,elevation:15}).level,'ground');
 assert.equal(flightPoint(f.adapter,{x:2,y:2,elevation:25}).level,'sky');
});

test('flight planning can climb across an open twenty-foot level boundary and retain ground targets',async()=>{
 const f=fixture();levels(f);f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
 const ai=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const state=await ai.snapshot(await ai.readLedger(ai.turnKey()));
 assert.equal(state.flight.planning.backend,'worker');assert.ok(state.flight.moves.some(m=>m.elevation>=25));
 const result=await new TurnRunner(ai).run();assert.equal(result.uncertain,false);
 assert.ok(f.boss.document.elevation>=25);assert.equal(f.boss.document.level,'sky');
 assert.equal(ai.liveTarget(f.player.id),f.player,'climbing to another level must not lose a visible ground target');
 assert.ok(targetKnowledge(ai).checks.some(e=>e.target&&e.awareness.state==='observed'));
});

test('cross-level flight keeps measured ascent cost and explicit native level transitions',()=>{
 const f=fixture();levels(f);
 const points=flightPath(f.adapter,[{x:2,y:2,elevation:0},{x:2,y:2,elevation:30}]);
 assert.ok(points.some(p=>p.level==='ground')&&points.some(p=>p.level==='sky'));
 assert.equal(points.at(-1).elevation,30);assert.equal(f.boss.measureMovementPath(points).cost,60);
});

test('an actual surface ceiling blocks native and worker flight even when assigned only to another level',async()=>{
 const f=fixture();levels(f);const ceiling=addCeiling(f,20);ceiling.includedInLevel=id=>id==='sky';
 const ai=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),state=await ai.snapshot(await ai.readLedger(ai.turnKey()));
 assert.ok(state.flight.moves.every(m=>m.elevation+5<=20));
 assert.equal(flightCollision(ai,{x:200,y:200,elevation:10,level:'ground'},{x:200,y:200,elevation:25,level:'sky'}),false);
 const planner=flightRoutePlanner(ai,state);
 assert.equal(planner.routeClear([{x:2,y:2,elevation:0},{x:2,y:2,elevation:25}]),false);
 assert.ok(flightWorkerSnapshot(ai,state).surfaces.some(s=>s.elevation===20));
});

test('flying sight and attacks test surfaces across levels instead of seeing through an upper-level ceiling',()=>{
 const f=fixture({altitude:25});levels(f);f.boss.document.level='sky';
 assert.equal(clearSightPath(f.boss,f.player),true);assert.equal(clearAttackPath(f.boss,f.player),true);
 addCeiling(f,20);
 assert.equal(clearSightPath(f.boss,f.player),false);assert.equal(clearAttackPath(f.boss,f.player),false);
});

test('a physically overlapping token on another level remains an occupied flight destination',async()=>{
 const f=fixture({altitude:25});levels(f);f.player.document.elevation=25;f.player.document.level='sky';
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey())),planner=flightRoutePlanner(f.adapter,state);
 assert.equal(planner.canStop({x:5,y:2,elevation:25}),false);
 assert.ok(flightWorkerSnapshot(f.adapter,state).occupied.some(o=>o.x===5&&o.elevation===25));
});

test('upper-level wall rays are clipped to their actual elevation interval',()=>{
 const f=fixture();levels(f);const calls=[];
 CONFIG.Canvas={polygonBackends:{sight:{testCollision:(a,b,config)=>{calls.push({a,b,level:config.level.id});return config.level.id==='sky';}}}};
 f.player.document.level='sky';f.player.document.elevation=30;
 assert.equal(clearSightPath(f.boss,f.player),false);
 const upper=calls.find(c=>c.level==='sky');assert.ok(upper.a.elevation>=20&&upper.b.elevation>=20);
 calls.length=0;f.player.document.level='ground';f.player.document.elevation=0;
 assert.equal(clearSightPath(f.boss,f.player),true);assert.ok(calls.every(c=>c.level==='ground'));
});

test('level edits invalidate pending flight snapshots',()=>{
 const f=fixture();const all=levels(f),before=flightWorldStamp(f.adapter);all[1].elevation.bottom=25;
 assert.notEqual(flightWorldStamp(f.adapter),before);
});

test('an enemy can react to a reachable flyer across a level boundary, while a real ceiling blocks it',()=>{
 const f=fixture({altitude:10}),all=levels(f);all[0].elevation.top=10;all[1].elevation.bottom=10;
 f.boss.document.level='sky';f.boss.document.x=400;
 f.player.actor.items.set('reactive',{id:'reactive',type:'feat',slug:'reactive-strike',system:{}});
 f.player.actor.getReach=()=>10;
 f.player.actor.system.actions=[{type:'strike',item:{id:'sword',name:'Sword',isMelee:true},ready:true}];
 assert.equal(f.reactions.meleeStrikes(f.player,f.boss).length,1);
 addCeiling(f,8);assert.equal(f.reactions.meleeStrikes(f.player,f.boss).length,0);
});

test('a single scene level with no ceiling does not impose its top as a physical flight cap',async()=>{
 const f=fixture({altitude:15});canvas.scene.levels={get:()=>({elevation:{bottom:0,top:20}})};
 f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
 const state=await f.adapter.snapshot({...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1});
 assert.ok(state.flight.moves.some(m=>m.elevation>=25));
});
