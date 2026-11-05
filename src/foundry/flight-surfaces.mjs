import {surfaceContains,rampElevation} from './surface-terrain.mjs';
import {tokenHeight} from './vertical-geometry.mjs';
const ns='foundry-creature-ai';
export function flightBounds(token){
  const level=token.document.parent.levels?.get?.(token.document.level),range=level?.elevation;
  return {bottom:Number.isFinite(range?.bottom)?range.bottom:0,
    top:Number.isFinite(range?.top)?range.top:Math.max(60,token.document.elevation+30)};
}
export function floorBelow(token,position=token.document._source??token.document){
  const size=canvas.grid.size,point={x:position.x+token.document.width*size/2,y:position.y+token.document.height*size/2};
  let floor=flightBounds(token).bottom;
  for(const region of token.document.parent.regions?.contents??[]){
    if(region.hidden||region.includedInLevel&&!region.includedInLevel(token.document.level)||!surfaceContains(region,point))continue;
    const data=region.flags?.[ns]??{};
    const elevations=[];
    if(data.platform)elevations.push(data.platform.elevation);
    if(data.ramp)elevations.push(rampElevation(data.ramp,point));
    for(const behavior of region.behaviors?.contents??[])if(behavior.type==='defineSurface'&&!behavior.disabled&&behavior.system.move){
      if(behavior.system.placement!=='top')elevations.push(region.elevation.bottom);
      if(behavior.system.placement!=='bottom')elevations.push(region.elevation.top);
    }
    for(const elevation of elevations)if(Number.isFinite(elevation)&&elevation<=position.elevation+0.01)floor=Math.max(floor,elevation);
  }
  return floor;
}
export const isAirborne=(token,position)=>{const p=position??token.document._source??token.document;return p.elevation>floorBelow(token,p)+0.1;};
