import {clearSightPath,tokenRayPoint} from './attack-path.mjs';
import {iceBlocksMovement,segmentHitsBox} from './ice-wall-geometry.mjs';
import {tokenAt,tokenHeight,volumesOverlap} from './vertical-geometry.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
import {pitAt} from './pit-geometry.mjs';

// Terrain sight permits looking across one edge, but does not establish that
// the visible space inside that solid terrain is a safe teleport destination.
// Conservatively reject crossing movement-blocking terrain walls. Transparent
// windows and open doors can still be bypassed: this is not a walking route.
export function clearTeleportSight(source,target){
 if(!clearSightPath(source,target))return false;
 // Token.checkCollision resolves the native Level document and movement
 // source. The polygon backend itself does not accept a level ID string.
 const collisions=source.checkCollision(tokenRayPoint(target,'sight'),
  {origin:tokenRayPoint(source,'sight'),type:'move',mode:'all'});
 if(!Array.isArray(collisions))return false;
 const limited=globalThis.CONST?.EDGE_SENSE_TYPES?.LIMITED??10;
 return !collisions.some(c=>Array.from(c.edges??[]).some(e=>e.type==='wall'&&e.sight===limited&&e.move>0));
}

export function teleportSpaceClear(source,position){
 if(!position||!['x','y','elevation'].every(k=>Number.isFinite(position[k])))return false;
 const rect=canvas.dimensions.sceneRect,epsilon=0.01;
 if(!rect.contains(position.x,position.y)||!rect.contains(position.x+source.w-epsilon,position.y+source.h-epsilon)||pitAt(source.document,position))return false;
 const proxy=tokenAt(source,position),scene=source.document.parent,height=tokenHeight(source),level=position.level??source.document.level;
 if(canvas.tokens.placeables.some(t=>t!==source&&occupiesMovementSpace(t)&&volumesOverlap(proxy,t)))return false;
 const box={x:position.x+epsilon,y:position.y+epsilon,width:source.w-2*epsilon,height:source.h-2*epsilon,bottom:-1,top:1};
 for(const wall of scene.walls?.contents??[]){
  if(!wall.move||(wall.door>0&&wall.ds===1)||(wall.levels?.size&&!wall.levels.has(level)))continue;
  const c=wall.c;if(c?.length!==4)continue;
  if(segmentHitsBox({x:c[0],y:c[1],elevation:0},{x:c[2],y:c[3],elevation:0},box))return false;
 }
 if(iceBlocksMovement(source,position,position,height))return false;
 // Horizontal surfaces are separate from wall edges. Check the body at the
 // center and corners, allowing the feet to rest on a floor or platform.
 for(const [dx,dy]of [[source.w/2,source.h/2],[epsilon,epsilon],[source.w-epsilon,epsilon],[epsilon,source.h-epsilon],[source.w-epsilon,source.h-epsilon]]){
  const a={x:position.x+dx,y:position.y+dy,elevation:position.elevation+epsilon},b={...a,elevation:position.elevation+height-epsilon};
  if(scene.testSurfaceCollision?.(a,b,{type:'move',mode:'any',level}))return false;
 }
 return true;
}
