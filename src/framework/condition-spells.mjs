import {checkProbabilities} from './math.mjs';
export const conditionSpells={
 'laughing-fit':{save:'will',range:30,sustained:true},
 stupefy:{save:'will',range:30},blindness:{save:'fortitude',range:30},
 'void-warp':{save:'fortitude',range:30,damage:true},
};
export function conditionSpellValue(state,spell,enemy){
 if(enemy.lineOfSight===false||enemy.lineOfEffect===false||enemy.distance>spell.range||
  enemy.awareness?.searchRequired&&!enemy.awareness.allowAttackEstimate&&!enemy.awareness.attackOnSight)return 0;
 if(state.spellAttempts?.some(a=>a.targetId===enemy.id&&a.slug===spell.slug&&a.untilRound>=state.round))return 0;
 if(spell.sustained&&state.activeSustained?.some(c=>c.slug===spell.slug&&c.targetId===enemy.id))return 0;
 const p=checkProbabilities(state.self.referenceAC-10,spell.dc),role=enemy.tactics?.role;
 const flat=enemy.concealmentDC?(21-enemy.concealmentDC)/20:1;
 const denial=spell.slug==='laughing-fit'?(p.success*3+p.failure*10+p.criticalFailure*16):
  spell.slug==='stupefy'?(p.success*2+p.failure*6+p.criticalFailure*9)*(role==='caster'?1.6:0.6):
  spell.slug==='blindness'?p.success*3+p.failure*11+p.criticalFailure*14:
  spell.damage*(p.success*0.5+p.failure+p.criticalFailure*2);
 // Lasting denial can affect more than the present exchange. Use a bounded
 // two-turn estimate, rather than comparing its first round to all damage
 // from an immediate cantrip. No actual opposing save or outcome is read.
 return denial*flat*(spell.slug==='void-warp'?1:1.7);
}
export function conditionCastingCandidates(state){
 if(state.self.unable||state.self.restrained||state.morale?.broken)return [];
 return state.spells.flatMap(spell=>spell.available&&spell.actionCost<=state.actionsRemaining?state.enemies.flatMap(enemy=>{
  const value=conditionSpellValue(state,spell,enemy),reserve=spell.cantrip?0:1.5;
  if(value<=reserve)return [];
  return [{id:`condition-spell:${spell.id}:${enemy.id}`,kind:'castSpell',spellId:spell.id,spellSlug:spell.slug,spellName:spell.name,
   targetId:enemy.id,actionCost:spell.actionCost,mapIncreases:0,legal:true,provokes:true,
   features:{spell:true,conditionSpell:true,blocksForecast:spell.slug==='blindness'?[`gaze:${enemy.id}`]:[]},assessment:{value:value-reserve},
   scoringTerms:[{label:'Estimated condition or damage benefit using benchmark saves',contribution:value},{label:'Conserve native spell slots',contribution:-reserve}]}];
 }):[]);
}
