// Native Documents must stay on the browser thread. Release that thread between
// bounded batches, and honor Stop even while no action has been reserved yet.
export const yieldPlanning = () => globalThis.scheduler?.yield?.() ?? new Promise(resolve=>setTimeout(resolve,0));
export function planningBudget({signal,valid=()=>true,milliseconds=8}={}){
 let start=performance.now(),deadline=start+milliseconds,yields=0,maxBatchMs=0;
 return {get yields(){return yields;},get maxBatchMs(){return Math.max(maxBatchMs,performance.now()-start);},check(){if(signal?.aborted||!valid())throw Object.assign(new Error('Planning cancelled'),{name:'AbortError'});},
  async checkpoint(force=false){this.check();if(force||performance.now()>=deadline){maxBatchMs=Math.max(maxBatchMs,performance.now()-start);await yieldPlanning();yields++;this.check();start=performance.now();deadline=start+milliseconds;}}};
}
