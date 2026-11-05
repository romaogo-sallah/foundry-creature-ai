import {conditionViolation,conditionFlatChecks,ruleAction} from '../framework/condition-rules.mjs';
import {rulesSetting} from './rules-settings.mjs';
const ns='foundry-creature-ai';
export function conditionFacts(actor){
  const condition=slug=>Boolean(actor?.hasCondition?.(slug));
  return {restrained:condition('restrained'),grabbed:condition('grabbed')&&!condition('restrained'),
    immobilized:condition('immobilized')||condition('grabbed')||condition('restrained'),prone:condition('prone'),
    fascinated:condition('fascinated'),sickened:condition('sickened'),deafened:condition('deafened'),
    stupefied:condition('stupefied')?actor.getCondition('stupefied')?.value??1:0,
    synesthesia:(actor?.itemTypes?.effect??[]).some(effect=>!effect.isExpired&&effect.slug==='spell-effect-synesthesia'),
    fascinationSubjects:actor?.getFlag?.(ns,'conditionContext')?.fascinationSubjects??[]};
}
export function nativeRuleAction(item,extra={}){
  const traits=[...(item?.traits??item?.system?.traits?.value??[])];
  return ruleAction({kind:item?.type==='spell'?'castSpell':item?.slug??'item',traits,
    ingest:item?.type==='consumable'&&['potion','elixir','drug','food','beverage'].includes(item.system?.category),...extra});
}
export function manualConditionViolation(actor,action){return conditionViolation(conditionFacts(actor),action);}
export function automationOwnsFlatChecks(){
  if(!game.modules?.get?.('pf2e-automations')?.active)return false;
  try{return ['attack','all'].includes(game.settings.get('pf2e-automations','flatCheck'));}catch{return false;}
}
export async function resolveConditionChecks(actor,action,{token,valid=()=>true,manual=false,spellCard=false}={}){
  if(manual&&rulesSetting('conditionRestrictions')===false)return true;
  // Reuse the enabled module's native item/spell-card checks. Managed AI never
  // delegates an async failure to a fire-and-forget chat hook.
  if(manual&&spellCard&&automationOwnsFlatChecks())return true;
  for(const check of conditionFlatChecks(conditionFacts(actor),action)){
    if(!valid())throw new Error('Action changed before its condition check');
    const roll=await new Roll('1d20').evaluate();
    await roll.toMessage({speaker:ChatMessage.getSpeaker(token?{token:token.document??token}:{actor}),
      flavor:`${check.condition}: DC ${check.dc} (${roll.total>=check.dc?'success':'failure'})`,
      flags:{[ns]:{managed:true,conditionCheck:check.condition},pf2e:{context:{type:'flat-check',options:[`${ns}:managed`,'skip-handling-message']}}}});
    if(!valid())throw new Error('Action changed during its condition check');
    if(roll.total<check.dc){ui.notifications?.info?.(`${actor.name}: ${check.condition} flat check failed; the action is spent.`);return false;}
  }
  return true;
}
