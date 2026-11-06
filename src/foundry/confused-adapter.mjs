import {movingMist} from './vampire-state.mjs';
import {PF2eCreatureAdapter} from './pf2e-adapter.mjs';
import {confusedStrikes,confusedGear,executeConfusedGear} from './confused-gear.mjs';
import {chooseConfusedAction,confusedCandidates} from '../framework/confused-policy.mjs';
import {averageFormula} from '../framework/math.mjs';
import {targetKnowledge,rememberTargets} from './target-memory.mjs';
import {flySpeed} from './flight-costs.mjs';
import {flightLost,resolveFlightFall} from './flight-falling.mjs';
import {isAirborne} from './flight-surfaces.mjs';
import {flightPoint} from './flight-movement.mjs';
import {executeFlight} from './flight-execution.mjs';
import {confusedFlightMoves} from './confused-flight.mjs';
import {configureEscapes,escapeBindings} from './escape.mjs';
import {nativeRuleAction,resolveConditionChecks} from './condition-actions.mjs';
import {manualConditionViolation} from './condition-actions.mjs';
import {reveal} from './stealth-awareness.mjs';
import {conditionSpells} from '../framework/condition-spells.mjs';
import {executeSpell} from './spellcasting.mjs';
import {conditionDirective} from '../framework/condition-directives.mjs';
import {spellBindings} from './spell-catalog.mjs';
const ns='foundry-creature-ai',attached=new WeakSet();
const average=strike=>Object.values(strike.item.system.damageRolls??{}).filter(p=>!p.category).reduce((sum,p)=>sum+averageFormula(p.damage),0);
const attackKinds=['strike','castSpell'];
export class PF2eConfusedAdapter extends PF2eCreatureAdapter{
  constructor(normal,{random=()=>Math.random()}={}){super(normal.token,normal.profile,{reactions:normal.reactions});this.normal=normal;this.random=random;this.handlesConfusion=true;}
  get config(){return {...this.normal.config,packMorale:false,entertaining:false};}
  get profileId(){return this.normal.profileId;}
  parts(){const parts=this.normal.parts(),native=confusedStrikes(this.normal);return {...parts,native,strike:parts.strike??native[0],averageDamage:average(parts.strike??native[0])};}
  movementBonusAvailable(){return this.normal.movementBonusAvailable();}
  planningReach(){return Math.max(5,...this.parts().native.filter(strike=>!strike.item.isRanged).map(strike=>this.actor.getReach({action:'attack',weapon:strike.item})));}
  targetAt(cell,target,_allies,position,weapon=this.parts().strike.item){return super.targetAt(cell,target,[],position,weapon);}
  allies(){return [];}
  movementThreats(){return [];}
  targetIds(){return this.onlyTarget?[this.onlyTarget]:super.targetIds();}
  flightSpeed(){return flySpeed(this.actor);}
  stamp(){return `${this.turnKey()}:${(this.actor.getCondition('confused',{all:true})??[]).map(c=>c.flags?.pf2e?.grantedBy?.id??c.appliedBy?.id??c.id).sort().join(',')}`;}
  targets(){return targetKnowledge(this).checks.filter(check=>check.target&&check.awareness?.detection!=='undetected');}
  intent(){const saved=this.token.document.getFlag(ns,'confusedIntent');return saved?.stamp===this.stamp()?saved:null;}
  chooseTarget(){const pool=this.targets(),saved=this.intent();return pool.find(check=>check.id===saved?.targetId)??pool[Math.min(pool.length-1,Math.floor(Math.max(0,Math.min(0.999999,this.random()))*pool.length))]??null;}
  async prepareTurn({canContinue=()=>true,ledger}={}){
    await this.assertTurnContext();if(!canContinue())return false;
    await this.normal.configure?.();if(!canContinue())return false;
    if(this.flightSpeed()&&flightLost(this.token)){
      const fall=await resolveFlightFall(this.token,{reactions:this.reactions,applyDamage:this.config.applyDamage,valid:canContinue});if(fall.pause)return false;
    }
    await rememberTargets(this,canContinue);if(!canContinue())return false;
    const target=this.chooseTarget(),intent={stamp:this.stamp(),targetId:target?.id??null};
    if(JSON.stringify(this.intent())!==JSON.stringify(intent))await this.token.document.setFlag(ns,'confusedIntent',intent);
    if(!ledger?.escapeBlocked&&escapeBindings(this.actor).length)await configureEscapes(this,{valid:()=>canContinue()&&!this.turnEndReason()});
    return canContinue();
  }
  spells(){
    return spellBindings(this.actor).filter(b=>b.spell.isCantrip&&(b.definition.role==='damage'||b.definition.kind==='control-attack')&&!b.definition.area).map(({spell,entry})=>({
      id:spell.id,name:spell.name,slug:spell.slug,spell,entry,cantrip:true,actionCost:Number(spell.system.time?.value??2),
      attack:Boolean(spell.isAttack??spell.traits?.has('attack')),range:spell.system.range?.value==='touch'?5:Number.parseFloat(spell.system.range?.value??'30'),
      damage:Object.values(spell.system.damage??{}).reduce((sum,p)=>sum+averageFormula(p.formula??'0'),0),
    })).filter(spell=>spell.entry&&Number.isInteger(spell.actionCost)&&spell.actionCost>0&&Number.isFinite(spell.range));
  }
  geometry(point,target,strike,position){
    const result=PF2eCreatureAdapter.prototype.targetAt.call(this,point,target,[],position,strike?.item),range=strike?.item.system.range;
    const maximum=strike?.item.isRanged?(range?.max??range?.increment*6):null;
    return {...result,inReach:strike?.item.isRanged?Number.isFinite(maximum)&&result.distance<=maximum&&result.lineOfEffect:result.inReach};
  }
  async snapshot(ledger,options={}){
    await this.waitForMovement();const selected=this.chooseTarget(),view=Object.create(this);view.onlyTarget=selected?.id;
    const flying=this.flightSpeed()>0&&!flightLost(this.token)&&!this.actor.hasCondition('immobilized','grabbed','restrained');
    const state=await PF2eCreatureAdapter.prototype.snapshot.call(view,ledger,{...options,movement:Boolean(selected)&&options.movement!==false&&!flying});
    const target=selected?.target,strikes=this.parts().native,spells=this.spells(),origin=this.originCell(),position=this.actualWaypoint(),items=[];
    const candidate=(kind,values={})=>({id:`confused:${kind}:${values.strikeId??values.spellId??values.itemId??''}:${target?.id??''}:${values.destination?`${values.destination.x},${values.destination.y},${values.destination.elevation??''}`:''}`,kind,legal:true,actionCost:1,targetId:target?.id,
      traits:[],features:{confused:true},assessment:{value:1},...values});
    const available=strikes.map(strike=>({strike,gear:confusedGear(this.normal,strike)})).filter(({gear})=>gear.available);
    const at=(cell,p)=>available.map(({strike,gear})=>({strike,gear,geometry:target?this.geometry(cell,target,strike,p):null}));
    const current=target?at(origin,position):[];
    for(const {strike,gear,geometry}of current){
      if(!geometry.inReach)continue;
      if(gear.ready)items.push(candidate('strike',{strikeId:strike.item.id,mapIncreases:1,traits:[...strike.item.traits??[]],features:{confused:true,ranged:Boolean(strike.item.isRanged)},assessment:{value:average(strike)}}));
      else if(gear.preparation)items.push(candidate(gear.preparation.kind,{...gear.preparation,strikeId:strike.item.id,traits:['manipulate'],assessment:{value:average(strike)}}));
    }
    if(target)for(const spell of spells){
      const geometry=this.geometry(origin,target,null,position);
      if(geometry.lineOfEffect&&geometry.distance<=spell.range)items.push(candidate('castSpell',{spellId:spell.id,spellName:spell.name,spellSlug:spell.slug,actionCost:spell.actionCost,
        mapIncreases:spell.attack?1:0,traits:[...spell.spell.traits??[]],features:{confused:true,cantrip:true,conditionSpell:Boolean(conditionSpells[spell.slug])},assessment:{value:spell.damage/Math.max(1,spell.actionCost)}}));
    }
    const canAttack=items.some(item=>attackKinds.includes(item.kind)&&item.actionCost<=state.actionsRemaining&&!manualConditionViolation(this.actor,nativeRuleAction(this.actor.items.get(item.spellId??item.strikeId),item)));
    if(target&&!canAttack){
      if(state.self.prone&&state.self.canStand&&!state.self.immobile)items.push(candidate('stand',{traits:['move'],assessment:{value:100}}));
      if(state.self.immobile&&!state.escapeBlocked)for(const escape of state.escapes)items.push(candidate('escape',{escapeId:escape.id,statistic:escape.statistic,mapIncreases:1,traits:['attack'],estimate:{dc:escape.dc},assessment:{value:escape.bonus}}));
      if(!state.self.prone&&!state.self.immobile&&options.movement!==false){
        const moves=flying?confusedFlightMoves(this,target):state.moves.filter(move=>move.kind==='stride'||move.kind==='escapeStride');
        const distance=this.geometry(origin,target,null,position).distance;
        for(const move of moves){
          const cell={x:move.x,y:move.y,...flying?{elevation:move.elevation}:{}},p=flying?flightPoint(this,cell):this.topLeft(cell);
          const after=this.geometry(cell,target,null,p),progress=!flying&&Number.isFinite(state.nearestEnemy)&&Number.isFinite(move.nearestEnemy)?state.nearestEnemy-move.nearestEnemy:distance-after.distance;if(progress<=0.01)continue;
          const hit=at(cell,p).some(entry=>entry.geometry.inReach&&(entry.gear.ready||entry.gear.preparation&&state.actionsRemaining>=3))||spells.some(spell=>after.lineOfEffect&&after.distance<=spell.range&&spell.actionCost<=state.actionsRemaining-1);
          items.push(candidate(flying?'fly':'stride',{path:move.path,destination:cell,movementCost:move.cost,actionCost:state.bonusMovementActions>0&&!flying?0:1,
            bonusActionCost:state.bonusMovementActions>0&&!flying?1:0,traits:['move'],assessment:{value:hit?1000-move.cost:progress,movement:true}}));
        }
      }
    }
    const flight=this.token.document.getFlag(ns,'flight'),flown=flight?.combatId===game.combat.id&&flight.round===game.combat.round;
    if(flying&&isAirborne(this.token)&&!flown)items.push(candidate('hover',{traits:['move'],features:{confused:true,hover:true},assessment:{value:-1}}));
    state.confusedOptions=items;state.confusion={stamp:this.stamp(),targetId:target?.id??null,
      manual:!target?'Confused has no located external target. Resolve self-targeting or babbling manually.':state.self.restrained&&!state.escapes.length?'Configure the restraint source/DC before Confused can Escape.':null};
    state.diagnostics={...state.diagnostics,policy:'confused-simple',confusion:state.confusion};return state;
  }
  candidates(state){return confusedCandidates(state);}
  decide(state){return chooseConfusedAction(state);}
  async revalidate(choice,ledger,options){
    if(!choice.features?.confused||!this.actor.hasCondition('confused'))return;
    if(choice.features.confusedStamp!==this.stamp())return;
    if(choice.targetId&&!this.targets().some(target=>target.id===choice.targetId))return;
    return super.revalidate(choice,ledger,options);
  }
  async execute(choice,ledger,context={}){
    if(!this.actor.hasCondition('confused')||!choice.features?.confused||choice.features.confusedStamp!==this.stamp())return {skipped:true,skipReason:'Confused changed before the action; choose again.'};
    if(choice.targetId&&!this.targets().some(target=>target.id===choice.targetId))return {skipped:true,skipReason:'The randomly selected target is no longer available; choose again.'};
    const valid=()=> (context.canContinue?.()??true)&&this.turnKey()===ledger.turn&&!this.turnEndReason();
    if(!await this.waitForReactions({signal:context.signal})||!valid())return {skipped:true,pause:true};
    if(['stride','fly','drawWeapon','stow','reload','drawRefuse','stand','escape','hover'].includes(choice.kind))await reveal(this.token);
    if(['drawWeapon','stow','reload','drawRefuse'].includes(choice.kind)){
      if(!await resolveConditionChecks(this.actor,choice,{token:this.token,valid}))return {resolved:true,note:'Condition check failed; the action remains spent.'};
      return executeConfusedGear(this,choice,ledger,context);
    }
    if(['fly','hover'].includes(choice.kind))return executeFlight(this,{...choice,kind:'fly',...choice.kind==='hover'?{path:[{...this.originCell(),elevation:this.token.document.elevation}],destination:{...this.originCell(),elevation:this.token.document.elevation}}:{}},ledger,context);
    if(choice.kind==='castSpell'){
      const spell=this.spells().find(spell=>spell.id===choice.spellId);if(!spell)return {skipped:true,skipReason:'Only a supported offensive cantrip is allowed while Confused.'};
      const binding=Object.create(this);binding.parts=()=>({...this.parts(),entry:spell.entry,spells:[spell.spell]});
      try{return await executeSpell(binding,choice,ledger,context);}finally{await reveal(this.token);}
    }
    if(choice.kind==='strike'){
      const strike=this.parts().native.find(s=>s.item.id===choice.strikeId),target=this.liveTarget(choice.targetId);
      if(!strike||!target||!confusedGear(this.normal,strike).ready)return {skipped:true,skipReason:'The Confused Strike is no longer available.'};
      try{return await this.nativeExecute(choice,ledger,context);}finally{await reveal(this.token);}
    }
    return super.execute(choice,ledger,context);
  }
  async recordOutcome(choice,_ledger,result={}){
    if(!result.skipped&&attackKinds.includes(choice.kind))await this.token.document.setFlag(ns,'confusedIntent',{stamp:this.stamp(),targetId:null});
  }
}
export function attachConfusionSystem(adapter,options){
  if(attached.has(adapter))return adapter;attached.add(adapter);
  const driver=new PF2eConfusedAdapter(adapter,options),active=()=>!movingMist(adapter.actor)&&conditionDirective(adapter.actor)==='confused';
  driver.nativeExecute=adapter.execute.bind(adapter);
  for(const name of ['prepareTurn','assertReady','snapshot','candidates','decide','liveTarget','allies']){
    const original=adapter[name].bind(adapter);adapter[name]=(...args)=>active()?driver[name](...args):original(...args);
  }
  const revalidate=adapter.revalidate.bind(adapter),record=adapter.recordOutcome.bind(adapter);
  adapter.revalidate=(choice,...args)=>Boolean(choice.features?.confused)!==active()?Promise.resolve():active()?driver.revalidate(choice,...args):revalidate(choice,...args);
  adapter.recordOutcome=(choice,...args)=>choice?.features?.confused?driver.recordOutcome(choice,...args):active()?driver.recordOutcome(choice,...args):record(choice,...args);
  const original=adapter.execute.bind(adapter);
  adapter.execute=(choice,ledger,context)=>Boolean(choice.features?.confused)!==active()?Promise.resolve({skipped:true,skipReason:'The condition strategy changed; choose again.'}):active()?driver.execute(choice,ledger,context):original(choice,ledger,context);
  return adapter;
}
