import { tacticalBehaviors, defaultBehaviorConfiguration } from '../framework/tactical-behaviors.mjs';
import { castingCandidates } from '../framework/spell-evaluation.mjs';
import { casterStealthKnowledge } from './caster-stealth.mjs';
import { casterTargetKnowledge } from './caster-target-knowledge.mjs';
import {withdrawalPosition} from '../framework/withdrawal.mjs';
import {casterScenarios} from '../framework/caster-scenarios.mjs';
import {endHostileInvisibility} from './support-spells.mjs';
import { clearSightPath } from './attack-path.mjs';
import { reveal, detectionFor, STEALTH_MOVEMENT } from './stealth-awareness.mjs';
import { executeSharedHide, executeSharedSneak, sneakSpeed, retainStepStealth, stealthAdapter } from './shared-stealth.mjs';
import { movementSight } from '../framework/pursuit.mjs';
import { flySpeed } from './flight-costs.mjs';
import {groundThreats} from './ground-threats.mjs';

const ns='foundry-creature-ai';
const attached=new WeakSet();
const scoped=value=>value?.combatId===game.combat?.id&&value?.sceneId===canvas.scene?.id;

export function behaviorConfiguration(adapter) {
  const actor=adapter.actor.getFlag?.(ns,'behaviors'),token=adapter.token.document.getFlag(ns,'behaviors');
  const raw={...actor,...token,parameters:{...actor?.parameters,...token?.parameters}},defaults=defaultBehaviorConfiguration(adapter.profileId);
  if(adapter.hasSpellcasting){for(const id of ['spellcasting','spell-control','spell-damage','spell-drain','spell-support'])if(!defaults.components.includes(id))defaults.components.push(id);
    for(const id of ['spell-control','spell-damage','spell-drain','spell-support'])if(!defaults.plans.includes(id))defaults.plans.push(id);}
  if(flySpeed(adapter.actor)){defaults.components.push('flight');defaults.plans.push('aerial-hunt','aerial-engage','aerial-disengage');}
  if(adapter.profileId==='eagle')defaults.components.push('diving');
  if(flySpeed(adapter.actor)&&raw.components&&!raw.components.includes('flight'))
    raw.components=[...raw.components,'flight',...(adapter.profileId==='eagle'&&!raw.components.includes('diving')?['diving']:[])];
  if(adapter.actor.system.traits?.value?.includes('mindless')&&!raw.plans)defaults.plans=['aggressive','charge'];
  return tacticalBehaviors.configuration(raw,defaults);
}

export function battleContext(adapter,state,{deferDecision=false}={}) {
  const roster=new Set(Array.from(game.combat.combatants).filter(c=>!c.defeated&&
    (c.sceneId??c.token?.parent?.id??canvas.scene.id)===canvas.scene.id).map(c=>c.tokenId));
  const allies=canvas.tokens.placeables.filter(token=>token!==adapter.token&&roster.has(token.id)&&token.actor&&adapter.actor.isAllyOf(token.actor)&&
    !token.document.hidden&&token.actor.hitPoints?.value>0&&!token.actor.hasCondition('unconscious','dying','dead')&&
    detectionFor(adapter.token,token).state==='observed'&&clearSightPath(adapter.token,token));
  const known=state.enemies.length,visible=state.enemies.filter(enemy=>enemy.awareness?.state==='observed'&&enemy.lineOfSight!==false);
  const hp=adapter.actor.hitPoints,health=Math.max(0,Math.min(1,hp.value/Math.max(1,hp.max)));
  const immediate=state.enemies.some(enemy=>enemy.inReach||Object.values(enemy.strikes??{}).some(position=>position.usable))||
    !deferDecision&&state.spells&&castingCandidates(state).some(candidate=>candidate.assessment.value>0);
  const ranged=Boolean(state.spells?.some(spell=>spell.available)||state.bowReady&&state.loaded&&state.bolts>0||
    state.strikes?.some(strike=>strike.ranged&&state.enemies.some(enemy=>enemy.strikes?.[strike.id]?.usable)));
  const melee=!state.spells?.length&&(!state.bowReady||state.bolts<1);
  const configuration=behaviorConfiguration(adapter);
  const supportRecipients=!configuration.components.includes('leadership')||state.commandedThisTurn?0:
    state.supportRecipients??(state.commandRecipients??[]).filter(ally=>ally.needsMovement!==false).length;
  return {health,allies:allies.length,knownEnemies:known,visibleEnemies:visible.length,forceRatio:(allies.length+1)/Math.max(1,known),
    immediateAttack:Boolean(immediate),ranged,melee,caster:Boolean(state.spells?.length),
    closingMelee:visible.some(enemy=>enemy.tactics?.role!=='ranged'&&enemy.distance<=40),
    pack:configuration.components.includes('pack'),
    swarmOpportunity:state.enemies.some(enemy=>enemy.alliesInReach>0||enemy.flanked)||Object.values(state.group?.targets??{}).some(target=>target.swarm),
    supportRecipients,hideUseful:configuration.components.includes('stealth')&&Boolean(state.sharedBehaviors?.hideCandidates?.length),
    hiddenBelief:Boolean(state.sharedBehaviors?.hiddenBelief),skulk:state.sneakDamage>0,
    unanswerableAirThreat:Boolean(state.groundThreats?.unanswerable),
    protectiveOptions:Boolean(state.sharedBehaviors?.protectedMoves?.length||state.sharedBehaviors?.sneakCandidates?.length),
    planAge:scoped(state.behavior?.previous)?Math.max(0,game.combat.round-(state.behavior.previous.startedRound??game.combat.round)):0,
    waitPatienceReached:(state.casterDefense?.holdTurns??0)>=2,
    broken:Boolean(state.morale?.broken),emergency:Boolean(state.morale?.broken||health<=0.25)};
}

async function enrichState(adapter,state,options={}) {
  const configuration=behaviorConfiguration(adapter),previous=adapter.token.document.getFlag(ns,'behaviorState');
  const roleKnowledge=casterTargetKnowledge(adapter);
  for(const enemy of state.enemies) enemy.tactics??=roleKnowledge.entries[enemy.id]??{role:'unknown',reach:5,speed:25};
  const hideHistory=adapter.token.document.getFlag(ns,'behaviorActions');
  const knowledge=casterStealthKnowledge(stealthAdapter(adapter),state),at=knowledge.at();
  const positions=new Map(),projectAt=move=>{
    const key=`${move.x},${move.y}`;
    if(!positions.has(key))positions.set(key,knowledge.at(adapter.center(move)));
    return positions.get(key);
  };
  if(adapter.actor.hitPoints.value/Math.max(1,adapter.actor.hitPoints.max)<0.4){
    state.withdrawal=at;
    for(const move of state.moves??[])move.withdrawal=projectAt(move);
  }
  state.groundThreats=groundThreats(adapter,state);
  const layingLow=state.groundThreats.unanswerable;
  const canHide=Boolean(adapter.actor.getStatistic('stealth')?.check?.roll)&&!state.self.restrained;
  const gain=state.enemies.reduce((sum,enemy)=>sum+Math.max(0,(at[enemy.id]?.hideChance??0)-(at[enemy.id]?.stealthChance??0)),0)/Math.max(1,state.enemies.length);
  const value=gain*1.5;
  const hideCandidates=canHide&&state.actionsRemaining>0&&value>0.01&&hideHistory?.turn!==state.turn?
    [{id:'behavior:hide',kind:'hide',legal:true,actionCost:1,features:{sharedBehavior:true},assessment:{value},
      scoringTerms:[{label:'Estimated benefit of hiding from known observers',contribution:value}]}]:[];
  const protection=entries=>Object.values(entries).reduce((sum,entry)=>sum+Math.min(4,entry.incoming.coverBonus??0)*0.4+
    (entry.incoming.concealed?1.2:entry.incoming.blocked?1.5:0),0)/Math.max(1,state.enemies.length);
  const baseProtection=protection(at),protectedMoves=[],sneakCandidates=[];
  for(const move of state.moves??[])if(['goblin-pyro','kobold-scout'].includes(adapter.profileId)){
    const gain=state.enemies.reduce((sum,enemy)=>{
      const before=enemy.incoming??{},after=move.targets[enemy.id]?.incoming??{};
      return sum+((after.coverBonus??0)-(before.coverBonus??0))*0.4+(Number(Boolean(after.concealed))-Number(Boolean(before.concealed)))*1.2;
    },0)/Math.max(1,state.enemies.length);
    move.behaviorProtectedGain=gain>0.25;
  }
  if(!['goblin-pyro','kobold-scout'].includes(adapter.profileId)&&!state.self.immobile&&state.actionsRemaining>0)for(const move of state.moves??[]){
    await options.budget?.checkpoint();
    if(!move.cost||state.visited?.includes(`${move.x},${move.y}`))continue;
    const after=projectAt(move),gain=protection(after)-baseProtection;
    move.behaviorProtectedGain=gain>0.25;
    if(gain<=0.25)continue;
    const sight=movementSight(state,move),risk=(move.kind==='step'?0:move.reactionRisk??0)+(move.terrainRisk??0);
    const hide=canHide&&state.actionsRemaining>1?Object.values(after).reduce((sum,entry)=>sum+entry.freshHideChance,0)/Math.max(1,state.enemies.length)*1.5:0;
    const score=gain+hide-risk-(layingLow?0:sight.penalty)-sight.returnPenalty;
    if(score<=0)continue;
    protectedMoves.push({id:`behavior:cover:${move.kind}:${move.x},${move.y}`,kind:move.kind,actionCost:1,legal:true,path:move.path,
      destination:{x:move.x,y:move.y},movementCost:move.cost,provokes:move.kind!=='step'&&move.provokes,destinationThreatened:move.destinationThreatened,
      intent:'take a protected position',features:{defensiveSetup:true,visibility:sight},
      assessment:{value:score,movement:true,fullTurnPlan:true,step:move.kind==='step',nearestEnemy:move.nearestEnemy,
        currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5},scoringTerms:[{label:'Gain cover or concealment',contribution:gain},
      {label:'Affordable defensive Hide',contribution:hide},{label:'Path and visibility risks',contribution:-risk-(layingLow?0:sight.penalty)-sight.returnPenalty}]});
  }
  if(adapter.profileId!=='kobold-scout'&&canHide&&knowledge.priors.some(prior=>prior.unseenChance>0)&&!state.self.immobile&&state.actionsRemaining>0){
    for(const move of state.moves??[]){
    await options.budget?.checkpoint();
      if(!move.cost||move.cost>sneakSpeed(adapter)||move.kind==='step'||state.visited?.includes(`${move.x},${move.y}`))continue;
      const after=projectAt(move),gain=protection(after)-baseProtection;
      const distance=Math.min(...state.enemies.map(enemy=>move.targets[enemy.id]?.distance??0))-Math.min(...state.enemies.map(enemy=>enemy.distance));
      const emergency=state.morale?.broken||adapter.actor.hitPoints.value/Math.max(1,adapter.actor.hitPoints.max)<=0.25;
      const projected=knowledge.projectSneak(adapter.center(move),move.path);
      if(!projected.some(entry=>entry.unseenChance>0))continue;
      const undetectedGain=layingLow?projected.reduce((sum,entry)=>sum+
        Math.max(0,entry.undetectedChance-(knowledge.priors.find(prior=>prior.observerId===entry.observerId)?.undetectedChance??0)),0)/Math.max(1,state.enemies.length)*3:0;
      if(gain<=0.25&&!(emergency&&distance>0)&&undetectedGain<=0.05)continue;
      const risk=(move.reactionRisk??0)+(move.terrainRisk??0),sight=movementSight(state,move);
      const score=gain+undetectedGain+Math.min(1.5,Math.max(0,distance)*0.1)-risk-(layingLow?0:sight.penalty)-sight.returnPenalty;
      if(score<=0)continue;
      sneakCandidates.push({id:`behavior:sneak:${move.x},${move.y}`,kind:'sneak',legal:true,actionCost:1,path:move.path,
        destination:{x:move.x,y:move.y},movementCost:move.cost,intent:'move between protected positions',
        features:{sharedBehavior:true,stealthPreserved:true,defensiveSetup:gain>0.25,visibility:sight},
        assessment:{value:score,movement:true,fullTurnPlan:true,nearestEnemy:move.nearestEnemy,currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5},
        scoringTerms:[{label:'Protection gained while sneaking',contribution:gain},{label:'Create defensive distance',contribution:Math.min(1.5,Math.max(0,distance)*0.1)},
          {label:'Become harder for an unreachable hunter to locate',contribution:undetectedGain},
          {label:'Path and visibility risks',contribution:-risk-(layingLow?0:sight.penalty)-sight.returnPenalty}]});
    }
  }
  state.sharedBehaviors={hideCandidates,protectedMoves,sneakCandidates,hiddenBelief:Object.values(at).some(entry=>entry.stealthChance>0)};
  if(!configuration.components.includes('spellcasting')){
    state.spells=[];for(const move of state.moves??[])move.spells=[];
  }
  if(!configuration.components.includes('stealth')){
    state.hideTargets=[];state.hideEstimates=[];state.freshHideEstimates=[];
    if(state.casterDefense)state.casterDefense={...state.casterDefense,canHide:false};
    for(const move of state.moves??[]){
    await options.budget?.checkpoint();move.hideEstimates=[];move.sneakChances=[];move.sneakObservers=[];}
  }
  state.behavior={configuration,previous:scoped(previous)&&JSON.stringify(previous.configuration)===JSON.stringify(configuration)?previous:null,context:battleContext(adapter,state,options)};
  for(const id of configuration.components) if(tacticalBehaviors.components.get(id).enrich)
    state=await tacticalBehaviors.components.get(id).enrich(state,adapter,configuration.parameters[id]??{})??state;
  state.behavior.context=battleContext(adapter,state,options);
  if(options.deferDecision)return state;
  state.casterScenarios=casterScenarios(state);
  state.behavior.selection=tacticalBehaviors.select(state);
  if(state.behavior.selection.planId==='lay-low')state.diagnostics.noActionReason='Known enemies are above available attack reach. Hold protection and estimated stealth until an attack becomes possible; Hide still requires cover or concealment.';
  // A chosen tactic can activate a creature's existing forecast modules too;
  // aggressive casters no longer inherit the defensive waiting posture.
  if(state.casterDefense)state.casterDefense={...state.casterDefense,
    enabled:['defensive','hiding','avoiding','kiting','spell-control','spell-support'].includes(state.behavior.selection.planId)};
  return state;
}

export function attachBehaviorSystem(adapter) {
  if(attached.has(adapter))return adapter;
  attached.add(adapter);
  const snapshot=adapter.snapshot.bind(adapter),execute=adapter.execute.bind(adapter),record=adapter.recordOutcome.bind(adapter);
  const candidates=adapter.candidates.bind(adapter);
  adapter.candidates=state=>state.behavior?tacticalBehaviors.candidates(state,candidates(state),state.behavior.selection??tacticalBehaviors.select(state)).candidates:candidates(state);
  const speed=adapter.groundSpeedFor.bind(adapter),movementOptions=adapter.movementOptions.bind(adapter),revalidate=adapter.revalidate.bind(adapter);
  adapter.groundSpeedFor=choice=>choice.sharedSneak?sneakSpeed(adapter):speed(choice);
  adapter.movementOptions=choice=>adapter.sharedSneaking?{...movementOptions(choice),[STEALTH_MOVEMENT]:true,showRuler:false}:movementOptions(choice);
  adapter.revalidate=async(choice,ledger,options)=>{
    const configuration=behaviorConfiguration(adapter),component=[...tacticalBehaviors.components.values()].find(component=>component.actionKinds?.includes(choice.kind));
    if(component&&!component.core&&!configuration.components.includes(component.id))throw new Error(`Behavior component ${component.id} was detached before the action`);
    return revalidate(choice.features?.sharedBehavior&&choice.kind==='sneak'?{...choice,kind:'stride'}:choice,ledger,options);
  };
  const prepare=adapter.prepareTurn.bind(adapter);
  adapter.prepareTurn=async(options={})=>{
    if(!await prepare(options)||!(options.canContinue?.()??true))return false;
    const knowledge=casterTargetKnowledge(adapter);
    if(JSON.stringify(adapter.token.document.getFlag(ns,'casterTargets'))!==JSON.stringify(knowledge))await adapter.token.document.setFlag(ns,'casterTargets',knowledge);
    return options.canContinue?.()??true;
  };
  adapter.snapshot=async(...args)=>{const state=await snapshot(...args);return state.mistEscape?state:enrichState(adapter,state,args[1]);};
  adapter.execute=async(choice,ledger,context={})=>{
    if(!await adapter.waitForReactions({signal:context.signal})||!(context.canContinue?.()??true)||adapter.turnKey()!==ledger.turn)
      return {skipped:true,pause:true,skipReason:'Stopped before the behavior action'};
    const configuration=behaviorConfiguration(adapter),owner=[...tacticalBehaviors.components.values()].find(component=>component.actionKinds?.includes(choice.kind));
    if(owner&&!owner.core&&!configuration.components.includes(owner.id))return {skipped:true,skipReason:`Behavior component ${owner.id} is no longer attached`};
    if(choice.features?.sharedBehavior&&choice.kind==='hide')return executeSharedHide(adapter,choice,ledger,context);
    if(choice.features?.sharedBehavior&&choice.kind==='sneak')return executeSharedSneak(adapter,choice,ledger,context);
    for(const id of configuration.components){
      const component=tacticalBehaviors.components.get(id);
      if(component.execute&&component.actionKinds?.includes(choice.kind)){
        const result=await component.execute(adapter,choice,ledger,context);
        if(result!==undefined)return result;
      }
    }
    // Existing scout/caster bindings own their stealth-aware execution. Shared
    // Hide can now be attached to bruisers and pack hunters as well.
    if(!['kobold-scout','goblin-pyro'].includes(adapter.profileId)&&choice.kind==='step'){
      const before=await snapshot(ledger,{movement:false}),result=await execute(choice,ledger,context);
      if(!result.skipped)await retainStepStealth(adapter,before);
      return result;
    }
    if(!['kobold-scout','goblin-pyro'].includes(adapter.profileId)&&!['step','hide','strike','spikeVolley'].includes(choice.kind))await reveal(adapter.token);
    if(!['kobold-scout','goblin-pyro'].includes(adapter.profileId)&&['strike','spikeVolley'].includes(choice.kind)){
      try{return await execute(choice,ledger,context);}finally{await reveal(adapter.token);await endHostileInvisibility(adapter.token);}
    }
    try{return await execute(choice,ledger,context);}finally{if(['strike','spikeVolley','grab','drinkBlood'].includes(choice.kind)||choice.kind==='castSpell'&&!['heal','buff','ward'].includes(adapter.parts().descriptors?.find(s=>s.id===choice.spellId)?.kind))await endHostileInvisibility(adapter.token);}
  };
  adapter.recordOutcome=async(choice,ledger,result={})=>{
    await record(choice,ledger,result);
    if(result.skipped)return;
    if(choice.kind==='hide')await adapter.token.document.setFlag(ns,'behaviorActions',{turn:ledger.turn});
    const selection=adapter.lastTactic;
    const previous=adapter.token.document.getFlag(ns,'behaviorState');
    if(selection)await adapter.token.document.setFlag(ns,'behaviorState',{combatId:game.combat.id,sceneId:canvas.scene.id,
      turn:ledger.turn,round:game.combat.round,planId:selection.planId,label:selection.label,reason:selection.reason,
      startedRound:scoped(previous)&&previous.planId===selection.planId?previous.startedRound??game.combat.round:game.combat.round,
      activeComponents:selection.activeComponents,configuration:selection.configuration,goal:selection.goal});
  };
  const decide=adapter.decide.bind(adapter);
  adapter.decide=state=>{
    const decision=decide(state);
    adapter.lastTactic=decision.diagnostics?.tactic??null;
    if(adapter.lastTactic?.planId==='avoiding'&&decision.chosen?.kind==='endTurn'&&!state.self.immobile&&!state.self.restrained&&
      !state.diagnostics?.movementBlocked&&!state.escapeBlocked){
      decision.diagnostics.turnComplete=true;
      decision.diagnostics.noActionReason=withdrawalPosition(state).safe?'Hold this withdrawal position: known attacks are blocked or beyond the current safety distance.':
        'No safer supported retreat remains from this position; holding until a useful action becomes available.';
    }
    if(adapter.lastTactic?.planId==='hiding'&&decision.chosen?.kind==='endTurn'&&!state.self.immobile&&!state.self.restrained&&
      !state.diagnostics?.movementBlocked&&!state.escapeBlocked)decision.diagnostics.turnComplete=true;
    if(adapter.lastTactic?.planId==='lay-low'&&decision.chosen?.kind==='endTurn'&&!state.self.immobile&&!state.self.restrained&&
      !state.escapeBlocked)decision.diagnostics.turnComplete=true;
    return decision;
  };
  return adapter;
}

function assertGM(){if(!game.user.isGM||game.users.activeGM?.id!==game.user.id)throw new Error('Configure behaviors as the active GM');}
export async function configureBehaviors(document,configuration={}) {
  assertGM();
  if(!document?.setFlag)throw new Error('Supply an actor or token document');
  if(!configuration||typeof configuration!=='object'||Array.isArray(configuration))throw new Error('Behavior configuration needs an object');
  const actor=document.actor??document;
  const {creatureProfile}=await import('./creature-profiles.mjs');
  let id='generic';try{id=creatureProfile(actor).id;}catch{}
  if(configuration.parameters!==undefined)tacticalBehaviors.configuration({parameters:configuration.parameters},defaultBehaviorConfiguration(id));
  const own=document.getFlag?.(ns,'behaviors')??{},inherited=actor===document?{}:actor.getFlag?.(ns,'behaviors')??{};
  const patch={...own,...configuration};
  const validated=tacticalBehaviors.configuration({...inherited,...patch,parameters:{...inherited.parameters,...patch.parameters}},defaultBehaviorConfiguration(id));
  await document.setFlag(ns,'behaviors',patch);
  return validated;
}
export function behaviorCatalog(){return {components:[...tacticalBehaviors.components.values()].map(({id,label,kind,core})=>({id,label,kind,core:Boolean(core)})),
  plans:[...tacticalBehaviors.plans.values()].map(({id,label,components})=>({id,label,components}))};}
export const behaviorAPI={configure:configureBehaviors,catalog:behaviorCatalog,
  registerComponent:component=>tacticalBehaviors.registerComponent(component),registerPlan:plan=>tacticalBehaviors.registerPlan(plan)};
