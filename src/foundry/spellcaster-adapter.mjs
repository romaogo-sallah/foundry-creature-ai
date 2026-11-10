import {PF2eBasicNPCAdapter,basicMeleeStrikes} from './basic-npc-adapter.mjs';
import {casterCatalog} from './spell-catalog.mjs';
import {castingCandidates} from '../framework/spell-evaluation.mjs';
import {casterTurnCandidates} from '../framework/caster-planning.mjs';
import {chooseTacticalAction} from '../framework/tactical-behaviors.mjs';
import {preparedStrikeCandidates} from '../framework/strike-capability.mjs';
import {seekCandidates} from '../framework/perception.mjs';
import {recoveryCandidates} from '../framework/recovery.mjs';
import {casterTargetKnowledge} from './caster-target-knowledge.mjs';
import {casterStealthKnowledge} from './caster-stealth.mjs';
import {stealthAdapter} from './shared-stealth.mjs';
import {executeSpell} from './spellcasting.mjs';
import {ongoingCasts,sustainCast} from './ongoing-spells.mjs';
import {conditionSpells} from '../framework/condition-spells.mjs';
import {describeSpellAreasAsync} from './spell-areas.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {inGrease} from './spell-zones.mjs';
import {spellDefinition} from '../framework/spell-definitions.mjs';
import {witnessedSpellCasts} from './spell-observations.mjs';
import {taughtBuffs} from './support-spells.mjs';
import {visibleDispelTargets} from './counteract-spells.mjs';
import {translocationDestinationsAsync} from './translocation.mjs';
import {isTrueVampire} from './vampire-state.mjs';
import {shieldImmune} from './spell-attack-buffs.mjs';
import {formSpellcastingRestriction} from './form-restrictions.mjs';
const ns='foundry-creature-ai';
export class PF2eSpellcasterAdapter extends PF2eBasicNPCAdapter{
 get profileId(){return 'spellcaster';}
 parts(){
  const catalog=casterCatalog(this.actor),native=basicMeleeStrikes(this.actor);
  const base=native.length?super.parts():{native:[],averageDamage:5,abilityNames:['Stand','Escape','Seek'],
   strike:{item:{id:'casting-geometry',aiGeometryOnly:true,isMelee:true,isRanged:false,traits:new Set()},totalModifier:0,variants:[{penalty:0},{penalty:-5},{penalty:-10}]}};
  return {...base,...catalog,entry:catalog.entries[0],abilityNames:[...base.abilityNames,...catalog.spells.map(s=>s.name),'Sustain'],
   unsupported:[...catalog.unsupported.map(s=>`${s.name}: ${s.reason}`),...(this.actor.itemTypes.action??[]).map(a=>a.name)]};
 }
 planningReach(){return Math.max(5,...this.parts().native.map(s=>this.actor.getReach({action:'attack',weapon:s.item})));}
 preferRangedFlight(state){return state.spells?.some(s=>s.available&&s.range>this.planningReach());}
 perceivedSpellTarget(enemy){return this.perceivedTarget(enemy);}
 extraCasterActions(){return [];}
 async snapshot(ledger,options){
  return this.enrichCasterState(await super.snapshot(ledger,options),ledger,options);
 }
 async enrichCasterState(state,ledger,options={}){
  const parts=this.parts(),knowledge=casterTargetKnowledge(this),attempts=this.token.document.getFlag(ns,'conditionCaster');
  // Persistent native regions continue outside the caster's turn. Do not
  // create autonomous damage sources when the GM selected rolls-only mode.
  const castingRestriction=formSpellcastingRestriction(this.actor);
  parts.descriptors=parts.descriptors.map(s=>castingRestriction||s.kind==='lingering'&&s.slug!=='mist'&&!this.config.applyDamage||s.slug==='shield'&&shieldImmune(this.actor)||s.domination&&isTrueVampire(this.actor)&&this.actor.hasCondition('blinded')?{...s,available:false}:s);
  state.round=game.combat.round;state.spellAttempts=attempts?.combatId===game.combat.id?attempts.attempts??[]:[];
  state.witnessedCasts=witnessedSpellCasts(this.token);state.self.level=this.actor.level;
  state.self.hpFraction=this.actor.hitPoints.value/Math.max(1,this.actor.hitPoints.max);state.self.tempHP=this.actor.hitPoints.temp??0;
  state.resourcePools=Object.fromEntries(parts.descriptors.filter(s=>s.poolId).map(s=>[s.poolId,s.resourceRemaining]));
  state.spellSlots=Object.values(state.resourcePools).reduce((n,v)=>n+v,0);state.maxForecastActions=10;state.maxForecastMoves=20;
  const stealth=casterStealthKnowledge(stealthAdapter(this),state),at=stealth.at();
  for(const enemy of state.enemies){enemy.tactics=knowledge.entries[enemy.id]??{role:'unknown',reach:5,speed:25};Object.assign(enemy,at[enemy.id]);
   const sizes=['tiny','sm','med','lg','huge','grg'],target=canvas.tokens.get(enemy.id);
   enemy.knownModeOfBeing=enemy.tactics.knownModeOfBeing;
   enemy.spellTrippable=enemy.trippable&&sizes.indexOf(target.actor.size)<=sizes.indexOf(this.actor.size)+1;}
  const turns=Array.from(game.combat.turns??game.combat.combatants),index=game.combat.turn;
  for(const enemy of state.enemies){const targetIndex=turns.findIndex(c=>c.tokenId===enemy.id),steps=(targetIndex-index+turns.length)%turns.length||turns.length;
   enemy.alliedTurnsBeforeNextStart=0;
   for(let step=1;step<steps;step++){const token=canvas.tokens.get(turns[(index+step)%turns.length]?.tokenId);
    if(token?.actor&&(token===this.token||this.actor.isAllyOf(token.actor)))enemy.alliedTurnsBeforeNextStart++;}}
  const allies=canvas.tokens.placeables.filter(t=>t.actor?.isOfType?.('creature')&&!t.actor.isDead&&!t.actor.hasCondition('dead')&&!t.document.hidden&&(t===this.token||this.actor.isAllyOf(t.actor)&&this.sight(this.token.center,t)&&detectionFor(this.token,t).state==='observed'));
  const support=(token,cell=state.self.cell,position=this.actualWaypoint())=>({id:token.id,self:token===this.token,missingHP:Math.max(0,token.actor.hitPoints.max-token.actor.hitPoints.value),
   buffs:taughtBuffs(token.actor),martialPower:Math.max(0,...basicMeleeStrikes(token.actor).map(s=>Number(s.totalModifier)*0.6)),
   skulk:Boolean((token.actor.itemTypes.action??[]).some(a=>a.slug==='sneak-attack')),nearestEnemy:Math.min(Infinity,...state.enemies.filter(e=>e.lineOfSight!==false).map(e=>token.distanceTo(this.perceivedSpellTarget(e)))),
   hpFraction:token.actor.hitPoints.value/Math.max(1,token.actor.hitPoints.max),...token===this.token?{distance:0,lineOfSight:true,lineOfEffect:true}:this.targetAt(cell,token,[],position)});
  state.casterAllies=allies.map(t=>support(t));
  state.teleportDestinations=parts.descriptors.some(s=>s.teleport&&s.available)?await translocationDestinationsAsync(this,state,options.budget):[];
  for(const enemy of state.enemies)enemy.chainNeighbors=state.enemies.filter(e=>e.id!==enemy.id&&this.perceivedSpellTarget(enemy).distanceTo(this.perceivedSpellTarget(e))<=30).map(e=>e.id);
  state.damageThreats=[...new Set((game.messages?.contents??[]).slice(-100).filter(m=>!m.blind&&!m.whisper?.length&&state.enemies.some(e=>e.id===m.speaker?.token)).flatMap(m=>(m.rolls??[]).flatMap(r=>(r.instances??[]).map(i=>i.type))))];
  state.dispelTargets=parts.descriptors.some(s=>s.slug==='dispel-magic'&&s.available)?visibleDispelTargets(this):[];
  const patience=this.token.document.getFlag(ns,'casterPatience');
  state.casterDefense={enabled:true,holdTurns:patience?.combatId===game.combat.id&&patience.sceneId===canvas.scene.id?patience.holdTurns??0:0,
   engagementRange:Math.max(5,...parts.descriptors.filter(s=>s.available&&s.kind!=='heal').map(s=>s.range))};
  const bystanders=allies.filter(t=>t!==this.token); // Add other visible neutrals as friendly-fire risks too.
  for(const t of canvas.tokens.placeables)if(t!==this.token&&!bystanders.includes(t)&&!state.enemies.some(e=>e.id===t.id)&&t.actor?.isOfType?.('creature')&&!t.document.hidden&&this.sight(this.token.center,t)&&detectionFor(this.token,t).state==='observed')bystanders.push(t);
  const areaCache=new Map();
  const decorate=async(position,enemies)=>{
   const decorated=[];
   for(const spell of parts.descriptors){
    await options.budget?.checkpoint();
    if(!spell.available||!spell.area&&!['ground-control','lingering'].includes(spell.kind)){decorated.push(spell);continue;}
    // Slot and Soul Cage bindings share geometry, not resource availability.
    const key=JSON.stringify([position,spell.slug,spell.area,spell.range,spell.living,spell.ice]);
    if(!areaCache.has(key))areaCache.set(key,await describeSpellAreasAsync(this,spell,{...state,enemies,bystanderGrease:Object.fromEntries(bystanders.map(t=>[t.id,inGrease(t).length>0]))},bystanders,position,options.budget));
    decorated.push({...spell,areas:areaCache.get(key)});
   }return decorated;
  };
  state.spells=await decorate(undefined,state.enemies);
  for(const move of state.moves){await options.budget?.checkpoint();const defense=stealth.at(this.center(move));move.spells=parts.descriptors;
   for(const enemy of state.enemies)Object.assign(move.targets[enemy.id],defense[enemy.id]);
   move.supportTargets=Object.fromEntries(allies.map(t=>[t.id,support(t,move,this.topLeft(move))]));}
  if(ledger.actionsRemaining>=3)for(const move of [...state.moves].sort((a,b)=>(a.nearestEnemy??0)-(b.nearestEnemy??0)).slice(0,12))
   move.spells=await decorate(this.topLeft(move),state.enemies.map(e=>({...e,...move.targets[e.id]})));
  state.activeSustained=ongoingCasts(this.actor);state.sustained=state.activeSustained.filter(c=>c.lastRound<game.combat.round);
  state.diagnostics={...state.diagnostics,spellcastingRestriction:castingRestriction,manualAbilities:parts.unsupported,witnessedSpellCasts:state.witnessedCasts.map(c=>({slug:c.slug,targetId:c.targetId,immunity:c.immunity})),castingEntries:parts.entries.map(e=>({id:e.id,name:e.name,mode:e.system.prepared.value})),spellCatalog:parts.descriptors.map(s=>({name:s.name,rank:s.castRank,actions:s.actionCost,available:s.available,pool:s.poolId}))};
  return state;
 }
 casterActions(state){return [...castingCandidates(state),...preparedStrikeCandidates(state),...this.extraCasterActions(state),
  ...state.sustained.filter(c=>state.actionsRemaining>0&&!state.plannedCapabilities?.includes(`sustain:${c.id}`)).map(c=>({id:`sustain:${c.id}`,kind:'sustainSpell',castId:c.id,legal:true,actionCost:1,
   features:{onceKey:`sustain:${c.id}`},assessment:{value:5},scoringTerms:[{label:'Maintain estimated ongoing benefit',contribution:5}]}))];}
 candidates(state){return [{id:'end',kind:'endTurn',legal:true,actionCost:0,assessment:{value:0}},...recoveryCandidates(state,{canStrike:state.enemies.some(e=>e.inReach)}),...seekCandidates(state),
  ...casterTurnCandidates(state,{actions:s=>this.casterActions(s)})];}
 decide(state){const d=chooseTacticalAction(this.candidates(state),state,{actionsRemaining:state.actionsRemaining,threatened:state.self.threatened});
  return {...d,diagnostics:{...state.diagnostics,...d.diagnostics,...d.chosen?.kind==='endTurn'&&!state.self.immobile&&!state.self.restrained?{turnComplete:true}:{}}};}
 liveSpellTarget(id){const target=canvas.tokens.get(id);return target===this.token||target?.actor&&this.actor.isAllyOf(target.actor)&&!target.document.hidden&&this.sight(this.token.center,target)?target:this.liveTarget(id);}
 async executeProfileAction(choice,ledger,context={}){if(choice.kind==='castSpell')return executeSpell(this,choice,ledger,context);
  if(choice.kind==='sustainSpell')return sustainCast(this.actor,choice.castId);return super.executeProfileAction(choice,ledger,context);}
 async recordOutcome(choice,_ledger,result={}){
  if(result.skipped)return;const saved=this.token.document.getFlag(ns,'conditionCaster'),previous=saved?.combatId===game.combat.id?saved:{};
  const old=this.token.document.getFlag(ns,'casterPatience'),history=old?.combatId===game.combat.id&&old.sceneId===canvas.scene.id?old:{};
  // Count quiet turns once per round, even if a turn is reported/retried twice.
  // A real offensive action resets patience; setup and Hide do not.
  const offensive=['strike','grab','drinkBlood','castSpell'].includes(choice.kind);
  if(offensive||choice.kind==='endTurn')await this.token.document.setFlag(ns,'casterPatience',{
   combatId:game.combat.id,sceneId:canvas.scene.id,round:game.combat.round,
   holdTurns:offensive?0:history.round===game.combat.round?history.holdTurns??0:Math.min(2,(history.holdTurns??0)+1)});
  const attempts=(previous.attempts??[]).filter(a=>a.untilRound>=game.combat.round);
  if(choice.kind==='castSpell'&&result.lastAction?.kind==='castSpell'&&conditionSpells[choice.spellSlug]&&!conditionSpells[choice.spellSlug].damage)
   attempts.push({slug:choice.spellSlug,targetId:choice.targetId,untilRound:game.combat.round+(choice.spellSlug==='blindness'?10:2)});
  else if(choice.kind==='castSpell'&&result.lastAction?.kind==='castSpell'&&spellDefinition(choice.spellSlug)?.resolver==='outcomes')
   for(const targetId of choice.targetIds??[choice.targetId])attempts.push({slug:choice.spellSlug,targetId,untilRound:game.combat.round+Math.max(1,Math.ceil((spellDefinition(choice.spellSlug).duration??6)/6))});
  await this.token.document.setFlag(ns,'conditionCaster',{...previous,combatId:game.combat.id,attempts});
 }
}
