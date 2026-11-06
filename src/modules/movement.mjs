import {getRulesRuntime} from './runtime.mjs';
import {CORE_ID} from '../foundry/rules-context.mjs';
import {registerRulesSetting} from '../foundry/rules-settings.mjs';
import {registerMovementModes} from '../foundry/native-movement-modes.mjs';
import {installFlightCosts} from '../foundry/flight-costs.mjs';
import {installFlightFalls} from '../foundry/flight-falling.mjs';
import {registerRampBehavior} from '../foundry/ramp-behavior.mjs';
import {openRamps,configureRamp} from '../foundry/ramp-controls.mjs';
getRulesRuntime().register('movement',{
  init:runtime=>{
    registerRampBehavior();runtime.rules.ramps={open:openRamps,configure:configureRamp};
    registerMovementModes();registerRulesSetting('playerStealth',{name:'Player Hide and Sneak',scope:'world',config:true,type:Boolean,default:true});
    registerRulesSetting('manualMovementReactions',{name:'Manual movement reactions',scope:'world',config:true,type:Boolean,default:true});
    runtime.playerStealth.install();runtime.manualMovement.install();
  },
  start:runtime=>{installFlightCosts({packageId:CORE_ID});installFlightFalls({reactions:runtime.reactions,onError:runtime.onError});runtime.playerStealth.installRolls({packageId:CORE_ID});},
  controls:[{name:'playerStealth',title:'Player Hide / Sneak',icon:'fa-solid fa-user-secret',order:104,run:runtime=>runtime.playerStealth.open()},
    {name:'rampControls',title:'Ramps / stairs',icon:'fa-solid fa-stairs',order:107,gmOnly:true,run:()=>openRamps()}],
});
