// A complete activity competes as a turn goal, rather than losing its setup
// action to a better-looking atomic move. Bindings supply legal native steps;
// this module only budgets them and preserves a useful preferred first step.
export function activityPlan({id,label,steps,value}){
  if(!id||!steps?.length||!Number.isFinite(value)||steps.some(step=>!step.kind||!Number.isInteger(step.actionCost)||step.actionCost<0))
    throw new Error('An activity plan needs legal, costed steps and a finite value');
  return {id,label,steps,actionCost:steps.reduce((sum,step)=>sum+step.actionCost,0),value};
}

export function gateActivityGoal(state,candidates){
  const goal=state.activityGoal;
  if(!goal||state.morale?.broken||state.behavior?.context.emergency)return candidates;
  const ready=candidates.filter(candidate=>candidate.legal&&candidate.kind===goal.kind&&candidate.features?.turnPlan?.value>0&&
    candidate.features.turnPlan.actionCost<=state.actionsRemaining&&candidate.features.turnPlan.steps[0].actionCost===candidate.actionCost);
  if(!ready.length)return candidates;
  // Recovery and perception remain available, including priority Stand/Escape.
  // No actions are reserved here, and a stale plan is rebuilt by revalidation.
  const ids=new Set(ready.map(candidate=>candidate.id));
  return candidates.filter(candidate=>ids.has(candidate.id)||['stand','escape','seek','endTurn'].includes(candidate.kind));
}
