import { attackValue } from '../dawnsbury/chooser.mjs';

// Adapters declare prepared weapons, native readiness and target geometry.
// This provider can be reused by any actor kit; no monster identity is needed.
export function preparedStrikeCandidates(state){
  if(state.self.restrained||state.self.unable||state.actionsRemaining<1||state.retreatComplete||state.morale?.broken)return [];
  return (state.strikes??[]).flatMap(strike=>state.enemies.flatMap(enemy=>{
    const position=enemy.strikes?.[strike.id];
    if(!position?.usable||enemy.lineOfSight===false||position.lineOfSight===false||position.lineOfEffect===false||
      enemy.awareness?.searchRequired&&!enemy.awareness.allowAttackEstimate&&!enemy.awareness.attackOnSight)return [];
    const value=attackValue({bonus:strike.bonus+strike.mapPenalties[Math.min(2,state.attacksMade)]-(position.rangePenalty??0),damage:strike.damage,
      referenceAC:state.self.referenceAC,defenseAdjustment:(position.coverBonus??0)-(enemy.prone||enemy.offGuard||position.flanked?2:0),concealmentDC:position.concealmentDC});
    const benefit=enemy.strikeEffectValues?.[strike.id]??strike.onHitValue??0;
    const onHit=benefit>0?attackValue({bonus:strike.bonus+strike.mapPenalties[Math.min(2,state.attacksMade)]-(position.rangePenalty??0),damage:benefit,
      referenceAC:state.self.referenceAC,defenseAdjustment:(position.coverBonus??0)-(enemy.prone||enemy.offGuard||position.flanked?2:0),concealmentDC:position.concealmentDC}):0;
    return [{id:`prepared:strike:${strike.id}:${enemy.id}`,kind:'strike',strikeId:strike.id,targetId:enemy.id,legal:true,actionCost:1,mapIncreases:1,
      provokes:Boolean(strike.ranged),features:{ranged:Boolean(strike.ranged)},assessment:{value:value+onHit},scoringTerms:[{label:'Prepared native Strike',contribution:value},
        ...(onHit?[{label:'Estimated on-hit ability benefit (benchmark defenses)',contribution:onHit}]:[])]}];
  }));
}
