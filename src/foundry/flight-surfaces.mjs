import {surfaceContains,rampElevation,platformElevations} from './surface-terrain.mjs';
import {tokenHeight} from './vertical-geometry.mjs';
import {sceneLevels} from './vertical-space.mjs';
import {flySpeed} from './flight-costs.mjs';
import {rampConfig} from './ramp-geometry.mjs';
export function flightBounds(token){
  const ranges=sceneLevels(token.document.parent,token.document.level).map(l=>l.elevation??{});
  return {bottom:Math.min(0,token.document.elevation,...ranges.map(r=>r.bottom).filter(Number.isFinite)),
    top:Math.max(60,token.document.elevation+Math.max(30,flySpeed(token.actor)/2),...ranges.map(r=>r.top).filter(Number.isFinite))};
}
export function ceilingAbove(token,position=token.document._source??token.document){
 const size=canvas.grid.size,point={x:position.x+token.document.width*size/2,y:position.y+token.document.height*size/2};
 let ceiling=Infinity;
 for(const region of token.document.parent.regions?.contents??[]){
  if(region.hidden||!surfaceContains(region,point))continue;
  for(const behavior of region.behaviors?.contents??[])if(behavior.type==='defineSurface'&&!behavior.disabled&&behavior.system.move){
   const heights=[];
   if(behavior.system.placement!=='top')heights.push(region.elevation.bottom);
   if(behavior.system.placement!=='bottom')heights.push(region.elevation.top);
   for(const height of heights)if(Number.isFinite(height)&&height>position.elevation+0.01)ceiling=Math.min(ceiling,height);
  }
 }
 return ceiling;
}
export function floorBelow(token,position=token.document._source??token.document){
  const size=canvas.grid.size,point={x:position.x+token.document.width*size/2,y:position.y+token.document.height*size/2};
  let floor=flightBounds(token).bottom;
  for(const region of token.document.parent.regions?.contents??[]){
    if(region.hidden||!surfaceContains(region,point))continue;
    const elevations=platformElevations(region);
    const ramp=rampConfig(region);if(ramp)elevations.push(rampElevation(ramp,point));
    for(const elevation of elevations)if(Number.isFinite(elevation)&&elevation<=position.elevation+0.01)floor=Math.max(floor,elevation);
  }
  return floor;
}
export const isAirborne=(token,position)=>{const p=position??token.document._source??token.document;return p.elevation>floorBelow(token,p)+0.1;};
