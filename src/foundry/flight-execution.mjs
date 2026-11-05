import {flightCost,flightPath,flightPoint} from './flight-movement.mjs';
import {flySpeed} from './flight-costs.mjs';
import {flightLost,resolveFlightFall} from './flight-falling.mjs';
import {isAirborne} from './flight-surfaces.mjs';
import {MANAGED_MOVEMENT} from './movement-options.mjs';
const ns='foundry-creature-ai';
export async function executeFlight(adapter,choice,ledger,{canContinue=()=>true,signal}={}){
  const valid=()=>canContinue()&&adapter.turnKey()===ledger.turn&&!game.paused&&game.users.activeGM?.id===game.user.id;
  if(!await adapter.waitForReactions({signal})||!valid())return {skipped:true,pause:true};
  if(flightLost(adapter.token)||adapter.actor.hasCondition('immobilized','grabbed','restrained'))return {skipped:true,skipReason:'The creature can no longer Fly.'};
  const context=adapter.movementContext(),budget=flySpeed(adapter.actor)*(choice.kind==='eagleDive'?2:1);
  const cost=choice.features?.hover?0:flightCost(adapter,choice.path,context);
  if(!Number.isFinite(cost)||cost>budget+1e-8)return {skipped:true,skipReason:'The flight path no longer fits this action.'};
  await adapter.token.document.setFlag(ns,'flight',{combatId:game.combat.id,round:game.combat.round,turn:ledger.turn});
  if(!valid())return {resolved:true,pause:true};
  const from=adapter.actualWaypoint();let completed=true,pauseReason;
  if(!choice.features?.hover){
    let points=flightPath(adapter,choice.path);const seen=new Set();
    const options={[MANAGED_MOVEMENT]:true,showRuler:true,constrainOptions:{ignoreWalls:false,ignoreCost:false,maxCost:context.historyCost+budget}};
    const replay=adapter.config.pauseForReactions!==false&&adapter.reactions?.hasMovementReactors(adapter.token);
    if(replay&&choice.kind==='eagleDive'){
      const one=points[0],two=points.at(-1),steps=Math.ceil(Math.max(Math.abs(two.x-one.x)/canvas.grid.size,
        Math.abs(two.y-one.y)/canvas.grid.size,Math.abs(two.elevation-one.elevation)/canvas.grid.distance));
      points=[one,...Array.from({length:steps},(_,index)=>{
        const t=(index+1)/steps;
        return {...two,x:one.x+(two.x-one.x)*t,y:one.y+(two.y-one.y)*t,
          elevation:one.elevation+(two.elevation-one.elevation)*t,snapped:index+1===steps};
      })];
    }
    if(replay){
      for(const point of points.slice(1)){
        const before=adapter.actualWaypoint(),unchanged=()=>valid()&&['x','y','elevation','level'].every(key=>adapter.actualWaypoint()[key]===before[key]);
        const reaction=await adapter.reactions.movement({mover:adapter.token,seen,valid:unchanged,applyDamage:adapter.config.applyDamage});
        const fall=await resolveFlightFall(adapter.token,{reactions:adapter.reactions,applyDamage:adapter.config.applyDamage,valid:()=>canContinue()});
        if(fall.pause)pauseReason=fall.pauseReason;
        if(reaction.pause||reaction.endTurn||fall.fall||!unchanged()){
          completed=false;pauseReason??=reaction.pauseReason;break;
        }
        completed=await adapter.token.document.move([point],options);await adapter.waitForMovement();
        if(!completed||!valid()||adapter.turnEndReason())break;
      }
    }else completed=await adapter.token.document.move(points.slice(1),options);
    await adapter.waitForMovement();
  }
  const fall=await resolveFlightFall(adapter.token,{reactions:adapter.reactions,applyDamage:adapter.config.applyDamage,valid:()=>canContinue()});
  pauseReason??=fall.pauseReason;
  const to=adapter.actualWaypoint(),expected=flightPoint(adapter,choice.destination),arrived=['x','y','elevation'].every(key=>Math.abs(to[key]-expected[key])<=0.1);
  if(valid())await adapter.token.document.update?.({movementAction:isAirborne(adapter.token)?'fly':'walk'});
  const ended=adapter.turnEndReason(),pause=Boolean(!ended&&(pauseReason||!valid()));
  return {resolved:true,destination:Math.hypot(to.x-from.x,to.y-from.y,to.elevation-from.elevation)>0.1?{...adapter.originCell(),elevation:to.elevation}:null,
    ...(choice.features?.flightAttackPass&&arrived?{lastAction:{kind:'fly',flightAttackPass:true}}:{}),
    endTurn:Boolean(ended),incapacitationReason:ended,pause,pauseReason,
    note:fall.note??(!completed||!arrived?'Foundry stopped this flight. Its action remains spent; reassessing from the actual position.':choice.features?.hover?'The creature hovers to remain airborne.':null),
    movement:{from,to,completed,arrived,cost:completed&&arrived?cost:adapter.token.document.movement?.passed?.cost??0}};
}
