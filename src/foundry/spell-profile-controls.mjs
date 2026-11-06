import {spellDefinition,spellDefinitions,constructSpellDefinition,defineSpell,replaceCustomSpellDefinitions} from '../framework/spell-definitions.mjs';
import {registerRulesSetting,rulesSetting,setRulesSetting} from './rules-settings.mjs';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function registerSpellProfiles(){registerRulesSetting('spellProfiles',{scope:'world',config:false,type:Object,default:{}});}
export function loadSpellProfiles(){replaceCustomSpellDefinitions(Object.values(rulesSetting('spellProfiles')??{}));}
export async function saveSpellProfile(data){
 if(!game.user.isGM)throw new Error('Only the GM can teach spell rules');const definition=defineSpell(data);
 for(const outcome of definition.outcomes??[])for(const condition of outcome.conditions??[])if(!game.pf2e.ConditionManager.getCondition(condition.slug))throw new Error('Unknown native condition: '+condition.slug);
 const saved={...rulesSetting('spellProfiles'),[definition.slug]:definition};await setRulesSetting('spellProfiles',saved);loadSpellProfiles();return definition;
}
export async function openSpellProfiles(token=canvas.tokens.controlled[0]){
 if(!token?.actor||!game.user.isGM)throw new Error('Select an NPC as GM to teach its spells');
 const spells=token.actor.itemTypes.spell??[];if(!spells.length)throw new Error('This actor has no spells');
 const pick=await foundry.applications.api.DialogV2.prompt({window:{title:'Spell AI — choose spell'},content:`<select name="spell">${spells.map(s=>`<option value="${s.id}">${escape(s.name)} — ${spellDefinition(s)?'taught':'manual'}</option>`).join('')}</select>`,
  ok:{label:'Edit shared definition',callback:(_event,button)=>button.form.elements.spell.value},rejectClose:false});
 if(!pick)return;const spell=spells.find(s=>s.id===pick);
 let seed=spellDefinition(spell);if(!seed){try{seed=constructSpellDefinition(spell,{kind:spell.system.defense?.save?'save':spell.isAttack?'attack':spell.system.damage&&Object.values(spell.system.damage).some(d=>d.kinds?.includes('healing'))?'heal':'auto'});}catch{seed={slug:spell.slug,kind:'save',save:spell.system.defense?.save?.statistic??'will',actionCosts:[2],outcomes:[{damage:0},{damage:0},{damage:0},{damage:0}]};}}
 const result=await foundry.applications.api.DialogV2.wait({window:{title:`Spell AI — ${spell.name}`,resizable:true},position:{width:620,height:640},
  content:`<p>This definition is reused by every caster knowing this spell. Verify every rider before saving. Native range, area, damage, rank and casting resources are read from each spell item.</p><p>Outcome order: critical failure, failure, success, critical success. Duration is seconds; omit it for conditions with their own recovery.</p><textarea name="definition" style="width:100%;height:370px;font-family:monospace">${escape(JSON.stringify(seed,null,2))}</textarea>`,
  buttons:[{action:'save',label:'Save shared spell',callback:(_event,button)=>button.form.elements.definition.value},{action:'cancel',label:'Cancel'}],rejectClose:false});
 if(!result||result==='cancel')return;const definition=JSON.parse(result);if(definition.slug!==(spell.slug??spell.system.slug))throw new Error('Keep the selected spell slug');
 await saveSpellProfile(definition);ui.notifications.info(`Spell AI taught: ${spell.name}. Reused by every caster with this spell.`);
}
export const spellProfilesAPI={list:spellDefinitions,inspect:spellDefinition,construct:constructSpellDefinition,save:saveSpellProfile,open:openSpellProfiles};
