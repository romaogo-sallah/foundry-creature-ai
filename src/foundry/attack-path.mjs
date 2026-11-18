import {clearLevelWalls} from './vertical-space.mjs';
import {flySpeed} from './flight-costs.mjs';
import {pitBlocksRay} from './pit-geometry.mjs';
import {iceBlocksRay} from './ice-wall-geometry.mjs';
export const FOOTPRINT_RAY_INSET = 0.05;
// Token.center is only 2D in Foundry 14. Use each token's own native ray height,
// including for a target of a different depth and hypothetical movement origins.
export function tokenRayPoint(token, type = 'move', center) {
  const document = token.document, source = document._source ?? document;
  const method = type === 'sight' ? document.getVisionOrigin : document.getMovementOrigin;
  const native = method?.call(document, source);
  const distance = document.parent?.grid?.distance ?? globalThis.canvas?.grid?.distance ?? 5;
  const point = native ?? { ...token.center, elevation: (source.elevation ?? 0) + (source.depth ?? 1) * distance / 2 };
  return { x: center?.x ?? point.x, y: center?.y ?? point.y, elevation: center?.elevation ?? point.elevation };
}

// An AI plan asks for the same corner rays many times, so while a plan is built
// their results are kept per attacker. Any change that can alter a ray clears them.
const RAY_CACHE_EVENTS=['createToken','updateToken','deleteToken','moveToken','updateActor','createItem','updateItem','deleteItem',
  'createRegion','updateRegion','deleteRegion','createRegionBehavior','updateRegionBehavior','deleteRegionBehavior',
  'createWall','updateWall','deleteWall','updateScene','canvasReady'];
let rayCacheDepth=0,rayCache=new WeakMap(),rayCacheHooked=false;
function clearRayCache(){rayCache=new WeakMap();}
// Listeners exist only while a plan holds the cache.
export function beginRayCache(){
  if(!rayCacheDepth++&&globalThis.Hooks?.on){rayCacheHooked=true;for(const event of RAY_CACHE_EVENTS)Hooks.on(event,clearRayCache);}
}
export function endRayCache(){
  if(rayCacheDepth<=0||--rayCacheDepth)return;
  clearRayCache();
  if(rayCacheHooked)for(const event of RAY_CACHE_EVENTS)globalThis.Hooks?.off?.(event,clearRayCache);
  rayCacheHooked=false;
}
export async function withRayCache(work){beginRayCache();try{return await work();}finally{endRayCache();}}

function clearRay(attacker, target, type, origin, destination) {
  const across=flySpeed(attacker.actor)>0||flySpeed(target.actor)>0;
  if(!rayCacheDepth)return testRay(attacker,target,type,origin,destination,across);
  let rays=rayCache.get(attacker);if(!rays)rayCache.set(attacker,rays=new Map());
  const key=`${type}|${across}|${attacker.document.parent?.id}|${attacker.document.level}|${origin.x},${origin.y},${origin.elevation}|${destination.x},${destination.y},${destination.elevation}`;
  let clear=rays.get(key);
  if(clear===undefined)rays.set(key,clear=testRay(attacker,target,type,origin,destination,across));
  return clear;
}

function testRay(attacker, target, type, origin, destination, across) {
  if(pitBlocksRay(attacker,target,origin,destination))return false;
  if(iceBlocksRay(attacker.document.parent,origin,destination,attacker.document.level))return false;
  if(across&&globalThis.CONFIG?.Canvas?.polygonBackends?.[type]?.testCollision){
    if(!clearLevelWalls(attacker,origin,destination,type))return false;
  }else if(attacker.checkCollision?.(destination,{origin,type,mode:'any'}))return false;
  // Token.checkCollision tests wall edges. Foundry tests horizontal surfaces
  // separately. Flyers test physical surfaces across the scene's levels.
  return !attacker.document.parent?.testSurfaceCollision?.(origin, destination,
    { type, mode: 'any', level: across?undefined:attacker.document.level });
}

function footprintAxis(start,length,step){
  const end=start+length,points=[start];
  if(step>0)for(let value=start+step;value<end-1e-6;value+=step)points.push(value);
  if(end!==start)points.push(end);return points;
}

function insetFootprintPoint(value,center,inset){
  if(value<center)return Math.min(center,value+inset);
  if(value>center)return Math.max(center,value-inset);
  return value;
}

// Sample every occupied-grid intersection. Medium and smaller creatures have
// four footprint corners; larger creatures also contribute their internal grid
// intersections, as required by the table's corner-visibility policy.
export function footprintRayPoints(token,type='sight',center){
  const document=token.document,source=document._source??document,scene=document.parent??globalThis.canvas?.scene;
  const size=scene?.grid?.size??globalThis.canvas?.grid?.size??100;
  const widthUnits=Number.isFinite(document.width)?document.width:Number.isFinite(token.w)?token.w/size:1,
    heightUnits=Number.isFinite(document.height)?document.height:Number.isFinite(token.h)?token.h/size:1;
  const width=widthUnits*size,height=heightUnits*size;
  const native=tokenRayPoint(token,type,center),left=center?center.x-width/2:source.x??token.center.x-width/2,
    top=center?center.y-height/2:source.y??token.center.y-height/2;
  const middleX=left+width/2,middleY=top+height/2,inset=size*FOOTPRINT_RAY_INSET;
  return footprintAxis(left,width,size).flatMap(x=>footprintAxis(top,height,size).map(y=>({
    x:insetFootprintPoint(x,middleX,inset),y:insetFootprintPoint(y,middleY,inset),elevation:native.elevation})));
}

export function footprintVisibility(observer,target,{type='sight',origin,destination}={}){
  const origins=footprintRayPoints(observer,type,origin),targets=footprintRayPoints(target,type,destination);
  let visible=0;
  for(const from of origins){
    let count=0;
    for(const to of targets)if(clearRay(observer,target,type,from,to))count++;
    if(count===targets.length)return {visible:true,unobstructed:true,visiblePoints:count,totalPoints:targets.length,coverBonus:0};
    visible=Math.max(visible,count);
  }
  if(!visible)return {visible:false,unobstructed:false,visiblePoints:0,totalPoints:targets.length,coverBonus:0};
  const coverBonus=visible===1?2:1;
  return {visible:true,unobstructed:false,visiblePoints:visible,totalPoints:targets.length,coverBonus};
}

// Glass can permit sight while blocking weapons. Keep both native collision
// types distinct while using the same footprint-corner policy.
export const clearAttackPath = (attacker, target, origin) => footprintVisibility(attacker,target,{type:'move',origin}).visible;
export const clearSightPath = (attacker, target, origin) => footprintVisibility(attacker,target,{type:'sight',origin}).visible;
