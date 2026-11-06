import {CORE_ID,ENVIRONMENT_ID,CONDITIONS_ID,MOVEMENT_ID,MODULE_ID} from '../foundry/rules-context.mjs';
import {rulesSetting,migrateRulesSettings} from '../foundry/rules-settings.mjs';
import {RUNTIME_VERSION} from '../foundry/runtime-version.mjs';
import {ReactionEngine} from '../foundry/reactions.mjs';
import {PlayerStealth} from '../foundry/player-stealth.mjs';
import {ManualMovement} from '../foundry/manual-movement.mjs';
import {configureZone,environmentBetween,openZones} from '../foundry/environment-zones.mjs';
import {EnvironmentAwareness,TOKEN_GEOMETRY_FIELDS} from '../foundry/environment-awareness.mjs';
import {ZoneConcealment} from '../foundry/zone-concealment.mjs';
import {refreshStealthVisibility,openStealthControls,detectionFor} from '../foundry/stealth-awareness.mjs';
import {installEnvironmentRolls} from '../foundry/environment-rolls.mjs';
import {createHazardHandler} from '../foundry/hazardous-terrain.mjs';
import {applySceneSetup} from '../foundry/scene-setup.mjs';
import {refreshSpellZones,expireSpellZones} from '../foundry/spell-zones.mjs';
import {setSneakMode} from '../foundry/sneak-mode.mjs';
import {actionRestriction,reactionRestriction} from '../foundry/action-restrictions.mjs';
import {openOngoingSpells,ongoingCasts,advanceOngoingSpells,sustainCast,endSustainedCast} from '../foundry/ongoing-spells.mjs';
import {openConditionActions} from '../foundry/manual-condition-actions.mjs';
import {conditionAutomationOwners} from '../foundry/condition-compatibility.mjs';
import {advancePoisons,expirePoisons} from '../foundry/poison-effects.mjs';
import {migrateRegionScripts} from './script-migration.mjs';
import {registerLegacyRuleFlags} from '../foundry/legacy-rule-flags.mjs';
import {markManagedRuleMessage} from '../foundry/managed-rule-message.mjs';

const runtimes=new WeakMap();
export function getRulesRuntime(){
  if(!runtimes.has(game))runtimes.set(game,new RulesRuntime());
  return runtimes.get(game);
}
export class RulesRuntime {
  constructor(){
    this.features=new Set();this.controllers=new Map();this.ai=null;this.started=null;this.hooksInstalled=false;
    this.onError=error=>{console.error(`${CORE_ID}:`,error);ui.notifications.error(`Tactical Rules: ${error.message}`);};
    this.reactions=new ReactionEngine({onPause:()=>this.pause(),automaticReactiveStrike:token=>this.ai?.automaticReactiveStrike?.(token)??false});
    this.playerStealth=new PlayerStealth({enabled:()=>this.has('movement')&&rulesSetting('playerStealth')!==false,onError:this.onError});
    this.manualMovement=new ManualMovement(this.reactions,{playerStealth:this.playerStealth,
      enabled:()=>this.has('movement')&&!this.ai?.blocked?.()&&rulesSetting('manualMovementReactions')!==false,
      onMoveAction:(...args)=>this.ai?.afterMove?.(...args),onError:this.onError});
    this.reactions.afterMoveAction=(...args)=>this.ai?.afterMove?.(...args);
    this.zoneConcealment=new ZoneConcealment();
    this.environmentAwareness=new EnvironmentAwareness({enabled:()=>this.has('environment')&&rulesSetting('directionalZoneIndicators')!==false});
    this.onHazardMove=createHazardHandler({resolve:operation=>this.reactions.resolve(operation),onPause:()=>this.pause()});
    this.rules={reactions:this.reactions,manualMovement:this.manualMovement,
      zones:{open:openZones,configure:configureZone,between:environmentBetween,refresh:()=>this.refresh(),view:()=>({observerId:this.environmentAwareness.observer?.id??null,
        defenses:[...this.environmentAwareness.entries].map(([tokenId,entry])=>({tokenId,...entry.environment,detection:entry.detection}))})},
      terrain:{onHazardMove:this.onHazardMove,applySetup:applySceneSetup},
      stealth:{open:openStealthControls,detection:detectionFor,player:this.playerStealth,
        hide:token=>this.playerStealth.request('hide',token),sneak:token=>this.playerStealth.request('arm-sneak',token),stopSneak:token=>this.playerStealth.request('stop-sneak',token),
        revealAction:token=>this.playerStealth.request('reveal-action',token),reveal:token=>this.playerStealth.request('reveal',token)},
      spells:{refresh:refreshSpellZones,expire:expireSpellZones,openOngoing:openOngoingSpells,ongoing:ongoingCasts,advance:advanceOngoingSpells,sustain:sustainCast,end:endSustainedCast},
      conditions:{open:openConditionActions,owners:conditionAutomationOwners,inspect:(actor=canvas.tokens.controlled[0]?.actor)=>({actions:actionRestriction(actor),reactions:reactionRestriction(actor)})},
      poisons:{advance:token=>this.reactions.resolve(()=>advancePoisons(token)),expire:expirePoisons}};
  }
  has(feature){return this.features.has(feature);}
  attachAI(callbacks){this.ai=callbacks;this.reactions.presentation=callbacks.presentation??null;}
  pause(){this.manualMovement.cancel();this.ai?.onPause?.();}
  async refresh(){
    if(!canvas.ready)return;
    refreshStealthVisibility();canvas.tokens.recalculatePlannedMovementPaths?.();
    await Promise.all([this.has('environment')?this.zoneConcealment.refresh():null,this.has('environment')?this.environmentAwareness.schedule():null,
      this.has('movement')?this.playerStealth.refresh():null,this.has('conditions')?refreshSpellZones():null]);
  }
  publish(){
    const active={reactions:this.reactions};
    if(this.has('environment'))Object.assign(active,{zones:this.rules.zones,terrain:this.rules.terrain,stealth:{open:openStealthControls,detection:detectionFor}});
    if(this.has('conditions'))Object.assign(active,{conditions:this.rules.conditions,spells:this.rules.spells,poisons:this.rules.poisons});
    if(this.has('movement'))Object.assign(active,{manualMovement:this.manualMovement,stealth:this.rules.stealth,ramps:this.rules.ramps});
    const core=game.modules?.get?.(CORE_ID);if(core)core.api={version:RUNTIME_VERSION,apiVersion:1,rules:active,runtime:this};
    for(const [feature,id,api]of [['environment',ENVIRONMENT_ID,{zones:this.rules.zones,terrain:this.rules.terrain,stealth:{open:openStealthControls,detection:detectionFor}}],
      ['conditions',CONDITIONS_ID,{conditions:this.rules.conditions,spells:this.rules.spells,poisons:this.rules.poisons}],
      ['movement',MOVEMENT_ID,{movement:this.manualMovement,stealth:this.rules.stealth,ramps:this.rules.ramps}]]){
      const module=game.modules?.get?.(id);if(module&&this.has(feature))module.api={version:RUNTIME_VERSION,apiVersion:1,...api};
    }
  }
  register(feature,controller={}){
    if(this.has(feature))return;this.features.add(feature);this.controllers.set(feature,controller);this.publish();
    Hooks.once('init',()=>{
      controller.init?.(this);
    });
    Hooks.once('ready',()=>this.start().catch(this.onError));
    if(!this.hooksInstalled)this.installRefreshHooks();
  }
  async start(){
    // Foundry replaces its early {view} bootstrap object with the Game instance
    // before ready. Later consumers must receive this same registered runtime.
    runtimes.set(game,this);
    return this.started??=this.startOnce();
  }
  async startOnce(){
    if(game.system.id!=='pf2e'||Number(game.release.generation)!==14)return;
    registerLegacyRuleFlags();await migrateRulesSettings();globalThis.CONFIG??={};this.reactions.install();
    Hooks.on('preCreateChatMessage',markManagedRuleMessage);
    if(this.features.size)installEnvironmentRolls({packageId:CORE_ID,playerStealth:this.has('movement')?this.playerStealth:null,
      conditionsEnabled:()=>this.has('conditions'),environmentEnabled:()=>this.has('environment')});
    for(const feature of ['environment','conditions','movement'])await this.controllers.get(feature)?.start?.(this);
    this.publish();if(this.features.size)await migrateRegionScripts();await this.refresh();return this.rules;
  }
  installRefreshHooks(){
    this.hooksInstalled=true;
    const refresh=()=>{void this.refresh().catch(this.onError);};
    for(const event of ['moveToken','createToken','deleteToken','createRegion','deleteRegion','updateRegion','createRegionBehavior',
      'updateRegionBehavior','deleteRegionBehavior','canvasReady','createWall','updateWall','deleteWall'])Hooks.on(event,refresh);
    const captions=tokenId=>{if(this.has('environment'))void this.environmentAwareness.schedule(tokenId).catch(this.onError);};
    // Selection and redraws only change the view; do not restart native path
    // calculations or refresh persistent conditions for these UI events.
    Hooks.on('controlToken',()=>captions());
    Hooks.on('targetToken',user=>{if(user.id===game.user.id)captions();});
    Hooks.on('drawToken',token=>captions(token.id));
    Hooks.on('updateUser',()=>{captions();if(this.has('environment'))void this.zoneConcealment.refresh().catch(this.onError);});
    Hooks.on('updateToken',(document,changed={})=>{
      if(this.has('movement')&&Object.hasOwn(changed,'movementAction')&&document.actor?.isOfType?.('creature')&&game.users.activeGM?.id===game.user.id){
        const token=document.object??canvas.tokens.get(document.id);if(token)void setSneakMode(token,changed.movementAction==='sneak').catch(this.onError);
      }
      if(TOKEN_GEOMETRY_FIELDS.some(key=>Object.hasOwn(changed,key))||changed.flags?.[MODULE_ID]||Object.keys(changed).some(key=>key.startsWith(`flags.${MODULE_ID}.`)))refresh();
    });
    for(const event of ['createItem','updateItem','deleteItem'])Hooks.on(event,item=>{if(['condition','effect'].includes(item.type))refresh();});
    Hooks.on('canvasTearDown',()=>{this.manualMovement.cancel();this.environmentAwareness.clear();});
    Hooks.on('deleteCombat',combat=>{this.manualMovement.cancel();if(this.has('conditions'))void expireSpellZones({combat,removeAll:true}).catch(this.onError);refresh();});
    Hooks.on('updateCombat',combat=>{if(this.has('conditions'))void expireSpellZones({combat}).catch(this.onError);refresh();});
    Hooks.on('updateWorldTime',()=>{if(this.has('conditions'))void expireSpellZones().catch(this.onError);});
    Hooks.on('getSceneControlButtons',controls=>{
      if(!controls.tokens?.tools)return;const tools=controls.tokens.tools;
      const add=(name,title,icon,order,handler)=>tools[name]={name,title,icon,order,button:true,control:true,onChange:()=>{Promise.resolve(handler()).catch(this.onError);}};
      for(const controller of this.controllers.values())for(const control of controller.controls??[]){
        if(control.gmOnly&&!game.user?.isGM)continue;
        add(control.name,control.title,control.icon,control.order,()=>control.run(this));
      }
      if(!game.user?.isGM)return;
      add('reactionControls','Reaction controls','fa-solid fa-shield-halved',101,()=>this.reactions.openControls());
    });
  }
}
