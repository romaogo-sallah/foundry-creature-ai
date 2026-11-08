import { PF2eCreatureAdapter, MODULE_ID, MANAGED_OPTION, rollEvent } from './pf2e-adapter.mjs';
import { averageFormula } from '../framework/math.mjs';
import { scoutCandidates, chooseScoutAction } from '../profiles/kobold-scout.mjs';
import { clearAttackPath, clearSightPath } from './attack-path.mjs';
import { rememberedToken, targetKnowledge } from './target-memory.mjs';
import { environmentBetween, coverAlongPath } from './environment-zones.mjs';
import { concealmentCheck } from './environment-rolls.mjs';
import { stealthObservers, stealthRecord, detectionFor, hidingFrom, reveal, STEALTH_MOVEMENT } from './stealth-awareness.mjs';
import { stealthBelief, projectStealth } from './stealth-belief.mjs';
import { scoutGroup } from './scout-group.mjs';
import {scoutTacticalMap,scoutTacticalMapAsync,scoutMotionMemory} from './tactical-map.mjs';
import { executeSharedHide, executeSharedSneak, sneakSpeed } from './shared-stealth.mjs';

const held=(item,hands=1)=>item.system.equipped.carryType==='held'&&item.system.equipped.handsHeld>=hands;
const average=strike=>Object.values(strike.item.system.damageRolls).filter(d=>!d.category).reduce((sum,d)=>sum+averageFormula(d.damage),0);
export function scoutParts(actor) {
  const weapons=actor.itemTypes.weapon, bow=weapons.find(w=>w.system.baseItem==='crossbow'), sword=weapons.find(w=>w.system.baseItem==='shortsword');
  const strikes=actor.system.actions.filter(s=>s.type==='strike');
  const strike=strikes.find(s=>(s.item.linkedWeapon?.id??s.item.flags?.pf2e?.linkedWeapon)===sword?.id);
  const ranged=strikes.find(s=>(s.item.linkedWeapon?.id??s.item.flags?.pf2e?.linkedWeapon)===bow?.id);
  const bolts=(actor.itemTypes.ammo??[]).find(item=>item.system.baseItem==='bolts');
  const scamper=actor.itemTypes.action.find(item=>item.slug==='scamper'||item.id==='0qvSsLdTulsncbsi'||item.name.toLowerCase()==='scamper');
  const sneak=actor.itemTypes.action.find(item=>item.slug==='sneak-attack');
  if(!bow||!sword||!strike||!ranged||!scamper||!sneak)throw new Error('Kobold Scout requires linked crossbow/shortsword Strikes, Scamper and Sneak Attack');
  const dice=sneak.system.rules.find(rule=>rule.key==='DamageDice'&&rule.category==='precision');
  if(dice?.diceNumber!==1||dice.dieSize!=='d6'||scamper.actionCost?.value!==1)throw new Error('Unsupported Kobold Scout: expected 1d6 Sneak Attack and one-action Scamper');
  return {strike,ranged,bow,sword,bolts,scamper,sneak,remaster:true,averageDamage:average(strike),
    abilityNames:[strike.item.name,ranged.item.name,'Hide','Sneak','Sneak Attack (+1d6)','Scamper'],
    unsupported:actor.itemTypes.action.filter(item=>![scamper,sneak].includes(item)&&item.actionCost?.type!=='passive').map(item=>item.name)};
}

export class PF2eKoboldScoutAdapter extends PF2eCreatureAdapter {
  get profileId(){return 'kobold-scout';}
  get config(){return {...super.config,packMorale:false};}
  parts(){return scoutParts(this.actor);}
  get loaded(){return this.configOverride?.crossbowLoaded??this.token.document.getFlag(MODULE_ID,'scoutGear')?.loaded??this.config.crossbowLoaded??true;}
  nearby(){return targetKnowledge(this).checks.map(c=>c.target).filter(Boolean).some(t=>this.token.distanceTo(t)<=5);}
  planningSpeed(){return this.groundSpeed()+(this.nearby()?5:0);}
  planningReach(){return this.actor.getReach({action:'attack',weapon:this.parts().strike.item});}
  groundSpeedFor(choice){return this.groundSpeed()+(choice.scamper?5:0);}
  targetAt(cell,target,allies,position){
    const known=(allies??[]).filter(ally=>detectionFor(this.token,ally).state==='observed'&&clearSightPath(this.token,ally));
    return super.targetAt(cell,target,known,position,this.parts().strike.item);
  }
  async assertReady(){
    await super.assertReady();
    const parts=this.parts(),others=this.actor.itemTypes.weapon.filter(item=>held(item)&&![parts.bow,parts.sword].includes(item));
    if(others.length)throw new Error('Stow other held weapons before running the scout');
    if(held(parts.bow,2)&&held(parts.sword))throw new Error('The scout cannot hold its two-handed crossbow and shortsword together');
    if(this.actor.hasCondition('quickened'))throw new Error('Kobold Scout extra Quickened actions need manual handling');
  }
  async configure(){
    const parts=this.parts();
    if(!parts.ranged.item.isRanged)await parts.ranged.item.update({'system.range':{increment:120,max:null}});
  }
  threatKnowledge(){
    const previous=this.token.document.getFlag(MODULE_ID,'scoutThreats'),combatId=game.combat.id,sceneId=canvas.scene.id;
    const entries={...(previous?.combatId===combatId&&previous?.sceneId===sceneId?previous.entries:{})};
    for(const check of targetKnowledge(this).checks){
      if(check.awareness?.state!=='observed'||!check.target)continue;
      const actor=check.target.actor,strikes=actor.system.actions?.filter(s=>s.type==='strike')??[];
      const reaches=strikes.filter(s=>s.item?.isMelee&&s.ready!==false).map(s=>actor.getReach({action:'attack',weapon:s.item}));
      const ranged=strikes.filter(s=>s.item?.isRanged);
      entries[check.id]={reach:Math.max(5,...reaches.filter(Number.isFinite)),
        speed:actor.system.movement?.speeds?.land?.value??actor.system.attributes?.speed?.total??actor.system.attributes?.speed?.value??25,
        ranged:ranged.length>0,range:Math.max(0,...ranged.map(s=>s.item.system?.range?.increment??s.item.range?.increment??120)),
        reactive:[...(actor.itemTypes.action??[]),...(actor.itemTypes.feat??[])].some(item=>['reactive-strike','attack-of-opportunity'].includes(item.slug))};
    }
    return {combatId,sceneId,entries};
  }
  async prepareTurn(options={}){
    if(!await super.prepareTurn(options))return false;
    await this.configure();if(!(options.canContinue?.()??true))return false;
    const known=this.threatKnowledge();
    if(JSON.stringify(known)!==JSON.stringify(this.token.document.getFlag(MODULE_ID,'scoutThreats')))
      await this.token.document.setFlag(MODULE_ID,'scoutThreats',known);
    return options.canContinue?.()??true;
  }
  stealthKnowledge(state){
    const observers=stealthObservers(this.token).flatMap(observer=>{
      const known=state.enemies.find(enemy=>enemy.id===observer.id);
      if(!known)return [];
      if(known.awareness.state!=='known-square')return [observer];
      const perceived=rememberedToken(observer,known.awareness.position,known.awareness);
      perceived.checkCollision=observer.checkCollision.bind(observer);
      return [perceived];
    });
    const saved=stealthBelief(this.token),bonus=this.actor.getStatistic('stealth')?.check?.mod??0;
    const priors=observers.map(observer=>{
      const prior=saved.find(entry=>entry.observerId===observer.id)??{observerId:observer.id,unseenChance:0,undetectedChance:0};
      return hidingFrom(observer,this.token).canHide?prior:{...prior,unseenChance:0,undetectedChance:0};
    });
    const project=(kind,destination,path,fresh=false)=>observers.map(observer=>{
      const environment=hidingFrom(observer,this.token,destination);
      return projectStealth(kind,fresh?{observerId:observer.id,unseenChance:0,undetectedChance:0}:priors.find(entry=>entry.observerId===observer.id),{bonus,referenceDC:state.self.referenceAC,
        canHide:environment.canHide,coverBonus:kind==='sneak'&&path?coverAlongPath(observer,this.token,path.map(cell=>this.center(cell))):environment.stealthBonus});
    });
    return {observers,priors,project};
  }
  async snapshot(ledger,options){
    const state=await super.snapshot(ledger,options),parts=this.parts();
    const {observers,priors,project}=this.stealthKnowledge(state);
    const descriptors=[parts.strike,parts.ranged].map((strike,index)=>({id:strike.item.id,ranged:index===1,bonus:strike.totalModifier,damage:average(strike),
      mapPenalties:[0,strike.variants[1].penalty,strike.variants[2].penalty]}));
    const bowReady=held(parts.bow,2),bladeReady=held(parts.sword),bolts=parts.bolts?.system.quantity??0;
    const threats=this.threatKnowledge().entries;
    const focusIds=new Set(canvas.tokens.placeables.flatMap(ally=>{
      if(ally!==this.token&&!ally.actor?.isAllyOf(this.actor))return [];
      const focus=ally.document.getFlag?.(MODULE_ID,'scoutFocus');
      return focus?.combatId===game.combat.id&&focus.sceneId===canvas.scene.id&&focus.round>=game.combat.round-1&&
        focus.witnessIds?.includes(this.token.id)?[focus.targetId]:[];
    }));
    const ranges=(cell,enemy,position)=>{
      const live=canvas.tokens.get(enemy.id),target=enemy.awareness.state==='known-square'?rememberedToken(live,enemy.awareness.position,enemy.awareness):live;
      const geometry=this.targetAt(cell,target,target.memoryView?[]:this.allies(target),position);
      const p=position??this.topLeft(cell),reach=threats[enemy.id]?.reach??5;
      const threatDistance=target.distanceTo({actor:this.actor,document:this.token.document,
        mechanicalBounds:new PIXI.Rectangle(p.x,p.y,this.token.w,this.token.h)},{reach});
      const incoming=environmentBetween(target,this.token,{destination:this.center(cell)});
      return {...geometry,threatDistance,incoming:{coverBonus:incoming.coverBonus,concealed:incoming.concealed},strikes:Object.fromEntries(descriptors.map(strike=>{
        const inReach=strike.ranged?geometry.distance<=720:geometry.inReach;
        return [strike.id,{...geometry,inReach,flanked:!strike.ranged&&geometry.flanked,rangePenalty:strike.ranged?Math.max(0,Math.ceil(geometry.distance/120)-1)*2:0,
          geometryUsable:inReach&&geometry.lineOfEffect,usable:inReach&&geometry.lineOfEffect&&(strike.ranged?bowReady&&this.loaded&&bolts>0:bladeReady)}];
      }))};
    };
    for(const enemy of state.enemies){
      Object.assign(enemy,ranges(state.self.cell,enemy,this.actualWaypoint()));
      enemy.threat=threats[enemy.id]??{reach:5,speed:25,ranged:false};enemy.focusFire=focusIds.has(enemy.id);
      const target=canvas.tokens.get(enemy.id);
      enemy.flankable=Boolean(game.pf2e.settings.automation.flanking&&this.actor.attributes.flanking.canFlank&&this.actor.canAttack&&
        enemy.awareness.state==='observed'&&target.actor.attributes.flanking.flankable&&target.actor.isOfType('creature'));
      const prior=priors.find(entry=>entry.observerId===enemy.id);
      enemy.stealthChance=prior?.unseenChance??0;enemy.undetectedChance=prior?.undetectedChance??0;
    }
    for(const move of state.moves){
      for(const enemy of state.enemies)move.targets[enemy.id]=ranges(move,enemy);
      const destination=this.center(move);
      move.sneakChances=project('sneak',destination,move.path);
      move.hideEstimates=project('hide',destination,undefined,true);
      move.stepChances=priors.map(prior=>hidingFrom(observers.find(o=>o.id===prior.observerId),this.token,destination).canHide?prior:{...prior,unseenChance:0,undetectedChance:0});
      move.sneakObservers=move.sneakChances.filter(entry=>entry.unseenChance>0).map(entry=>entry.observerId);
    }
    const saved=this.token.document.getFlag(MODULE_ID,'scoutActions'),own=saved?.turn===ledger.turn?saved:{};
    const hideEstimates=project('hide');
    const hideTargets=hideEstimates.filter(entry=>entry.unseenChance>(priors.find(prior=>prior.observerId===entry.observerId)?.unseenChance??0)).map(entry=>entry.observerId);
    const group=scoutGroup(this,state);
    const field=state.moves.length?await (options?.budget?scoutTacticalMapAsync:scoutTacticalMap)(this,state,options):null;
    if(field){
      for(const enemy of state.enemies)enemy.arrivalActions=field.unmappedThreatIds.includes(enemy.id)?undefined:field.origin?.arrivals[enemy.id]??Infinity;
      for(const move of state.moves){move.tactical=field.cells.get(`${move.x},${move.y}`);
        for(const enemy of state.enemies)move.targets[enemy.id].arrivalActions=field.unmappedThreatIds.includes(enemy.id)?undefined:move.tactical?.arrivals[enemy.id]??Infinity;}
    }
    return {...state,group,strikes:descriptors,bowReady,bladeReady,loaded:this.loaded,bolts,sneakDamage:3.5,speed:this.groundSpeed(),sneakSpeed:sneakSpeed(this),
      tactical:field?.origin,round:game.combat.round,motionMemory:scoutMotionMemory(this),
      adjacent:state.enemies.some(e=>e.distance<=5),hideTargets,hideEstimates,freshHideEstimates:project('hide',undefined,undefined,true),
      hideAttempts:own.hideAttempts??0,sneakAttempts:own.sneakAttempts??0,
      hiddenShown:this.token.document.getFlag(MODULE_ID,'scoutShown')?.combatId===game.combat.id,
      diagnostics:{...state.diagnostics,profileId:this.profileId,policy:'dawnsbury-4.44-skulk',manualAbilities:parts.unsupported,groupTactics:group,
        resources:{bolts,bowReady,bladeReady,loaded:this.loaded},tactical:field?{visitedCells:field.visitedCells,cropped:field.cropped,current:field.origin}:null,
        noActionReason:state.diagnostics.noActionReason,stealth:priors,stealthEstimateDC:state.self.referenceAC}};
  }
  candidates(state){return scoutCandidates(state);}
  decide(state){
    const decision=chooseScoutAction(state);
    if(!state.hideTargets.length&&state.enemies.some(enemy=>enemy.stealthChance>0))decision.rejected.push({id:'hide',kind:'hide',
      reason:'Still relying on the previous Hide/Sneak; no new hiding advantage for these observers'});
    return decision;
  }
  async interrupt(kind,valid){return this.config.pauseForReactions!==false&&this.reactions?this.reactions.action({mover:this.token,kind,valid,applyDamage:this.config.applyDamage}):{};}
  async execute(choice,ledger,context={}){
    const valid=()=> (context.canContinue?.()??true)&&this.turnKey()===ledger.turn&&!game.paused&&game.users.activeGM?.id===game.user.id;
    if(!await this.waitForReactions({signal:context.signal})||!valid())return {skipped:true,pause:true,skipReason:'Stopped before the scout acted'};
    const parts=this.parts();
    if(choice.kind==='hide'){
      return executeSharedHide(this,choice,ledger,context);
    }
    if(choice.kind==='sneak'){
      return executeSharedSneak(this,choice,ledger,context);
    }
    if(choice.kind==='strike'){
      const target=this.liveTarget(choice.targetId),strike=[parts.strike,parts.ranged].find(s=>s.item.id===choice.strikeId);
      if(!target||!strike||!clearAttackPath(this.token,target))return {skipped:true,skipReason:'Strike target or attack path changed'};
      const ranged=strike===parts.ranged;
      if(ranged&&(!held(parts.bow,2)||!this.loaded||!(parts.bolts?.system.quantity>0))||!ranged&&!held(parts.sword))return {skipped:true,skipReason:'The scout weapon is no longer ready'};
      if(ranged){const interrupt=await this.interrupt('ranged',valid);if(interrupt.endTurn||interrupt.pause)return interrupt;if(!valid())throw new Error('The scout stopped during a ranged reaction');
        if(this.liveTarget(target.id)!==target){await reveal(this.token);return {resolved:true,note:'Ranged action lost its target after a reaction; its action remains spent'};}
        await this.token.document.setFlag(MODULE_ID,'scoutGear',{loaded:false});await parts.bolts.update({'system.quantity':parts.bolts.system.quantity-1});}
      const hidden=detectionFor(target,this.token).state!=='observed';
      const flanking=!ranged&&Boolean(this.token.isFlanking?.(target,{reach:this.actor.getReach({action:'attack',weapon:strike.item})}));
      const options=[MANAGED_OPTION,...hidden||flanking?['target:condition:off-guard']:[]],variant=Math.min(ledger.attacksMade-1,2);
      try{
        if(!await concealmentCheck(this.token,target,{valid}))return {resolved:true,lastAction:{kind:'strike',hit:false},note:'Concealment check failed; the attack and any bolt remain spent'};
        const roll=await strike.variants[variant].roll({target,options,event:rollEvent('check')});
        if(!Number.isInteger(roll?.degreeOfSuccess)||!valid())throw new Error('Scout Strike was cancelled or interrupted; inspect its reserved action');
        const hit=roll.degreeOfSuccess>=2;
        if(hit){const damage=await strike[roll.degreeOfSuccess===3?'critical':'damage']({target,mapIncreases:variant,options,event:rollEvent('damage')});
          if(!damage||!valid())throw new Error('Scout damage was cancelled or interrupted');
          if(this.config.applyDamage)await this.applyDamage(target,damage,strike.item,roll.degreeOfSuccess===3?'criticalSuccess':'success',{valid});}
        return {lastAction:{kind:'strike',hit,targetId:target.id,strikeId:strike.item.id},pause:hit&&!this.config.applyDamage};
      }finally{await reveal(this.token);}
    }
    if(choice.kind!=='step')await reveal(this.token);
    if(['reload','drawSword','stowSword','gripBow'].includes(choice.kind)){
      if(choice.kind==='drawSword'&&held(parts.bow,2))await parts.bow.update({'system.equipped.handsHeld':1});
      const interrupt=await this.interrupt('manipulate',valid);
      if(interrupt.endTurn||interrupt.pause||interrupt.disrupted)return {...interrupt,resolved:true};
      if(!valid())throw new Error('Scout equipment action was interrupted');
      if(choice.kind==='reload'){if(!held(parts.bow,2)||!(parts.bolts?.system.quantity>0))throw new Error('Crossbow or ammunition changed before Reload');await this.token.document.setFlag(MODULE_ID,'scoutGear',{loaded:true});}
      if(choice.kind==='drawSword')await parts.sword.update({'system.equipped.carryType':'held','system.equipped.handsHeld':1});
      if(choice.kind==='stowSword')await parts.sword.update({'system.equipped.carryType':'worn','system.equipped.handsHeld':0});
      if(choice.kind==='gripBow'){if(held(parts.sword))throw new Error('Stow the shortsword before gripping the crossbow');await parts.bow.update({'system.equipped.carryType':'held','system.equipped.handsHeld':2});}
      return {resolved:true};
    }
    if(choice.kind==='scamper'){
      if(!this.nearby())return {skipped:true,skipReason:'Scamper requires an adjacent enemy'};
      const enemies=targetKnowledge(this).checks.map(check=>check.target).filter(Boolean);
      if(enemies.some(enemy=>this.targetAt(choice.destination,enemy,[]).distance<=5))return {skipped:true,skipReason:'Scamper must end outside adjacency to known enemies'};
      await this.token.document.setFlag(MODULE_ID,'scampering',true);
      try{return await super.execute({...choice,kind:'stride',scamper:true},ledger,context);}finally{await this.token.document.setFlag(MODULE_ID,'scampering',false);}
    }
    return super.execute(choice,ledger,context);
  }
  movementOptions(){return this.sneaking||this.sharedSneaking||stealthRecord(this.token)?.entries.some(entry=>entry.state==='undetected')?{[STEALTH_MOVEMENT]:true,showRuler:false}:{};}
  async recordOutcome(choice,ledger,result={}){
    if(result.skipped)return;
    const saved=this.token.document.getFlag(MODULE_ID,'scoutActions'),current=saved?.turn===ledger.turn?saved:{};
    await this.token.document.setFlag(MODULE_ID,'scoutActions',{turn:ledger.turn,hideAttempts:(current.hideAttempts??0)+Number(choice.kind==='hide'),sneakAttempts:(current.sneakAttempts??0)+Number(choice.kind==='sneak')});
    if(choice.kind==='hide')await this.token.document.setFlag(MODULE_ID,'scoutShown',{combatId:game.combat.id});
    if(['stride','step','sneak','scamper','crawl'].includes(choice.kind)&&game.combat&&ledger.turn.startsWith(`${game.combat.id}:`)&&result.movement?.cost!==0){
      const cell=result.destination??choice.destination;
      if(cell){const entries=scoutMotionMemory(this);
        if(ledger.startCell&&!entries.some(e=>e.turn===ledger.turn))entries.push({cell:ledger.startCell,round:game.combat.round,turn:ledger.turn});
        entries.push({cell:{x:cell.x,y:cell.y},round:game.combat.round,turn:ledger.turn});
        await this.token.document.setFlag(MODULE_ID,'scoutMotion',{sceneId:canvas.scene.id,combatId:game.combat.id,entries:entries.slice(-12)});}
    }
    if(choice.kind==='strike'&&result.lastAction?.hit){
      const target=canvas.tokens.get(choice.targetId);
      if(target&&!target.document.hidden){
        const witnessIds=canvas.tokens.placeables.filter(witness=>!witness.document.hidden&&witness.actor?.hitPoints?.value>0&&!witness.actor.hasCondition('blinded','unconscious','dying','dead')&&
          (witness===this.token||witness.actor?.isAllyOf(this.actor))&&
          detectionFor(witness,target).state==='observed'&&clearSightPath(witness,target)&&
          (witness===this.token||!this.token.document.hidden&&detectionFor(witness,this.token).state==='observed'&&clearSightPath(witness,this.token))).map(t=>t.id);
        await this.token.document.setFlag(MODULE_ID,'scoutFocus',{combatId:game.combat.id,sceneId:canvas.scene.id,
          round:game.combat.round,targetId:target.id,witnessIds});
      }
    }
  }
}
