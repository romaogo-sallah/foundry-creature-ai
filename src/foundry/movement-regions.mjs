import { terrainBehavior } from './terrain-contract.mjs';
import { GREASE_SCRIPT,LEGACY_GREASE_SCRIPT } from './spell-zones.mjs';
import {RAMP_BEHAVIOR_TYPE} from './ramp-geometry.mjs';
import {PIT_BEHAVIOR_TYPE} from './pit-geometry.mjs';
import {WATER_BEHAVIOR_TYPES} from './water-geometry.mjs';

// These native behaviors may react to movement or presentation, but they do
// not alter the route itself. Foundry remains responsible for executing them.
// Level changes, teleports, macros and unknown scripts stay guarded because
// their destination or movement consequences cannot be predicted safely.
const NON_MOVEMENT_BEHAVIORS=new Set([
  'adjustDarknessLevel','applyActiveEffect','displayScrollingText','pauseGame',
  'suppressWeather','toggleBehavior',
]);

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
      !['defineSurface','modifyMovementCost',RAMP_BEHAVIOR_TYPE,PIT_BEHAVIOR_TYPE].includes(behavior.type) &&
      !NON_MOVEMENT_BEHAVIORS.has(behavior.type) && !WATER_BEHAVIOR_TYPES.has(behavior.type) &&
      !terrainBehavior(behavior,'environment') && !terrainBehavior(behavior,'hazard') &&
      !(behavior.type==='executeScript' && [GREASE_SCRIPT,LEGACY_GREASE_SCRIPT].includes(behavior.system?.source) && behavior.flags?.['foundry-creature-ai']?.spellTerrain==='grease')));
}
