import { checkProbabilities } from './math.mjs';
import { setupUtility } from './setup-utility.mjs';

// Search choices use known observations and benchmark odds, never live hidden
// coordinates, opponents' Stealth DCs, or secret totals. Field search has no aim.
export function seekCandidates(state) {
  if(state.actionsRemaining<1||state.self.unable||state.retreatComplete||state.morale?.broken||!state.seek?.available)return [];
  // Locating additional enemies is normally less urgent than engaging an
  // opponent already observed. In particular, do not stall a distant approach.
  const observed=state.enemies.some(enemy=>enemy.awareness?.state==='observed'&&enemy.lineOfSight!==false);
  const canAttack=state.enemies.some(enemy=>state.strikes?.some(strike=>enemy.strikes?.[strike.id]?.usable)??(enemy.inReach&&enemy.lineOfEffect));
  const canApproach=state.moves?.some(move=>!state.visited?.includes(`${move.x},${move.y}`)&&move.nearestEnemy<state.nearestEnemy);
  if(observed&&(canAttack||canApproach))return [];
  const odds=checkProbabilities(state.seek.bonus,state.self.referenceAC),success=odds.success+odds.criticalSuccess;
  if(state.seek.scope==='field'){
    const unresolved=state.enemies.filter(enemy=>enemy.awareness?.state==='known-square'&&
      !(enemy.awareness.detection==='hidden'&&enemy.awareness.precisionBlocked));
    if(!unresolved.length&&!state.seek.suspectedOpponents)return [];
    if(!state.seek.imprecise&&!unresolved.some(enemy=>enemy.lineOfSight!==false)&&!state.seek.suspectedOpponents)return [];
    const before=unresolved.filter(enemy=>enemy.awareness.detection==='hidden').length;
    const gain=success*state.self.averageDamage*(state.actionsRemaining>1?0.8:0.2);
    const marginal=setupUtility(state,{gain,retained:before});
    return [{id:'seek:field',kind:'seek',searchScope:'field',actionCost:1,legal:true,
      intent:'search the visible field for hidden opponents',features:{search:true},assessment:{value:Math.max(0.1,marginal.value)},
      scoringTerms:[{label:'Estimated new detection from whole-field search',contribution:gain},
        {label:'Setup action cost',contribution:-marginal.actionCost}]}];
  }
  const areas=new Set();
  const candidates=state.enemies.flatMap(enemy=>{
    if(!enemy.awareness?.searchRequired||!state.seek.imprecise&&enemy.lineOfSight===false||enemy.distance>30)return [];
    // A known invisible square cannot become observed with ordinary vision.
    if(enemy.awareness.detection==='hidden'&&enemy.awareness.precisionBlocked)return [];
    const square=enemy.awareness.position;
    if(!square)return [];
    const key=`${square.x},${square.y},${square.elevation},${square.level}`;
    if(areas.has(key))return [];areas.add(key);
    const attacks=Math.min(2,Math.max(0,state.actionsRemaining-1));
    const benefit=state.self.averageDamage*(enemy.awareness.detection==='hidden'?0.55:0.9);
    const value=Math.max(0.1,success*(benefit*(attacks||0.25)+1));
    return [{id:`seek:${enemy.id}`,kind:'seek',actionCost:1,legal:true,targetId:enemy.id,searchPosition:{...square},
      intent:'search a remembered enemy position',features:{search:true},assessment:{value},
      scoringTerms:[{label:'Estimated benefit of locating an enemy (benchmark Perception odds)',contribution:value}]}];
  });
  if(!candidates.length&&state.seek.suspectedOpponents&&state.seek.origin){
    candidates.push({id:'seek:nearby',kind:'seek',actionCost:1,legal:true,searchPosition:{...state.seek.origin},
      intent:'listen and search the nearby area for undetected opponents',features:{search:true},assessment:{value:0.1}});
  }
  return candidates;
}
