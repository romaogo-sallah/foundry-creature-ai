import {castingCandidates} from './spell-evaluation.mjs';
import {casterPressure} from './caster-tactics.mjs';

export const spellRole=spell=>spell?.drain?'drain':Number(spell?.damage)>0||['damage-attack','basic-save'].includes(spell?.kind)?'damage':'control';
// One move plus an affordable cast. This compares opportunities, not outcomes;
// no hit, failed save, death or successful control is assumed for the next step.
export function casterScenarios(state){
  const best={};if(!state.spells?.length)return best;
  const consider=(position,cost=0,move=null)=>{
    for(const choice of castingCandidates(position,{showcase:false})){
      const spell=position.spells.find(spell=>spell.id===choice.spellId),role=spellRole(spell);
      const reaction=position.self.threatened?(position.self.reactionRisk??0):0;
      const value=choice.assessment.value-cost-reaction;
      if(value>0&&(!best[role]||best[role].value<value))best[role]={value,spellId:spell.id,spellSlug:spell.slug,targetId:choice.targetId,
        actionCost:choice.actionCost,movement:move?{x:move.x,y:move.y}:null};
    }
  };
  consider(state);
  if(state.actionsRemaining>=3&&!state.self.immobile)for(const move of state.moves??[]){
    if(!move.cost||state.visited?.includes(`${move.x},${move.y}`))continue;
    const after={...state,actionsRemaining:state.actionsRemaining-1,
      self:{...state.self,threatened:move.destinationThreatened,reactionRisk:move.destinationReactionRisk??state.self.reactionRisk},
      spells:move.spells??state.spells,enemies:state.enemies.map(enemy=>({...enemy,...move.targets[enemy.id]}))};
    const pressure=Math.max(0,casterPressure(after.enemies)-casterPressure(state.enemies));
    consider(after,pressure+(move.kind==='step'?0:move.reactionRisk??0)+(move.terrainRisk??0),move);
  }
  return best;
}
export function scenarioBonus(role,candidate,state){
  if(candidate.kind==='castSpell')return spellRole(state.spells.find(spell=>spell.id===candidate.spellId))===role?0.75:0;
  return candidate.features?.turnPlan?.some(step=>step.spellSlug&&spellRole(state.spells.find(spell=>spell.slug===step.spellSlug))===role)?0.5:0;
}
