import {spellDefinition} from '../framework/spell-definitions.mjs';
import {averageFormula} from '../framework/math.mjs';
import {isTrueVampire} from './vampire-state.mjs';
const mode=entry=>entry.system?.prepared?.value;
export function spellBindings(actor){
 const result=[];
 const token=actor.token??globalThis.canvas?.tokens?.placeables?.find(t=>t.actor===actor)?.document,
  turn=game.combat?.started?`${game.combat.id}:${game.combat.round}:${game.combat.combatant?.id}`:null,
  bond=(actor.itemTypes.action??[]).find(a=>(a.slug??a.name.toLowerCase().replaceAll(' ','-'))==='drain-bonded-item'),
  canBond=bond?.system.frequency?.value>0&&game.combat?.combatant?.tokenId===token?.id&&token?.getFlag('foundry-creature-ai','vampireActions')?.turn!==turn;
 for(const spell of actor.itemTypes.spell??[]){
  const entry=(actor.itemTypes.spellcastingEntry??[]).find(e=>e.id===spell.system.location?.value);
  const definition=spellDefinition(spell);if(!entry||!definition||!Number.isFinite(entry.statistic?.dc?.value)||typeof entry.consume!=='function')continue;
  const casting=mode(entry),cantrip=Boolean(spell.isCantrip),focus=spell.isFocusSpell||casting==='focus',atWill=spell.atWill||spell.slug==='dominate'&&isTrueVampire(actor);
  const rank=spell.rank??spell.system.location.heightenedLevel??spell.system.level.value;
  const binding=(castRank,poolId,remaining,slotId=null)=>result.push({spell,entry,definition,castRank,poolId,remaining,slotId,cantrip,focus,atWill});
  if(focus&&!cantrip)binding(rank,'focus',actor.system.resources?.focus?.value??0);
  else if(casting==='prepared'&&!entry.system.prepared.flexible){
   for(const [key,slot]of Object.entries(entry.system.slots??{}))for(const [index,prepared]of Object.entries(slot.prepared??{}))
    if(prepared?.id===spell.id){if(!prepared.expended)binding(cantrip?rank:Number(key.replace('slot','')),cantrip?null:`${entry.id}:${key}:${index}`,cantrip?Infinity:1,Number(index));
     else if(canBond&&!cantrip)result.push({spell,entry,definition,castRank:Number(key.replace('slot','')),poolId:'bonded-item',remaining:1,slotId:Number(index),cantrip:false,focus:false,bonded:bond});}
  }else if(cantrip||atWill)binding(rank,null,Infinity);
  else if(casting==='innate')binding(rank,`${entry.id}:${spell.id}`,spell.system.location.uses?.value??0);
  else if(['spontaneous','prepared'].includes(casting)){
   const ranks=spell.system.location.signature?Object.keys(entry.system.slots??{}).map(key=>Number(key.replace('slot',''))).filter(r=>r>=rank&&r<=10):[rank];
   for(const r of ranks)binding(r,`${entry.id}:slot${r}`,entry.system.slots?.[`slot${r}`]?.value??0);
  }
 }
 return result;
}
export function averageSpellDamage(spell,rank){
 const base=spell.system.level.value,heightening=spell.system.heightening;
 const times=heightening?.type==='interval'?Math.max(0,Math.floor((rank-base)/heightening.interval)):0;
 const damage=heightening?.type==='fixed'?Object.entries(heightening.levels??{}).filter(([level])=>Number(level)<=rank).sort((a,b)=>Number(b[0])-Number(a[0]))[0]?.[1]?.damage:null;
 return Object.entries(damage??spell.system.damage??{}).reduce((sum,[key,part])=>sum+averageFormula(part.formula??'0')+times*averageFormula(heightening?.damage?.[key]??'0'),0);
}
export function spellDescriptor(binding,actionCost){
 const {spell,entry,definition,castRank,remaining,poolId,slotId,cantrip}=binding;
 const area=definition.area??spell.system.area;
 const rangeText=spell.system.range?.value??'',touchRange=rangeText==='touch'?Math.max(5,spell.actor?.getReach?.({action:'attack'})??5):null,range=touchRange??Number.parseFloat(rangeText);
 const shards=definition.shards?actionCost*(1+Math.floor((castRank-1)/2)):1;
 const damage=averageSpellDamage(spell,castRank)*shards;
 return {...definition,id:spell.id,name:spell.name,slug:spell.slug??spell.system.slug,entryId:entry.id,castRank,slotId,
  bindingId:`${entry.id}:${spell.id}:${castRank}:${slotId??'-'}:${actionCost}${binding.bonded?':bonded':''}`,poolId,resourceRemaining:Number.isFinite(remaining)?remaining:null,
  actionCost,resourceCost:binding.focus?(spell.system.cast?.focusPoints??1):1,cantrip,unlimited:!poolId,available:remaining>=(binding.focus?(spell.system.cast?.focusPoints??1):1),range:touchRange??definition.range??(Number.isFinite(range)?range:area?.value??0),
  maxTargets:definition.maxTargets??Math.min(12,Number.parseInt(spell.system.target?.value?.match(/\d+/)?.[0]??'1')),
  area,bonus:entry.statistic.check?.mod??0,dc:entry.statistic.dc.value,damage,meleeDamage:spell.slug==='ignition'?damage*1.4:damage,
  traits:[...new Set([...spell.traits??spell.system.traits?.value??[],...definition.domination&&isTrueVampire(spell.actor)?['visual']:[]])],areas:[]};
}
export function casterCatalog(actor){
 if(!actor?.itemTypes)throw new Error('Select an actor with spellcasting entries');
 const bindings=spellBindings(actor),spells=[...new Set(bindings.map(b=>b.spell))],entries=[...new Set(bindings.map(b=>b.entry))];
 const unsupported=(actor.itemTypes.spell??[]).filter(s=>!spells.includes(s)).map(s=>({id:s.id,name:s.name,reason:!spellDefinition(s)?'No taught effect resolver':
  'Casting entry, resources or prepared slots unavailable'}));
 return {bindings,spells,entries,unsupported,descriptors:bindings.flatMap(b=>b.definition.actionCosts.map(cost=>spellDescriptor(b,cost)))};
}
export function resolveSpellBinding(actor,choice){
 return spellBindings(actor).find(b=>b.spell.id===choice.spellId&&(!choice.entryId||b.entry.id===choice.entryId)&&
  Boolean(b.bonded)===Boolean(choice.bindingId?.endsWith(':bonded'))&&
  (choice.castRank==null||b.castRank===choice.castRank)&&(choice.slotId==null||b.slotId===choice.slotId)&&b.remaining>=(b.focus?(b.spell.system.cast?.focusPoints??1):1));
}
