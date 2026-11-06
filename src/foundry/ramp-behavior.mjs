import {RAMP_BEHAVIOR_TYPE,RAMP_DIRECTIONS,validateRampSettings} from './ramp-geometry.mjs';
export function registerRampBehavior(){
  const Base=globalThis.foundry?.data?.regionBehaviors?.RegionBehaviorType,fields=globalThis.foundry?.data?.fields;
  if(!Base||!fields)return false;
  class RampBehavior extends Base {
    static defineSchema(){return {
      lowerElevation:new fields.NumberField({required:true,nullable:false,initial:0,label:'Lower elevation',hint:'Elevation at the low end, in scene distance units. Negative values are allowed.'}),
      upperElevation:new fields.NumberField({required:true,nullable:false,initial:5,label:'Upper elevation',hint:'Elevation at the high end. Use a separate Define Surface behavior for the adjoining flat platform.'}),
      direction:new fields.StringField({required:true,blank:false,initial:'east',choices:RAMP_DIRECTIONS,label:'Uphill direction',hint:'Scene compass direction from the lower end to the upper end. North is the top of the scene.'}),
    };}
    static validateJoint(data){validateRampSettings(data);}
  }
  CONFIG.RegionBehavior.dataModels[RAMP_BEHAVIOR_TYPE]=RampBehavior;
  (CONFIG.RegionBehavior.typeLabels??={})[RAMP_BEHAVIOR_TYPE]='Ramp / stairs';
  (CONFIG.RegionBehavior.typeIcons??={})[RAMP_BEHAVIOR_TYPE]='fa-solid fa-stairs';
  (CONFIG.RegionBehavior.typeHints??={})[RAMP_BEHAVIOR_TYPE]='Walk, Step or Sneak along this Region to follow its slope. The shape controls the width and length. Elevation changes continuously; this does not teleport tokens or create a floor/ceiling. Disable this behavior to disable the ramp.';
  return true;
}
