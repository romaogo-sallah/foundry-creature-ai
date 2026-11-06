import {flightBounds} from './flight-surfaces.mjs';
import {tokenHeight} from './vertical-geometry.mjs';
import {simpleFlightMoves} from './simple-flight-moves.mjs';
// A bounded approach to the one selected target, with no hunting altitude,
// retreat, diving, safety heat map or worker strategy.
export function confusedFlightMoves(adapter,target){
  const start={...adapter.originCell(),elevation:adapter.token.document.elevation},bounds=flightBounds(adapter.token);
  const goal={...adapter.cell(target.document),elevation:Math.max(bounds.bottom,target.document.elevation)};
  return simpleFlightMoves(adapter,{goal,ceiling:Math.max(start.elevation,goal.elevation+tokenHeight(target))});
}
