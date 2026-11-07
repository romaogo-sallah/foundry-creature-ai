import {monsterAbility,abilityDamage,siphonLife} from './monster-abilities.mjs';
import {clearAttackPath,clearSightPath} from './attack-path.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {consumeSureStrike} from './spell-attack-buffs.mjs';
import {resistSpellDisruption,castingResourceReady} from './spell-disruption.mjs';
const ns='foundry-creature-ai';
export async function counterspell(reactions,{source,spell,valid=()=>true}){
 for(const reactor of canvas.tokens.placeables){
  if(reactor===source||!reactions.available(reactor)||!monsterAbility(reactor.actor,'counterspell')||!reactor.actor.isEnemyOf(source.actor)||
   detectionFor(reactor,source).state!=='observed'||!clearSightPath(reactor,source)||!clearAttackPath(reactor,source))continue;
  const matches=[];
  for(const entry of reactor.actor.itemTypes.spellcastingEntry??[])if(entry.system.prepared?.value==='prepared'&&!entry.system.prepared.flexible)
   for(const [key,slot]of Object.entries(entry.system.slots??{}))for(const [index,p]of Object.entries(slot.prepared??{})){
    const prepared=reactor.actor.items.get(p.id);
    if(!p.expended&&prepared?.slug===spell.slug&&Number(key.replace('slot',''))>0)matches.push({entry,prepared,rank:Number(key.replace('slot','')),slotId:Number(index)});
   }
  const binding=matches.sort((a,b)=>a.rank-b.rank)[0];if(!binding)continue;
  const result=await reactions.exclusive(reactor,async()=>{
   if(!valid()||!reactions.available(reactor))return false;
   const automatic=reactor.actor.type==='npc'&&reactor.document.getFlag(ns,'config')?.enabled;
   const answer=automatic?'counter':await reactions.prompts.ask({token:reactor,title:'Counterspell',description:`Counter ${source.name}'s ${spell.name} with the same prepared spell? The slot and reaction are spent even on failure.`,choices:[{id:'counter',label:'Counterspell'}],valid});
   if(answer==='pause')throw new Error('Counterspell is unresolved; casting is paused.');if(answer!=='counter')return false;
   const reservation=await reactions.reserve(reactor,'counterspell',valid);
   if(!await binding.entry.consume(binding.prepared,binding.rank,binding.slotId))throw new Error('Counterspell resource changed after reservation');
   const statistic=binding.entry.counteraction?.check;if(!statistic?.roll)throw new Error('Native counteract statistic is unavailable');
   const dc=spell.spellcasting?.statistic?.dc?.value??source.actor.itemTypes.spellcastingEntry.find(e=>e.id===spell.system.location.value)?.statistic.dc.value;
   const roll=await statistic.roll({skipDialog:true,dc:{value:dc},item:binding.prepared,token:reactor.document,label:`Counterspell: ${spell.name}`,extraRollOptions:[`${ns}:managed`,'skip-handling-message']});
   if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Counterspell check was not resolved');
   await reactions.confirm(reactor,reservation);return spell.rank<=[-1,binding.rank-1,binding.rank+1,binding.rank+3][roll.degreeOfSuccess];
  });
  if(result)return true;
 }
 return false;
}
export async function monsterStrikeEffects(reactions,{source,target,strike,degree,damageTaken=0,stage='complete',applyDamage=true,valid=()=>true}){
 if(stage!=='hit'&&damageTaken>0&&(strike.item.traits.has('unarmed')||strike.item.type==='melee'&&!strike.item.linkedWeapon))await siphonLife(source,target);
 if(stage==='damage')return;
 if(degree===3&&monsterAbility(source.actor,'draconic-momentum')&&source.document.getFlag(ns,'pyreRecharge'))await source.document.unsetFlag(ns,'pyreRecharge');
 const item=monsterAbility(target.actor,'boiling-blood');if(degree!==3||!strike.item.isMelee||!item||!reactions?.available(target))return;
 await reactions.exclusive(target,async()=>{
  if(!valid()||!reactions.available(target))return;
  const answer=target.actor.type==='npc'&&target.document.getFlag(ns,'config')?.enabled?'use':await reactions.prompts.ask({token:target,title:'Boiling Blood',description:`${source.name} critically hit ${target.name} in melee. Spill burning blood onto the attacker?`,choices:[{id:'use',label:'Boiling Blood'}],valid});
  if(answer==='pause')throw new Error('Boiling Blood reaction is unresolved');if(answer!=='use')return;
  const reserved=await reactions.reserve(target,'boiling-blood',valid);
  await abilityDamage(target,[source],{item,formula:'6d6[fire]',dc:29,applyDamage,valid});await reactions.confirm(target,reserved);
 });
}
export function installMonsterReactions({reactions,packageId}){
 reactions.beforeSpell=options=>reactions.resolve(()=>counterspell(reactions,options));
 reactions.afterStrike=options=>monsterStrikeEffects(reactions,options);
 if(globalThis.CONFIG?.PF2E?.Item?.documentClasses?.spellcastingEntry?.prototype?.cast)
  libWrapper.register(packageId,'CONFIG.PF2E.Item.documentClasses.spellcastingEntry.prototype.cast',async function(wrapped,spell,options={},...rest){
   if(options.consume===false||!canvas.ready||!castingResourceReady(this,spell,options))return wrapped(spell,options,...rest);
   const source=canvas.tokens.placeables.find(t=>t.actor===this.actor);if(!source)return wrapped(spell,options,...rest);
   const variant=spell.loadVariant?.({castRank:options.rank??spell.rank})??spell;
   // Consumption is left to native cast when no eligible counter exists. A
   // successful counter still consumes the triggering caster's actual slot.
   if(await reactions.beforeSpell({source,spell:variant})&&!await resistSpellDisruption(this.actor,source)){if(!await this.consume(spell,variant.rank,options.slotId))throw new Error('Countered casting resource could not be spent');
    ui.notifications.info(`${spell.name} was counterspelled; its casting resources remain spent.`);return;}
   return wrapped(spell,options,...rest);
  },'MIXED');
 reactions.afterDamage=async function(actor,options,before,after){
  if(options.final)return;
  const self=actor;
  const physical=options.damage?.instances?.some(i=>['bludgeoning','piercing','slashing'].includes(i.type)&&!i.persistent&&i.total>0),attack=options.item?.type==='weapon'||options.item?.type==='melee';
  if(physical&&attack)for(const effect of self.itemTypes.effect??[])if(effect.flags?.[ns]?.supportSpell?.slug==='mountain-resilience'){
   const expires=effect.flags[ns].supportSpell.expiresAt-60;if(expires<=game.time.worldTime)await self.deleteEmbeddedDocuments('Item',[effect.id]);
   else await effect.update({[`flags.${ns}.supportSpell.expiresAt`]:expires,[`flags.${ns}.definedSpell.expiresAt`]:expires});
  }
  const managed=options.rollOptions?.has?.(`${ns}:managed`)??options.rollOptions?.includes?.(`${ns}:managed`);
  if(!managed&&before>after&&attack){const source=canvas.tokens.placeables.find(t=>t.actor===options.item.actor),target=canvas.tokens.placeables.find(t=>t.actor===self);
   if(source&&target)await reactions.resolve(()=>monsterStrikeEffects(reactions,{source,target,strike:{item:options.item},degree:options.outcome==='criticalSuccess'?3:2,damageTaken:before-after,stage:'damage'}));}
 };

 if(game.pf2e?.Check?.roll)libWrapper.register(packageId,'game.pf2e.Check.roll',async function(wrapped,check,context,...rest){
  const roll=await wrapped(check,context,...rest),managed=context?.options?.has?.(`${ns}:managed`)??context?.options?.includes?.(`${ns}:managed`);
  if(!managed&&context?.type==='attack-roll'&&roll){const source=(context.origin?.token??context.token)?.object;if(source)await consumeSureStrike(source.actor);}
  if(!managed&&context?.type==='attack-roll'&&['weapon','melee'].includes(context.item?.type)&&roll?.degreeOfSuccess>=2){
   const source=(context.origin?.token??context.token)?.object,target=context.target?.token?.object;
   if(source&&target)await reactions.resolve(()=>monsterStrikeEffects(reactions,{source,target,strike:{item:context.item},degree:roll.degreeOfSuccess,stage:'hit'}));
  }return roll;
 },'WRAPPER');
}
