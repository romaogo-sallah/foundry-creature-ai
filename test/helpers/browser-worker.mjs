import {Worker as NodeWorker} from 'node:worker_threads';
import {after} from 'node:test';
import {planningWorker} from '../../src/foundry/planning-worker.mjs';
export class BrowserWorker{
 constructor(url){
  this.thread=new NodeWorker(`const {parentPort,workerData}=require('node:worker_threads');global.self=globalThis;global.postMessage=data=>parentPort.postMessage(data);import(workerData.url).then(()=>parentPort.on('message',data=>global.onmessage({data})));`,{eval:true,workerData:{url:url.href}});
  this.thread.on('message',data=>this.onmessage?.({data}));this.thread.on('error',error=>this.onerror?.(error));
 }
 postMessage(data){this.thread.postMessage(data);}
 terminate(){void this.thread.terminate();}
}
// Integration files exercise the normal production worker backend. Each file
// is a separate Node process; its Foundry globals and worker cannot race others.
export function usePlanningWorker(){
 const previous=globalThis.Worker;globalThis.Worker=BrowserWorker;planningWorker.failed=false;
 after(()=>{planningWorker.close();if(previous)globalThis.Worker=previous;else delete globalThis.Worker;});
}
