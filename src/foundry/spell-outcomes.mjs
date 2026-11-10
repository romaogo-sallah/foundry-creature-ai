import {spellDamage} from './spell-native-rolls.mjs';
import {spellDefenseCheck,SPELL_OPTIONS} from './spell-checks.mjs';
import {applyDefinedSpellEffects} from './defined-spell-effects.mjs';
import {concealmentCheck} from './environment-rolls.mjs';
import {spellRegion,inSpellArea,sameSpellLevel,areaContains} from './spell-areas.mjs';
import {clearAttackPath} from './attack-path.mjs';
import {environmentBetween} from './environment-zones.mjs';
import {beginSustainedCast} from './ongoing-spells.mjs';
import {observeSpellCast} from './spell-observations.mjs';
import {applySupportSpell} from './support-spells.mjs';
import {applyDomination,dominateImmune} from './domination.mjs';
import {createLingeringFire} from './lingering-fire.mjs';
import {executeCounteract,liveDispelTarget} from './counteract-spells.mjs';
import {markKilled} from './death-status.mjs';
import {grantVampiricTempHP} from './ongoing-spells.mjs';
import {createAdvancedZone,createBlizzard} from './spell-weather.mjs';
import {executeTranslocate} from './translocation.mjs';
import {isTrueVampire} from './vampire-state.mjs';
import {consumeSureStrike} from './spell-attack-buffs.mjs';
const outcomes=['criticalFailure','failure','success','criticalSuccess'];
export async function executeSpellOutcomes(adapter,spell,entry,choice,definition,{valid,attackNumber=1}){
 const healing=definition.kind==='heal',support=healing||['ward','buff','counteract'].includes(definition.kind),target=choice.area?null:definition.kind==='counteract'?liveDispelTarget(adapter,choice.targetId,choice.effectUuid):support?adapter.liveSpellTarget?.(choice.targetId):adapter.liveTarget(choice.targetId);
 if(!choice.area&&(!target||!valid()))return {resolved:true,note:'Spell lost its target after commitment.'};
 if(definition.teleport)return executeTranslocate(adapter,spell,choice);
 if(definition.kind==='buff')return applySupportSpell({actor:adapter.actor,token:adapter.token},target,spell,{...definition,energyType:choice.energyType});
 if(definition.kind==='counteract')return executeCounteract(adapter,spell,entry,choice);
 const region=choice.area?spellRegion(choice.area.shapes,adapter.token):null;
 if(definition.kind==='lingering'){
  if(definition.cloud||definition.ice)return createAdvancedZone(adapter,spell,entry,choice,definition);
  const commitment=definition.sustained?await beginSustainedCast({actor:adapter.actor,token:adapter.token},spell,adapter.liveTarget(choice.targetId),undefined,{maxDuration:definition.duration}):null;
  return createLingeringFire(adapter,spell,entry,choice,definition,{castId:commitment?.id});
 }
 const targets=region?canvas.tokens.placeables.filter(t=>t.actor?.isOfType?.('creature')&&areaContains(adapter.token,t,choice.area)&&clearAttackPath(adapter.token,t)):
  (choice.targetIds??[target.id]).map(id=>support?adapter.liveSpellTarget?.(id):adapter.liveTarget(id)).filter(t=>t&&clearAttackPath(adapter.token,t));
 let commitment=null,wardEnemy=null;
 if(definition.kind==='ward'){
  wardEnemy=adapter.liveTarget(choice.wardEnemyId);
  if(!wardEnemy||adapter.targetAt(adapter.originCell(),wardEnemy,[],adapter.actualWaypoint()).distance>Number.parseFloat(spell.system.range.value)||!await concealmentCheck(adapter.token,wardEnemy,{valid}))return {resolved:true,note:'Ward lost its opposing target; its actions remain spent.'};
  commitment=await beginSustainedCast({actor:adapter.actor,token:adapter.token},spell,target,undefined,{maxDuration:definition.duration,enemyId:wardEnemy.id});
 }
 const affected=[];
 let previousChainTarget=null;for(const subject of targets){
  if(definition.chain&&previousChainTarget&&previousChainTarget.distanceTo(subject)>30)break;
  previousChainTarget=subject;
  if(!valid())throw new Error('Casting stopped before a spell outcome was resolved');
  const range=spell.system.range?.value==='touch'?Math.max(5,adapter.actor.getReach({action:'attack'})):definition.range??Number.parseFloat(spell.system.range?.value??'0');
  if(!choice.area&&Number.isFinite(range)&&adapter.targetAt(adapter.originCell(),subject,[],adapter.actualWaypoint()).distance>range)continue;
  if(subject.actor.isImmuneTo?.(spell)||definition.living&&subject.actor.modeOfBeing&&subject.actor.modeOfBeing!=='living')continue;
  if(definition.domination&&isTrueVampire(adapter.actor)&&(dominateImmune(subject.actor,adapter.token.id)||subject.actor.hasCondition('blinded')||adapter.actor.hasCondition('blinded')))continue;
  if(!choice.area&&!await concealmentCheck(adapter.token,subject,{valid,attack:definition.kind==='attack'}))continue;
  if(definition.sustained&&!commitment)commitment=await beginSustainedCast({actor:adapter.actor,token:adapter.token},spell,subject,undefined,{maxDuration:definition.duration??600});
  if(definition.kind==='maneuver'){
   if(subject.actor.hasCondition('prone'))continue;
   const roll=await entry.statistic.check.roll({skipDialog:true,item:spell,token:adapter.token.document,target:subject.actor,
    attackNumber:Math.min(3,attackNumber),dc:{slug:'reflex'},traits:[...spell.traits],extraRollOptions:[...SPELL_OPTIONS,'action:trip']});
   if(!Number.isInteger(roll?.degreeOfSuccess)||!valid())throw new Error('Telekinetic Trip was unresolved');
   if(roll.degreeOfSuccess>=2&&!subject.actor.hasCondition('prone'))await subject.actor.increaseCondition('prone');
   if(roll.degreeOfSuccess===0&&!adapter.actor.hasCondition('prone'))await adapter.actor.increaseCondition('prone');
   if(roll.degreeOfSuccess===3){const DamageRoll=CONFIG.Dice.rolls.find(c=>c.name==='DamageRoll'),damage=await new DamageRoll('1d6[bludgeoning]').evaluate();
    await damage.toMessage({speaker:ChatMessage.getSpeaker({token:adapter.token.document}),flavor:'Telekinetic Trip',flags:{[ 'foundry-creature-ai']:{managed:true},pf2e:{context:{options:SPELL_OPTIONS},suppressDamageButtons:Boolean(adapter.config.applyDamage)}}});
    if(adapter.config.applyDamage)await adapter.applyDamage(subject,damage,spell,'success',{valid});else return {resolved:true,pause:true};}
   return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id,targetId:subject.id},note:'Telekinetic Trip used a native spell attack against Reflex DC.'};
  }
  const cover=choice.area&&definition.save==='reflex'?environmentBetween(adapter.token,subject).coverBonus:0;
  let degree=1;
  if(definition.kind==='save'){
   await observeSpellCast({source:{actor:adapter.actor,token:adapter.token},target:subject,spell,dc:entry.statistic.dc.value,castId:commitment?.id});
   degree=await spellDefenseCheck(subject,{dc:entry.statistic.dc.value,statistic:definition.save,origin:adapter.token,spell,label:spell.name,cover:cover>=2?cover:0});
  }
  else if(definition.kind==='attack'){const roll=await spell.rollAttack(null,Math.min(3,attackNumber),{target:subject.actor,token:adapter.token.document,skipDialog:true,extraRollOptions:SPELL_OPTIONS});
   if(roll)await consumeSureStrike(adapter.actor);
   if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Spell attack was unresolved');degree=roll.degreeOfSuccess;}
  if(!valid())throw new Error('Casting changed during a spell defense');affected.push({subject,degree});
  if(definition.chain&&degree===3)break;
 }
 let pause=false,sharedDamage=null,maxDrainedDamage=0;
 for(const {subject,degree}of affected){
  if(definition.domination){await applyDomination({source:{actor:adapter.actor,token:adapter.token},target:subject,spell,degree,dc:entry.statistic.dc.value});continue;}
  const factor=['save','attack'].includes(definition.kind)?(definition.outcomes?.[degree]?.damage??[2,1,0.5,0][degree]):1;
  let postDamage=null;
  if(factor>0&&Object.keys(spell.system.damage??{}).length){
   const shards=definition.shards?choice.actionCost*(1+Math.floor((spell.rank-1)/2)):1;
   const attackCritical=definition.kind==='attack'&&degree===3;
   const roll=()=>spellDamage(spell,adapter.token,{target:choice.area?undefined:subject,outcome:attackCritical?'criticalSuccess':'success',autoApply:Boolean(adapter.config.applyDamage),
    ...definition.shards?{formula:`(${shards}d4+${shards})[force]`}:{}});
   const damage=choice.area||definition.chain?(sharedDamage??=await roll()):await roll();
   const scale=attackCritical?factor/2:factor,scaled=scale===1?damage:damage.alter(scale,0);
   if(adapter.config.applyDamage){
    if(healing)await applySpellHealing(subject,scaled,spell);
    else {const applied=await adapter.applyDamage(subject,scaled,spell,outcomes[degree],{valid,captureDamage:Boolean(definition.persistent||definition.drain)});postDamage=applied?.damageTaken;maxDrainedDamage=Math.max(maxDrainedDamage,postDamage??0);}
   }else pause=true;
  }
  if(!valid())throw new Error('Spell interrupted before its source-tracked effects');
  if(definition.deathAtZero&&adapter.config.applyDamage&&subject.actor.hitPoints.value<=0){await markKilled(subject);continue;}
  await applyDefinedSpellEffects({source:{actor:adapter.actor,token:adapter.token},target:subject,spell,definition,degree,dc:entry.statistic.dc.value,skipPersistent:postDamage===0,
   castId:commitment?.id,enemySignature:wardEnemy?.actor.signature??wardEnemy?.actor.uuid});
 }
 if(definition.drain&&adapter.config.applyDamage)await grantVampiricTempHP({actor:adapter.actor,token:adapter.token},spell,maxDrainedDamage);
 if(definition.blizzard)await createBlizzard(adapter,choice.area,spell);
 return {resolved:true,pause,lastAction:{kind:'castSpell',spellId:spell.id,targetId:target?.id},
  note:`${spell.name}: ${affected.length} target(s) resolved with native casting resources and source-tracked effects.`};
}
// PF2e Actor.applyDamage accepts negative numeric damage for healing. A
// multiplier is a chat-button option, not an Actor.applyDamage argument.
export async function applySpellHealing(target,roll,spell){
 if(!Number.isFinite(roll.total)||roll.total<0)throw new Error('Healing requires a resolved nonnegative total');
 return target.actor.applyDamage({damage:-roll.total,item:spell,token:target.document,
  rollOptions:new Set([...SPELL_OPTIONS,...spell.getRollOptions?.('item')??[],...spell.actor?.getSelfRollOptions?.('origin')??[]])});
}
