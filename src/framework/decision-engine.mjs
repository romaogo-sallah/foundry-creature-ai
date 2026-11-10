import {buildWolfCandidates,chooseWolfAction} from '../wolf/planner.mjs';
import {ogreCapabilities} from '../profiles/ogre-boss.mjs';
import '../profiles/ogre.mjs';
import {basicCapabilities} from '../profiles/basic-npc.mjs';
import {scoutCandidates} from '../profiles/kobold-scout.mjs';
import {pyroCandidates} from '../profiles/goblin-pyro.mjs';
import {chooseTacticalAction,tacticalBehaviors} from './tactical-behaviors.mjs';
import {castingCandidates} from './spell-evaluation.mjs';
import {casterTurnCandidates} from './caster-planning.mjs';
import {preparedStrikeCandidates} from './strike-capability.mjs';
import {seekCandidates} from './perception.mjs';
import {recoveryCandidates} from './recovery.mjs';
import {profileActions} from './profile-actions.mjs';
import {flightCandidates,gateFlightHunt} from './flight-candidates.mjs';
import {gateActivityGoal} from './activity-plan.mjs';
import {spikeVolleyCandidates} from './spike-volley.mjs';
import {casterScenarios} from './caster-scenarios.mjs';
import {waitingCaster} from './caster-defense.mjs';
import {chooseConfusedAction,confusedCandidates} from './confused-policy.mjs';
import {chooseFleeingAction,fleeingCandidates} from './fleeing-policy.mjs';
import {withdrawalPosition} from './withdrawal.mjs';
import {pitFlightCandidates} from './pit-escape.mjs';

export function finalizeDecisionState(state){
 if(state.dragon?.flightOptions?.length){
  state.dragon.flightSetups=state.dragon.flightOptions.flatMap(({move,areas})=>{
   const next={...state,actionsRemaining:state.actionsRemaining-1,enemies:state.enemies.map(e=>({...e,...move.targets[e.id]})),dragon:{...state.dragon,areas}};
   const follow=Math.max(0,...profileActions(next).map(c=>c.assessment.value),...preparedStrikeCandidates(next).map(c=>c.assessment.value));
   return follow<=0?[]:[{id:`dragon:fly:${move.x},${move.y},${move.elevation}`,kind:'fly',legal:true,actionCost:1,path:move.path,destination:{x:move.x,y:move.y,elevation:move.elevation},movementCost:move.cost,provokes:move.provokes,features:{flight:true},intent:'take an angle for breath or a full attack activity',assessment:{value:follow-(move.reactionRisk??0),movement:true,fullTurnPlan:true,goodAttacksLeft:true},scoringTerms:[{label:'Affordable breath or attack after flight',contribution:follow},{label:'Known reaction exposure',contribution:-(move.reactionRisk??0)}]}];
  });
 }
 if(!state.behavior)return state;
 state.behavior.context.immediateAttack ||= Boolean(state.spells&&castingCandidates(state).some(c=>c.assessment.value>0));
 state.casterScenarios=casterScenarios(state);state.behavior.selection=tacticalBehaviors.select(state);
 if(state.behavior.selection.planId==='lay-low')state.diagnostics.noActionReason='Known enemies are above available attack reach. Hold protection and estimated stealth until an attack becomes possible; Hide still requires cover or concealment.';
 if(state.casterDefense)state.casterDefense={...state.casterDefense,enabled:['defensive','hiding','avoiding','kiting','spell-control','spell-support'].includes(state.behavior.selection.planId)};
 return state;
}
function casterActions(state,model){return [...castingCandidates(state),...preparedStrikeCandidates(state),...profileActions(state,model.extra),
 ...(state.sustained??[]).filter(c=>state.actionsRemaining>0&&!state.plannedCapabilities?.includes(`sustain:${c.id}`)).map(c=>({id:`sustain:${c.id}`,kind:'sustainSpell',castId:c.id,legal:true,actionCost:1,features:{onceKey:`sustain:${c.id}`},assessment:{value:5},scoringTerms:[{label:'Maintain estimated ongoing benefit',contribution:5}]}))];}
function mistCandidates(state){const r=state.mistEscape;
 if(r.revert)return state.actionsRemaining>0?[{id:'mist:revert',kind:'vampireForm',form:'vampire',actionCost:1,legal:true,assessment:{value:20}}]:[{id:'mist:end',kind:'endTurn',actionCost:0,legal:true,assessment:{value:0}}];
 return r.atEdge?[{id:'mist:exit',kind:'escapeScene',actionCost:0,legal:true,assessment:{value:10000}}]:r.path.length&&state.actionsRemaining>0?[{id:'mist:fly',kind:'mistFly',actionCost:1,legal:true,path:r.path,destination:r.path.at(-1),movementCost:r.cost,assessment:{value:10000}}]:[{id:'mist:end',kind:'endTurn',actionCost:0,legal:true,assessment:{value:0}}];
}
function baseCandidates(state,model){
 if(state.mistEscape)return mistCandidates(state);
 let items=model.kind==='wolf'?buildWolfCandidates(state):['ogre','ogre-boss'].includes(model.kind)?ogreCapabilities.candidates(model.kind,state):model.kind==='kobold-scout'?scoutCandidates(state):model.kind==='goblin-pyro'?pyroCandidates(state):model.kind==='caster'?
  [{id:'end',kind:'endTurn',legal:true,actionCost:0,assessment:{value:0}},...recoveryCandidates(state,{canStrike:state.enemies.some(e=>e.inReach)}),...seekCandidates(state),...casterTurnCandidates(state,{actions:s=>casterActions(s,model)})]:basicCapabilities.candidates('basic-npc',state);
 if(model.profileId==='eagle')items.push(...state.flight?.dives??[]);
 if(model.profileId==='manticore-quill')items.push(...spikeVolleyCandidates(state));
 items.push(...state.dragon?.flightSetups??[]);
 if(model.casterAddon)items.push(...casterTurnCandidates(state,{actions:s=>casterActions(s,{...model,extra:{}}).filter(c=>['castSpell','sustainSpell'].includes(c.kind))}));
 if(state.flight||state.mistEscape)items=gateActivityGoal(state,gateFlightHunt(state,[...items,...flightCandidates(state)])).map(c=>state.flight?.airCombat?{...c,features:{...c.features,aerialPlan:state.flight.airCombat}}:c);
 return items;
}
export function decisionCandidates(state,model){
 if(state.fleeing)return fleeingCandidates(state);if(state.confusion)return confusedCandidates(state);
 let items=baseCandidates(state,model);
 if(state.bonusMovementActions){
  const extra=baseCandidates({...state,actionsRemaining:Math.max(1,state.actionsRemaining),bonusMovementActions:0},model).filter(c=>model.bonusKinds.includes(c.kind)&&c.actionCost===1&&!c.bonusActionCost).map(c=>({...c,id:`quickened:${c.id}`,actionCost:0,bonusActionCost:1,scoringTerms:[...c.scoringTerms??[],{label:'Restricted quickened action',contribution:0}]}));
  items=[...items.filter(c=>!state.hasteBonus||c.bonusActionCost!==1||model.bonusKinds.includes(c.kind)),...extra];
 }
 items.push(...state.pitActions??[]);
 items.push(...pitFlightCandidates(state));
 return state.behavior?tacticalBehaviors.candidates(state,items,state.behavior.selection??tacticalBehaviors.select(state)).candidates:items;
}
// All target/action ranking and remaining-turn forecasts run here. This module
// imports no Foundry code and has no access to rolls or the real scene.
export function planCreatureDecision({state,model,operation='decide'}){
 if(state.behavior)for(const [key,registry]of [['components',tacticalBehaviors.components],['plans',tacticalBehaviors.plans]])for(const id of state.behavior.configuration[key]??[])
  if(!registry.has(id))throw new Error(`Behavior ${id} is not registered in the decision worker; use a worker-compatible module or explicit native compatibility mode`);
 finalizeDecisionState(state);
 if(operation==='candidates')return decisionCandidates(state,model);
 if(state.fleeing)return chooseFleeingAction(state);if(state.confusion)return chooseConfusedAction(state);
 const options={actionsRemaining:state.actionsRemaining,bonusMovementActions:state.bonusMovementActions??0,threatened:state.self.threatened};
 const decision=chooseTacticalAction(decisionCandidates(state,model),state.mistEscape?{...state,behavior:null}:state,options);
 const end=decision.chosen?.kind==='endTurn';let diagnostics={...state.diagnostics,...decision.diagnostics};
 if(model.kind==='wolf'){
  // Preserve the detailed unavailable-action explanations from the Wolf policy.
  const rejected=chooseWolfAction({...state,behavior:null},null,{random:()=>0}).rejected;
  decision.rejected.push(...rejected);diagnostics.escapeExhausted=state.escapeBlocked&&end&&model.escapeConfigured;
  decision.reason+=state.morale?.broken?`; pack retreat: ${state.morale.reason}`:'';
 }
 if(['ogre','ogre-boss'].includes(model.kind)){
  decision.rejected.push(...model.unavailable);diagnostics.escapeExhausted=state.escapeBlocked&&state.self.immobile&&!state.moves.length;
  if(model.kind==='ogre'&&!state.refuseCount)decision.rejected.push({id:'refuse',kind:'strike',reason:'Refuse supply is empty; set Refuse remaining in controls'});
 }
 if(model.kind==='kobold-scout'&&!state.hideTargets.length&&state.enemies.some(e=>e.stealthChance>0))decision.rejected.push({id:'hide',kind:'hide',reason:'Still relying on the previous Hide/Sneak; no new hiding advantage for these observers'});
 if(model.kind==='goblin-pyro'){
  const hold=end&&waitingCaster(state);if(hold)decision.chosen.features={...decision.chosen.features,holdForApproach:true};
  diagnostics={...diagnostics,turnComplete:end&&(state.actionsRemaining===1||hold)&&!state.self.immobile&&!state.self.restrained&&!state.diagnostics.movementBlocked&&(hold||state.enemies.some(e=>e.lineOfSight!==false&&e.distance<=30)),holdForApproach:hold};
 }
 if(model.kind==='caster'&&!model.casterAddon&&!state.self.immobile&&!state.self.restrained)diagnostics.turnComplete=end;
 if(state.flight||state.mistEscape)delete diagnostics.turnComplete;
 if(end&&(state.mistEscape||state.flight?.canFly&&(state.flight.flown||!state.flight.airborne&&state.flight.airCombat?.mode==='disengage')))diagnostics.turnComplete=true;
 if(state.mistEscape)diagnostics.turnComplete=!state.mistEscape.path.length&&!state.mistEscape.atEdge;
 if(state.pitActions?.some(c=>c.legal))diagnostics.turnComplete=end;
 const tactic=diagnostics.tactic?.planId;
 if(end&&!state.self.immobile&&!state.self.restrained&&!state.escapeBlocked){
  if(tactic==='avoiding'&&!state.diagnostics.movementBlocked){diagnostics.turnComplete=true;diagnostics.noActionReason=withdrawalPosition(state).safe?'Hold this withdrawal position: known attacks are blocked or beyond the current safety distance.':'No safer supported retreat remains from this position; holding until a useful action becomes available.';}
  if(tactic==='hiding'&&!state.diagnostics.movementBlocked||tactic==='lay-low')diagnostics.turnComplete=true;
 }
 return {...decision,diagnostics};
}
