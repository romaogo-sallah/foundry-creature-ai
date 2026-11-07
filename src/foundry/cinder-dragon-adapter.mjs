import {PF2eSpellcasterAdapter} from './spellcaster-adapter.mjs';
import {monsterAbility,pyreBreath,abilityDamage,monsterDC,monsterAdjustment} from './monster-abilities.mjs';
import {describeSpellAreas} from './spell-areas.mjs';
import {basicSaveValue} from '../framework/spell-evaluation.mjs';
import {preparedStrikeCandidates} from '../framework/strike-capability.mjs';
import {executeNativeStrike} from './native-strikes.mjs';
import {fireShield,raiseFireShield} from './fire-shield.mjs';
const ns='foundry-creature-ai';
export const isCinderDragon=actor=>actor?.type==='npc'&&actor.system.traits.value.includes('dragon')&&/9d6\[fire\]/.test(monsterAbility(actor,'pyre-breath')?.system.description.value??'');
export function dragonActivities(state){
 if(state.self.unable||state.self.restrained)return [];
 const result=[],dragon=state.dragon;
 if(!dragon)return result;
 if(dragon.breathReady&&state.actionsRemaining>=2&&!state.plannedCapabilities?.includes('pyre'))for(const area of dragon.areas??[]){
  const value=basicSaveValue(dragon.breathDC??29,state.self.referenceAC-10,dragon.breathDamage??31.5)*(area.enemies.length-area.bystanders.filter(e=>!e.unaffected).length*2)+area.enemies.length*2;
  if(value>0)result.push({id:`pyre:${area.id}`,kind:'pyreBreath',area,targetId:area.enemies[0]?.id,actionCost:2,legal:true,traits:['fire','primal'],
   features:{onceKey:'pyre',blocksForecast:['pyre']},assessment:{value},scoringTerms:[{label:'Breath damage, fire and smoke; avoid friendly fire',contribution:value}]});
 }
 if(dragon.frenzy&&state.actionsRemaining>=2){
  // Choose each Strike by benchmark value with normal increasing MAP. Replan
  // actual targets between attacks; a prediction never assumes a hit or kill.
  let forecast=state,total=0;const sequence=[],remaining=['claw','claw','wing'];
  for(let i=0;i<3;i++){
   const choices=preparedStrikeCandidates({...forecast,strikes:state.strikes.filter(s=>remaining.includes(s.dragonPart))}).sort((a,b)=>b.assessment.value-a.assessment.value);
   const best=choices[0];if(!best)break;sequence.push({strikeId:best.strikeId,targetId:best.targetId});total+=best.assessment.value;
   remaining.splice(remaining.indexOf(state.strikes.find(s=>s.id===best.strikeId).dragonPart),1);forecast={...forecast,attacksMade:forecast.attacksMade+1};
  }
  if(sequence.length===3)result.push({id:'draconic-frenzy',kind:'draconicFrenzy',sequence,targetId:sequence[0].targetId,actionCost:2,mapIncreases:3,legal:true,traits:['attack'],
   assessment:{value:total},scoringTerms:[{label:'Two Claws and one Wing with normal MAP',contribution:total}]});
 }
 if(state.actionsRemaining&&dragon.burning?.length&&!state.plannedCapabilities?.includes('stoke')){
  const value=dragon.burning.length*10.5;result.push({id:'stoke-flames',kind:'stokeFlames',actionCost:1,legal:true,traits:['fire','primal'],features:{onceKey:'stoke'},assessment:{value},scoringTerms:[{label:'Intensify persistent fire on known foes',contribution:value}]});
 }
 return result;
}
export class PF2eCinderDragonAdapter extends PF2eSpellcasterAdapter{
 get profileId(){return this.actor.itemTypes.spell?.length?'cinder-dragon-caster':'cinder-dragon';}
 preferRangedFlight(){return true;}
 parts(){const p=super.parts();return {...p,abilityNames:[...p.abilityNames,'Pyre Breath','Stoke the Flames',...(monsterAbility(this.actor,'draconic-frenzy')?['Draconic Frenzy','Draconic Momentum']:[])],
  unsupported:p.unsupported.filter(n=>!['Pyre Breath','Stoke the Flames','Draconic Frenzy','Draconic Momentum','Smoke Vision','Boiling Blood','Frightful Presence','Reactive Strike (Jaws only)','+2 Status to All Saves vs. Primal'].includes(n))};}
 async snapshot(ledger,options){const state=await super.snapshot(ledger,options),recharge=this.token.document.getFlag(ns,'pyreRecharge');
  state.dragon={breathReady:!recharge||recharge.combatId!==game.combat.id||game.combat.round>=recharge.round,breathDC:monsterDC(this.actor,29),breathDamage:31.5+monsterAdjustment(this.actor)*4,frenzy:Boolean(monsterAbility(this.actor,'draconic-frenzy')),
   burning:state.enemies.filter(e=>e.lineOfSight!==false&&e.distance<=60&&this.perceivedTarget(e).actor.itemTypes.condition.some(c=>c.slug==='persistent-damage'&&c.system.persistent?.damageType==='fire')).map(e=>e.id)};
  state.dragon.areas=describeSpellAreas(this,{slug:'pyre-breath',area:{type:'cone',value:40},volumetric:true,range:40},state,this.bystanders(state));
  for(const strike of state.strikes)strike.dragonPart=this.parts().native.find(s=>s.item.id===strike.id)?.item.name.toLowerCase();
  return state;
 }
 bystanders(state){return canvas.tokens.placeables.filter(t=>t!==this.token&&t.actor?.isOfType?.('creature')&&!t.document.hidden&&!state.enemies.some(e=>e.id===t.id));}
 async enrichFlight(state){
  if(!state.dragon||!state.flight)return;state.flight.hunt=null;state.flight.airCombat=null;
  const moves=[...state.flight.moves].sort((a,b)=>a.nearestEnemy-b.nearestEnemy).slice(0,16);state.dragon.flightSetups=[];
  if(state.actionsRemaining<3)return;
  for(const move of moves){const position=this.waypoint(move,'fly'),next={...state,actionsRemaining:state.actionsRemaining-1,enemies:state.enemies.map(e=>({...e,...move.targets[e.id]}))};
   next.dragon={...state.dragon,areas:state.dragon.breathReady?describeSpellAreas(this,{slug:'pyre-breath',area:{type:'cone',value:40},volumetric:true,range:40},next,this.bystanders(state),position):[]};
   const follow=Math.max(0,...dragonActivities(next).map(c=>c.assessment.value),...preparedStrikeCandidates(next).map(c=>c.assessment.value));
   if(follow<=0)continue;
   state.dragon.flightSetups.push({id:`dragon:fly:${move.x},${move.y},${move.elevation}`,kind:'fly',legal:true,actionCost:1,path:move.path,destination:{x:move.x,y:move.y,elevation:move.elevation},movementCost:move.cost,
    provokes:move.provokes,features:{flight:true},intent:'take an angle for breath or a full attack activity',assessment:{value:follow-(move.reactionRisk??0),movement:true,fullTurnPlan:true,goodAttacksLeft:true},scoringTerms:[{label:'Affordable breath or attack after flight',contribution:follow},{label:'Known reaction exposure',contribution:-(move.reactionRisk??0)}]});
  }
 }
 candidates(state){return [...super.candidates(state),...(state.dragon?.flightSetups??[])];}
 extraCasterActions(state){return [...dragonActivities(state),...(state.actionsRemaining&&!state.plannedCapabilities?.includes('raise-shield')&&fireShield(this.actor)&&!this.actor.attributes.shield?.raised?[{id:'dragon:shield',kind:'raiseFireShield',actionCost:1,legal:true,features:{onceKey:'raise-shield'},assessment:{value:state.self.threatened?8:2},scoringTerms:[]}]:[])];}
 async executeProfileAction(choice,ledger,context={}){
  const valid=()=> (context.canContinue?.()??true)&&this.turnKey()===ledger.turn;
  if(choice.kind==='raiseFireShield')return raiseFireShield(this.token);
  if(choice.kind==='pyreBreath')return pyreBreath(this,choice,{valid});
  if(choice.kind==='stokeFlames'){
   const item=monsterAbility(this.actor,'stoke-the-flames'),targets=this.targetIds().map(id=>canvas.tokens.get(id)).filter(t=>t?.actor?.hitPoints.value>0&&t.distanceTo(this.token)<=60&&t.actor.itemTypes.condition.some(c=>c.slug==='persistent-damage'&&c.system.persistent?.damageType==='fire'));
   const result=await abilityDamage(this.token,targets,{item,formula:'3d6[fire]',save:null,applyDamage:this.config.applyDamage,valid});return {resolved:true,pause:result.pause,note:`Stoked fire on ${result.saved.length} foes.`};
  }
  if(choice.kind==='draconicFrenzy'){
   for(let i=0;i<choice.sequence.length;i++){
    if(!valid()||this.turnEndReason())return {resolved:true,endTurn:Boolean(this.turnEndReason()),note:'Frenzy interrupted after its earlier Strikes.'};
    const step=choice.sequence[i],strike=this.parts().native.find(s=>s.item.id===step.strikeId),target=this.liveTarget(step.targetId)??this.targetIds().map(id=>this.liveTarget(id)).find(t=>t&&this.strikeGeometry(this.originCell(),t,[],this.actualWaypoint(),strike).usable);
    if(!target||!this.strikeGeometry(this.originCell(),target,[],this.actualWaypoint(),strike).usable)continue;
    const result=await executeNativeStrike(this,strike,target,{...ledger,attacksMade:ledger.attacksMade-2+i},context);await this.momentum(result);
    if(result.pause)return {...result,note:'Resolve Frenzy damage before continuing; its actions and three-attack MAP reservation remain spent.'};
   }return {resolved:true,lastAction:{kind:'draconicFrenzy'},note:'Two Claws and one Wing completed with normal MAP.'};
  }
  const result=await super.executeProfileAction(choice,ledger,context);if(choice.kind==='strike')await this.momentum(result);return result;
 }
 async momentum(result){if(result.lastAction?.critical&&monsterAbility(this.actor,'draconic-momentum')&&this.token.document.getFlag(ns,'pyreRecharge'))await this.token.document.unsetFlag(ns,'pyreRecharge');}
}
