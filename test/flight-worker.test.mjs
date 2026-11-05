import test from 'node:test';
import assert from 'node:assert/strict';
import {Worker as NodeWorker} from 'node:worker_threads';
import {planFlightRoutes,rankDiveSetups,numericFlightCost} from '../src/framework/flight-worker-planner.mjs';
import {PlanningWorker,planningWorker} from '../src/foundry/planning-worker.mjs';
import {flightWorkerSnapshot} from '../src/foundry/flight-worker-snapshot.mjs';
import {fixture} from './helpers/eagle-fixture.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {fixture as manticoreFixture} from './helpers/manticore-fixture.mjs';

class BrowserWorker {
  constructor(url){
    this.thread=new NodeWorker(`const {parentPort,workerData}=require('node:worker_threads');global.self=globalThis;global.postMessage=data=>parentPort.postMessage(data);import(workerData.url).then(()=>parentPort.on('message',data=>global.onmessage({data})));`,{eval:true,workerData:{url:url.href}});
    this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));
  }
  postMessage(data){this.thread.postMessage(data);}
  terminate(){void this.thread.terminate();}
}
const model=()=>({origin:{x:1,y:2,elevation:0},footprint:{width:1,height:1,depth:5},budget:60,preferredElevation:25,
  goals:[{x:1,y:2,elevation:25},{x:6,y:2,elevation:25}],occupied:[],walls:[],surfaces:[],
  limits:{left:0,right:10,top:0,bottom:10,low:0,high:30}});
function enableWorker(t){globalThis.Worker=BrowserWorker;planningWorker.failed=false;t.after(()=>{planningWorker.close();delete globalThis.Worker;});}

test('numeric flight search produces a bounded shortlist with a legal ascent, without Foundry globals',()=>{
  const result=planFlightRoutes(model());assert.ok(result.nodes.length>0&&result.nodes.length<=24);
  assert.ok(result.nodes.some(n=>n.elevation===25));
  assert.equal(numericFlightCost([{x:0,y:0,elevation:0},{x:0,y:0,elevation:25}]),50);
  assert.equal(numericFlightCost([{x:0,y:0,elevation:25},{x:0,y:0,elevation:15}]),5);
});

test('worker routes respect a blocking wall and cannot climb through a deck',()=>{
  const wall=model();wall.walls=[{x1:3,y1:-10,x2:3,y2:20}];
  assert.ok(planFlightRoutes(wall).nodes.every(n=>n.x<=2));
  const deck=model();deck.surfaces=[{elevation:10,points:[{x:-10,y:-10},{x:20,y:-10},{x:20,y:20},{x:-10,y:20}]}];
  assert.ok(planFlightRoutes(deck).nodes.every(n=>n.elevation<=5));
});

test('worker permits traversing allies but cannot end in their occupied volume',()=>{
  const data=model();data.occupied=[{x:2,y:2,elevation:0,width:1,height:1,depth:30,passable:true}];
  const result=planFlightRoutes(data);
  assert.ok(!result.nodes.some(n=>n.x===2&&n.y===2&&n.elevation<30));
});

test('Dive ranking preserves per-enemy alternatives and rejects an unaffordable climb',()=>{
  const payload={origins:[{x:0,y:0,elevation:25}],speed:60,preferredElevation:25,
    endpoints:Array.from({length:20},(_,i)=>({enemyId:i<10?'one':'two',point:{x:i%10,y:0,elevation:5},value:2}))};
  const picks=rankDiveSetups(payload)[0];assert.equal(picks.length,8);
  assert.ok(picks.some(i=>i<10)&&picks.some(i=>i>=10));
  assert.deepEqual(rankDiveSetups({...payload,speed:20})[0],[]);
});

test('a real persistent worker handles routes and Dive setup requests and matches numeric fallback',async t=>{
  enableWorker(t);const client=new PlanningWorker();t.after(()=>client.close());
  const first=await client.request('routes',model());assert.deepEqual(first.result,planFlightRoutes(model()));
  const instance=client.worker,payload={origins:[{x:0,y:0,elevation:25}],endpoints:[],speed:60,preferredElevation:25};
  assert.deepEqual((await client.request('diveSetups',payload)).result,[[]]);assert.equal(client.worker,instance);
});

test('worker errors, timeouts, and cancellation settle requests without leaving reservations',async t=>{
  enableWorker(t);
  const client=new PlanningWorker({factory:()=>({postMessage(){},terminate(){}}),timeout:15});t.after(()=>client.close());
  assert.match((await client.request('routes',model())).error,/timed out/);
  assert.equal(client.pending.size,0);
  const second=new PlanningWorker({factory:()=>({postMessage(){},terminate(){}}),timeout:100});t.after(()=>second.close());
  const controller=new AbortController(),pending=second.request('routes',model(),{signal:controller.signal});controller.abort();
  assert.equal((await pending).cancelled,true);assert.equal(second.pending.size,0);
});

test('live adapter uses actual worker proposals, native validation and the Dive-then-climb turn',async t=>{
  enableWorker(t);const f=fixture({altitude:25});f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
  const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),state=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
  assert.equal(state.flight.planning.backend,'worker');assert.ok(state.flight.moves.length<=24);
  assert.equal(adapter.decide(state).chosen.kind,'eagleDive');
  const result=await new TurnRunner(adapter).run();
  assert.equal(result.uncertain,false);assert.equal(result.attacksMade,1);assert.equal(result.actionsRemaining,0);
  assert.ok(f.boss.document.elevation>=25);assert.equal(f.calls.find(c=>c[0]==='attack')[2],adapter.parts().talon.item.id);
});

test('worker retains melee approaches for a non-diving flyer and completes its Stinger and escape pass',async t=>{
  enableWorker(t);const f=manticoreFixture({altitude:25});f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
  const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),state=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
  assert.equal(state.flight.planning.backend,'worker');
  assert.ok(state.flight.moves.some(m=>m.attackEscape),'high-altitude routes must not crowd out melee attack positions');
  const result=await new TurnRunner(adapter).run();
  assert.equal(result.uncertain,false);assert.equal(result.attacksMade,1);assert.equal(result.actionsRemaining,0);
  assert.ok(f.boss.document.elevation>=25);assert.equal(f.calls.find(c=>c[0]==='attack')[2],adapter.parts().stinger.item.id);
  assert.equal(f.calls.filter(c=>c[0]==='venom-save').length,1);
});

test('worker snapshot excludes unseen live occupancy and remembers enemy positions',async()=>{
  const f=fixture({altitude:25}),state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  f.player.document.hidden=true;
  state.enemies[0].awareness={state:'known-square',position:{x:500,y:200,elevation:0,level:'ground',width:1,height:1,depth:1}};
  f.player.document.x=1100;f.player.document.y=800;
  const data=flightWorkerSnapshot(f.adapter,state);
  assert.equal(data.occupied.length,0);assert.equal('actor' in data,false);assert.equal('items' in data,false);
  assert.equal(data.goals.at(-1).x,5);assert.equal(data.goals.at(-1).y,2,'unseen live coordinates must not replace the remembered square');
  assert.doesNotThrow(()=>structuredClone(data));
});

test('native checks reject a worker route that the real scene blocks',async t=>{
  enableWorker(t);const f=fixture({altitude:25});f.boss.constrainMovementPath=path=>[path,true];
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.flight.planning.backend,'native');assert.equal(state.flight.moves.length,0);
});

test('Stop during worker planning returns before spending actions or moving',async t=>{
  enableWorker(t);const f=fixture({altitude:25});
  t.mock.method(planningWorker,'request',(type,payload,options)=>new Promise(resolve=>options.signal.addEventListener('abort',()=>resolve({cancelled:true}),{once:true})));
  const runner=new TurnRunner(createCreatureAdapter(f.boss,null,{reactions:f.reactions}));
  const pending=runner.run();setTimeout(()=>runner.cancel(),20);
  const result=await pending;assert.equal(result.actionsRemaining,3);assert.equal(result.uncertain,false);
  assert.equal(f.calls.some(c=>['move','attack'].includes(c[0])),false);
});

test('a battlefield change while the worker runs discards its result and rebuilds the snapshot',async t=>{
  enableWorker(t);const f=fixture({altitude:25}),original=planningWorker.request.bind(planningWorker);let routeRequests=0;
  t.mock.method(planningWorker,'request',async(type,payload,options)=>{
    const result=await original(type,payload,options);
    if(type==='routes'&&++routeRequests===1)f.player.document.x+=100;
    return result;
  });
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(routeRequests,2);assert.equal(state.flight.planning.backend,'worker');assert.equal(f.calls.length,0);
});

test('worker failure falls back to native planning with a diagnostic reason',async t=>{
  enableWorker(t);const f=fixture({altitude:25});
  t.mock.method(planningWorker,'request',async()=>({error:'Test worker failure'}));
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.flight.planning.backend,'native');assert.match(state.flight.planning.reason,/Test worker failure/);
  assert.ok(state.flight.moves.length>0);assert.ok(f.adapter.decide(state).chosen);
});
