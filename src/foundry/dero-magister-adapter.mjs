import {PF2eSpellcasterAdapter} from './spellcaster-adapter.mjs';
import {checkProbabilities} from '../framework/math.mjs';
import {executeSpell} from './spellcasting.mjs';
import {spellDefenseCheck} from './spell-checks.mjs';
import {sustainCast,applyConditionSpell} from './ongoing-spells.mjs';
import {concealmentCheck} from './environment-rolls.mjs';
const ns='foundry-creature-ai';
export const DERO_SOURCE='Compendium.pf2e.pathfinder-monster-core.Actor.qyCcr32PVcnNm4Wr';
export class PF2eDeroMagisterAdapter extends PF2eSpellcasterAdapter{
 get profileId(){return 'dero-magister';}
 parts(){const base=super.parts(),stare=this.actor.itemTypes.action.find(a=>(a.slug??a.system.slug??a.name.toLowerCase().replaceAll(' ','-'))==='cytillesh-stare');
  if(!stare)throw new Error('Dero Magister needs Cytillesh Stare');
  return {...base,stare,abilityNames:[...base.abilityNames,'Cytillesh Stare'],unsupported:base.unsupported.filter(name=>name!==stare.name)};}
 extraCasterActions(state){
  const attempts=this.token.document.getFlag(ns,'conditionCaster');
  if(attempts?.combatId===game.combat.id&&attempts.stareRound===game.combat.round||state.actionsRemaining<1||state.self.restrained||state.plannedCapabilities?.includes('cytillesh-stare'))return [];
  return state.enemies.filter(e=>e.distance<=30&&e.lineOfSight!==false&&e.lineOfEffect!==false&&!e.awareness?.searchRequired&&
    !state.plannedCapabilities?.includes('gaze:'+e.id)&&!state.spellAttempts.some(a=>a.slug==='blindness'&&a.targetId===e.id&&a.untilRound>=state.round)).map(e=>{
   const p=checkProbabilities(state.self.referenceAC-10,this.parts().entry.statistic.dc.value),value=1.5+(p.failure+p.criticalFailure)*5;
   return {id:'stare:'+e.id,kind:'gaze',targetId:e.id,legal:true,actionCost:1,features:{onceKey:'cytillesh-stare'},assessment:{value},scoringTerms:[{label:'Dazzle and estimated chance to confuse; once per round',contribution:value}]};});
 }
 async executeProfileAction(choice,ledger,context={}){
  if(choice.kind==='castSpell')return executeSpell(this,choice,ledger,context);
  if(choice.kind==='sustainSpell')return sustainCast(this.actor,choice.castId);
  if(choice.kind!=='gaze')return super.executeProfileAction(choice,ledger,context);
  const target=this.liveTarget(choice.targetId),stare=this.parts().stare;
  const valid=()=> (context.canContinue?.()??true)&&this.turnKey()===ledger.turn&&!this.turnEndReason();
  if(!target||target.actor.hasCondition('blinded')||target.actor.isImmuneTo?.(stare))return {resolved:true,note:'Cytillesh Stare has no effect on this target.'};
  if(!await concealmentCheck(this.token,target,{valid}))return {resolved:true,note:'Cytillesh Stare targeting flat check failed.'};
  const degree=await spellDefenseCheck(target,{dc:this.parts().entry.statistic.dc.value,statistic:'will',origin:this.token,spell:stare,label:'Cytillesh Stare'});
  if(!valid())throw new Error('Cytillesh Stare was interrupted during its save');
  await applyConditionSpell({source:{actor:this.actor,token:this.token},target,spell:{name:stare.name,img:stare.img,uuid:stare.uuid,rank:this.actor.level,slug:'cytillesh-stare'},degree});
  return {resolved:true,note:'Cytillesh Stare: Dazzled for one round; native Will save resolves Confused.'};
 }
 async recordOutcome(choice,ledger,result={}){
  await super.recordOutcome(choice,ledger,result);
  if(!result.skipped&&choice.kind==='gaze')await this.token.document.setFlag(ns,'conditionCaster',{...this.token.document.getFlag(ns,'conditionCaster'),combatId:game.combat.id,stareRound:game.combat.round});
 }
}
