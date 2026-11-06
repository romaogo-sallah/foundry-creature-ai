import {PF2eSpellcasterAdapter} from './spellcaster-adapter.mjs';
import {preparedNPCStrikes,basicMeleeStrikes} from './basic-npc-adapter.mjs';
import {chooseTacticalAction} from '../framework/tactical-behaviors.mjs';
import {preparedStrikeCandidates} from '../framework/strike-capability.mjs';
import {vampireAbility,vampireState,vampireForm,movingMist,escapingMist} from './vampire-state.mjs';
import {ensureMistEscape,setVampireForm} from './vampire-lifecycle.mjs';
import {mistEscapeRoute,executeMistEscape} from './vampire-escape.mjs';
import {bloodEligible,ownGrab,vampireGrab,drinkBlood} from './vampire-blood.mjs';
import {executeNativeStrike} from './native-strikes.mjs';
import {endHostileInvisibility} from './support-spells.mjs';
import {fireShield,raiseFireShield} from './fire-shield.mjs';
const ns='foundry-creature-ai';
export const VAMPIRES={
 guardian:{id:'vampire-guardian',source:'Compendium.pf2e.blood-lords-bestiary.Actor.syFR3SChA5KCx8OA',drain:1,bloodHeal:13,killAtFive:false},
 count:{id:'vampire-count',source:'Compendium.pf2e.pathfinder-monster-core.Actor.pPQyoQHTxrE2U7px',drain:2,bloodHeal:10,killAtFive:true},
 mastermind:{id:'vampire-mastermind',source:'Compendium.pf2e.pathfinder-monster-core.Actor.TZt3H39oxVdZRKs9',drain:2,bloodHeal:10,killAtFive:true},
};
export function vampireSpec(actor){return Object.values(VAMPIRES).find(spec=>[actor.sourceId,actor._stats?.compendiumSource,actor._stats?.duplicateSource].some(s=>s===spec.source||s===spec.source.replace('.Actor.','.')))??
 VAMPIRES[actor.name?.toLowerCase().replace('vampire ','')]??null;}
export class PF2eVampireAdapter extends PF2eSpellcasterAdapter{
 get vampireSpec(){return vampireSpec(this.actor);}
 get profileId(){return this.vampireSpec.id;}
 get config(){return {...super.config,packMorale:false};}
 parts(){const base=super.parts(),form=vampireForm(this.actor),native=preparedNPCStrikes(this.actor).filter(s=>form==='bat'?/fang/i.test(s.item.name):!/bat fangs/i.test(s.item.name));
  return {...base,native,strike:native.find(s=>s.item.isMelee)??base.strike,drink:(this.actor.itemTypes.action??[]).find(a=>a.slug?.endsWith('drink-blood')),
   abilityNames:[...base.abilityNames,'Grab','Drink Blood','Change Shape','Turn to Mist','Mist Escape'],
   unsupported:base.unsupported.filter(s=>!['Grab','Drink Blood','Change Shape','Turn to Mist','Mist Escape','Dominate','Fast Healing 7','Fast Healing 10','Void Healing','Coffin Restoration','Sneak Attack','Steady Spellcasting','Untaught ranged weapon/ammunition configuration'].includes(s))};}
 async assertReady(){if(movingMist(this.actor)){await this.assertTurnContext();this.validateFootprint();return;}return super.assertReady();}
 async prepareTurn(options={}){await ensureMistEscape(this.token);if(movingMist(this.actor)){await this.assertTurnContext();return true;}return super.prepareTurn(options);}
 async snapshot(ledger,options={}){
  if(vampireForm(this.actor)==='mist'){const route=movingMist(this.actor)?mistEscapeRoute(this.token):{revert:true,path:[]};return {...ledger,self:{cell:this.originCell(),threatened:false},enemies:[],moves:[],mistEscape:route,
   diagnostics:{profileId:this.profileId,policy:'mist escape',movementBlocked:route.blocked?'No legal path to a scene border was found':null}};}
  const state=await super.snapshot(ledger,options),parts=this.parts(),last=this.token.document.getFlag(ns,'vampireLastStrike');
  state.vampire={...this.vampireSpec,lastStrike:last?.turn===ledger.turn?last:null,form:vampireForm(this.actor)};
  for(const strike of state.strikes){const native=parts.native.find(s=>s.item.id===strike.id),linked=native?.item.linkedWeapon;
   strike.available=!linked||linked.system.equipped.carryType==='held'&&linked.system.equipped.handsHeld>=(strike.ranged?2:1);
   if(strike.ranged){strike.available&&=this.ammunition()>0;strike.rangeAversion=0.06;}
   const grab=native?.item.attackEffects?.includes?.('grab')||native?.item.system.attackEffects?.value?.includes('grab');
   if(grab&&state.actionsRemaining>=2)strike.onHitValue=5+(state.actionsRemaining>=3?this.vampireSpec.drain*3+Math.min(6,this.actor.hitPoints.max-this.actor.hitPoints.value):0);
   if(this.profileId==='vampire-guardian')strike.precisionDamage=3.5;
  }
  for(const enemy of state.enemies){const target=this.perceivedTarget(enemy);enemy.bloodEligible=bloodEligible(target.actor);enemy.drained=target.actor.getCondition('drained')?.value??0;
   enemy.held=target.actor.hasCondition('grabbed','restrained','paralyzed','unconscious');enemy.ownGrab=Boolean(ownGrab(target.actor,this.token.id));
   if(enemy.held)enemy.offGuard=true;}
  return state;
 }
 ammunition(){return (this.actor.itemTypes.ammo??[]).filter(i=>(i.slug??i.system.slug)==='arrows').reduce((n,i)=>n+i.system.quantity,0);}
 extraCasterActions(state){
  if(vampireForm(this.actor)==='mist')return [];
  const result=[],last=state.vampire?.lastStrike;
  if(state.actionsRemaining>0&&fireShield(this.actor)&&!this.actor.attributes.shield?.raised)
   result.push({id:'vampire:raise-shield',kind:'raiseFireShield',legal:true,actionCost:1,assessment:{value:state.self.threatened?9:4},scoringTerms:[{label:'Raise Fire Shield for AC and a blocking reaction',contribution:state.self.threatened?9:4}]});
  const airThreat=state.enemies.some(e=>(e.awareness?.position?.elevation??this.perceivedTarget(e).document.elevation)>this.token.document.elevation+10);
  if(state.actionsRemaining>0&&state.vampire?.form==='vampire'&&airThreat&&state.enemies.every(e=>!e.inReach))
   result.push({id:'vampire:bat',kind:'vampireForm',form:'bat',legal:true,actionCost:1,assessment:{value:12},scoringTerms:[{label:'Change into a giant bat to reach airborne opponents',contribution:12}]});
  if(state.actionsRemaining>0&&state.vampire?.form==='bat'&&this.token.document.elevation===0&&!airThreat)
   result.push({id:'vampire:body',kind:'vampireForm',form:'vampire',legal:true,actionCost:1,assessment:{value:12},scoringTerms:[{label:'Resume the stronger vampire body at ground level',contribution:12}]});
  for(const enemy of state.enemies){if(!enemy.inReach||enemy.lineOfSight===false)continue;
   if(enemy.held&&enemy.bloodEligible){const value=(enemy.drained?3+(this.vampireSpec.killAtFive&&enemy.drained>=4?20:0):this.vampireSpec.drain*3+Math.min(this.vampireSpec.bloodHeal,this.actor.hitPoints.max-this.actor.hitPoints.value)+2);
    result.push({id:`blood:${enemy.id}`,kind:'drinkBlood',targetId:enemy.id,legal:true,actionCost:1,mapIncreases:0,assessment:{value},scoringTerms:[{label:'Drain a held foe and recover without wasting healing on a previously drained victim',contribution:value}]});}
   const sizes=['tiny','sm','med','lg','huge','grg'],canGrab=sizes.indexOf(canvas.tokens.get(enemy.id).actor.size)<=sizes.indexOf(this.actor.size)+1;
   if(enemy.ownGrab||canGrab&&last?.hit&&last.targetId===enemy.id&&this.parts().native.some(s=>s.item.id===last.strikeId&&(s.item.attackEffects?.includes?.('grab')||s.item.system.attackEffects?.value?.includes('grab')))){
    const value=enemy.ownGrab?4:7+(state.actionsRemaining>=2?this.vampireSpec.drain*2+Math.min(5,this.actor.hitPoints.max-this.actor.hitPoints.value):0);
    result.push({id:`grab:${enemy.id}`,kind:'grab',targetId:enemy.id,legal:true,actionCost:1,mapIncreases:0,assessment:{value},scoringTerms:[{label:'Hold a foe for allied attacks and Drink Blood',contribution:value}]});}
  }
  for(const strike of state.strikes.filter(s=>!s.available)){const native=this.parts().native.find(s=>s.item.id===strike.id),weapon=native.item.linkedWeapon;if(!weapon||strike.ranged&&!this.ammunition())continue;
   const other=this.parts().native.find(s=>s.item.linkedWeapon&&s.item.linkedWeapon!==weapon&&s.item.linkedWeapon.system.equipped.carryType==='held')?.item.linkedWeapon,cost=other?2:1;
   if(cost>state.actionsRemaining)continue;const forecast=preparedStrikeCandidates({...state,actionsRemaining:Math.max(1,state.actionsRemaining-cost),strikes:[{...strike,available:true}]}),value=Math.max(0,...forecast.map(c=>c.assessment.value))-cost;
   if(value>0)result.push({id:`equip:${weapon.id}`,kind:other?'vampireStow':'vampireEquip',weaponId:other?.id??weapon.id,legal:true,actionCost:1,assessment:{value},scoringTerms:[{label:'Prepare a native weapon for a useful attack',contribution:value}]});}
  return result;
 }
 candidates(state){if(state.mistEscape){const r=state.mistEscape;if(r.revert)return state.actionsRemaining>0?[{id:'mist:revert',kind:'vampireForm',form:'vampire',actionCost:1,legal:true,assessment:{value:20}}]:[{id:'mist:end',kind:'endTurn',actionCost:0,legal:true,assessment:{value:0}}];
  return r.atEdge?[{id:'mist:exit',kind:'escapeScene',actionCost:0,legal:true,assessment:{value:10000}}]:r.path.length&&state.actionsRemaining>0?
  [{id:'mist:fly',kind:'mistFly',actionCost:1,legal:true,path:r.path,destination:r.path.at(-1),movementCost:r.cost,assessment:{value:10000}}]:[{id:'mist:end',kind:'endTurn',actionCost:0,legal:true,assessment:{value:0}}];}
  return super.candidates(state);}
 decide(state){if(state.mistEscape){const decision=chooseTacticalAction(this.candidates(state),{...state,behavior:null},{actionsRemaining:state.actionsRemaining});return {...decision,diagnostics:{...state.diagnostics,turnComplete:!state.mistEscape.path.length&&!state.mistEscape.atEdge}};}return super.decide(state);}
 async execute(choice,ledger,context={}){if(movingMist(this.actor))return executeMistEscape(this,choice);return super.execute(choice,ledger,context);}
 async executeProfileAction(choice,ledger,context={}){
  const valid=()=> (context.canContinue?.()??true)&&this.turnKey()===ledger.turn;
  if(choice.kind==='vampireForm'){await setVampireForm(this.token,choice.form);return {resolved:true,note:`Changed to ${choice.form} form.`};}
  if(vampireForm(this.actor)==='mist')return {resolved:true,note:'The vampire became mist; its committed offensive action cannot finish.'};
  if(choice.kind==='raiseFireShield')return raiseFireShield(this.token);
  if(['vampireEquip','vampireStow'].includes(choice.kind)){
   const interrupt=this.config.pauseForReactions!==false?await this.reactions?.action({mover:this.token,kind:'manipulate',valid,applyDamage:this.config.applyDamage})??{}:{};
   if(interrupt.pause||interrupt.endTurn)return interrupt;
   if(interrupt.disrupted||!valid()||vampireForm(this.actor)==='mist')return {resolved:true,note:'The weapon Interact was interrupted; its action remains spent.'};
   const weapon=this.actor.items.get(choice.weaponId),stow=choice.kind==='vampireStow';
   await weapon.update({'system.equipped.carryType':stow?'worn':'held','system.equipped.handsHeld':stow?0:/one-plus|two/.test(weapon.system.usage.value)?2:1});
   return {resolved:true,note:stow?'Weapon stowed with one Interact; drawing the next weapon is a separate action.':'Native weapon readied with one Interact.'};
  }
  const target=this.liveTarget(choice.targetId);
  try{
   if(choice.kind==='grab')return vampireGrab(this,target,ledger,{valid});
   if(choice.kind==='drinkBlood')return drinkBlood(this,target,{valid});
   if(choice.kind==='strike'){const strike=this.parts().native.find(s=>s.item.id===choice.strikeId);
    if(strike.item.traits.has('unarmed'))for(const w of this.actor.itemTypes.weapon??[])if(w.system.equipped?.carryType==='held'&&w.system.equipped.handsHeld===2)
     await w.update({'system.equipped.handsHeld':1}); // Release one bow hand is a free action; regripping later costs an Interact.
    if(strike.item.isRanged){const ammo=(this.actor.itemTypes.ammo??[]).find(i=>i.system.quantity>0);if(!ammo)return {skipped:true,skipReason:'No arrows remain'};await ammo.update({'system.quantity':ammo.system.quantity-1});}
    return executeNativeStrike(this,strike,target,ledger,context);}
   return await super.executeProfileAction(choice,ledger,context);
  }finally{if(['strike','grab','drinkBlood','castSpell'].includes(choice.kind)&&!['heal','ward','buff','counteract'].includes(this.parts().descriptors.find(s=>s.id===choice.spellId)?.kind))await endHostileInvisibility(this.token);}
 }
 async recordOutcome(choice,ledger,result={}){if(movingMist(this.actor)||escapingMist(this.actor))return;
  await super.recordOutcome(choice,ledger,result);if(!result.skipped){await this.token.document.setFlag(ns,'vampireLastStrike',choice.kind==='strike'?{...result.lastAction,turn:ledger.turn}:null);
   if(choice.kind!=='endTurn')await this.token.document.setFlag(ns,'vampireActions',{turn:ledger.turn});}}
}
