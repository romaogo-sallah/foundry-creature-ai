import {getRulesRuntime} from './runtime.mjs';
import {CORE_ID} from '../foundry/rules-context.mjs';
import {registerRulesSetting} from '../foundry/rules-settings.mjs';
import {registerConditionCompatibility,applyConditionCompatibility} from '../foundry/condition-compatibility.mjs';
import {installRestrictionMovement,installActionRestrictions} from '../foundry/action-restrictions.mjs';
import {installOngoingSpells,openOngoingSpells} from '../foundry/ongoing-spells.mjs';
import {installConditionActions,openConditionActions} from '../foundry/manual-condition-actions.mjs';
import {installManualConditionSpells} from '../foundry/manual-condition-spells.mjs';
import {installFascination} from '../foundry/fascination.mjs';
import {installPoisonHooks} from '../foundry/poison-effects.mjs';
import {installGreaseTerrain} from '../foundry/spell-zones.mjs';
import {installGreaseLandingHooks} from '../foundry/grease-landing.mjs';
getRulesRuntime().register('conditions',{
  init:()=>{registerConditionCompatibility();registerRulesSetting('conditionRestrictions',{name:'Enforce condition action and reaction rules',scope:'world',config:true,type:Boolean,default:true});installRestrictionMovement();},
  start:async runtime=>{
    await applyConditionCompatibility();const options={reactions:runtime.reactions,onError:runtime.onError,onPause:()=>runtime.pause()};
    installOngoingSpells(options);installConditionActions(options);installFascination(options);installManualConditionSpells(options);installPoisonHooks(options);
    installActionRestrictions({packageId:CORE_ID});installGreaseTerrain({packageId:CORE_ID});installGreaseLandingHooks(options);
  },
  controls:[{name:'conditionActions',title:'Condition actions / sources',icon:'fa-solid fa-heart-pulse',order:106,run:()=>openConditionActions()},
    {name:'ongoingSpells',title:'Ongoing spells / Sustain',icon:'fa-solid fa-wand-sparkles',order:105,run:()=>openOngoingSpells()}],
});
