import {PF2eBasicNPCAdapter} from './basic-npc-adapter.mjs';
import {attachFlightSystem} from './flight-runtime.mjs';
import {executeFlight} from './flight-execution.mjs';
import {flightMoveTargets,flightPoint,perceivedFlightTarget} from './flight-movement.mjs';
import {flySpeed} from './flight-costs.mjs';
import {flightBounds,isAirborne} from './flight-surfaces.mjs';
import {tokenHeight,tokenAt,volumesOverlap} from './vertical-geometry.mjs';
import {executeNativeStrike} from './native-strikes.mjs';
import {preparedStrikeCandidates} from '../framework/strike-capability.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {clearSightPath} from './attack-path.mjs';
import {flightThreats,flightSafety} from './flight-safety.mjs';
import {activityPlan} from '../framework/activity-plan.mjs';
import {planningWorker} from './planning-worker.mjs';
import {rankDiveSetups} from '../framework/flight-worker-planner.mjs';
import {flightWorldStamp} from './flight-worker-snapshot.mjs';

const ns='foundry-creature-ai',slug=item=>item.slug??item.name.toLowerCase().replaceAll(' ','-');
export const EAGLE_SOURCE='Compendium.pf2e.pathfinder-monster-core.Actor.WBPEvEqIGvxeQKlp';
export class PF2eEagleAdapter extends PF2eBasicNPCAdapter{
  constructor(...args){super(...args);attachFlightSystem(this);}
  get profileId(){return 'eagle';}
  parts(){
    const parts=super.parts(),talon=parts.native.find(strike=>slug(strike.item)==='talon');
    const dive=this.actor.itemTypes.action.find(item=>slug(item)==='eagle-dive'&&item.actionCost?.type==='action'&&item.actionCost.value===2);
    if(!talon||!dive)throw new Error('Eagle requires a prepared Talon Strike and two-action Eagle Dive.');
    return {...parts,talon,dive,abilityNames:[...parts.native.map(s=>s.item.name),`Fly (${flySpeed(this.actor)} ft)`, 'Hover','Eagle Dive (2 actions)','Arrest a Fall','Stand','Escape','Seek'],
      unsupported:parts.unsupported.filter(name=>name!==dive.name)};
  }
  candidates(state){return [...super.candidates(state),...(state.flight?.dives??[])];}
  async enrichFlight(state,planner,{signal}={}){
    if(!state.flight?.canFly)return;
    const endpoints=[],bounds=flightBounds(this.token),talon=this.parts().talon;
    state.flight.preferredActivity='eagleDive';
    state.activityGoal={kind:'eagleDive',label:'Begin the turn with Eagle Dive, then climb back to hunting altitude'};
    const threats=flightThreats(this,state,enemy=>perceivedFlightTarget(this,enemy));
    for(const enemy of state.enemies){
      const target=perceivedFlightTarget(this,enemy),cell=this.cell(target.document);
      const top=target.document.elevation+tokenHeight(target);
      for(const elevation of [...new Set([target.document.elevation,Math.max(target.document.elevation,top-5),top])])
        for(let dx=-Math.ceil(this.token.document.width);dx<=Math.ceil(target.document.width);dx++)
          for(let dy=-Math.ceil(this.token.document.height);dy<=Math.ceil(target.document.height);dy++){
          if(elevation<bounds.bottom||elevation>bounds.top)continue;
          const point={x:cell.x+dx,y:cell.y+dy,elevation},p=flightPoint(this,point),rect=canvas.dimensions.sceneRect;
          if(!isAirborne(this.token,p))continue;
          if(p.x<rect.x||p.y<rect.y||p.x+this.token.w>rect.x+rect.width||p.y+this.token.h>rect.y+rect.height)continue;
          if(canvas.tokens.placeables.some(other=>other!==this.token&&other.actor.hitPoints?.value>0&&
            detectionFor(this.token,other).state==='observed'&&clearSightPath(this.token,other)&&volumesOverlap(tokenAt(this.token,p),other,{acrossLevels:true})))continue;
          const positions=flightMoveTargets(this,state,point),geometry=positions[enemy.id].strikes[talon.item.id];
          if(!geometry?.usable)continue;
          const after={...state,enemies:[{...enemy,...positions[enemy.id]}]},strike=preparedStrikeCandidates(after).find(c=>c.strikeId===talon.item.id);
          if(strike)endpoints.push({point,enemyId:enemy.id,value:strike.assessment.value});
        }
    }
    const shown=this.token.document.getFlag(ns,'eagleShown'),showcase=state.style.enabled&&shown?.combatId!==game.combat.id?state.style.showcaseBonus:0;
    const build=(origin,end,actions,options={})=>{
      if(origin.elevation-end.point.elevation<10||!planner.routeClear([origin,end.point]))return null;
      const cost=planner.measure([origin,end.point],options);
      if(cost>flySpeed(this.actor)*2)return null;
      const escapePlan=planner.escape(end.point,[origin,end.point],options);
      // A legal Dive is not necessarily a sensible attack pass. The hunting
      // gate requires this measured return route and its remaining action.
      if(!escapePlan)return null;
      const exposedFinish=actions<=2&&!flightSafety(this,flightPoint(this,end.point),threats).safe;
      const retreatPenalty=exposedFinish?state.self.averageDamage*2+2:0;
      const value=end.value+showcase*0.5-retreatPenalty-(escapePlan.reactionRisk??0);
      const turnPlan=activityPlan({id:`dive-and-climb:${end.enemyId}`,label:'Eagle Dive, then climb to safety',value,
        steps:[{kind:'eagleDive',actionCost:2,targetId:end.enemyId,destination:end.point},
          {kind:'fly',actionCost:escapePlan.cost>0?1:0,destination:escapePlan.destination,movementCost:escapePlan.cost}]});
      return {id:`eagle-dive:${end.enemyId}:${end.point.x},${end.point.y},${end.point.elevation}`,kind:'eagleDive',legal:true,actionCost:2,mapIncreases:1,
        targetId:end.enemyId,strikeId:talon.item.id,path:[origin,end.point],destination:end.point,movementCost:cost,
        features:{flight:true,dive:true,escapePlan,turnPlan,plan:turnPlan},assessment:{value,fullTurnPlan:true},
        scoringTerms:[{label:'Talon after a legal descending flight',contribution:end.value},{label:'Show Eagle Dive',contribution:showcase*0.5},
          {label:'No action left to Fly out of melee reach',contribution:-retreatPenalty},
          {label:'Known reaction exposure on the escape',contribution:-(escapePlan.reactionRisk??0)}]};
    };
    state.flight.dives=state.actionsRemaining>=2?endpoints.map(end=>build(state.flight.origin,end,state.actionsRemaining)).filter(Boolean):[];
    state.flight.diveSetupValue=Math.max(0,...endpoints.map(end=>build(state.flight.origin,end,3,{fresh:true})?.assessment.value??0))*0.45;
    const payload={origins:state.flight.moves.map(({x,y,elevation})=>({x,y,elevation})),endpoints,speed:flySpeed(this.actor),preferredElevation:planner.preferredElevation};
    const stamp=flightWorldStamp(this);
    const response=state.flight.planning?.backend==='worker'?await planningWorker.request('diveSetups',payload,{signal}):{};
    if(response.cancelled||signal?.aborted)throw Object.assign(new Error('Flight planning cancelled'),{name:'AbortError'});
    if(flightWorldStamp(this)!==stamp)throw new Error('Battlefield changed while planning a Dive; retry before acting');
    const selected=response.result??rankDiveSetups(payload);
    for(const [index,move] of state.flight.moves.entries()){
      const shortlist=(selected[index]??[]).map(i=>endpoints[i]).filter(Boolean);
      let dive=shortlist.map(end=>build({x:move.x,y:move.y,elevation:move.elevation},end,3,{fresh:true})).filter(Boolean);
      // Preserve a route around unusual native geometry when the cheap
      // shortlist was obstructed. This fallback is local to that destination.
      if(!dive.length&&shortlist.length&&shortlist.length<endpoints.length)
        dive=endpoints.map(end=>build({x:move.x,y:move.y,elevation:move.elevation},end,3,{fresh:true})).filter(Boolean);
      // Staging evaluates a future full turn: Dive (two actions), then the
      // measured escape (one Fly). It does not consume that escape action now.
      move.diveSetupValue=dive.length?Math.max(...dive.map(c=>c.assessment.value))*0.45:0;
    }
  }
  async executeProfileAction(choice,ledger,context){
    if(choice.kind!=='eagleDive')return super.executeProfileAction(choice,ledger,context);
    const movement=await executeFlight(this,choice,ledger,context);
    if(movement.skipped)return movement;
    const target=this.liveTarget(choice.targetId),strike=this.parts().talon;
    if(movement.pause||movement.endTurn||!movement.movement?.arrived||!target||
      !this.targetAt(this.originCell(),target,[],this.actualWaypoint(),strike.item).inReach)
      return {...movement,attackNotAttempted:true};
    const result=await executeNativeStrike(this,strike,target,ledger,context);
    await this.token.document.setFlag(ns,'eagleShown',{combatId:game.combat.id,dive:true});
    return {...movement,...result,note:'Eagle Dive: descend in a straight line, then make one Talon Strike.'};
  }
}
