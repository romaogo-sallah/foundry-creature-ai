import {reachableFlightCells} from '../framework/flight-navigation.mjs';
import {flySpeed} from './flight-costs.mjs';
import {flightBounds,isAirborne} from './flight-surfaces.mjs';
import {tokenAt,tokenHeight,volumesOverlap} from './vertical-geometry.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {clearSightPath} from './attack-path.mjs';
import {rememberedToken} from './target-memory.mjs';
import {flightThreats,flightSafety} from './flight-safety.mjs';

export const flightPoint=(adapter,cell)=>({...adapter.topLeft(cell),elevation:cell.elevation??adapter.token.document.elevation,
  level:adapter.token.document.level,action:'fly',snapped:true});
export const flightPath=(adapter,path)=>[{...adapter.actualWaypoint(),action:'fly'},...path.slice(1).map(p=>flightPoint(adapter,p))];
export function flightCost(adapter,path,context=adapter.movementContext()){
  const points=flightPath(adapter,path),terrain=adapter.token.createTerrainMovementPath?.(points,{preview:false})??points;
  return Math.max(0,adapter.token.measureMovementPath([...context.history,...terrain]).cost-context.historyCost);
}
export function perceivedFlightTarget(adapter,enemy){
  const token=canvas.tokens.get(enemy.id);
  return enemy.awareness?.state==='known-square'?rememberedToken(token,enemy.awareness.position,enemy.awareness):token;
}
export function flightMoveTargets(adapter,state,point){
  const position=flightPoint(adapter,point),targetMap={};
  for(const enemy of state.enemies){
    const target=perceivedFlightTarget(adapter,enemy),geometry=adapter.targetAt(point,target,[],position);
    const strikes=Object.fromEntries((state.strikes??[]).map(description=>{
      const strike=adapter.actor.system.actions.find(s=>s.item.id===description.id);
      const result=adapter.targetAt(point,target,[],position,strike?.item);
      return [description.id,{...result,usable:result.inReach&&strike?.ready!==false}];
    }));
    targetMap[enemy.id]={...geometry,strikes};
  }
  return targetMap;
}
export function flightCollision(adapter,from,to){
  const [,blocked]=adapter.token.constrainMovementPath([from,to],{ignoreWalls:false,ignoreCost:true});
  return !blocked;
}
export function flightMoves(adapter,state,planner){
  if(!flySpeed(adapter.actor)||state.self.immobile||state.self.prone||state.actionsRemaining<1||!state.enemies.length)return [];
  const context=adapter.movementContext(),bounds=flightBounds(adapter.token),rect=canvas.dimensions.sceneRect;
  const threats=flightThreats(adapter,state,enemy=>perceivedFlightTarget(adapter,enemy));
  state.flight.safety=flightSafety(adapter,adapter.actualWaypoint(),threats);
  const start={...adapter.originCell(),elevation:adapter.token.document.elevation},cache=new Map();
  const others=canvas.tokens.placeables.filter(token=>token!==adapter.token&&occupiesMovementSpace(token)&&!token.document.hidden&&
    detectionFor(adapter.token,token).state==='observed'&&clearSightPath(adapter.token,token));
  const canStop=point=>!others.some(other=>volumesOverlap(tokenAt(adapter.token,flightPoint(adapter,point)),other));
  const canEnter=point=>{
    const p=flightPoint(adapter,point);
    return point.elevation>=bounds.bottom&&point.elevation<=bounds.top&&p.x>=rect.x&&p.y>=rect.y&&
      p.x+adapter.token.w<=rect.x+rect.width&&p.y+adapter.token.h<=rect.y+rect.height&&
      !others.some(other=>!other.actor.isAllyOf(adapter.actor)&&volumesOverlap(tokenAt(adapter.token,p),other));
  };
  const canTraverse=(from,to)=>{
    const key=`${from.x},${from.y},${from.elevation}>${to.x},${to.y},${to.elevation}`;
    if(!cache.has(key))cache.set(key,flightCollision(adapter,from.path?.length===1?adapter.actualWaypoint():flightPoint(adapter,from),flightPoint(adapter,to)));
    return cache.get(key);
  };
  const attackGoals=state.enemies.flatMap(enemy=>{
    const p=perceivedFlightTarget(adapter,enemy).document,cell=adapter.cell(p);
    return [p.elevation,Math.min(bounds.top,p.elevation+15)].map(elevation=>({...cell,elevation}));
  });
  const escapeGoals=threats.flatMap(({target,reach,safeElevation})=>{
    const cell=adapter.cell(target.document),elevation=Math.min(bounds.top,safeElevation),radius=Math.ceil((reach+tokenHeight(target))/5)+2;
    return [{...start,elevation},{...cell,elevation},...[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>
      ({x:cell.x+dx*radius,y:cell.y+dy*radius,elevation}))];
  });
  const hunt=state.flight.hunt;
  const height=hunt?Math.min(hunt.preferredElevation,start.elevation+Math.floor(state.flight.speed/10)*5):null;
  const huntGoals=hunt?[{...start,elevation:height},...state.enemies.map(enemy=>({...adapter.cell(perceivedFlightTarget(adapter,enemy).document),elevation:hunt.preferredElevation}))]:null;
  const goals=huntGoals??(state.actionsRemaining===1||state.attacksMade>0?escapeGoals:attackGoals);
  const nodes=reachableFlightCells(start,flySpeed(adapter.actor),{canEnter,canStop,canTraverse,goals,maxNodes:450,
    pathCost:path=>flightCost(adapter,path,context),edgeRisk:from=>adapter.movementThreats(from,flightPoint(adapter,from)).length})
    .filter(node=>node.cost>0);
  if(hunt&&height>start.elevation){
    const point={...start,elevation:height},path=[start,point],cost=flightCost(adapter,path,context);
    if(planner.routeClear(path)&&cost<=state.flight.speed&&!nodes.some(n=>n.x===point.x&&n.y===point.y&&n.elevation===height))
      nodes.push({...point,path,cost,risk:adapter.movementThreats(start,flightPoint(adapter,start)).length});
  }
  return nodes.map(node=>{
      const targets=flightMoveTargets(adapter,state,node),threatened=adapter.movementThreats(node,flightPoint(adapter,node));
      const attackHere=Object.values(targets).some(t=>Object.values(t.strikes??{}).some(s=>s.usable));
      return {...node,kind:'fly',targets,nearestEnemy:Math.min(...Object.values(targets).map(target=>target.distance/5)),
        safety:flightSafety(adapter,flightPoint(adapter,node),threats),
        ...(hunt?{attackEscape:attackHere&&state.actionsRemaining>=3?planner.escape(node,node.path):null}:{}),
        provokes:node.risk>0,destinationThreatened:threatened.length>0,reactionRisk:node.risk?state.self.averageDamage:0,
        airborne:isAirborne(adapter.token,flightPoint(adapter,node))};
    });
}
