import { attackValue } from '../dawnsbury/chooser.mjs';

// Adapters declare prepared weapons, native readiness and target geometry.
// This provider can be reused by any actor kit; no monster identity is needed.
export function preparedStrikeCandidates(state){
  if(state.self.restrained||state.self.unable||state.actionsRemaining<1||state.retreatComplete||state.morale?.broken)return [];
  return (state.strikes??[]).filter(strike=>strike.available!==false).flatMap(strike=>state.enemies.flatMap(enemy=>{
    if(enemy.knownModeOfBeing==='undead'&&strike.damageTypes?.length&&strike.damageTypes.every(type=>type==='void'))return [];
    const position=enemy.strikes?.[strike.id];
    if(!position?.usable||enemy.lineOfSight===false||position.lineOfSight===false||position.lineOfEffect===false||
      enemy.awareness?.searchRequired&&!enemy.awareness.allowAttackEstimate&&!enemy.awareness.attackOnSight)return [];
    const value=attackValue({bonus:strike.bonus+strike.mapPenalties[Math.min(2,state.attacksMade)]-(position.rangePenalty??0),damage:strike.damage+(enemy.prone||enemy.offGuard||position.flanked?strike.precisionDamage??0:0),
      referenceAC:state.self.referenceAC,defenseAdjustment:(position.coverBonus??0)-(enemy.prone||enemy.offGuard||position.flanked?2:0),concealmentDC:position.concealmentDC});
    const benefit=enemy.strikeEffectValues?.[strike.id]??(strike.onHitBenefits?
      strike.onHitBenefits.filter(b=>state.actionsRemaining>=b.minimumActions).reduce((n,b)=>n+b.value,0):strike.onHitValue??0);
    const onHit=benefit>0?attackValue({bonus:strike.bonus+strike.mapPenalties[Math.min(2,state.attacksMade)]-(position.rangePenalty??0),damage:benefit,
      referenceAC:state.self.referenceAC,defenseAdjustment:(position.coverBonus??0)-(enemy.prone||enemy.offGuard||position.flanked?2:0),concealmentDC:position.concealmentDC}):0;
    const accuracyCost=(strike.rangeAversion??0)*(position.rangePenalty??0)*strike.damage;
    return [{id:`prepared:strike:${strike.id}:${enemy.id}`,kind:'strike',strikeId:strike.id,targetId:enemy.id,legal:true,actionCost:1,mapIncreases:1,
      provokes:Boolean(strike.ranged),features:{ranged:Boolean(strike.ranged)},assessment:{value:accuracyCost?Math.max(0.01,value+onHit-accuracyCost):value+onHit},scoringTerms:[{label:'Prepared native Strike',contribution:value},
        ...(accuracyCost?[{label:'Conserve limited missiles at poor accuracy',contribution:-accuracyCost}]:[]),
        ...(onHit?[{label:'Estimated on-hit ability benefit (benchmark defenses)',contribution:onHit}]:[])]}];
  }));
}
