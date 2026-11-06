import {filterConditionActions} from './condition-rules.mjs';
// This intentionally has no creature tactics, retreat, stealth or activity-plan
// scoring. Randomness chooses a target; execution still uses ordinary rules.
export const CONFUSED_KINDS=new Set(['strike','castSpell','stride','fly','stand','escape','reload','drawWeapon','stow','drawRefuse','hover']);
export function confusedCandidates(state){
  const stamp=state.confusion,tag=action=>({...action,features:{...action.features,confused:true,confusedStamp:stamp.stamp},targetId:action.targetId??stamp.targetId});
  const legal=filterConditionActions(state.confusedOptions??[],state.conditionRules).filter(action=>action.legal&&CONFUSED_KINDS.has(action.kind)&&
    action.actionCost<=state.actionsRemaining&&(action.bonusActionCost??0)<=(state.bonusMovementActions??0)&&
    (action.kind!=='castSpell'||action.features?.cantrip===true));
  const attacks=legal.filter(action=>['strike','castSpell'].includes(action.kind));
  const hover=legal.find(action=>action.kind==='hover');
  let offered;
  if(hover&&state.actionsRemaining===1){const approach=legal.filter(action=>action.kind==='fly');offered=approach.length?approach:[hover];}
  else if(hover&&attacks.length&&attacks.every(action=>action.actionCost>=state.actionsRemaining))offered=[hover];
  else if(attacks.length)offered=attacks;
  else{
    const recovery=legal.filter(action=>['escape','stand'].includes(action.kind));
    const equipment=legal.filter(action=>['reload','drawWeapon','stow','drawRefuse'].includes(action.kind));
    offered=recovery.length?recovery:equipment.length?equipment:legal.filter(action=>['stride','fly'].includes(action.kind));
    if(!offered.length&&hover)offered=[hover];
  }
  return offered.map(tag);
}
export function chooseConfusedAction(state){
  const options=confusedCandidates(state).sort((a,b)=>(b.assessment?.value??0)-(a.assessment?.value??0)||a.id.localeCompare(b.id));
  const chosen=options[0]??{id:'confused:end',kind:'endTurn',legal:true,actionCost:0,features:{confused:true}};
  return {chosen,reason:'confused: random target, simple attacks only',tiedIds:[],rejected:[],
    ranked:options.map(candidate=>({candidate,layer:2,utility:candidate.assessment?.value??0,terms:candidate.scoringTerms??[]})),
    diagnostics:{...state.diagnostics,confusion:state.confusion,turnComplete:!options.length&&!state.confusion.manual,
      noActionReason:options.length?null:state.confusion.manual??'Confused: no affordable simple attack remains; the remaining actions are wasted.'}};
}
