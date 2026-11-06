import {flySpeed} from './flight-costs.mjs';
import {flightMoves} from './flight-movement.mjs';
import {isAirborne} from './flight-surfaces.mjs';
import {executeFlight} from './flight-execution.mjs';
import {resolveFlightFall,flightLost} from './flight-falling.mjs';
import {flightCandidates,gateFlightHunt} from '../framework/flight-candidates.mjs';
import {flightRoutePlanner} from './flight-route-planner.mjs';
import {gateActivityGoal} from '../framework/activity-plan.mjs';
import {chooseTacticalAction} from '../framework/tactical-behaviors.mjs';
import {aerialTactics,recordAerialPlan} from './aerial-tactics.mjs';
import {isTrueVampire} from './vampire-state.mjs';
const attached=new WeakSet(),ns='foundry-creature-ai';
export function attachFlightSystem(adapter){
  if(attached.has(adapter)||!flySpeed(adapter.actor)&&!isTrueVampire(adapter.actor))return adapter;
  attached.add(adapter);
  const snapshot=adapter.snapshot.bind(adapter),candidates=adapter.candidates.bind(adapter),execute=adapter.execute.bind(adapter),prepare=adapter.prepareTurn.bind(adapter),record=adapter.recordOutcome.bind(adapter);
  const flightSnapshot=async(ledger,options={})=>{
    const initiallyFlying=flySpeed(adapter.actor)>0&&!flightLost(adapter.token)&&!adapter.actor.hasCondition('immobilized','grabbed','restrained');
    const state=await snapshot(ledger,initiallyFlying?{...options,movement:false}:options),saved=adapter.token.document.getFlag(ns,'flight');
    if(state.mistEscape||!flySpeed(adapter.actor))return state;
    const canFly=!flightLost(adapter.token)&&!adapter.actor.hasCondition('immobilized','grabbed','restrained');
    state.flight={speed:flySpeed(adapter.actor),airborne:isAirborne(adapter.token),canFly,
      flown:saved?.combatId===game.combat.id&&saved.round===game.combat.round,
      ranged:adapter.preferRangedFlight?.(state)??false,
      origin:{...adapter.originCell(),elevation:adapter.token.document.elevation},moves:[]};
    state.flight.airCombat=aerialTactics(adapter,state);
    if(state.flight.airborne||canFly)state.moves=[];
    const planner=canFly?flightRoutePlanner(adapter,state):null;
    if(planner){
      state.flight.safety=planner.safety(state.flight.origin);
      state.flight.preferredElevation=planner.preferredElevation;
      if(!state.flight.airCombat&&!state.flight.ranged&&state.enemies.length&&state.strikes?.some(strike=>!strike.ranged)){
        const recovering=state.attacksMade>0,engaging=state.lastAction?.flightAttackPass===true;
        const phase=recovering?'recover':!engaging&&(!state.flight.airborne||state.flight.origin.elevation<planner.preferredElevation)?'gain-height':'stalk';
        state.flight.hunt={phase,engaging,preferredElevation:planner.preferredElevation,highPossible:planner.highPossible,
          attackEscape:planner.escape(state.flight.origin,[state.flight.origin]),
          reason:phase==='recover'?'Recover altitude after attacking':phase==='gain-height'?'Gain a safe hunting altitude before committing':'Approach at altitude and wait for an attack with an escape route'};
      }
    }
    if(canFly&&options?.movement!==false){
      const moves=await flightMoves(adapter,state,planner,options);
      if(moves.stale){if((options.workerRetries??0)>=2)throw new Error('Battlefield changed repeatedly while planning; retry this turn');
        return flightSnapshot(ledger,{...options,workerRetries:(options.workerRetries??0)+1});}
      state.flight.moves=moves;
    }
    await adapter.enrichFlight?.(state,planner,options);
    if(state.flight.hunt&&state.flight.hunt.phase==='stalk'&&state.flight.dives?.some(d=>d.features?.escapePlan&&
      (state.actionsRemaining>d.actionCost||d.features.escapePlan.cost===0))){
      state.flight.hunt.phase='strike';state.flight.hunt.reason='A descending attack and a safe escape fit the remaining actions';
    }
    state.diagnostics.flight={speed:state.flight.speed,airborne:state.flight.airborne,flown:state.flight.flown,reachable:state.flight.moves.length,hunt:state.flight.hunt,airCombat:state.flight.airCombat,planning:state.flight.planning};
    if(state.flight.hunt)state.diagnostics.noActionReason=`${state.flight.hunt.reason}. Wait at a safe vantage rather than commit without an affordable escape.`;
    if(state.flight.moves.length){state.diagnostics.movementBlocked=null;state.diagnostics.reachableDestinations=state.flight.moves.length;}
    return state;
  };
  adapter.snapshot=flightSnapshot;
  const offered=state=>gateActivityGoal(state,gateFlightHunt(state,[...candidates(state),...flightCandidates(state)]))
    .map(c=>state.flight?.airCombat?{...c,features:{...c.features,aerialPlan:state.flight.airCombat}}:c);
  adapter.candidates=offered;
  adapter.decide=state=>{
    const result=chooseTacticalAction(offered(state),state,{actionsRemaining:state.actionsRemaining,bonusMovementActions:state.bonusMovementActions??0,threatened:state.self.threatened});
    return {...result,diagnostics:{...state.diagnostics,...result.diagnostics,
      ...(result.chosen?.kind==='endTurn'&&(state.mistEscape||state.flight?.canFly&&(state.flight.flown||!state.flight.airborne&&state.flight.airCombat?.mode==='disengage'))?{turnComplete:true}:{} )}};
  };
  adapter.execute=(choice,ledger,context)=>choice.kind==='fly'?executeFlight(adapter,choice,ledger,context):execute(choice,ledger,context);
  adapter.recordOutcome=async(choice,ledger,result={})=>{await record(choice,ledger,result);await recordAerialPlan(adapter,choice,result);};
  adapter.prepareTurn=async(options={})=>{
    if(!adapter.token.document.getFlag(ns,'flight'))await adapter.token.document.setFlag(ns,'flight',{combatId:game.combat.id,round:-1});
    if(flightLost(adapter.token))await resolveFlightFall(adapter.token,{reactions:adapter.reactions,applyDamage:adapter.config.applyDamage});
    return prepare(options);
  };
  return adapter;
}
