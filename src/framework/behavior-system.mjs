import { chooseOption } from '../dawnsbury/chooser.mjs';
import {gateFlightHunt} from './flight-candidates.mjs';
import {gateActivityGoal} from './activity-plan.mjs';
import {filterConditionActions} from './condition-rules.mjs';
import {analyzeDecisionHierarchy,mergePortfolioCandidates,planArchetype,planningTrace,weightHierarchicalCandidate} from './hierarchical-planner.mjs';
const policyBase=Symbol('behavior policy input');

// Components are registered module code. Actor documents store identifiers and
// data only: neither descriptions nor flags are evaluated as JavaScript.
export class BehaviorSystem {
  constructor() { this.components = new Map(); this.plans = new Map(); }
  registerComponent(component) {
    if (!component.id || this.components.has(component.id) ||
      component.candidates && typeof component.candidates !== 'function' ||
      component.adjust && typeof component.adjust !== 'function' || component.execute && typeof component.execute!=='function' ||
      component.enrich && typeof component.enrich!=='function') throw new Error('Invalid or duplicate behavior component');
    this.components.set(component.id, Object.freeze({ ...component })); return this;
  }
  registerPlan(plan) {
    if (!plan.id || this.plans.has(plan.id) || typeof plan.score !== 'function' || !Array.isArray(plan.components))
      throw new Error('Invalid or duplicate tactical plan');
    if(plan.intent!==undefined&&typeof plan.intent!=='string'||plan.delivery!==undefined&&!Array.isArray(plan.delivery)||
      plan.posture!==undefined&&typeof plan.posture!=='string')throw new Error('Tactical plan metadata needs an intent, delivery array and posture');
    for (const id of [...plan.components,...plan.requires??[]]) if (!this.components.has(id)) throw new Error(`Unknown behavior component: ${id}`);
    if(plan.objective&&typeof plan.objective!=='function')throw new Error('A tactical objective needs a registered function');
    this.plans.set(plan.id, Object.freeze({ ...plan, components: Object.freeze([...plan.components]),
      ...(plan.delivery?{delivery:Object.freeze([...plan.delivery])}:{}) })); return this;
  }
  configuration(raw, defaults) {
    if(raw?.components!==undefined&&!Array.isArray(raw.components)||raw?.plans!==undefined&&!Array.isArray(raw.plans)||
      ['preferredPlan','backupPlan','desperatePlan'].some(key=>raw?.[key]!==undefined&&raw[key]!==null&&typeof raw[key]!=='string'))
      throw new Error('Behavior configuration needs component/plan ID arrays and optional preferred, backup and desperate plan IDs');
    const result = { components: [...new Set(raw?.components ?? defaults.components)],
      plans: [...new Set(raw?.plans ?? defaults.plans)], preferredPlan: raw?.preferredPlan ?? null,
      backupPlan:raw?.backupPlan??null,desperatePlan:raw?.desperatePlan??null };
    const parameters=JSON.stringify(raw?.parameters??{},(_key,value)=>{
      if(['function','symbol','bigint','undefined'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))throw new Error('Component parameters must be JSON data');
      return value;
    });
    if(parameters.length>32768)throw new Error('Component parameters exceed 32 KB');
    result.parameters=JSON.parse(parameters);
    if(!result.parameters||typeof result.parameters!=='object'||Array.isArray(result.parameters))throw new Error('Component parameters need an object keyed by component ID');
    for (const id of result.components) if (!this.components.has(id)) throw new Error(`Unknown behavior component: ${id}`);
    for (const id of result.plans) if (!this.plans.has(id)) throw new Error(`Unknown tactical plan: ${id}`);
    if (!result.plans.length) throw new Error('At least one tactical plan is required');
    for(const [key,label]of [['preferredPlan','Preferred'],['backupPlan','Backup'],['desperatePlan','Desperate']])
      if(result[key]&&!result.plans.includes(result[key]))throw new Error(`${label} plan must be in the allowed plans`);
    // Recovery, visibility investigation, basic attacks and movement remain
    // available when a specialized plan has no useful action left.
    for (const [id, component] of this.components) if (component.core && !result.components.includes(id)) result.components.push(id);
    return result;
  }
  select(state) {
    const { configuration, context, previous } = state.behavior;
    const evaluations = configuration.plans.map(id => {
      const plan = this.plans.get(id);
      const missing=plan.requires?.filter(component=>!configuration.components.includes(component))??[];
      if(missing.length)return {id,label:plan.label,applicable:false,value:null,
        reason:`Missing required behavior${missing.length===1?'':'s'}: ${missing.join(', ')}`};
      const result = plan.score(context, state);
      if (!result || !Number.isFinite(result.value)) return {id,label:plan.label,applicable:false,value:null,
        reason:'Current tactical conditions do not activate this plan'};
      const continuity = previous?.planId === id && !context.emergency ? 0.75 : 0;
      const preference = configuration.preferredPlan === id && !context.emergency ? 2 : 0;
      return {id,label:plan.label,applicable:true,value:result.value+continuity+preference,baseValue:result.value,
        reason:result.reason,continuity,preference};
    });
    const scores = evaluations.filter(evaluation=>evaluation.applicable)
      .sort((a,b) => b.value-a.value || a.id.localeCompare(b.id));
    // Every default includes aggressive. An actor's optional plans can all be
    // temporarily unavailable; retain the shared abilities rather than stall.
    const selected = scores[0] ?? { id: 'aggressive', label: 'Engage', value: 0, reason: 'No optional tactic is currently applicable' };
    const remaining=scores.filter(score=>score.id!==selected.id);
    const configuredBackup=remaining.find(score=>score.id===configuration.backupPlan);
    const backup=configuredBackup??remaining[0]??null;
    const configuredDesperate=remaining.find(score=>score.id===configuration.desperatePlan&&score.id!==backup?.id);
    const desperate=configuredDesperate??remaining.find(score=>score.id==='desperate')??null;
    const summary=(entry,source)=>entry?{planId:entry.id,label:entry.label,reason:entry.reason,score:entry.value,source}:null;
    const hierarchy={preferred:summary(selected,configuration.preferredPlan===selected.id?'configured':'ranked'),
      backup:summary(backup,configuredBackup?'configured':'next-best'),
      desperate:summary(desperate,configuredDesperate?'configured':'engagement-fallback'),used:'preferred'};
    const analysis=analyzeDecisionHierarchy(state,evaluations,this.plans);
    return this.selection(state,evaluations,selected,hierarchy,'preferred',analysis);
  }
  selection(state,evaluations,selected,hierarchy,stage,analysis=analyzeDecisionHierarchy(state,evaluations,this.plans)){
    const {configuration,context,previous}=state.behavior;
    const policies = this.plans.get(selected.id)?.components ?? [];
    const active = configuration.components.filter(id => this.components.get(id).kind !== 'policy' || policies.includes(id));
    const goal=this.plans.get(selected.id)?.objective?.(context,state,previous)??{kind:selected.id,label:selected.label};
    return { planId: selected.id, label: selected.label, reason: selected.reason, goal, activeComponents: active,
      scores:evaluations.filter(evaluation=>evaluation.applicable).sort((a,b)=>b.value-a.value||a.id.localeCompare(b.id)),evaluations,
      hierarchy:{...hierarchy,used:stage},stage,context: { ...context }, configuration,
      planning:{analysis,archetype:planArchetype(selected.id,this.plans.get(selected.id))} };
  }
  fallbackSelection(state,primary,stage){
    const target=primary.hierarchy?.[stage];if(!target)return null;
    const selected=primary.evaluations.find(evaluation=>evaluation.id===target.planId&&evaluation.applicable);
    return selected?this.selection(state,primary.evaluations,selected,primary.hierarchy,stage,primary.planning?.analysis):null;
  }
  candidates(state, offered, selection = this.select(state)) {
    const enabled = new Set(selection.activeComponents);
    const rejected = [], candidates = [];
    const generated=new Map([...enabled].map(id=>[id,this.components.get(id).candidates?.(state,selection)??[]]));
    const withdrawing=selection.planId==='avoiding'&&(generated.get('withdraw')?.length??0)>0;
    for (const offeredCandidate of offered) {
      // Some adapters expose policy-gated candidates for native revalidation
      // and then pass them through decide. Always rescore their original input,
      // including after a changed plan, rather than adding policy terms twice.
      const original=offeredCandidate[policyBase]??offeredCandidate;
      const component = [...this.components.values()].find(component => component.actionKinds?.includes(original.kind));
      if (component && !enabled.has(component.id) && !component.core) {
        rejected.push({id:original.id,kind:original.kind,reason:`Behavior component ${component.id} is not attached`}); continue;
      }
      if(withdrawing&&component?.id==='equipment'&&!state.behavior.context.immediateAttack){
        rejected.push({id:original.id,kind:original.kind,reason:'Take an available safer retreat before preparing a weapon without an immediate attack'});continue;
      }
      if(withdrawing&&original.kind==='bellow'){
        rejected.push({id:original.id,kind:original.kind,reason:'Complete an available retreat before spending an action commanding allies'});continue;
      }
      if(selection.planId==='avoiding'&&!state.morale?.broken&&(original.assessment?.movement||['stride','step','crawl','escapeStride','fly'].includes(original.kind))&&!original.features?.avoidance){
        const move=state.moves?.find(move=>move.x===original.destination?.x&&move.y===original.destination?.y);
        const before=Math.min(...state.enemies.map(enemy=>enemy.distance));
        const after=move&&Math.min(...state.enemies.map(enemy=>move.targets[enemy.id]?.distance??0));
        if(after<before){rejected.push({id:original.id,kind:original.kind,reason:'This move closes on threats while trying to disengage'});continue;}
      }
      if(selection.planId==='hiding'&&original.assessment?.movement&&!original.features?.defensiveSetup&&!original.features?.stealthPreserved){
        const move=state.moves?.find(move=>move.x===original.destination?.x&&move.y===original.destination?.y);
        if(move&&!move.behaviorProtectedGain){rejected.push({id:original.id,kind:original.kind,reason:'Hold the hiding position instead of advancing without protection'});continue;}
      }
      if(selection.planId==='lay-low'&&original.assessment?.movement&&!original.features?.defensiveSetup&&!original.features?.stealthPreserved){
        rejected.push({id:original.id,kind:original.kind,reason:'Take protection or retain stealth while the hunter is beyond attack reach'});continue;
      }
      candidates.push(original);
    }
    for (const id of enabled) for (const candidate of generated.get(id))
      if (!candidates.some(existing => existing.id === candidate.id || ['hide','stand','endTurn'].includes(candidate.kind) && existing.kind === candidate.kind ||
        candidate.kind==='strike'&&existing.kind==='strike'&&candidate.targetId===existing.targetId&&candidate.strikeId===existing.strikeId)) candidates.push(candidate);
    const adjusted = candidates.map(candidate => {
      const terms = [];
      // Priority recovery and native legality are never traded for a tactic.
      if (!Number.isFinite(candidate.assessment?.value) || candidate.assessment.value < 0 || candidate.assessment.value >= 5000 ||
        ['stand','escape','seek','endTurn'].includes(candidate.kind)) return candidate;
      for (const id of enabled) {
        const contribution = this.components.get(id).adjust?.(candidate,state,selection) ?? 0;
        if (Number.isFinite(contribution) && contribution) terms.push({label:`${selection.label}: ${this.components.get(id).label ?? id}`,contribution});
      }
      if (!terms.length) return candidate;
      const total = terms.reduce((sum,term) => sum+term.contribution,0), bound = Math.min(2,Math.max(0.5,Math.abs(candidate.assessment.value)*0.25));
      const bounded = Math.max(-bound,Math.min(bound,total)), scale = total===0?1:bounded/total;
      return {...candidate,[policyBase]:candidate,assessment:{...candidate.assessment,value:candidate.assessment.value+bounded},
        scoringTerms:[...(candidate.scoringTerms??[]),...terms.map(term=>({...term,contribution:term.contribution*scale}))]};
    });
    const flightSafe=filterConditionActions(gateActivityGoal(state,gateFlightHunt(state,adjusted)),state.conditionRules)
      .filter(c=>!state.rejectedActionIds?.includes(c.id));
    const maintenance=state.flight?.airborne&&!state.flight.flown&&flightSafe.some(c=>c.kind==='fly'&&c.legal);
    const takeoff=state.flight?.canFly&&!state.flight.airborne&&state.flight.airCombat?.mode!=='disengage'&&flightSafe.some(c=>c.kind==='fly'&&c.legal);
    return {candidates:takeoff?flightSafe.filter(c=>c.kind==='fly'||['escape','stand'].includes(c.kind)):
      maintenance?flightSafe.filter(c=>['fly','eagleDive'].includes(c.kind)||c.actionCost<state.actionsRemaining):flightSafe,rejected,selection};
  }
  portfolio(state,offered,primary=state.behavior.selection??this.select(state)){
    const analysis=primary.planning?.analysis??analyzeDecisionHierarchy(state,primary.evaluations,this.plans);
    const stageFor=planId=>primary.hierarchy?.preferred?.planId===planId?'preferred':primary.hierarchy?.backup?.planId===planId?'backup':
      primary.hierarchy?.desperate?.planId===planId?'desperate':'alternative';
    const selections=analysis.survivingPlanIds.map(planId=>{
      if(planId===primary.planId)return primary;
      const evaluation=primary.evaluations.find(entry=>entry.id===planId&&entry.applicable);
      return evaluation?this.selection(state,primary.evaluations,evaluation,primary.hierarchy,stageFor(planId),analysis):null;
    }).filter(Boolean);
    if(!selections.length)selections.push(primary);
    const runs=selections.map(selection=>{const built=this.candidates(state,offered,selection);return {...built,
      candidates:built.candidates.map(candidate=>{const weighted=weightHierarchicalCandidate(candidate,state,selection,analysis);
        weighted[policyBase]=candidate[policyBase]??candidate;return weighted;})};});
    return {...mergePortfolioCandidates(runs),analysis,runs,primary};
  }
  decide(state, offered, options = {}) {
    const portfolio=this.portfolio(state,offered),{analysis,runs,primary}=portfolio;
    const decision=chooseOption(portfolio.candidates,{actionsRemaining:state.actionsRemaining,
      bonusMovementActions:state.bonusMovementActions??0,threatened:state.self.threatened,...options});
    const chosenPlan=decision.chosen?.features?.planning?.planId,used=runs.find(run=>run.selection.planId===chosenPlan)?.selection??primary;
    const rejected=[...decision.rejected,...portfolio.rejected].filter((entry,index,all)=>
      all.findIndex(other=>other.id===entry.id&&other.reason===entry.reason)===index);
    const complete={...decision,rejected},trace=planningTrace(state,analysis,runs,complete,used);
    const tactic={...used,hierarchy:{...used.hierarchy,used:used.stage},planningTrace:trace};
    return {...complete,diagnostics:{...state.diagnostics,tactic}};
  }
}

// Profiles may still provide specialized forecasts, but all runtime profiles
// share the same plan/component gate and the same final legality/budget checks.
export function chooseBehaviorAction(system, candidates, state, options = {}) {
  candidates=candidates.filter(c=>!state.rejectedActionIds?.includes(c.id));
  const selectionOptions={variation:state.decisionVariation??0,...options};
  return state.behavior ? system.decide(state,candidates,selectionOptions) : chooseOption(filterConditionActions(candidates,state.conditionRules),{
    actionsRemaining:state.actionsRemaining,bonusMovementActions:state.bonusMovementActions??0,threatened:state.self.threatened,...selectionOptions});
}
