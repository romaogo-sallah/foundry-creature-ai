import {flightPoint,perceivedFlightTarget} from './flight-movement.mjs';
import {flightBounds,isAirborne} from './flight-surfaces.mjs';
import {flightThreats,flightSafety} from './flight-safety.mjs';
import {tokenAt,volumesOverlap} from './vertical-geometry.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {clearSightPath} from './attack-path.mjs';

// A read-only oracle shared by aerial approach, native Strikes and Dive. Costs
// include the planned inbound path, so the escape starts with its real diagonal
// parity, terrain and elevation rather than a fresh, fictitious movement budget.
export function flightRoutePlanner(adapter,state){
  const bounds=flightBounds(adapter.token),context=adapter.movementContext(),step=canvas.grid.distance;
  const origin={...adapter.originCell(),elevation:adapter.token.document.elevation},rect=canvas.dimensions.sceneRect;
  const threats=flightThreats(adapter,state,enemy=>perceivedFlightTarget(adapter,enemy));
  const preferredElevation=Math.min(bounds.top,Math.max(bounds.bottom+step,...threats.map(t=>t.safeElevation)));
  const highPossible=threats.every(t=>t.safeElevation<=bounds.top);
  const others=canvas.tokens.placeables.filter(t=>t!==adapter.token&&occupiesMovementSpace(t)&&!t.document.hidden&&
    detectionFor(adapter.token,t).state==='observed'&&clearSightPath(adapter.token,t));
  const safety=point=>flightSafety(adapter,flightPoint(adapter,point),threats);
  const canEnter=point=>{
    const p=flightPoint(adapter,point);
    return point.elevation>=bounds.bottom&&point.elevation<=bounds.top&&p.x>=rect.x&&p.y>=rect.y&&
      p.x+adapter.token.w<=rect.x+rect.width&&p.y+adapter.token.h<=rect.y+rect.height&&
      !others.some(t=>!t.actor.isAllyOf(adapter.actor)&&volumesOverlap(tokenAt(adapter.token,p),t));
  };
  const canStop=point=>canEnter(point)&&!others.some(t=>volumesOverlap(tokenAt(adapter.token,flightPoint(adapter,point)),t));
  const routeClear=path=>{
    const points=path.map(p=>flightPoint(adapter,p));
    if(!canStop(path.at(-1))||adapter.token.constrainMovementPath(points,{ignoreWalls:false,ignoreCost:true})[1])return false;
    for(let i=1;i<path.length;i++){
      const from=path[i-1],to=path[i],n=Math.ceil(Math.max(Math.abs(to.x-from.x),Math.abs(to.y-from.y),Math.abs(to.elevation-from.elevation)/step));
      for(let j=1;j<=n;j++)if(!canEnter({x:from.x+(to.x-from.x)*j/n,y:from.y+(to.y-from.y)*j/n,
        elevation:from.elevation+(to.elevation-from.elevation)*j/n}))return false;
    }
    return true;
  };
  const measure=(path,{fresh=false}={})=>{
    const points=path.map(p=>flightPoint(adapter,p)),terrain=adapter.token.createTerrainMovementPath?.(points,{preview:false})??points;
    return Math.max(0,adapter.token.measureMovementPath([...(fresh?[]:context.history),...terrain]).cost-(fresh?0:context.historyCost));
  };
  const escapeCache=new Map();
  const escape=(point,inbound=[origin,point],options={})=>{
    const key=JSON.stringify([options.fresh??false,inbound.map(p=>[p.x,p.y,p.elevation])]);
    if(escapeCache.has(key))return escapeCache.get(key);
    const before=measure(inbound,options),here=safety(point),atCruise=point.elevation>=preferredElevation;
    if(here.safe&&atCruise){const result={path:[point],destination:point,cost:0,safety:here};escapeCache.set(key,result);return result;}
    const high={...point,elevation:Math.max(point.elevation,preferredElevation)},paths=[[point,high]];
    // If a ceiling prevents the preferred height, fall back to a substantial
    // lateral separation. Do not call one square beyond current reach a safe
    // staging position that a ground enemy can erase with a single Stride.
    if(!highPossible)for(const threat of threats){
      const cell=adapter.cell(threat.target.document),radius=Math.ceil((threat.reach+25)/step)+1;
      for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]){
        const end={x:cell.x+dx*radius,y:cell.y+dy*radius,elevation:high.elevation};
        paths.push([point,end]);
      }
    }
    let best=null;
    for(const path of paths){
      const end=path.at(-1),safe=safety(end);
      if(!safe.safe||!isAirborne(adapter.token,flightPoint(adapter,end))||!routeClear(path))continue;
      const cost=measure([...inbound,...path.slice(1)],options)-before;
      if(!Number.isFinite(cost)||cost<0||cost>state.flight.speed+1e-8)continue;
      const reactionRisk=path.some(p=>adapter.movementThreats(p,flightPoint(adapter,p)).length)?state.self.averageDamage:0;
      if(!best||cost<best.cost)best={path,destination:end,cost,safety:safe,reactionRisk};
    }
    escapeCache.set(key,best);return best;
  };
  return {origin,bounds,preferredElevation,highPossible,threats,context,safety,canEnter,canStop,routeClear,measure,escape};
}
