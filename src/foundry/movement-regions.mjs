import { terrainBehavior } from './terrain-contract.mjs';
import { GREASE_SCRIPT,LEGACY_GREASE_SCRIPT } from './spell-zones.mjs';
import {RAMP_BEHAVIOR_TYPE} from './ramp-geometry.mjs';

// Measurement consumes terrain annotations; it does not discover Regions itself.
// Regionalize only new movement, preserving the recorded history's terrain and
// diagonal parity when the caller appends this path to that history.
export function terrainMovementPath(token, waypoints) {
  return token.createTerrainMovementPath?.(waypoints, { preview: false }) ?? waypoints;
}
// Declarative geometry/costs use native path constraints and measurement. Owned
// environment scripts only refresh state; owned hazards have an awaited handler.
export function unsupportedMovementRegions(scene) {
  return (scene.regions?.contents ?? []).filter(region =>
    (region.behaviors?.contents ?? []).some(behavior => !behavior.disabled &&
      !['defineSurface','modifyMovementCost','suppressWeather',RAMP_BEHAVIOR_TYPE].includes(behavior.type) &&
      !terrainBehavior(behavior,'environment') && !terrainBehavior(behavior,'hazard') &&
      !(behavior.type==='executeScript' && [GREASE_SCRIPT,LEGACY_GREASE_SCRIPT].includes(behavior.system?.source) && behavior.flags?.['foundry-creature-ai']?.spellTerrain==='grease')));
}
