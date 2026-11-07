import {iceBlocksMovement} from './ice-wall-geometry.mjs';
import {flySpeed} from './flight-costs.mjs';

export function sceneLevels(scene,fallbackId){
 const levels=scene?.levels;
 if(levels?.contents)return levels.contents;
 if(levels?.[Symbol.iterator])return Array.from(levels);
 return [levels?.get?.(fallbackId)].filter(Boolean);
}
export function sharesVerticalSpace(one,two){
 return one.document.level===two.document.level||one.document.parent?.id===two.document.parent?.id&&
  (flySpeed(one.actor)>0||flySpeed(two.actor)>0);
}
export function flightLevelAt(token,elevation){
 const current=token.document.level,levels=sceneLevels(token.document.parent,current);
 const includes=level=>elevation>=(level.elevation?.bottom??-Infinity)&&elevation<(level.elevation?.top??Infinity);
 const available=levels.filter(includes);
 return available.find(l=>l.id===current)?.id??available.sort((a,b)=>(b.elevation?.bottom??-Infinity)-(a.elevation?.bottom??-Infinity))[0]?.id??current;
}
function raySegments(scene,origin,destination){
 const dz=destination.elevation-origin.elevation;
 const at=t=>({x:origin.x+(destination.x-origin.x)*t,y:origin.y+(destination.y-origin.y)*t,elevation:origin.elevation+dz*t});
 return sceneLevels(scene).flatMap(level=>{
  if(!level.id)return [];
  const low=level.elevation?.bottom??-Infinity,high=level.elevation?.top??Infinity;
  if(!dz)return origin.elevation>=low&&origin.elevation<high?[{level,origin,destination}]:[];
  const a=(low-origin.elevation)/dz,b=(high-origin.elevation)/dz,from=Math.max(0,Math.min(a,b)),to=Math.min(1,Math.max(a,b));
  return to>from?[{level,origin:at(from),destination:at(to)}]:[];
 });
}
// Native wall edges remain authoritative. Clip the ray to each intersected
// level instead of testing an upper-level wall along a ground-level segment.
export function clearLevelWalls(token,origin,destination,type){
 const backend=globalThis.CONFIG?.Canvas?.polygonBackends?.[type];
 if(!backend?.testCollision)return true;
 return raySegments(token.document.parent,origin,destination).every(segment=>!backend.testCollision(segment.origin,segment.destination,
  {type,mode:'any',level:segment.level,source:type==='sight'?token.vision:undefined}));
}
export function clearFlightSurfaces(token,from,to,height){
 if(iceBlocksMovement(token,from,to,height))return false;
 const scene=token.document.parent,size=globalThis.canvas.grid.size;
 const point=(p,z)=>({x:p.x+token.document.width*size/2,y:p.y+token.document.height*size/2,elevation:p.elevation+z});
 for(const [z,side]of [[0,'below'],[height,'above'],[height/2,'below']]){
  if(scene.testSurfaceCollision?.(point(from,z),point(to,z),{type:'move',mode:'any',side}))return false;
 }
 return clearLevelWalls(token,point(from,height/2),point(to,height/2),'move');
}
