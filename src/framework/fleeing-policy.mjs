import {filterConditionActions} from './condition-rules.mjs';
export function fleeingCandidates(state){
  if(state.self.unable)return [];
  const tag=action=>({...action,features:{...action.features,fleeing:true,fleeingStamp:state.fleeing.stamp}});
  const recovery=(state.fleeing.recovery??[]).filter(a=>['stand','escape'].includes(a.kind));
  const moves=(state.fleeing.moves??[]).filter(a=>a.progress>0).map(a=>({
    ...a,id:`flee:${a.kind}:${a.destination.x},${a.destination.y},${a.destination.elevation??''}`,legal:true,
    assessment:{value:100+a.progress},scoringTerms:[{label:'Escape the source as far as possible',contribution:a.progress}],
  }));
  return filterConditionActions([...moves,...recovery].map(tag),state.conditionRules).filter(a=>a.legal&&a.actionCost<=state.actionsRemaining&&(a.bonusActionCost??0)<=(state.bonusMovementActions??0));
}
export function chooseFleeingAction(state){
  const options=fleeingCandidates(state).sort((a,b)=>b.assessment.value-a.assessment.value||
    (a.terrainRisk??0)-(b.terrainRisk??0)||(a.reactionRisk??0)-(b.reactionRisk??0)||a.id.localeCompare(b.id));
  const chosen=options[0]??{id:'flee:end',kind:'endTurn',legal:true,actionCost:0,features:{fleeing:true,fleeingStamp:state.fleeing.stamp}};
  return {chosen,reason:'fleeing: escape overrides Confused and Controlled',tiedIds:[],rejected:[],
    diagnostics:{...state.diagnostics,turnComplete:chosen.kind==='endTurn',noActionReason:chosen.kind==='endTurn'?
      'No supported movement or recovery can make progress away from the known fleeing source.':null}};
}
