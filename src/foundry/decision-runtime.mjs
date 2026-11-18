import {PlanningWorker} from './planning-worker.mjs';
import {decisionModel,planningData} from './decision-snapshot.mjs';
import {flightWorldStamp} from './flight-worker-snapshot.mjs';
import {planningBudget} from '../shared/planning-budget.mjs';
export const decisionWorker=new PlanningWorker({timeout:30000,interruptOnCancel:true});
let revision=0;const installed=new WeakSet();
const PLANNING_EVENTS=['createToken','updateToken','deleteToken','moveToken','updateActor','createItem','updateItem','deleteItem','createRegion','updateRegion','deleteRegion','createRegionBehavior','updateRegionBehavior','deleteRegionBehavior','createWall','updateWall','deleteWall','updateCombat','updateCombatant','updateSetting','canvasReady'];
// Settings of these packages can change rules, movement or collisions. Others, such as a clock or a dice
// module saving its state, do not affect a plan.
export const PLANNING_SETTING_NAMESPACES=['core','pf2e','foundry-creature-ai','pf2e-tactical-core','pf2e-tactical-environment',
 'pf2e-tactical-conditions','pf2e-tactical-movement','pf2e-automations','xdy-pf2e-workbench','levels','wall-height'];
const sceneOf=document=>document?.documentName==='RegionBehavior'?document.parent?.parent:document?.parent;
function actorInScene(actor,scene){
 if(!actor||actor.documentName!=='Actor')return false;
 if(actor.token)return actor.token.parent?.id===scene.id;
 return scene.tokens?.some?.(token=>token.actorId===actor.id)??true;
}
/** Whether a world change can alter a plan for the viewed scene. Anything unclear counts as a change. */
export function planningChange(event,document){
 if(event==='canvasReady')return true;
 if(event==='updateSetting'){const namespace=String(document?.key??'').split('.')[0];return !namespace||PLANNING_SETTING_NAMESPACES.includes(namespace);}
 const scene=globalThis.canvas?.scene;if(!scene||!document)return true;
 if(event==='updateCombat'||event==='updateCombatant'){
  const combat=event==='updateCombat'?document:document.parent,current=globalThis.game?.combat;
  return !current||!combat||combat.id===current.id;
 }
 if(event==='updateActor')return actorInScene(document,scene);
 if(event.endsWith('Item'))return actorInScene(document.parent,scene);
 const parent=sceneOf(document);
 return !parent||parent.id===scene.id;
}
export function installDecisionInvalidation(){
 if(!globalThis.Hooks?.on||installed.has(Hooks))return;installed.add(Hooks);
 for(const event of PLANNING_EVENTS)Hooks.on(event,document=>{if(planningChange(event,document))revision++;});
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
