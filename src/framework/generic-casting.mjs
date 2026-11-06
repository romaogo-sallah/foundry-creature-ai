import {checkProbabilities} from './math.mjs';
import {spellChoiceFields} from './spell-definitions.mjs';
import {spellReserveCost} from './caster-tactics.mjs';
import {spellSaveProbabilities,witnessedSpellConfidence,knownSpellImmunity} from './spell-knowledge.mjs';
const conditionValue={stunned:8,slowed:7,blinded:9,sickened:3,frightened:3,enfeebled:2,clumsy:2,stupefied:3,dazzled:2,immobilized:5,prone:5};
export function outcomeSpellValue(state,spell,target,{area=false}={}){
 if(!area&&(target.lineOfSight===false||target.lineOfEffect===false||target.distance>spell.range||
   target.awareness?.searchRequired&&!target.awareness.allowAttackEstimate&&!target.awareness.attackOnSight))return 0;
 if(knownSpellImmunity(state,spell,target))return 0;
 const flat=area?1:target.concealmentDC?(21-target.concealmentDC)/20:1;
 if(spell.kind==='maneuver'){
  if(target.prone||target.spellTrippable===false)return 0;
  const odds=checkProbabilities(spell.bonus-5*Math.min(2,state.attacksMade),state.self.referenceAC);
  return (odds.success*6+odds.criticalSuccess*9)*flat;
 }
 const odds=spell.kind==='auto'?{criticalFailure:0,failure:1,success:0,criticalSuccess:0}:spell.kind==='attack'?
  checkProbabilities(spell.bonus-5*Math.min(2,state.attacksMade),state.self.referenceAC+(target.coverBonus??0)-(target.offGuard||target.prone?2:0)):
  spellSaveProbabilities(state,spell,target,{cover:area&&spell.save==='reflex'?(target.coverBonus??0):0});
 const probabilities=[odds.criticalFailure,odds.failure,odds.success,odds.criticalSuccess];
 const attempted=state.spellAttempts?.some(a=>a.slug===spell.slug&&a.targetId===target.id&&a.untilRound>=state.round);
 const fresh=1-witnessedSpellConfidence(state,spell,target);
 return probabilities.reduce((sum,p,index)=>{
  const outcome=spell.outcomes?.[index]??{damage:[2,1,0.5,0][index]};
  const conditions=attempted?0:(outcome.conditions??[]).reduce((n,c)=>n+(target.knownConditions?.includes(c.slug)?0:(conditionValue[c.slug]??2)*(c.value??1)),0);
  const persistent=!attempted&&spell.persistent?.degrees.includes(index)?Math.min(12,spell.castRank*(spell.persistent.type==='mental'?2.5:1))*1.4:0;
  return sum+p*(spell.damage*(outcome.damage??0)+fresh*(conditions+persistent+(attempted?0:outcome.noActions?12:outcome.noReactions?4:0)+(!spell.groupOnly||state.enemies.length>1?outcome.utility??0:0)));
 },0)*flat;
}
export function genericCastingCandidates(state){
 const result=[];
 for(const spell of state.spells.filter(s=>s.resolver==='outcomes'&&s.available&&s.actionCost<=state.actionsRemaining)){
  const reserve=spellReserveCost(state,spell),base={kind:'castSpell',spellId:spell.id,spellSlug:spell.slug,spellName:spell.name,...spellChoiceFields(spell),
   actionCost:spell.actionCost,mapIncreases:['maneuver','attack'].includes(spell.kind)?1:0,legal:true,provokes:spell.traits?.includes('manipulate'),features:{spell:true,modularSpell:true}};
  if(spell.kind==='ward')for(const ally of state.casterAllies??[]){
   if(ally.self||ally.distance>spell.range||ally.lineOfEffect===false||ally.lineOfSight===false)continue;
   for(const enemy of state.enemies.filter(e=>e.distance<=spell.range&&e.lineOfSight!==false&&e.lineOfEffect!==false)){
    if(state.activeSustained?.some(c=>c.slug===spell.slug&&c.targetId===ally.id&&c.enemyId===enemy.id)||state.plannedCapabilities?.includes(`ward:${ally.id}:${enemy.id}`))continue;
    const value=3.5+(ally.hpFraction<0.5?2:0),onceKey=`ward:${ally.id}:${enemy.id}`;
    result.push({...base,id:`spell:${spell.bindingId}:${ally.id}:${enemy.id}`,targetId:ally.id,wardEnemyId:enemy.id,
     features:{...base.features,support:true,onceKey},assessment:{value},scoringTerms:[{label:'Sustained protection for an exposed ally',contribution:value}]});
   }
  }else if(spell.kind==='heal')for(const ally of state.casterAllies??[]){
   if(ally.distance>spell.range||ally.lineOfEffect===false||ally.lineOfSight===false||ally.missingHP<=0)continue;
   const value=Math.min(ally.missingHP,spell.damage)*(ally.hpFraction<0.35?1.4:0.9);
   if(value<=reserve)continue;
   result.push({...base,id:`spell:${spell.bindingId}:${ally.id}`,targetId:ally.id,features:{...base.features,support:true,onceKey:`heal:${ally.id}`},
    assessment:{value:value-reserve},scoringTerms:[{label:'Restore allied HP; prioritize allies in danger',contribution:value},{label:'Reserve limited casting resources',contribution:-reserve}]});
  }else if(spell.area)for(const area of spell.areas??[]){
   const value=area.enemies.reduce((n,e)=>n+outcomeSpellValue(state,spell,e,{area:true}),0)-area.bystanders.reduce((n,e)=>n+2*outcomeSpellValue(state,spell,e,{area:true}),0);
   if(value>reserve)result.push({...base,id:`spell:${spell.bindingId}:${area.id}`,area,targetId:area.enemies[0]?.id,assessment:{value:value-reserve},
    scoringTerms:[{label:'Area benefit minus friendly fire and resource cost',contribution:value-reserve}]});
  }else if(spell.maxTargets>1){
   const targets=state.enemies.map(enemy=>({enemy,value:outcomeSpellValue(state,spell,enemy)})).filter(e=>e.value>0).sort((a,b)=>b.value-a.value).slice(0,spell.maxTargets);
   const value=targets.reduce((n,t)=>n+t.value,0);
   if(value>reserve)result.push({...base,id:`spell:${spell.bindingId}:${targets.map(t=>t.enemy.id).join(',')}`,targetId:targets[0].enemy.id,targetIds:targets.map(t=>t.enemy.id),assessment:{value:value-reserve},scoringTerms:[{label:'Combined benefit of legal selected targets',contribution:value-reserve}]});
  }else for(const enemy of state.enemies){
   if(state.plannedCapabilities?.includes(`spell:${spell.slug}:${enemy.id}`))continue;
   const value=outcomeSpellValue(state,spell,enemy);
   if(value<=reserve)continue;
   result.push({...base,id:`spell:${spell.bindingId}:${enemy.id}`,targetId:enemy.id,
    features:{...base.features,...spell.kind==='save'&&spell.persistent?{onceKey:`spell:${spell.slug}:${enemy.id}`}:{}} ,assessment:{value:value-reserve},
    scoringTerms:[{label:'Expected damage and condition outcomes using benchmark saves',contribution:value},{label:'Reserve limited casting resources',contribution:-reserve}]});
  }
 }
 return result.filter(c=>!c.features.onceKey||!state.plannedCapabilities?.includes(c.features.onceKey));
}
