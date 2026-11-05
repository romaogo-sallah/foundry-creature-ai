import {flySpeed} from './flight-costs.mjs';
import {distanceToPosition} from './vertical-geometry.mjs';
import {rememberedToken} from './target-memory.mjs';

// Test whether closing horizontally could EVER bring an available melee attack
// into vertical reach. Use the observer's remembered position for unseen foes.
export function groundThreats(adapter,state){
  const ranged=state.strikes?.some(s=>s.ranged&&(s.id===state.refuseId?state.refuseCount>0:
    state.javelins!==undefined?state.javelins>0:state.bolts!==undefined?state.bolts>0:true));
  if(flySpeed(adapter.actor)||!state.enemies.length||ranged||state.spells?.some(s=>s.available)||
    state.bowReady&&state.bolts>0)return {unanswerable:false,ids:[]};
  const reach=adapter.planningReach(),origin=adapter.actualWaypoint();
  const ids=state.enemies.flatMap(enemy=>{
    const live=canvas.tokens.get(enemy.id),target=enemy.awareness?.state==='known-square'?rememberedToken(live,enemy.awareness.position,enemy.awareness):live;
    if(!target||target.document.level!==origin.level)return [];
    const position={...origin,x:target.document.x,y:target.document.y};
    return target.document.elevation>origin.elevation&&distanceToPosition(adapter.token,target,position,reach)>reach?[enemy.id]:[];
  });
  return {unanswerable:ids.length===state.enemies.length,ids};
}
