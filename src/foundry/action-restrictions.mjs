import {nativeRuleAction,manualConditionViolation,resolveConditionChecks} from './condition-actions.mjs';
import {conditionActivityActive} from './condition-activity.mjs';
import {rulesSetting} from './rules-settings.mjs';
const ns='foundry-creature-ai';
const actionConditions=['unconscious','dying','dead','paralyzed','petrified','stunned'];
const optionHas=(options,value)=>options?.has?.(value)??options?.includes?.(value)??false;
export function restrictionsEnabled(){
  try{return rulesSetting('conditionRestrictions')!==false;}catch{return true;}
}

function liveSource(item,actor,seen=new Set()){
  if(!item||item.isExpired||item.system?.disabled||seen.has(item.id))return false;
  seen.add(item.id);
  const parentId=item.flags?.pf2e?.grantedBy?.id;
  const parent=parentId?actor.items?.get?.(parentId):null;
  return !parentId||Boolean(parent&&liveSource(parent,actor,seen));
}
function effectRestriction(actor,key){
  const flag=actor.flags?.pf2e?.[key]??actor.getFlag?.('pf2e',key);
  if(flag!==true)return null;
  const sources=(actor.itemTypes?.effect??[]).filter(item=>item.system?.rules?.some(rule=>
    rule.key==='ActiveEffectLike'&&rule.path===`flags.pf2e.${key}`&&rule.value===true));
  // Respect native prepared flags and predicates. The ancestry check also
  // handles an unlimited granted marker whose timed parent just expired.
  const source=sources.find(item=>liveSource(item,actor));
  if(sources.length&&!source)return null;
  const parent=source&&actor.items?.get?.(source.flags?.pf2e?.grantedBy?.id);
  return {kind:key,sourceId:source?.id??null,reason:`${parent?.name??source?.name??'An active effect'}: ${key==='noActions'?'cannot use actions or reactions':'cannot use reactions'}.`};
}
export function actionRestriction(actor,{purelyMental=false}={}){
  if(!actor||!restrictionsEnabled())return null;
  const condition=actionConditions.find(slug=>actor.hasCondition?.(slug)&&!(slug==='paralyzed'&&purelyMental)&&
    !(slug==='stunned'&&Number.isInteger(actor.getCondition?.('stunned')?.value)&&conditionActivityActive(actor)));
  return condition?{kind:condition,reason:`Cannot act while ${condition}.`}:effectRestriction(actor,'noActions');
}
export function reactionRestriction(actor){
  if(restrictionsEnabled()&&actor?.hasCondition?.('confused'))return {kind:'confused',reason:'Cannot use reactions while confused.'};
  if(restrictionsEnabled()&&actor?.hasCondition?.('stunned'))return {kind:'stunned',reason:'Cannot use reactions while stunned.'};
  return actionRestriction(actor)??(restrictionsEnabled()?effectRestriction(actor,'noUseReactions'):null);
}

// One common native Check.roll wrapper owns terrain, stealth and restrictions.
// Saving throws, flat checks, initiative, rerolls and non-action perception
// remain possible when a creature cannot act.
export function checkRestriction(check,context={}){
  if(!restrictionsEnabled()||context.isReroll||context.createMessage===false)return null;
  if(!['attack-roll','skill-check','perception-check'].includes(context.type))return null;
  const options=context.options??[],item=context.item;
  const explicitReaction=optionHas(options,`${ns}:reaction`)||item?.actionCost?.type==='reaction'||
    ['reactive-strike','attack-of-opportunity','shield-block'].includes(context.action);
  if(context.type!=='attack-roll'&&!context.action&&!explicitReaction&&![...options].some(o=>o.startsWith('action:')))return null;
  const actor=context.actor??context.token?.actor??context.origin?.actor??context.origin?.token?.actor??
    context.token?.object?.actor??context.origin?.token?.object?.actor??check?.actor??item?.actor;
  const basic=explicitReaction?reactionRestriction(actor):actionRestriction(actor,{purelyMental:context.action==='recall-knowledge'});
  if(basic)return basic;
  const traits=[...(context.traits??[])].map(t=>typeof t==='string'?t:t.name);
  const kind=context.action??(context.type==='attack-roll'?'strike':null);
  const target=context.target?.token?.id;
  const reason=manualConditionViolation(actor,nativeRuleAction(item,{kind,traits:[...new Set([...traits,...item?.traits??[]])],targetId:target,reaction:explicitReaction}));
  return reason?{kind:'condition-rule',reason}:null;
}
export function notifyRestriction(actor,restriction){
  if(restriction)ui.notifications.warn(`${actor?.name??'Creature'}: ${restriction.reason}`);
}
export function blockedVoluntaryMovement(document,movement,options={}){
  if(!restrictionsEnabled()||options.isUndo||options.isPaste||options.teleport||
    options[`${ns}:ignore-action-restrictions`]&&game.user?.isGM)return false;
  // Passed waypoints may still carry the action of the previous move. A
  // forced displacement must be classified by the pending departure instead.
  const pending=movement.pending?.waypoints??[];
  const points=pending.length?pending:movement.passed?.waypoints??[];
  if(!points.length||points.every(p=>['displace','fall'].includes(p.action)))return false;
  const reason=manualConditionViolation(document.actor,{kind:points[0].action==='walk'?'stride':points[0].action,traits:['move']});
  const restriction=actionRestriction(document.actor)??(reason?{kind:'movement',reason}:null);
  if(!restriction)return false;
  notifyRestriction(document.actor,restriction);return true;
}

// Hook functions are exported separately for deterministic native-boundary
// tests and to avoid registering Check.roll a second time with libWrapper.
export async function guardCast(wrapped,spell,options){
  const reason=restrictionsEnabled()&&manualConditionViolation(this.actor,nativeRuleAction(spell,{kind:'castSpell',targetIds:[...game.user?.targets??[]].map(token=>token.id)}));
  const restriction=(spell?.actionCost?.type==='reaction'?reactionRestriction(this.actor):actionRestriction(this.actor))??(reason?{kind:'condition-rule',reason}:null);
  if(restriction){notifyRestriction(this.actor,restriction);return;}
  return wrapped(spell,options);
}
export async function guardItemMessage(wrapped,event,options={}){
  if(options.actualUse||options.actualCast){
    const action=nativeRuleAction(this,{targetIds:options[`${ns}:targets`]??[...game.user?.targets??[]].map(token=>token.id)});
    const reason=options.create!==false&&restrictionsEnabled()&&manualConditionViolation(this.actor,action);
    const restriction=(this.actionCost?.type==='reaction'?reactionRestriction(this.actor):actionRestriction(this.actor))??(reason?{kind:'condition-rule',reason}:null);
    if(restriction){notifyRestriction(this.actor,restriction);return;}
    if(options.create!==false&&restrictionsEnabled()&&!await resolveConditionChecks(this.actor,action,{manual:true,spellCard:true}))return;
  }
  return wrapped(event,options);
}
export function guardConsumable(wrapped,...args){
  const reason=restrictionsEnabled()&&manualConditionViolation(this.actor,nativeRuleAction(this));
  if(reason){notifyRestriction(this.actor,{reason});return;}
  return wrapped(...args);
}
export async function guardShieldDamage(wrapped,options,...rest){
  if(options?.shieldBlockRequest&&!options.final){
    const restriction=reactionRestriction(this);
    if(restriction){notifyRestriction(this,restriction);options={...options,shieldBlockRequest:false};}
  }
  // Damage must still be applied when an unavailable Shield Block is denied.
  return wrapped(options,...rest);
}
export function installRestrictionMovement(){
  Hooks.on('preMoveToken',(document,movement,options)=>blockedVoluntaryMovement(document,movement,options)?false:undefined);
}
export function installActionRestrictions({packageId=ns}={}){
  const items=CONFIG.PF2E?.Item?.documentClasses;
  if(items?.spellcastingEntry?.prototype?.cast)libWrapper.register(packageId,'CONFIG.PF2E.Item.documentClasses.spellcastingEntry.prototype.cast',guardCast,'MIXED');
  if(items?.consumable?.prototype?.consume)libWrapper.register(packageId,'CONFIG.PF2E.Item.documentClasses.consumable.prototype.consume',guardConsumable,'MIXED');
  if(CONFIG.Item?.documentClass?.prototype?.toMessage)libWrapper.register(packageId,'CONFIG.Item.documentClass.prototype.toMessage',guardItemMessage,'MIXED');
  if(CONFIG.Actor?.documentClass?.prototype?.applyDamage)libWrapper.register(packageId,'CONFIG.Actor.documentClass.prototype.applyDamage',guardShieldDamage,'WRAPPER');
}
