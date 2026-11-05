import {performance} from 'node:perf_hooks';
import {Worker as NodeWorker} from 'node:worker_threads';
import {fixture} from '../test/helpers/eagle-fixture.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {planningWorker} from '../src/foundry/planning-worker.mjs';

class BrowserWorker {
  constructor(url){
    this.thread=new NodeWorker(`const {parentPort,workerData}=require('node:worker_threads');global.self=globalThis;global.postMessage=data=>parentPort.postMessage(data);import(workerData.url).then(()=>parentPort.on('message',data=>global.onmessage({data})));`,{eval:true,workerData:{url:url.href}});
    this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',e=>this.onerror?.(e));
  }
  postMessage(data){this.thread.postMessage(data);}
  terminate(){void this.thread.terminate();}
}

for(const backend of ['native','worker']){
  if(backend==='worker')globalThis.Worker=BrowserWorker;else delete globalThis.Worker;
  const f=fixture({altitude:25,size:18});f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
  for(const [id,x,y] of [['foe2',800,500],['foe3',1000,800]]){const token=f.addOgre(id,x,y);token.actor.alliance='party';token.actor.dimensions={height:10};}
  const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),calls={};
  for(const [object,key,label] of [[f.boss,'constrainMovementPath','collisionPaths'],[f.boss,'measureMovementPath','pathMeasurements'],[adapter,'targetAt','targetGeometry'],[adapter,'movementThreats','reactionQueries']]){
    const original=object[key].bind(object);object[key]=(...args)=>{calls[label]=(calls[label]??0)+1;return original(...args);};
  }
  const ledger=await adapter.readLedger(adapter.turnKey()),begin=performance.now(),state=await adapter.snapshot(ledger);
  console.log(JSON.stringify({fixtureOnly:true,backend:state.flight.planning.backend,enemies:state.enemies.length,
    routes:state.flight.moves.length,dives:state.flight.dives.length,choice:adapter.decide(state).chosen.kind,
    snapshotMs:Math.round(performance.now()-begin),calls,worker:planningWorker.status()}));
  planningWorker.close();
}
