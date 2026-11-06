import {spellDefinitions,spellChoiceFields} from './spell-definitions.mjs';
import {spellSaveProbabilities,witnessedSpellConfidence,knownSpellImmunity} from './spell-knowledge.mjs';
export const conditionSpells=Object.fromEntries(spellDefinitions().filter(d=>d.kind==='condition-save').map(d=>[d.slug,d]));
export function conditionSpellValue(state,spell,enemy){
 if(enemy.lineOfSight===false||enemy.lineOfEffect===false||enemy.distance>spell.range||
  enemy.awareness?.searchRequired&&!enemy.awareness.allowAttackEstimate&&!enemy.awareness.attackOnSight)return 0;
 if(knownSpellImmunity(state,spell,enemy))return 0;
 if(!spell.damage&&state.spellAttempts?.some(a=>a.targetId===enemy.id&&a.slug===spell.slug&&a.untilRound>=state.round))return 0;
 if(spell.sustained&&state.activeSustained?.some(c=>c.slug===spell.slug&&c.targetId===enemy.id))return 0;
 const p=spellSaveProbabilities(state,spell,enemy),role=enemy.tactics?.role;
 const briefWindow=enemy.alliedTurnsBeforeNextStart==null?1:Math.min(1,0.15+enemy.alliedTurnsBeforeNextStart*0.35+(state.actionsRemaining>spell.actionCost?0.35:0));
 const flat=enemy.concealmentDC?(21-enemy.concealmentDC)/20:1;
 const denial=spell.slug==='laughing-fit'?(p.success*3+p.failure*10+p.criticalFailure*16):
  spell.slug==='stupefy'?(p.success*2+p.failure*6+p.criticalFailure*9)*(role==='caster'?1.6:0.6):
  spell.slug==='blindness'?p.success*3*briefWindow+p.failure*11+p.criticalFailure*14:
  spell.damage*(p.success*0.5+p.failure+p.criticalFailure*2);
 // Lasting denial can affect more than the present exchange. Use a bounded
 // two-turn estimate, rather than comparing its first round to all damage
 // from an immediate cantrip. No actual opposing save or outcome is read.
 const damageSpell=Number(spell.damage)>0;
 const tempHP=spell.drain?Math.max(0,denial*flat/2-(state.self.tempHP??0))*(0.55+0.35*(1-(state.self.hpFraction??1))):0;
 return denial*flat*(damageSpell?1:1.7)*(damageSpell?1:1-witnessedSpellConfidence(state,spell,enemy))+tempHP;
}
export function conditionCastingCandidates(state){
 if(state.self.unable||state.self.restrained||state.morale?.broken)return [];
 return state.spells.flatMap(spell=>spell.available&&spell.actionCost<=state.actionsRemaining?state.enemies.flatMap(enemy=>{
  const value=conditionSpellValue(state,spell,enemy),reserve=spell.cantrip?0:1.5;
  if(value<=reserve)return [];
  return [{id:`condition-spell:${spell.bindingId??spell.id}:${enemy.id}`,kind:'castSpell',spellId:spell.id,...spellChoiceFields(spell),spellSlug:spell.slug,spellName:spell.name,
   targetId:enemy.id,actionCost:spell.actionCost,mapIncreases:0,legal:true,provokes:true,
   features:{spell:true,conditionSpell:true,spellRole:spell.drain?'drain':Number(spell.damage)>0?'damage':'control',blocksForecast:spell.slug==='blindness'?[`gaze:${enemy.id}`]:[]},assessment:{value:value-reserve},
   scoringTerms:[{label:'Estimated condition or damage benefit using benchmark saves',contribution:value},{label:'Conserve native spell slots',contribution:-reserve}]}];
 }):[]);
}
