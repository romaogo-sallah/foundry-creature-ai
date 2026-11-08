import {profileActions} from '../framework/profile-actions.mjs';
import {profileActionFacts} from './decision-snapshot.mjs';
import {PF2eSpellcasterAdapter} from './spellcaster-adapter.mjs';
import {monsterAbility,pyreBreath,abilityDamage,monsterDC,monsterAdjustment} from './monster-abilities.mjs';
import {describeSpellAreas} from './spell-areas.mjs';
import {preparedStrikeCandidates} from '../framework/strike-capability.mjs';
import {executeNativeStrike} from './native-strikes.mjs';
import {raiseFireShield} from './fire-shield.mjs';
const ns='foundry-creature-ai';
export const isCinderDragon=actor=>actor?.type==='npc'&&actor.system.traits.value.includes('dragon')&&/9d6\[fire\]/.test(monsterAbility(actor,'pyre-breath')?.system.description.value??'');
export const dragonActivities=state=>profileActions(state);
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
 async enrichFlight(state,_planner,options={}){
  if(!state.dragon||!state.flight)return;state.flight.hunt=null;state.flight.airCombat=null;
  const moves=[...state.flight.moves].sort((a,b)=>a.nearestEnemy-b.nearestEnemy).slice(0,16);state.dragon.flightSetups=[];state.dragon.flightOptions=[];
  if(state.actionsRemaining<3)return;
  for(const move of moves){await options.budget?.checkpoint();const position=this.waypoint(move,'fly'),next={...state,actionsRemaining:state.actionsRemaining-1,enemies:state.enemies.map(e=>({...e,...move.targets[e.id]}))};
   next.dragon={...state.dragon,areas:state.dragon.breathReady?describeSpellAreas(this,{slug:'pyre-breath',area:{type:'cone',value:40},volumetric:true,range:40},next,this.bystanders(state),position):[]};
   if(options.deferDecision){state.dragon.flightOptions.push({move,areas:next.dragon.areas});continue;}
   const follow=Math.max(0,...dragonActivities(next).map(c=>c.assessment.value),...preparedStrikeCandidates(next).map(c=>c.assessment.value));
   if(follow<=0)continue;
   state.dragon.flightSetups.push({id:`dragon:fly:${move.x},${move.y},${move.elevation}`,kind:'fly',legal:true,actionCost:1,path:move.path,destination:{x:move.x,y:move.y,elevation:move.elevation},movementCost:move.cost,
    provokes:move.provokes,features:{flight:true},intent:'take an angle for breath or a full attack activity',assessment:{value:follow-(move.reactionRisk??0),movement:true,fullTurnPlan:true,goodAttacksLeft:true},scoringTerms:[{label:'Affordable breath or attack after flight',contribution:follow},{label:'Known reaction exposure',contribution:-(move.reactionRisk??0)}]});
  }
 }
 candidates(state){return [...super.candidates(state),...(state.dragon?.flightSetups??[])];}
 extraCasterActions(state){return profileActions(state,profileActionFacts(this,state));}
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
