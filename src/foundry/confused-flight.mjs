import {reachableFlightCells} from '../framework/flight-navigation.mjs';
import {flightPoint,flightCost,flightCollision} from './flight-movement.mjs';
import {flightBounds,floorBelow} from './flight-surfaces.mjs';
import {tokenAt,volumesOverlap,tokenHeight} from './vertical-geometry.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
// A bounded approach to the one selected target, with no hunting altitude,
// retreat, diving, safety heat map or worker strategy.
export function confusedFlightMoves(adapter,target){
  const start={...adapter.originCell(),elevation:adapter.token.document.elevation},bounds=flightBounds(adapter.token),rect=canvas.dimensions.sceneRect;
  const occupied=canvas.tokens.placeables.filter(other=>other!==adapter.token&&occupiesMovementSpace(other));
  const goal={...adapter.cell(target.document),elevation:Math.max(bounds.bottom,target.document.elevation)};
  const ceiling=Math.max(start.elevation,goal.elevation+tokenHeight(target)),context=adapter.movementContext(),cache=new Map();
  return reachableFlightCells(start,adapter.flightSpeed(),{
    maxNodes:180,goals:[goal],canEnter:cell=>{
      const p=flightPoint(adapter,cell);
      return cell.elevation>=bounds.bottom&&cell.elevation<=ceiling&&p.x>=rect.x&&p.y>=rect.y&&p.x+adapter.token.w<=rect.x+rect.width&&p.y+adapter.token.h<=rect.y+rect.height&&
        cell.elevation>=floorBelow(adapter.token,p)-0.1&&!occupied.some(other=>volumesOverlap(tokenAt(adapter.token,p),other,{acrossLevels:true}));
    },canTraverse:(from,to)=>{
      const key=`${from.x},${from.y},${from.elevation}>${to.x},${to.y},${to.elevation}`;
      if(!cache.has(key))cache.set(key,flightCollision(adapter,from.path.length===1?adapter.actualWaypoint():flightPoint(adapter,from),flightPoint(adapter,to)));
      return cache.get(key);
    },pathCost:path=>flightCost(adapter,path,context),
  }).filter(node=>node.cost>0).map(node=>({...node,kind:'fly'}));
}
