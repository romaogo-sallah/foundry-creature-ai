import { chooseOption } from '../dawnsbury/chooser.mjs';
import {gateFlightHunt} from './flight-candidates.mjs';
import {gateActivityGoal} from './activity-plan.mjs';
import {filterConditionActions} from './condition-rules.mjs';
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
    for (const id of [...plan.components,...plan.requires??[]]) if (!this.components.has(id)) throw new Error(`Unknown behavior component: ${id}`);
    if(plan.objective&&typeof plan.objective!=='function')throw new Error('A tactical objective needs a registered function');
    this.plans.set(plan.id, Object.freeze({ ...plan, components: Object.freeze([...plan.components]) })); return this;
  }
  configuration(raw, defaults) {
    if(raw?.components!==undefined&&!Array.isArray(raw.components)||raw?.plans!==undefined&&!Array.isArray(raw.plans)||
      raw?.preferredPlan!==undefined&&raw.preferredPlan!==null&&typeof raw.preferredPlan!=='string')throw new Error('Behavior configuration needs component/plan ID arrays and an optional preferred plan ID');
    const result = { components: [...new Set(raw?.components ?? defaults.components)],
      plans: [...new Set(raw?.plans ?? defaults.plans)], preferredPlan: raw?.preferredPlan ?? null };
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
    if (result.preferredPlan && !result.plans.includes(result.preferredPlan)) throw new Error('Preferred plan must be in the allowed plans');
    // Recovery, visibility investigation, basic attacks and movement remain
    // available when a specialized plan has no useful action left.
    for (const [id, component] of this.components) if (component.core && !result.components.includes(id)) result.components.push(id);
    return result;
  }
  select(state) {
    const { configuration, context, previous } = state.behavior;
    const scores = configuration.plans.flatMap(id => {
      const plan = this.plans.get(id);
      if(plan.requires?.some(component=>!configuration.components.includes(component)))return [];
      const result = plan.score(context, state);
      if (!result || !Number.isFinite(result.value)) return [];
      const continuity = previous?.planId === id && !context.emergency ? 0.75 : 0;
      const preference = configuration.preferredPlan === id && !context.emergency ? 2 : 0;
      return [{ id, label: plan.label, value: result.value + continuity + preference,
        reason: result.reason, continuity, preference }];
    }).sort((a,b) => b.value-a.value || a.id.localeCompare(b.id));
    // Every default includes aggressive. An actor's optional plans can all be
    // temporarily unavailable; retain the shared abilities rather than stall.
    const selected = scores[0] ?? { id: 'aggressive', label: 'Engage', value: 0, reason: 'No optional tactic is currently applicable' };
    const policies = this.plans.get(selected.id)?.components ?? [];
    const active = configuration.components.filter(id => this.components.get(id).kind !== 'policy' || policies.includes(id));
    const goal=this.plans.get(selected.id)?.objective?.(context,state,previous)??{kind:selected.id,label:selected.label};
    return { planId: selected.id, label: selected.label, reason: selected.reason, goal, activeComponents: active, scores,
      context: { ...context }, configuration };
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
  decide(state, offered, options = {}) {
    const built = this.candidates(state,offered,state.behavior.selection??this.select(state));
    const decision = chooseOption(built.candidates,{actionsRemaining:state.actionsRemaining,
      bonusMovementActions:state.bonusMovementActions??0,threatened:state.self.threatened,...options});
    return {...decision,rejected:[...decision.rejected,...built.rejected],diagnostics:{...state.diagnostics,tactic:built.selection}};
  }
}

// Profiles may still provide specialized forecasts, but all runtime profiles
// share the same plan/component gate and the same final legality/budget checks.
export function chooseBehaviorAction(system, candidates, state, options = {}) {
  candidates=candidates.filter(c=>!state.rejectedActionIds?.includes(c.id));
  return state.behavior ? system.decide(state,candidates,options) : chooseOption(filterConditionActions(candidates,state.conditionRules),{
    actionsRemaining:state.actionsRemaining,bonusMovementActions:state.bonusMovementActions??0,threatened:state.self.threatened,...options});
}
