import {checkProbabilities} from './math.mjs';
// Apparent combat roles inform estimates; actual enemy save modifiers and
// hidden check outcomes never enter this calculation.
export function estimatedSpellSave(state,spell,enemy){
 const role=enemy.tactics?.role,save=spell.save;
 const adjustment=role==='melee'?(save==='fortitude'?2:save==='will'?-1:0):
  role==='ranged'?(save==='reflex'?2:save==='fortitude'?-1:0):role==='caster'?(save==='will'?2:save==='fortitude'?-1:0):0;
 return state.self.referenceAC-10+adjustment;
}
export function spellSaveProbabilities(state,spell,enemy,{cover=0}={}){
 const p=checkProbabilities(estimatedSpellSave(state,spell,enemy)+cover,spell.dc);
 if(!spell.traits?.includes('incapacitation'))return p;
 const level=enemy.tactics?.estimatedLevel??state.self.level??state.self.encounterLevel??0;
 const uncertainty=enemy.tactics?.levelUncertainty??2,threshold=2*(spell.castRank??spell.rank??1);
 const chance=uncertainty?Math.max(0,Math.min(1,(level+uncertainty-threshold)/(2*uncertainty))):Number(level>threshold);
 return {criticalFailure:p.criticalFailure*(1-chance),failure:p.failure*(1-chance)+p.criticalFailure*chance,
  success:p.success*(1-chance)+p.failure*chance,criticalSuccess:p.criticalSuccess+p.success*chance};
}
export function witnessedSpellConfidence(state,spell,target){
 const casts=(state.witnessedCasts??[]).filter(c=>c.targetId===target.id&&c.slug===spell.slug);
 return casts.reduce((confidence,cast)=>{
  const p=spellSaveProbabilities(state,{...spell,...cast},target);
  const probabilities=[p.criticalFailure,p.failure,p.success,p.criticalSuccess];
  const effective=spell.outcomes?probabilities.reduce((n,chance,degree)=>{const o=spell.outcomes[degree];
   return n+chance*Number(Boolean(o?.conditions?.length||o?.controlled||o?.noActions||o?.noReactions||o?.noAllies||spell.persistent?.degrees.includes(degree)));},0):1-p.criticalSuccess;
  return 1-(1-confidence)*(1-effective);
 },0);
}
export const knownSpellImmunity=(state,spell,target)=>
 ((spell.living||spell.slug==='toxic-cloud')&&['undead','construct'].includes(target.knownModeOfBeing))||
 (target.knownModeOfBeing==='undead'&&spell.damageTypes?.length>0&&spell.damageTypes.every(type=>type==='void'))||
 (state.witnessedCasts??[]).some(c=>c.slug===spell.slug&&c.targetId===target.id&&c.immunity);
