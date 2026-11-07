import {movingMist} from './vampire-state.mjs';
import {PF2eCreatureAdapter} from './pf2e-adapter.mjs';
import {conditionDirective} from '../framework/condition-directives.mjs';
import {chooseFleeingAction,fleeingCandidates} from '../framework/fleeing-policy.mjs';
import {recoveryCandidates} from '../framework/recovery.mjs';
import {detectionFor,reveal} from './stealth-awareness.mjs';
import {clearSightPath} from './attack-path.mjs';
import {flySpeed} from './flight-costs.mjs';
import {flightLost,resolveFlightFall} from './flight-falling.mjs';
import {isAirborne} from './flight-surfaces.mjs';
import {simpleFlightMoves} from './simple-flight-moves.mjs';
import {executeFlight} from './flight-execution.mjs';
import {allianceSide} from './targeting.mjs';
import {pitActionChoices,executePitAction} from './pit-actions.mjs';
const ns='foundry-creature-ai',attached=new WeakSet();
const position=t=>({x:t.document.x,y:t.document.y,elevation:t.document.elevation??0});
const sourceVisible=(observer,source)=>source&&!source.document.hidden&&detectionFor(observer,source).state==='observed'&&clearSightPath(observer,source);
const metric=(a,b)=>Math.hypot((a.x-b.x)/canvas.grid.size,(a.y-b.y)/canvas.grid.size,((a.elevation??0)-(b.elevation??0))/5);
export function fleeingSourceToken(actor){
  const configured=actor.getFlag?.(ns,'conditionContext')?.fleeingSourceId;
  if(configured)return canvas.tokens.get(configured)??null;
  const condition=actor.getCondition?.('fleeing'),source=condition?.appliedBy??condition;
  const origin=source?.system?.context?.origin??condition?.system?.context?.origin;
  return canvas.tokens.placeables.find(t=>t.document.uuid===origin?.token||t.actor?.uuid===origin?.actor)??null;
}
export class PF2eFleeingAdapter extends PF2eCreatureAdapter{
  constructor(normal){super(normal.token,normal.profile,{reactions:normal.reactions});this.normal=normal;this.handlesFleeing=true;}
  get config(){return {...this.normal.config,packMorale:false,entertaining:false};}
  get profileId(){return this.normal.profileId;}
  parts(){return this.normal.parts();}
  movementBonusAvailable(){return this.normal.movementBonusAvailable();}
  flightSpeed(){return flySpeed(this.actor);}
  sourceKey(){return `${(this.actor.getCondition('fleeing',{all:true})??[]).map(c=>c.appliedBy?.id??c.id).sort().join(',')}:${fleeingSourceToken(this.actor)?.id??'known-opponents'}`;}
  stamp(){return `${this.turnKey()}:${this.sourceKey()}`;}
  async prepareTurn({canContinue=()=>true,ledger}={}){
    await this.assertTurnContext();if(!canContinue())return false;
    await this.normal.configure?.();
    if(this.flightSpeed()&&flightLost(this.token))await resolveFlightFall(this.token,{reactions:this.reactions,applyDamage:this.config.applyDamage,valid:canContinue});
    const ready=await PF2eCreatureAdapter.prototype.prepareTurn.call(this,{canContinue,ledger}),source=fleeingSourceToken(this.actor);
    if(ready&&canContinue()&&sourceVisible(this.token,source))await this.token.document.setFlag(ns,'fleeingMemory',{
      combatId:game.combat.id,sourceKey:this.sourceKey(),tokenId:source.id,point:position(source)});
    return ready;
  }
  sources(state){
    const source=fleeingSourceToken(this.actor),saved=this.token.document.getFlag(ns,'targetMemory');
    if(source&&source!==this.token){
      const visible=sourceVisible(this.token,source),remembered=this.token.document.getFlag(ns,'fleeingMemory');
      const memory=saved?.combatId===game.combat.id&&saved.sceneId===canvas.scene.id?saved.entries?.find(e=>e.id===source.id):null;
      const ownMemory=remembered?.combatId===game.combat.id&&remembered.sourceKey===this.sourceKey()?remembered.point:null;
      const point=visible?position(source):memory?.position??ownMemory;
      if(point)return [{id:source.id,point,kind:visible?'source':'remembered source'}];
    }
    // GM default for a condition without usable source metadata: flee from
    // already-known opposing combatants, never inspect Undetected coordinates.
    return state.enemies.filter(e=>{
      const other=canvas.tokens.get(e.id)?.actor,self=allianceSide(this.actor),side=allianceSide(other);
      return !self||!side||self!==side;
    }).map(e=>({id:e.id,point:e.awareness?.position??position(canvas.tokens.get(e.id)),kind:'known opponent'}));
  }
  async snapshot(ledger,options={}){
    const flying=this.flightSpeed()>0&&!flightLost(this.token)&&!this.actor.hasCondition('immobilized','grabbed','restrained');
    const state=await PF2eCreatureAdapter.prototype.snapshot.call(this,ledger,{...options,movement:options.movement!==false&&!flying,movementRequired:true});
    const sources=this.sources(state),start=this.actualWaypoint(),distance=p=>sources.length?Math.min(...sources.map(s=>metric(p,s.point))):0;
    let moves=state.moves.filter(move=>['stride','crawl','escapeStride'].includes(move.kind));
    if(flying&&sources.length&&options.movement!==false){
      const nearest=[...sources].sort((a,b)=>metric(start,a.point)-metric(start,b.point))[0].point,cell=this.originCell(),other=this.cell(nearest);
      const n=Math.max(1,Math.ceil(this.flightSpeed()/5)),dx=Math.sign(cell.x-other.x)||1,dy=Math.sign(cell.y-other.y);
      const ceiling=start.elevation+Math.ceil(this.flightSpeed()/10/5)*5;
      moves=simpleFlightMoves(this,{goal:{x:cell.x+dx*n,y:cell.y+dy*n,elevation:ceiling},ceiling});
    }
    const mapped=moves.map(move=>{
      const destination={x:move.x,y:move.y,...move.kind==='fly'?{elevation:move.elevation}:{}},bonus=move.kind!=='fly'&&(ledger.bonusMovementActions??0)>0;
      return {...move,destination,movementCost:move.cost,actionCost:move.kind==='escapeStride'||bonus?0:1,bonusActionCost:bonus?1:0,
        progress:distance({...this.topLeft(move),elevation:move.elevation??start.elevation})-distance(start)};
    });
    for(const action of pitActionChoices(this.token,state))mapped.push({...action,destination:action.destination??this.originCell(),progress:['climb','pitStow'].includes(action.kind)?10:
      distance(action.destination)-distance(start),features:{...action.features,pitAction:true,pitChoiceId:action.id}});
    const recovery=recoveryCandidates(state).filter(a=>a.kind==='stand'||a.kind==='escape'&&state.self.immobile).map(a=>({...a,assessment:{value:1000}}));
    state.fleeing={stamp:this.stamp(),sources:sources.map(s=>({id:s.id,kind:s.kind})),moves:mapped,recovery};
    if(flying&&isAirborne(this.token)&&!mapped.some(m=>m.progress>0)){
      const saved=this.token.document.getFlag(ns,'flight');
      if(!(saved?.combatId===game.combat.id&&saved.round===game.combat.round))state.fleeing.moves.push({kind:'fly',destination:{...this.originCell(),elevation:start.elevation},path:[{...this.originCell(),elevation:start.elevation}],movementCost:0,actionCost:1,progress:0.001,features:{hover:true}});
    }
    state.diagnostics={...state.diagnostics,policy:'fleeing',fleeing:state.fleeing.sources};return state;
  }
  candidates(state){return fleeingCandidates(state);}
  decide(state){return chooseFleeingAction(state);}
  async revalidate(choice,ledger,options){
    if(conditionDirective(this.actor)!=='fleeing'||!choice.features?.fleeing||choice.features.fleeingStamp!==this.stamp())return;
    return super.revalidate(choice,ledger,options);
  }
  async execute(choice,ledger,context={}){
    if(conditionDirective(this.actor)!=='fleeing'||!choice.features?.fleeing||choice.features.fleeingStamp!==this.stamp())return {skipped:true,skipReason:'Fleeing changed; choose the current condition strategy again.'};
    await reveal(this.token);
    if(choice.features.pitAction)return executePitAction(this.token,{...choice,id:choice.features.pitChoiceId},{reactions:this.reactions,valid:()=>conditionDirective(this.actor)==='fleeing'&&(context.canContinue?.()??true)&&this.turnKey()===ledger.turn});
    if(choice.kind==='fly')return executeFlight(this,choice,ledger,context);
    return super.execute(choice,ledger,context);
  }
  async recordOutcome(){}
}
export function attachFleeingSystem(adapter){
  if(attached.has(adapter))return adapter;attached.add(adapter);
  const driver=new PF2eFleeingAdapter(adapter),active=()=>!movingMist(adapter.actor)&&conditionDirective(adapter.actor)==='fleeing';
  for(const name of ['prepareTurn','assertReady','snapshot','candidates','decide']){
    const original=adapter[name].bind(adapter);adapter[name]=(...args)=>active()?driver[name](...args):original(...args);
  }
  const revalidate=adapter.revalidate.bind(adapter),execute=adapter.execute.bind(adapter),record=adapter.recordOutcome.bind(adapter);
  adapter.revalidate=(choice,...args)=>Boolean(choice.features?.fleeing)!==active()?Promise.resolve():active()?driver.revalidate(choice,...args):revalidate(choice,...args);
  adapter.execute=(choice,...args)=>Boolean(choice.features?.fleeing)!==active()?Promise.resolve({skipped:true,skipReason:'The condition strategy changed; choose again.'}):active()?driver.execute(choice,...args):execute(choice,...args);
  adapter.recordOutcome=(choice,...args)=>choice?.features?.fleeing?driver.recordOutcome(choice,...args):record(choice,...args);
  return adapter;
}
