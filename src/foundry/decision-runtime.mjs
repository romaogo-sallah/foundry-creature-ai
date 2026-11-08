import {PlanningWorker} from './planning-worker.mjs';
import {decisionModel,planningData} from './decision-snapshot.mjs';
import {flightWorldStamp} from './flight-worker-snapshot.mjs';
import {planningBudget} from '../shared/planning-budget.mjs';
export const decisionWorker=new PlanningWorker({timeout:30000,interruptOnCancel:true});
let revision=0;const installed=new WeakSet();
export function installDecisionInvalidation(){
 if(!globalThis.Hooks?.on||installed.has(Hooks))return;installed.add(Hooks);
 for(const event of ['createToken','updateToken','deleteToken','moveToken','updateActor','createItem','updateItem','deleteItem','createRegion','updateRegion','deleteRegion','createRegionBehavior','updateRegionBehavior','deleteRegionBehavior','createWall','updateWall','deleteWall','updateCombat','updateCombatant','updateSetting','canvasReady'])Hooks.on(event,()=>revision++);
}
const stamp=adapter=>`${revision}:${flightWorldStamp(adapter)}`;
export const stalePlanning=()=>Object.assign(new Error('Battlefield changed while planning; rebuilding the decision'),{name:'StalePlanningError'});
export function attachDecisionSystem(adapter){
 const snapshot=adapter.snapshot.bind(adapter),stamps=new WeakMap();
 const useWorker=()=>game.settings?.get?.('foundry-creature-ai','decisionPlanningBackend')!=='native';
 adapter.snapshot=async(ledger,options={})=>{
  if(!useWorker())return snapshot(ledger,options);
  installDecisionInvalidation();
  const initial=stamp(adapter),budget=options.budget??planningBudget({signal:options.signal}),started=performance.now(),parts=adapter.parts;
  let cached;adapter.parts=()=>cached??=parts.call(adapter);
  try{
   await budget.checkpoint(true);const state=await snapshot(ledger,{...options,budget,deferDecision:true});
   state.decisionModel=decisionModel(adapter,state);
   state.diagnostics.preparation={elapsedMs:Math.round(performance.now()-started),yields:budget.yields,maxBatchMs:Math.round(budget.maxBatchMs)};
   if(initial!==stamp(adapter))throw stalePlanning();stamps.set(state,initial);return state;
  }finally{adapter.parts=parts;}
 };
 async function request(state,operation,options={}){
  if(!useWorker())return operation==='candidates'?adapter.candidates(state):adapter.decide(state);
  if(!decisionWorker.available())throw new Error('Decision Web Worker unavailable. Reload this client; AI is paused with its actions preserved. Native compatibility mode is available in module settings.');
  const initial=stamps.get(state)??stamp(adapter),started=performance.now();
  const payload={state:planningData(state),model:state.decisionModel??decisionModel(adapter,state),operation};delete payload.state.decisionModel;
  const response=await decisionWorker.request('decision',payload,{signal:options.signal});
  if(response.cancelled||options.signal?.aborted)throw Object.assign(new Error('Decision planning cancelled'),{name:'AbortError'});
  if(initial!==stamp(adapter))throw stalePlanning();
  if(response.error)throw new Error(`Decision worker stopped: ${response.error}. No action was spent; reload or retry after resolving the worker error.`);
  if(operation==='candidates'){if(!Array.isArray(response.result))throw new Error('Invalid worker candidates');return response.result;}
  if(!response.result?.chosen||!Array.isArray(response.result.rejected))throw new Error('Invalid worker decision');
  adapter.lastTactic=response.result.diagnostics?.tactic??null;
  if(state.behavior&&adapter.lastTactic)state.behavior.selection=adapter.lastTactic;
  return {...response.result,diagnostics:{...response.result.diagnostics,decisionPlanning:{backend:'worker',elapsedMs:Math.round(performance.now()-started)}}};
 }
 adapter.planDecision=(state,options)=>request(state,'decide',options);
 adapter.planningCandidates=(state,options)=>request(state,'candidates',options);
 return adapter;
}
