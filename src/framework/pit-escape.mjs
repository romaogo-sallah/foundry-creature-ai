import {checkProbabilities} from './math.mjs';

export function pitFlightSpellValue(state,spell){
 const pit=state.pitEscape;
 if(!pit?.flightExitCost||spell.slug!=='fly'||pit.flySpeed>0)return 0;
 const gain=5+Math.max(0,Math.floor((pit.landSpeed-20)/20))*5;
 const odds=checkProbabilities(pit.climbBonus,pit.dc);
 const progress=pit.climbSpeed||odds.success*gain+odds.criticalSuccess*(gain+5);
 const climbActions=pit.heldItems+pit.height/Math.max(.1,progress);
 const flyActions=spell.actionCost+Math.ceil(pit.flightExitCost/Math.max(20,pit.landSpeed));
 return climbActions>flyActions?35+Math.min(15,climbActions-flyActions)+(state.actionsRemaining>=flyActions?10:0):0;
}

export function pitFlightCandidates(state){
 if(!state.flight?.canFly||state.actionsRemaining<1||state.self.immobile||state.self.prone)return [];
 return (state.pitEscape?.flightMoves??[]).map(move=>({
  id:`pit:fly:${move.x},${move.y},${move.elevation}`,kind:'fly',legal:true,actionCost:1,
  path:move.path,destination:{x:move.x,y:move.y,elevation:move.elevation},movementCost:move.cost,
  provokes:move.provokes,destinationThreatened:move.destinationThreatened,intent:move.exits?'fly out of the pit':'ascend toward the pit rim',
  features:{flight:true,pitEscape:true},assessment:{value:40+(move.exits?10:0)+move.heightGained,movement:true,fullTurnPlan:true},
  scoringTerms:[{label:move.exits?'Reach a clear bank using Fly':'Make vertical progress out of the pit',contribution:40+(move.exits?10:0)+move.heightGained}]
 }));
}
