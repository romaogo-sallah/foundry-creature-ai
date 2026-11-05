import {PF2eBasicNPCAdapter} from './basic-npc-adapter.mjs';
import {conditionSpells,conditionCastingCandidates} from '../framework/condition-spells.mjs';
import {casterTurnCandidates} from '../framework/caster-planning.mjs';
import {chooseTacticalAction} from '../framework/tactical-behaviors.mjs';
import {preparedStrikeCandidates} from '../framework/strike-capability.mjs';
import {seekCandidates} from '../framework/perception.mjs';
import {recoveryCandidates} from '../framework/recovery.mjs';
import {averageFormula,checkProbabilities} from '../framework/math.mjs';
import {casterTargetKnowledge} from './caster-target-knowledge.mjs';
import {casterStealthKnowledge} from './caster-stealth.mjs';
import {stealthAdapter} from './shared-stealth.mjs';
import {executeSpell} from './spellcasting.mjs';
import {spellDefenseCheck} from './spell-checks.mjs';
import {ongoingCasts,sustainCast,applyConditionSpell} from './ongoing-spells.mjs';
import {concealmentCheck} from './environment-rolls.mjs';
const ns='foundry-creature-ai',slug=item=>item.slug??item.system?.slug??item.name.toLowerCase().replaceAll(' ','-');
export const DERO_SOURCE='Compendium.pf2e.pathfinder-monster-core.Actor.qyCcr32PVcnNm4Wr';
export class PF2eDeroMagisterAdapter extends PF2eBasicNPCAdapter{
 get profileId(){return 'dero-magister';}
 parts(){
  const base=super.parts(),entry=this.actor.itemTypes.spellcastingEntry?.find(e=>e.system.tradition.value==='occult'&&e.system.prepared.value==='spontaneous');
  const spells=(this.actor.itemTypes.spell??[]).filter(s=>s.system.location.value===entry?.id&&conditionSpells[slug(s)]);
  const stare=this.actor.itemTypes.action.find(a=>slug(a)==='cytillesh-stare');
  if(!entry||!stare||!spells.some(s=>slug(s)==='laughing-fit'))throw new Error('Dero Magister needs occult spontaneous casting, Laughing Fit and Cytillesh Stare');
  return {...base,entry,spells,stare,abilityNames:[...base.abilityNames,...spells.map(s=>s.name),'Cytillesh Stare','Sustain'],
   unsupported:[...this.actor.itemTypes.spell.filter(s=>!spells.includes(s)).map(s=>s.name),...this.actor.itemTypes.action.filter(a=>a!==stare).map(a=>a.name)]};
 }
 async snapshot(ledger,options){
  const state=await super.snapshot(ledger,options),parts=this.parts(),knowledge=casterTargetKnowledge(this);
  const attempts=this.token.document.getFlag(ns,'conditionCaster');
  state.round=game.combat.round;state.spellAttempts=attempts?.combatId===game.combat.id?attempts.attempts??[]:[];
  state.self.hpFraction=this.actor.hitPoints.value/Math.max(1,this.actor.hitPoints.max);
  state.spells=parts.spells.map(spell=>{
   const rank=spell.rank,spec=conditionSpells[spell.slug],available=spell.isCantrip||parts.entry.system.slots[`slot${rank}`]?.value>0;
   const base=spell.system.level.value,interval=spell.system.heightening?.interval??1;
   const damage=Object.entries(spell.system.damage??{}).reduce((sum,[key,part])=>sum+averageFormula(part.formula)+
    Math.max(0,Math.floor((rank-base)/interval))*averageFormula(spell.system.heightening?.damage?.[key]??'0'),0);
   return {id:spell.id,name:spell.name,slug:spell.slug,kind:'condition-save',actionCost:2,cantrip:spell.isCantrip,available,dc:parts.entry.statistic.dc.value,...spec,damage};
  });
  state.spellSlots=[1,2,3].reduce((n,r)=>n+(parts.entry.system.slots[`slot${r}`]?.value??0),0);
  const stealth=casterStealthKnowledge(stealthAdapter(this),state),at=stealth.at();
  for(const enemy of state.enemies){enemy.tactics=knowledge.entries[enemy.id]??{role:'unknown',reach:5,speed:25};Object.assign(enemy,at[enemy.id]);}
  for(const move of state.moves){const defense=stealth.at(this.center(move));move.spells=state.spells;
   for(const enemy of state.enemies)Object.assign(move.targets[enemy.id],defense[enemy.id]);}
  state.casterDefense={enabled:true,engagementRange:30};
  state.activeSustained=ongoingCasts(this.actor);
  state.sustained=state.activeSustained.filter(c=>c.lastRound<game.combat.round&&state.enemies.some(e=>e.id===c.targetId));
  state.stareAvailable=!(attempts?.combatId===game.combat.id&&attempts.stareRound===game.combat.round);
  state.stareDC=parts.entry.statistic.dc.value;
  state.diagnostics.manualAbilities=parts.unsupported;state.diagnostics.resources={slots:parts.entry.system.slots};return state;
 }
 candidates(state){
  const actions=s=>[
   ...conditionCastingCandidates(s),...preparedStrikeCandidates(s),
   ...s.sustained.filter(c=>!s.plannedCapabilities?.includes(`sustain:${c.id}`)&&s.actionsRemaining>0).map(c=>({
    id:`sustain:${c.id}`,kind:'sustainSpell',castId:c.id,legal:true,actionCost:1,features:{onceKey:`sustain:${c.id}`},assessment:{value:5},
    scoringTerms:[{label:'Maintain the estimated benefit of an ongoing spell',contribution:5}]})),
   ...s.stareAvailable&&!s.plannedCapabilities?.includes('cytillesh-stare')&&s.actionsRemaining>0&&!s.self.restrained?s.enemies.filter(e=>
    e.distance<=30&&e.lineOfSight!==false&&e.lineOfEffect!==false&&!e.awareness?.searchRequired&&
    !s.plannedCapabilities?.includes(`gaze:${e.id}`)&&!s.spellAttempts.some(a=>a.slug==='blindness'&&a.targetId===e.id&&a.untilRound>=s.round)).map(e=>{
     const p=checkProbabilities(s.self.referenceAC-10,s.stareDC),value=1.5+(p.failure+p.criticalFailure)*5;
     return {id:`stare:${e.id}`,kind:'gaze',targetId:e.id,legal:true,actionCost:1,features:{onceKey:'cytillesh-stare'},assessment:{value},
      scoringTerms:[{label:'Dazzle and estimated chance to confuse; once per round',contribution:value}]};}):[]];
  return [{id:'end',kind:'endTurn',legal:true,actionCost:0,assessment:{value:0}},...recoveryCandidates(state,{canStrike:state.enemies.some(e=>e.inReach)}),
   ...seekCandidates(state),...casterTurnCandidates(state,{actions})];
 }
 decide(state){const d=chooseTacticalAction(this.candidates(state),state,{actionsRemaining:state.actionsRemaining,threatened:state.self.threatened});
  return {...d,diagnostics:{...state.diagnostics,...d.diagnostics,...d.chosen?.kind==='endTurn'&&!state.self.immobile&&!state.self.restrained?{turnComplete:true}:{}}};}
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
  if(result.skipped)return;const old=this.token.document.getFlag(ns,'conditionCaster'),previous=old?.combatId===game.combat.id?old:{};
  const attempts=(previous.attempts??[]).filter(a=>a.untilRound>=game.combat.round);
  if(choice.kind==='castSpell'&&result.lastAction?.kind==='castSpell')attempts.push({slug:choice.spellSlug,targetId:choice.targetId,untilRound:game.combat.round+(choice.spellSlug==='blindness'?10:2)});
  await this.token.document.setFlag(ns,'conditionCaster',{...previous,combatId:game.combat.id,attempts,...choice.kind==='gaze'?{stareRound:game.combat.round}:{}});
 }
}
