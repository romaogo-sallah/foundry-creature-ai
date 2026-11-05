import {registerRulesSetting,rulesSetting,setRulesSetting} from './rules-settings.mjs';
import {CORE_ID,CONDITIONS_ID} from './rules-context.mjs';
const ns='foundry-creature-ai',automations='pf2e-automations',workbench='xdy-pf2e-workbench';
const get=(module,key)=>{try{return module===ns?rulesSetting(key):game.settings.get(module,key);}catch{return undefined;}};
export function conditionAutomationOwners(){
  const nativeFlats=game.modules?.get(automations)?.active&&['attack','all'].includes(get(automations,'flatCheck'));
  const autoFear=game.modules?.get(automations)?.active&&get(automations,'decreaseFrightened');
  const workFear=game.modules?.get(workbench)?.active&&get(workbench,'decreaseFrightenedConditionEachTurn');
  return {manualFlatChecks:nativeFlats?automations:CORE_ID,managedFlatChecks:CORE_ID,
    frightened:autoFear?automations:workFear?workbench:'manual',duplicateFrightened:Boolean(autoFear&&workFear),
    stunned:game.modules?.get(workbench)?.active&&get(workbench,'autoReduceStunned')?workbench:CONDITIONS_ID,
    persistentDamage:game.modules?.get(workbench)?.active&&get(workbench,'applyPersistentDamage')?workbench:'native/manual'};
}
export function registerConditionCompatibility(){
  registerRulesSetting('preventDuplicateConditionAutomation',{name:'Prevent duplicate condition automation',scope:'world',config:true,type:Boolean,default:true,
    hint:'When PF2e Automations already reduces Frightened, disable this client’s duplicate Workbench reduction. Other Workbench options and native spell/save automation remain active.'});
  registerRulesSetting('conditionAutomationBackup',{scope:'client',config:false,type:Object,default:{}});
}
export async function applyConditionCompatibility(){
  const owners=conditionAutomationOwners();
  if(get(ns,'preventDuplicateConditionAutomation')===false||!owners.duplicateFrightened)return owners;
  const backup=get(ns,'conditionAutomationBackup')??{};
  if(!Object.hasOwn(backup,'workbenchFrightened'))await setRulesSetting('conditionAutomationBackup',{...backup,workbenchFrightened:true});
  // Workbench's preference is client-scoped. Do this on every loading client,
  // while PF2e Automations remains the single world-wide owner of the reduction.
  await game.settings.set(workbench,'decreaseFrightenedConditionEachTurn',false);
  return conditionAutomationOwners();
}
