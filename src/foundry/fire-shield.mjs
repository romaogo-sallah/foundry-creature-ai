const ns='foundry-creature-ai';
export const fireShield=actor=>(actor.itemTypes.shield??[]).find(i=>i.flags?.[ns]?.fireShield);
export async function createFireShield(actor,spell){
 const hp=40+10*Math.floor((spell.rank-4)/2),[shield]=await actor.createEmbeddedDocuments('Item',[{name:'Fire Shield (spell)',type:'shield',img:spell.img,
  system:{slug:'spell-fire-shield',level:{value:spell.rank},acBonus:1,hardness:10,hp:{value:hp,max:hp},quantity:1,bulk:{value:0},
   equipped:{carryType:'held',handsHeld:1},traits:{value:['magical','fire']}},flags:{[ns]:{fireShield:{rank:spell.rank}}}}]);return shield.id;
}
export async function raiseFireShield(token){
 if(!fireShield(token.actor))return {skipped:true,skipReason:'The fire shield is no longer available'};
 await token.actor.createEmbeddedDocuments('Item',[{name:'Raised Fire Shield',type:'effect',img:'icons/svg/shield.svg',
  system:{slug:'raised-fire-shield',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[
   {key:'RollOption',option:'self:shield:raised'},{key:'ActiveEffectLike',mode:'override',path:'system.attributes.shield.raised',value:true},{key:'FlatModifier',selector:'ac',type:'circumstance',value:1}]},
  flags:{[ns]:{fireShieldRaised:true}}}]);return {resolved:true,note:'Fire Shield raised until the start of the next turn.'};
}
export async function prepareFireShieldDamage(actor,options){
 const shield=fireShield(actor);if(!shield||!options.shieldBlockRequest||actor.attributes.shield?.itemId&&actor.attributes.shield.itemId!==shield.id)return null;
 const hardness=options.item?.traits?.has?.('water')?5:10;
 if(shield.system.hardness!==hardness)await shield.update({'system.hardness':hardness});
 return {shield,originActor:options.item?.actor,item:options.item};
}
export async function finishFireShieldDamage(actor,pending){
 if(!pending)return;const {shield,originActor,item}=pending,source=canvas.tokens.placeables.find(t=>t.actor===actor),target=canvas.tokens.placeables.find(t=>t.actor===originActor);
 if(source&&target&&(item?.traits?.has?.('unarmed')||source.distanceTo(target)<=5)){
  const DamageRoll=CONFIG.Dice.rolls.find(c=>c.name==='DamageRoll'),dice=2+Math.floor((shield.flags[ns].fireShield.rank-4)/2),roll=await new DamageRoll(`${dice}d6[fire]`).evaluate();
  await roll.toMessage({speaker:ChatMessage.getSpeaker({token:source.document}),flavor:'Fire Shield retaliation',flags:{[ns]:{managed:true},pf2e:{suppressDamageButtons:true,context:{options:[`${ns}:managed`,'skip-handling-message']}}}});
  await target.actor.applyDamage({damage:roll,token:target.document,item:shield,rollOptions:new Set(['magical','fire',`${ns}:managed`])});
 }
 if(shield.system.hp.value<=0){const ids=(actor.itemTypes.effect??[]).filter(e=>e.flags?.[ns]?.supportSpell?.slug==='fire-shield'||e.flags?.[ns]?.fireShieldRaised).map(e=>e.id);
  if(ids.length)await actor.deleteEmbeddedDocuments('Item',ids);if(actor.items.has(shield.id))await actor.deleteEmbeddedDocuments('Item',[shield.id]);}
}
export function installFireShield({reactions,onError}){
 Hooks.on('pf2e.startTurn',c=>{if(game.users.activeGM?.id!==game.user.id)return;const actor=canvas.tokens.get(c.tokenId)?.actor,ids=(actor?.itemTypes.effect??[]).filter(e=>e.flags?.[ns]?.fireShieldRaised).map(e=>e.id);
  if(ids.length)void reactions.resolve(()=>actor.deleteEmbeddedDocuments('Item',ids)).catch(onError);});
 Hooks.on('deleteItem',item=>{const id=item.flags?.[ns]?.supportSpell?.shieldId;if(id&&item.actor?.items.has(id)&&game.users.activeGM?.id===game.user.id)
    void reactions.resolve(()=>item.actor.items.has(id)?item.actor.deleteEmbeddedDocuments('Item',[id]):undefined).catch(onError);});
}
