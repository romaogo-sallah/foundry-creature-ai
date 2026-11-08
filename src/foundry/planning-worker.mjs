// One persistent module worker; live Documents and their methods never cross
// this boundary. A failed worker leaves native planning available.
export class PlanningWorker {
  constructor({factory=()=>new Worker(new URL('../workers/flight-planner-worker.mjs',import.meta.url),{type:'module',name:'Creature AI planner'}),timeout=3000,interruptOnCancel=false}={}){
    this.factory=factory;this.timeout=timeout;this.interruptOnCancel=interruptOnCancel;this.pending=new Map();this.nextId=0;this.worker=null;this.failed=false;this.completed=0;
  }
  status(){return {supported:typeof globalThis.Worker==='function',active:Boolean(this.worker),failed:this.failed,pending:this.pending.size,completed:this.completed};}
  available(){return !this.failed&&typeof globalThis.Worker==='function';}
  start(){
    if(this.worker)return this.worker;
    const worker=this.worker=this.factory();
    worker.onmessage=({data})=>{const entry=this.pending.get(data?.id);if(entry){this.completed++;entry.finish(data.error?{error:data.error}:{result:data.result});}};
    worker.onerror=()=>{this.failed=true;this.close('The planning worker failed');};
    worker.onmessageerror=()=>{this.failed=true;this.close('The planning worker message could not be decoded');};
    return worker;
  }
  request(type,payload,{signal}={}){
    if(signal?.aborted)return Promise.resolve({cancelled:true});
    if(!this.available())return Promise.resolve({error:'Web Workers are unavailable'});
    return new Promise(resolve=>{
      const id=++this.nextId;let timer;
      const abort=()=>{finish({cancelled:true});if(this.interruptOnCancel)this.close('Planning cancelled');};
      const finish=result=>{if(!this.pending.has(id))return;this.pending.delete(id);clearTimeout(timer);signal?.removeEventListener('abort',abort);resolve(result);};
      this.pending.set(id,{finish});signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{this.failed=true;this.close('The planning worker timed out');},this.timeout);
      try{this.start().postMessage({id,type,payload});}catch(error){finish({error:error.message});this.failed=true;this.close(error.message);}
    });
  }
  close(reason='Planning worker stopped'){
    this.worker?.terminate();this.worker=null;
    for(const entry of [...this.pending.values()])entry.finish({error:reason});
  }
}
export const planningWorker=new PlanningWorker();
