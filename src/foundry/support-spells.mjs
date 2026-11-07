import {createFireShield} from './fire-shield.mjs';
const ns='foundry-creature-ai';
export const taughtBuffs=actor=>(actor?.itemTypes.effect??[]).filter(e=>!e.isExpired&&(e.flags?.[ns]?.supportSpell||['haste','blur','invisibility','fleet-step','fire-shield'].some(s=>e.slug===`spell-effect-${s}`))).map(e=>e.flags?.[ns]?.supportSpell?.slug??e.slug.replace('spell-effect-',''));
export async function applySupportSpell(source,target,spell,definition){
 const existing=(target.actor.itemTypes.effect??[]).find(e=>e.flags?.[ns]?.supportSpell?.slug===spell.slug);
 if(existing)return {resolved:true,note:'This supported buff is already active; no duplicate effect was added.'};
 let raw={name:spell.name,type:'effect',img:spell.img,system:{slug:`spell-effect-${spell.slug}`,rules:[]}};
 if(definition.effectId){const native=await fromUuid(`Compendium.pf2e.spell-effects.Item.${definition.effectId}`);if(!native)throw new Error('Missing native spell effect: '+spell.name);raw=native.toObject();delete raw._id;}
 if(definition.condition){const conditions={concealed:'DmAIPqOBomZ7H95W',invisible:'zJxUflt9np0q4yML'};
  raw.system.rules=[{key:'GrantItem',uuid:`Compendium.pf2e.conditionitems.Item.${conditions[definition.condition]}`,inMemoryOnly:true}];}
 if(definition.energyWard){if(!['acid','cold','electricity','fire','sonic'].includes(definition.energyType))throw new Error('Resist Energy requires a known energy type');raw.system.rules=[{key:'Resistance',type:definition.energyType,value:spell.rank>=7?15:spell.rank>=4?10:5}];}
 // Native Fire Shield supplies shield statistics but assumes raised. This
 // component separates the buff from the later one-action Raise a Shield.
 let shieldId;
 if(spell.slug==='fire-shield'){shieldId=await createFireShield(target.actor,spell);raw.system.rules=raw.system.rules.filter(r=>r.key==='Resistance'||r.path==='flags.system.fireShield.resistance');}
 const duration=spell.slug==='invisibility'&&spell.rank>=4?60:definition.duration;
 if(!['sure-strike','shield'].includes(spell.slug))raw.system.duration={value:-1,unit:'unlimited',expiry:null,sustained:false};raw.system.level={value:spell.rank};
 raw.system.context={origin:{actor:source.actor.uuid,token:source.token.document.uuid,item:spell.uuid,spellcasting:null,rollOptions:[]}};
 raw.flags={...raw.flags,[ns]:{supportSpell:{slug:spell.slug,sourceTokenId:source.token.id,expiresAt:game.time.worldTime+duration,rank:spell.rank,shieldId},
  definedSpell:{castId:foundry.utils.randomID(),isRoot:true,slug:spell.slug,sourceTokenId:source.token.id,targetId:target.id,expiresAt:game.time.worldTime+duration,clearWhenEmpty:false}}};
 await target.actor.createEmbeddedDocuments('Item',[raw]);return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id,targetId:target.id},note:`${spell.name} protects ${target.name} for ${duration} seconds.`};
}
export async function endHostileInvisibility(token){
 const ids=(token.actor.itemTypes.effect??[]).filter(e=>e.flags?.[ns]?.supportSpell?.slug==='invisibility'&&e.flags[ns].supportSpell.rank<4).map(e=>e.id);
 if(ids.length)await token.actor.deleteEmbeddedDocuments('Item',ids);
}
