import {getRulesRuntime} from './runtime.mjs';
import {registerRulesSetting} from '../foundry/rules-settings.mjs';
import {CORE_ID} from '../foundry/rules-context.mjs';
import {installHazardMovement} from '../foundry/hazardous-terrain.mjs';
import {installStealthVisibility,openStealthControls} from '../foundry/stealth-awareness.mjs';
import {openZones} from '../foundry/environment-zones.mjs';
getRulesRuntime().register('environment',{
  init:runtime=>registerRulesSetting('directionalZoneIndicators',{name:'Show directional zone defenses',scope:'client',config:true,type:Boolean,default:true,onChange:()=>void runtime.refresh()}),
  start:runtime=>{installHazardMovement({packageId:CORE_ID});runtime.environmentAwareness.install({packageId:CORE_ID});installStealthVisibility({packageId:CORE_ID});},
  controls:[{name:'environmentZones',title:'Cover / concealment zones',icon:'fa-solid fa-cloud',order:102,gmOnly:true,run:()=>openZones()},
    {name:'stealthControls',title:'Detection controls',icon:'fa-solid fa-eye',order:103,gmOnly:true,run:()=>openStealthControls()}],
});
