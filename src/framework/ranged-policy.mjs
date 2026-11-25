import {attackValue} from '../dawnsbury/chooser.mjs';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

function estimate(state,strike,enemy,position,{ignoreRange=false}={}){
  const offGuard=enemy.prone||enemy.offGuard||position?.flanked;
  const map=(strike.mapPenalties??state.self.mapPenalties??[0,-5,-10])[Math.min(2,state.attacksMade??0)]??0;
  return attackValue({bonus:strike.bonus+map-
    (ignoreRange?0:position?.rangePenalty??0),damage:strike.damage+(offGuard?strike.precisionDamage??0:0),
    referenceAC:state.self.referenceAC,defenseAdjustment:(position?.coverBonus??0)-(offGuard?2:0),
    concealmentDC:position?.concealmentDC});
}

export function meleeAlternativeValue(state,enemy){
  return Math.max(0,...(state.strikes??[]).filter(strike=>!strike.ranged&&strike.available!==false)
    .map(strike=>estimate(state,strike,enemy,enemy.strikes?.[strike.id]??{})));
}

export function closingOpportunity(state,enemy,position){
  const beforePenalty=position?.rangePenalty??0,beforeDistance=enemy.distance??Infinity;
  return (state.moves??[]).some(move=>{
    if(!move?.cost||move.terrainRisk>=50||move.reactionRisk>=50)return false;
    const after=move.targets?.[enemy.id];
    if(!after||after.lineOfEffect===false||after.lineOfSight===false)return false;
    const afterPenalty=after.strikes&&Object.values(after.strikes).filter(entry=>entry?.inReach!==false)
      .reduce((best,entry)=>Math.min(best,entry.rangePenalty??Infinity),Infinity);
    const reachesMelee=(state.strikes??[]).some(strike=>!strike.ranged&&after.strikes?.[strike.id]?.inReach);
    return reachesMelee||afterPenalty<beforePenalty||(after.distance??Infinity)<beforeDistance;
  });
}

// This is an action-selection cost, never an additional modifier to the PF2e
// attack roll. A ranged Strike with any increment penalty is a poor substitute
// for closing when the map offers a useful approach. The final increment is
// retained as a desperation option when movement cannot improve the position.
export function rangedAttackPolicy(state,strike,enemy,position,rawValue){
  const penalty=strike.ranged?position?.rangePenalty??0:0;
  if(!penalty)return {value:rawValue,cost:0,penalty:0,closing:false,meleeValue:meleeAlternativeValue(state,enemy)};
  const closing=closingOpportunity(state,enemy,position),severity=clamp(penalty/10,0,1);
  const clearValue=estimate(state,strike,enemy,position,{ignoreRange:true});
  const meleeValue=meleeAlternativeValue(state,enemy);
  // At -2, a legal approach removes at least 69% of the ranged utility. At
  // -10, only 2% remains. Without an approach, the shot remains possible but
  // still loses 38% at -2 and 90% at -10.
  const fraction=closing?clamp(0.62+severity*0.36,0,0.98):clamp(0.25+severity*0.65,0,0.90);
  let cost=rawValue*fraction;
  if(closing&&meleeValue>0)cost+=Math.min(Math.max(0,rawValue-cost-0.01),meleeValue*(0.08+severity*0.17));
  cost=Math.min(Math.max(0,rawValue-0.01),cost);
  return {value:Math.max(0.01,rawValue-cost),cost,penalty,closing,meleeValue,clearValue};
}
