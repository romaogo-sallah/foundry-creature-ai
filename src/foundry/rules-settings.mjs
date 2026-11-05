import {MODULE_ID,ENVIRONMENT_ID,CONDITIONS_ID,MOVEMENT_ID} from './rules-context.mjs';
const owners={conditionRestrictions:CONDITIONS_ID,preventDuplicateConditionAutomation:CONDITIONS_ID,conditionAutomationBackup:CONDITIONS_ID,
  directionalZoneIndicators:ENVIRONMENT_ID,playerStealth:MOVEMENT_ID,manualMovementReactions:MOVEMENT_ID};
const registrations=new WeakMap();
export function rulesSettingNamespace(key){
  const owner=owners[key]??MODULE_ID;
  return game.settings?.settings?.has(`${owner}.${key}`)?owner:MODULE_ID;
}
export function rulesSetting(key){return game.settings?.get(rulesSettingNamespace(key),key);}
export function setRulesSetting(key,value){return game.settings.set(rulesSettingNamespace(key),key,value);}
export function registerRulesSetting(key,data){
  const owner=owners[key];if(!owner)throw new Error(`No rules package owns ${key}`);
  // Hidden aliases preserve old API callers and supply migration values even
  // when Creature AI is disabled or absent. Visible settings belong to features.
  if(!game.settings.settings?.has(`${MODULE_ID}.${key}`))game.settings.register(MODULE_ID,key,{...data,config:false});
  game.settings.register(owner,key,data);
  const entries=registrations.get(game)??new Map();entries.set(key,{owner,...data});registrations.set(game,entries);
}
export async function migrateRulesSettings(){
  for(const [key,data] of registrations.get(game)??[]){
    if(data.scope==='world'&&game.users.activeGM?.id!==game.user.id)continue;
    const storage=game.settings.storage?.get(data.scope);
    const stored=id=>data.scope==='client'?storage?.getItem(id):storage?.getSetting?storage.getSetting(id,null):storage?.getItem?.(id);
    if(!storage||stored(`${data.owner}.${key}`)!=null)continue;
    const legacy=stored(`${MODULE_ID}.${key}`);if(legacy===null||legacy===undefined)continue;
    await game.settings.set(data.owner,key,game.settings.get(MODULE_ID,key));
  }
}
