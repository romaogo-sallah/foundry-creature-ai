import {getRulesRuntime} from './runtime.mjs';
import {CORE_ID} from '../foundry/rules-context.mjs';
import {registerRulesSetting} from '../foundry/rules-settings.mjs';
import {registerMovementModes,installSneakRulerLabels} from '../foundry/native-movement-modes.mjs';
import {installFlightCosts} from '../foundry/flight-costs.mjs';
import {installFlightFalls} from '../foundry/flight-falling.mjs';
import {registerRampBehavior} from '../foundry/ramp-behavior.mjs';
import {openRamps,configureRamp} from '../foundry/ramp-controls.mjs';
import {registerPitBehavior} from '../foundry/pit-actions.mjs';
import {installPits,openPitActions} from '../foundry/pit-runtime.mjs';
import {registerWaterBehavior} from '../foundry/water-behavior.mjs';
import {configureWater,openWaterZones} from '../foundry/water-controls.mjs';
getRulesRuntime().register('movement',{
  init:runtime=>{
    registerRampBehavior();registerPitBehavior();registerWaterBehavior();runtime.rules.ramps={open:openRamps,configure:configureRamp};
    runtime.rules.waters={open:openWaterZones,configure:configureWater};
    registerMovementModes();registerRulesSetting('playerStealth',{name:'Manual Hide and Sneak (PCs and NPCs)',scope:'world',config:true,type:Boolean,default:true});
    registerRulesSetting('manualMovementReactions',{name:'Manual movement reactions',scope:'world',config:true,type:Boolean,default:true});
    runtime.playerStealth.install();runtime.manualMovement.install();
  },
  start:runtime=>{installPits(runtime);installFlightCosts({packageId:CORE_ID});installFlightFalls({reactions:runtime.reactions,onError:runtime.onError});runtime.playerStealth.installRolls({packageId:CORE_ID});installSneakRulerLabels({packageId:CORE_ID});},
  controls:[{name:'playerStealth',title:'Hide / Sneak (PCs and NPCs)',icon:'fa-solid fa-user-secret',order:104,run:runtime=>runtime.playerStealth.open()},
    {name:'rampControls',title:'Ramps / stairs',icon:'fa-solid fa-stairs',order:107,palette:'regions',gmOnly:true,run:()=>openRamps()},
    {name:'waterControls',title:'Water zones',icon:'fa-solid fa-water',order:108,palette:'regions',gmOnly:true,run:()=>openWaterZones()},
    {name:'pitControls',title:'Pit: Climb / Jump',icon:'fa-solid fa-person-falling',order:110,run:()=>openPitActions()}],
});
