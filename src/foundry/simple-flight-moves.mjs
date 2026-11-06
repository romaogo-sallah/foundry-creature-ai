import {reachableFlightCells} from '../framework/flight-navigation.mjs';
import {flightPoint,flightCost,flightCollision} from './flight-movement.mjs';
import {flightBounds,floorBelow} from './flight-surfaces.mjs';
import {tokenAt,volumesOverlap} from './vertical-geometry.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
// Shared bounded flight without the ordinary hunting or attack planner.
export function simpleFlightMoves(adapter,{goal,ceiling,maxNodes=180}){
  const start={...adapter.originCell(),elevation:adapter.token.document.elevation},bounds=flightBounds(adapter.token),rect=canvas.dimensions.sceneRect;
  const occupied=canvas.tokens.placeables.filter(other=>other!==adapter.token&&occupiesMovementSpace(other));
  const context=adapter.movementContext(),cache=new Map();
  return reachableFlightCells(start,adapter.flightSpeed(),{
    maxNodes,goals:[goal],canEnter:cell=>{
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
