import {getRulesRuntime} from './runtime.mjs';
import {CORE_ID,CONDITIONS_ID} from '../foundry/rules-context.mjs';
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
import {installDefinedSpellEffects} from '../foundry/defined-spell-effects.mjs';
import {registerSpellProfiles,loadSpellProfiles,openSpellProfiles} from '../foundry/spell-profile-controls.mjs';
import {installSpellAlliances} from '../foundry/spell-alliance.mjs';
import {installSpellObservations} from '../foundry/spell-observations.mjs';
getRulesRuntime().register('conditions',{
  init:()=>{registerSpellProfiles();registerConditionCompatibility();registerRulesSetting('conditionRestrictions',{name:'Enforce condition action and reaction rules',scope:'world',config:true,type:Boolean,default:true});installRestrictionMovement();},
  start:async runtime=>{
    loadSpellProfiles();Hooks.on('updateSetting',setting=>{if(setting.key?.endsWith('.spellProfiles'))loadSpellProfiles();});
    installSpellAlliances({packageId:CONDITIONS_ID});
    await applyConditionCompatibility();const options={reactions:runtime.reactions,onError:runtime.onError,onPause:()=>runtime.pause()};
    installOngoingSpells(options);installConditionActions(options);installFascination(options);installManualConditionSpells(options);installPoisonHooks(options);installDefinedSpellEffects(options);installSpellObservations(options);
    installActionRestrictions({packageId:CORE_ID});installGreaseTerrain({packageId:CORE_ID});installGreaseLandingHooks(options);
  },
  controls:[{name:'conditionActions',title:'Condition actions / sources',icon:'fa-solid fa-heart-pulse',order:106,run:()=>openConditionActions()},
    {name:'spellProfiles',title:'Spell AI / shared definitions',icon:'fa-solid fa-book-sparkles',order:108,gmOnly:true,run:()=>openSpellProfiles()},
    {name:'ongoingSpells',title:'Ongoing spells / Sustain',icon:'fa-solid fa-wand-sparkles',order:105,run:()=>openOngoingSpells()}],
});
