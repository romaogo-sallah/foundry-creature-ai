import {clearLevelWalls} from './vertical-space.mjs';
import {flySpeed} from './flight-costs.mjs';
import {pitBlocksRay} from './pit-geometry.mjs';
import {iceBlocksRay} from './ice-wall-geometry.mjs';
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

function clearRay(attacker, target, type, center) {
  const origin = tokenRayPoint(attacker, type, center), destination = tokenRayPoint(target, type);
  if(pitBlocksRay(attacker,target,origin,destination))return false;
  if(iceBlocksRay(attacker.document.parent,origin,destination,attacker.document.level))return false;
  const across=flySpeed(attacker.actor)>0||flySpeed(target.actor)>0;
  if(across&&globalThis.CONFIG?.Canvas?.polygonBackends?.[type]?.testCollision){
    if(!clearLevelWalls(attacker,origin,destination,type))return false;
  }else if(attacker.checkCollision(destination,{origin,type,mode:'any'}))return false;
  // Token.checkCollision tests wall edges. Foundry tests horizontal surfaces
  // separately. Flyers test physical surfaces across the scene's levels.
  return !attacker.document.parent?.testSurfaceCollision?.(origin, destination,
    { type, mode: 'any', level: across?undefined:attacker.document.level });
}

// Glass can permit sight while blocking jaws. Keep both native tests distinct.
export const clearAttackPath = (attacker, target, origin) => clearRay(attacker, target, 'move', origin);
export const clearSightPath = (attacker, target, origin) => clearRay(attacker, target, 'sight', origin);
