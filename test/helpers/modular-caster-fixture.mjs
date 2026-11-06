import {fixture as deroFixture} from './dero-fixture.mjs';
import {createCreatureAdapter} from '../../src/foundry/creature-profiles.mjs';
export function fixture(options={}){
 const f=deroFixture(options);f.actor.sourceId='Actor.shared-caster';
 const slugs=['sickened','stunned','clumsy','frightened','enfeebled','persistent-damage','drained','blinded','dazzled'];
 game.pf2e.ConditionManager={getCondition:slug=>slugs.includes(slug)?{sourceId:`Compendium.pf2e.conditionitems.Item.${slug}`,toObject:()=>({name:slug,type:'condition',system:{slug,value:{isValued:slug!=='persistent-damage',value:slug==='persistent-damage'?null:1}},flags:{}})}:null};
 for(const actor of [f.actor,f.player.actor]){
  Object.defineProperty(actor.itemTypes,'condition',{get:()=>[...actor.items.values()].filter(i=>i.type==='condition')});
  const sync=()=>{for(const slug of slugs)if(actor.itemTypes.condition.some(c=>c.slug===slug))actor.conditionsSet.add(slug);else actor.conditionsSet.delete(slug);};
  const get=actor.getCondition;actor.getCondition=(slug,{all=false}={})=>{
   const direct=actor.itemTypes.condition.filter(c=>c.slug===slug).map(c=>Object.assign(c,{value:c.system.value.value,getFlag:(ns,key)=>c.flags?.[ns]?.[key]}));
   return direct.length?(all?direct:direct.sort((a,b)=>b.value-a.value)[0]):get(slug,{all});};
  const create=actor.createEmbeddedDocuments,remove=actor.deleteEmbeddedDocuments;
  actor.createEmbeddedDocuments=async(...args)=>{const result=await create(...args);sync();return result;};
  actor.deleteEmbeddedDocuments=async(...args)=>{await remove(...args);sync();};
  actor.decreaseCondition=async condition=>{if(condition.value>1){condition.system.value.value--;condition.value--;}else await actor.deleteEmbeddedDocuments('Item',[condition.id]);sync();};
  const damage=actor.applyDamage;actor.applyDamage=async options=>{if(typeof options.damage==='number'&&options.damage<0){actor.hitPoints.value=Math.min(actor.hitPoints.max,actor.hitPoints.value-options.damage);f.calls.push(['healing-applied',actor.id,-options.damage,options]);return;}return damage(options);};
 }
 const BaseRoll=CONFIG.Dice.rolls[0];CONFIG.Dice.rolls=[class DamageRoll extends BaseRoll{constructor(formula){super(formula);f.calls.push(['native-damage-formula',formula]);}}];
 for(const entry of f.actor.itemTypes.spellcastingEntry)entry.consume=async(spell,rank,slotId)=>{
  f.calls.push(['consume-spell',spell.slug,rank,entry.id,slotId]);
  if(spell.isCantrip||spell.atWill)return true;
  if(entry.system.prepared.value==='innate'){const uses=spell.system.location.uses;if(!uses?.value)return false;uses.value--;return true;}
  if(entry.system.prepared.value==='prepared'){const slot=entry.system.slots[`slot${rank}`]?.prepared?.[slotId];if(!slot||slot.expended)return false;slot.expended=true;return true;}
  const slot=entry.system.slots[`slot${rank}`];if(!slot?.value)return false;slot.value--;return true;
 };
 f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});return f;
}
