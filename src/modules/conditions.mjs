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
import {installVampireLifecycle} from '../foundry/vampire-lifecycle.mjs';
import {releaseVampireGrabs} from '../foundry/vampire-blood.mjs';
import {installDomination} from '../foundry/domination.mjs';
import {installLingeringFire} from '../foundry/lingering-fire.mjs';
import {installFireShield} from '../foundry/fire-shield.mjs';
import {installVampireControls,openVampireControls} from '../foundry/vampire-controls.mjs';
import {installMonsterAbilities} from '../foundry/monster-abilities.mjs';
import {installMonsterReactions} from '../foundry/monster-reactions.mjs';
import {installWeather} from '../foundry/spell-weather.mjs';
import {installIceWalls,openIceWalls} from '../foundry/ice-wall-controls.mjs';
getRulesRuntime().register('conditions',{
  init:()=>{registerSpellProfiles();registerConditionCompatibility();registerRulesSetting('conditionRestrictions',{name:'Enforce condition action and reaction rules',scope:'world',config:true,type:Boolean,default:true});installRestrictionMovement();},
  start:async runtime=>{
    loadSpellProfiles();Hooks.on('updateSetting',setting=>{if(setting.key?.endsWith('.spellProfiles'))loadSpellProfiles();});
    installMonsterAbilities({reactions:runtime.reactions,onError:runtime.onError});
    installWeather({reactions:runtime.reactions,onError:runtime.onError});installIceWalls({reactions:runtime.reactions,onError:runtime.onError});
    installMonsterReactions({reactions:runtime.reactions,packageId:CONDITIONS_ID});
    installSpellAlliances({packageId:CONDITIONS_ID});
    installVampireLifecycle({packageId:CONDITIONS_ID,reactions:runtime.reactions,onError:runtime.onError});
    installDomination({reactions:runtime.reactions,onError:runtime.onError});
    installLingeringFire({reactions:runtime.reactions,onError:runtime.onError});
    installFireShield({reactions:runtime.reactions,onError:runtime.onError});
    installVampireControls({reactions:runtime.reactions,onError:runtime.onError});
    const release=options=>{if(game.users.activeGM?.id===game.user.id)void runtime.reactions.resolve(()=>releaseVampireGrabs(options)).catch(runtime.onError);};
    Hooks.on('moveToken',()=>release());Hooks.on('pf2e.endTurn',(c,combat)=>release({phase:'end',source:c.tokenId,round:c.getFlag?.('pf2e','roundOfLastTurnEnd')??combat.round}));
    await applyConditionCompatibility();const options={reactions:runtime.reactions,onError:runtime.onError,onPause:()=>runtime.pause()};
    installOngoingSpells(options);installConditionActions(options);installFascination(options);installManualConditionSpells(options);installPoisonHooks(options);installDefinedSpellEffects(options);installSpellObservations(options);
    installActionRestrictions({packageId:CORE_ID});installGreaseTerrain({packageId:CORE_ID});installGreaseLandingHooks(options);
  },
  controls:[{name:'conditionActions',title:'Condition actions / sources',icon:'fa-solid fa-heart-pulse',order:106,run:()=>openConditionActions()},
    {name:'iceWalls',title:'Ice walls: attack a section',icon:'fa-solid fa-icicles',order:111,run:()=>openIceWalls()},
    {name:'vampireStates',title:'Vampire forms / vulnerabilities',icon:'fa-solid fa-droplet',order:109,gmOnly:true,run:()=>openVampireControls()},
    {name:'spellProfiles',title:'Spell AI / shared definitions',icon:'fa-solid fa-book-sparkles',order:108,gmOnly:true,run:()=>openSpellProfiles()},
    {name:'ongoingSpells',title:'Ongoing spells / Sustain',icon:'fa-solid fa-wand-sparkles',order:105,run:()=>openOngoingSpells()}],
});
