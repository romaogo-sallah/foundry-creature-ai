import {isTrueVampire,vampireAbility,vampireState,escapingMist} from './vampire-state.mjs';
import {prepareFireShieldDamage,finishFireShieldDamage} from './fire-shield.mjs';
import {magicShield,finishMagicShield} from './spell-attack-buffs.mjs';
const ns='foundry-creature-ai',locks=new WeakMap(),formFlag='vampireFormEffect';
export async function setVampireForm(token,form,{escape=false,retreat=null}={}){
 const actor=token.actor,previous=vampireState(actor);
 if(!isTrueVampire(actor))throw new Error('This actor has no true-vampire form abilities');
 const effectIds=(actor.itemTypes.effect??[]).filter(e=>e.flags?.[ns]?.[formFlag]).map(e=>e.id);
 if(effectIds.length)await actor.deleteEmbeddedDocuments('Item',effectIds);
 const mist=form==='mist',now=game.time.worldTime;
 if(mist){
  const template=await fromUuid('Compendium.pf2e.spell-effects.Item.sILRkGTwoBywy0BU');
  if(!template)throw new Error('Native Vapor Form effect is unavailable');
  const raw=template.toObject();delete raw._id;raw.name=escape?'Mist Escape':'Turn to Mist';
  raw.system.duration={value:-1,unit:'unlimited',expiry:null,sustained:false};
  raw.system.rules=[...raw.system.rules,{key:'RollOption',option:'turn-to-mist'}];
  raw.flags={...raw.flags,[ns]:{[formFlag]:true}};await actor.createEmbeddedDocuments('Item',[raw]);
  // The supplied Mastermind omitted this predicate. Patch only its own native
  // rule, so existing fast-healing automation remains the sole HP owner.
  for(const item of actor.itemTypes.action??[])if(item.system.rules?.some(r=>r.key==='FastHealing'&&!JSON.stringify(r.predicate??[]).includes('turn-to-mist')))
   await item.update({'system.rules':item.system.rules.map(r=>r.key==='FastHealing'?{...r,predicate:[...r.predicate??[],{not:'turn-to-mist'}]}:r)});
 }
 if(form==='bat'){
  const action=vampireAbility(actor,'vampire-true-change-shape'),strike=(action.system.rules??[]).find(r=>r.key==='Strike');
  const claw=actor.system.actions.find(a=>a.item?.isMelee&&a.item.traits?.has('unarmed'));
  const raw={name:'Vampire giant bat form',type:'effect',img:'icons/creatures/mammals/bat-movement-flying-purple.webp',
   system:{slug:'vampire-bat-form',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[
    {key:'BaseSpeed',selector:'land',value:20},{key:'BaseSpeed',selector:'fly',value:30},
    {key:'Sense',selector:'echolocation',range:40,acuity:'precise'},
    ...strike?[{...strike,predicate:[]}]:claw?[{key:'Strike',label:'Bat Fangs',category:'unarmed',group:'brawling',baseType:null,traits:[],attackModifier:claw.totalModifier,
     damage:{base:{dice:2,die:'d6',modifier:11,damageType:'piercing'}},replaceAll:true}]:[]]},flags:{[ns]:{[formFlag]:true}}};
  await actor.createEmbeddedDocuments('Item',[raw]);
 }
 await actor.setFlag(ns,'vampire',{...previous,form,escape,escapeTriggered:escape||previous.escapeTriggered,escaped:false,expiresAt:escape?now+7200:null,
  retreat:mist&&!escape?retreat:null,retreatUsedCombatId:retreat?.combatId??previous.retreatUsedCombatId??null});
 if(escape&&game.combat){const updates=Array.from(game.combat.combatants).filter(c=>c.tokenId===token.id).map(c=>({_id:c.id,defeated:false}));
  if(updates.length)await game.combat.updateEmbeddedDocuments('Combatant',updates);}
}
export async function ensureMistEscape(token){
 const actor=token?.actor;if(!actor||!isTrueVampire(actor)||actor.hitPoints?.value>0||vampireState(actor).destroyed||vampireState(actor).staked||vampireState(actor).coffin||vampireState(actor).escapeTriggered||escapingMist(actor))return;
 if(locks.has(token.document))return locks.get(token.document);
 const task=setVampireForm(token,'mist',{escape:true});locks.set(token.document,task);try{return await task;}finally{locks.delete(token.document);}
}
export async function vampireDamage(wrapped,options,...rest){
 if(escapingMist(this))return this;
 if(isTrueVampire(this)&&vampireState(this).staked&&(typeof options.damage==='number'&&options.damage<0||options.damage?.kinds?.has('healing')))return this;
 const shield=await prepareFireShieldDamage(this,options);
 const cantrip=options.shieldBlockRequest&&!options.final?magicShield(this):null;
 const result=await wrapped(options,...rest);
 await finishFireShieldDamage(this,shield);
 await finishMagicShield(this,cantrip);
 const token=canvas.tokens.placeables.find(t=>t.actor===this);if(token)await ensureMistEscape(token);
 return result;
}
export async function resolveVampireHealing(message){
 const actor=message.actor;
 if(!isTrueVampire(actor)||actor.hitPoints?.value<=0||vampireState(actor).staked||vampireState(actor).destroyed||vampireState(actor).form==='mist')return;
 if(game.modules.get('xdy-pf2e-workbench')?.active&&game.settings.get('xdy-pf2e-workbench','applyPersistentHealing'))return;
 if(!message.isDamageRoll||!message.rolls?.some(r=>r.kinds?.has('healing'))||!message.flavor?.includes(game.i18n.localize('PF2E.Encounter.Broadcast.FastHealing.fast-healing.ReceivedMessage')))return;
 const amount=message.rolls.reduce((n,r)=>n+(r.total??0),0);if(amount>0)await actor.applyDamage({damage:-amount,token:message.token,item:message.item,rollOptions:new Set([`${ns}:managed`]),skipIWR:true});
}
export function installVampireLifecycle({reactions,onError,packageId}){
 if(CONFIG.Actor?.documentClass?.prototype?.applyDamage)libWrapper.register(packageId,'CONFIG.Actor.documentClass.prototype.applyDamage',async function(wrapped,options,...rest){
  const before=(this.hitPoints?.value??0)+(this.hitPoints?.temp??0),result=await vampireDamage.call(this,wrapped,options,...rest);
  await reactions.afterDamage?.(this,options,before,(this.hitPoints?.value??0)+(this.hitPoints?.temp??0));return result;
 },'MIXED');
 Hooks.on('updateActor',actor=>{if(game.users.activeGM?.id!==game.user.id)return;const token=canvas.tokens.placeables.find(t=>t.actor===actor);
  if(token&&actor.hitPoints?.value<=0)void reactions.resolve(()=>ensureMistEscape(token)).catch(onError);});
 Hooks.on('createChatMessage',message=>{if(game.users.activeGM?.id===game.user.id)void reactions.resolve(()=>resolveVampireHealing(message)).catch(onError);});
 Hooks.on('updateWorldTime',()=>{if(game.users.activeGM?.id!==game.user.id)return;
  void reactions.resolve(async()=>{for(const token of canvas.tokens.placeables){const state=vampireState(token.actor);
   if(state.escape&&state.expiresAt<=game.time.worldTime){await setVampireForm(token,'vampire');if(!token.actor.hasCondition('unconscious'))await token.actor.increaseCondition('unconscious');}}}).catch(onError);});
}
