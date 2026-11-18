const ns='foundry-creature-ai';
export const sureStrike=actor=>(actor.itemTypes?.effect??[]).some(e=>!e.isExpired&&(e.slug==='spell-effect-sure-strike'||e.flags?.[ns]?.supportSpell?.slug==='sure-strike'));
export async function consumeSureStrike(actor){
 const ids=(actor.itemTypes?.effect??[]).filter(e=>(e.slug==='spell-effect-sure-strike'||e.flags?.[ns]?.supportSpell?.slug==='sure-strike')&&actor.items.has(e.id)).map(e=>e.id);
 if(ids.length)await actor.deleteEmbeddedDocuments('Item',ids);
}
export const magicShield=actor=>{const id=actor?.attributes?.shield?.itemId,effect=actor?.items?.get(id);return effect?.type==='effect'&&(effect.slug==='spell-effect-shield'||effect.flags?.[ns]?.supportSpell?.slug==='shield')?effect:null;};
export const shieldImmune=actor=>(actor.itemTypes?.effect??[]).some(e=>!e.isExpired&&(e.slug?.includes('shield-immunity')||e.sourceId?.endsWith('QF6RDlCoTvkVHRo4')));
// Another module (pf2e-automations) can end the spell on the same damage message, deleting the effect
// without waiting. Its deletion reaches this client a moment later, so a failed delete of an effect that
// then disappears is not an error.
async function deleteEndedEffect(actor,id){
 try{await actor.deleteEmbeddedDocuments('Item',[id]);}
 catch(error){
  for(let i=0;i<40&&actor.items.has(id);i++)await new Promise(resolve=>setTimeout(resolve,25));
  if(actor.items.has(id))throw error;
 }
}
export async function finishMagicShield(actor,effect){
 if(!effect)return;if(actor.items.has(effect.id))await deleteEndedEffect(actor,effect.id);if(shieldImmune(actor))return;
 const native=await fromUuid('Compendium.pf2e.spell-effects.Item.QF6RDlCoTvkVHRo4');if(!native)throw new Error('Native Shield immunity effect was not found');
 if(shieldImmune(actor))return;
 const raw=native.toObject();delete raw._id;await actor.createEmbeddedDocuments('Item',[raw]);
}
