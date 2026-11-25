import {WATER_BEHAVIOR_TYPE} from './water-geometry.mjs';

export function registerWaterBehavior(){
  const Base=globalThis.foundry?.data?.regionBehaviors?.RegionBehaviorType;
  if(!Base)return false;
  class WaterBehavior extends Base {static defineSchema(){return {};}}
  CONFIG.RegionBehavior.dataModels[WATER_BEHAVIOR_TYPE]=WaterBehavior;
  (CONFIG.RegionBehavior.typeLabels??={})[WATER_BEHAVIOR_TYPE]='Water';
  (CONFIG.RegionBehavior.typeIcons??={})[WATER_BEHAVIOR_TYPE]='fa-solid fa-water';
  (CONFIG.RegionBehavior.typeHints??={})[WATER_BEHAVIOR_TYPE]='Makes this Region a three-dimensional swimmable volume. The Region elevation bottom is the water bottom and its top is the surface; negative elevations are allowed. Select Swim to move horizontally or vertically using Swim Speed.';
  return true;
}
