import {preparedStrikeCandidates} from './strike-capability.mjs';
import {PRIORITY} from '../dawnsbury/chooser.mjs';
import {aerialAttackCandidates} from './spike-volley.mjs';
export function flightCandidates(state){
  const flight=state.flight;
  if(!flight?.canFly||state.actionsRemaining<1)return [];
  if(flight.hunt)return huntingFlightCandidates(state);
  const candidates=[];
  const escapeAvailable=flight.safety?.safe===false&&(flight.moves??[]).some(move=>move.airborne&&move.safety?.safe);
  const hoverValue=state.actionsRemaining===1&&!escapeAvailable?PRIORITY:0.1;
  if(flight.airborne&&!flight.flown)candidates.push({id:'fly:hover',kind:'fly',legal:true,actionCost:1,path:[flight.origin],destination:flight.origin,
    intent:'hover',features:{flight:true,hover:true},assessment:{value:hoverValue},
    scoringTerms:[{label:'Use Fly to remain airborne',contribution:hoverValue}]});
  const current=Math.min(...state.enemies.map(enemy=>enemy.distance/5));
  const currentAttack=flight.ranged?Math.max(0,...aerialAttackCandidates(state).map(c=>c.assessment.value)):0;
  for(const move of flight.moves??[]){
    if(!move.airborne)continue;
    const key=`${move.x},${move.y},${move.elevation}`;
    if(state.visited?.includes(key)&&!(flight.safety?.safe===false&&move.safety?.safe))continue;
    const next={...state,actionsRemaining:state.actionsRemaining-1,enemies:state.enemies.map(enemy=>({...enemy,...move.targets[enemy.id]}))};
    const attacks=aerialAttackCandidates(next),follow=Math.max(0,...attacks.map(c=>c.assessment.value))*
      (state.actionsRemaining===2&&move.safety?.safe===false?0.15:1);
    const cruise=flight.preferredElevation??flight.origin.elevation;
    const heightGain=flight.ranged?Math.max(0,Math.min(cruise,move.elevation)-Math.min(cruise,flight.origin.elevation))/5:0;
    if(flight.ranged&&flight.safety?.safe&&move.safety?.safe&&flight.origin.elevation>=cruise&&
      currentAttack>0&&follow<=currentAttack&&heightGain===0)continue;
    const progress=Math.max(0,current-move.nearestEnemy)*0.15;
    const setup=move.diveSetupValue??0,reset=state.attacksMade>0&&move.elevation>flight.origin.elevation&&setup>0?0.6:0;
    const exposure=move.destinationThreatened?0.25:0,maintenance=flight.airborne&&!flight.flown&&state.actionsRemaining===1?0.25:0;
    const losesSight=state.enemies.some(enemy=>enemy.lineOfSight!==false)&&state.enemies.every(enemy=>move.targets[enemy.id]?.lineOfSight===false);
    const sightPenalty=losesSight?Math.max(2,state.self.averageDamage):0;
    const escaping=flight.safety?.safe===false&&move.safety?.safe;
    const retreat=escaping?(state.actionsRemaining===1||state.attacksMade>0?state.self.averageDamage*2+2:0.2):0;
    const heightPreference=(escaping||flight.ranged&&heightGain>0)&&move.safety.aboveReach?1.5:0;
    const safeHold=(flight.ranged||flight.safety?.safe&&state.actionsRemaining<=2)&&move.safety?.safe===false?state.self.averageDamage*2:0;
    const altitudeSetup=heightGain*2;
    const value=Math.max(follow,setup)+progress+reset+maintenance+retreat+heightPreference+altitudeSetup-(move.reactionRisk??0)-exposure-sightPenalty-safeHold;
    if(value<=0&&flight.airborne)continue;
    candidates.push({id:`fly:${key}`,kind:'fly',legal:true,actionCost:1,path:move.path,destination:{x:move.x,y:move.y,elevation:move.elevation},
      movementCost:move.cost,provokes:move.provokes,destinationThreatened:move.destinationThreatened,
      intent:escaping&&retreat>0.2?'fly out of melee reach':!flight.airborne?'take off and approach':setup>follow?'gain height for a dive':move.nearestEnemy<current?'approach in flight':'reposition in flight',
      features:{flight:true,diveSetup:setup>follow,flightRetreat:escaping&&retreat>0.2},assessment:{value:Math.max(0.01,value),movement:true,fullTurnPlan:escaping&&retreat>0.2||altitudeSetup>0,goodAttacksLeft:follow>0||setup>0&&state.actionsRemaining>=3,
        nearestEnemy:move.nearestEnemy,currentNearestEnemy:current,distanceMoved:move.cost/5,reachSquares:state.self.reachSquares},
      scoringTerms:[{label:'Attack or dive after flight',contribution:Math.max(follow,setup)},
        {label:'Approach and prepare another pass',contribution:progress+reset+maintenance},
        {label:'Finish outside enemy melee reach with clearance',contribution:retreat+heightPreference-safeHold},
        ...(altitudeSetup?[{label:'Build a safe firing altitude',contribution:altitudeSetup}]:[]),
        {label:'Known reaction, lost sight and destination exposure',contribution:-(move.reactionRisk??0)-exposure-sightPenalty}]});
  }
  return candidates;
}

// Apply after component injection too: shared native Strikes must not bypass
// the same complete-pass check used by a creature's specialized activity.
export function gateFlightHunt(state,offered){
  const flight=state.flight,hunt=flight?.hunt;
  if(!hunt||!flight.canFly)return offered;
  return offered.filter(choice=>{
    if(choice.kind==='eagleDive')return !['gain-height','recover'].includes(hunt.phase)&&Boolean(choice.features?.escapePlan)&&
      (state.actionsRemaining>choice.actionCost||choice.features.escapePlan.cost===0);
    if(choice.kind==='strike'&&!choice.features?.ranged){
      if(flight.safety.safe&&flight.origin.elevation>=hunt.preferredElevation)return true;
      return !['gain-height','recover'].includes(hunt.phase)&&state.actionsRemaining>choice.actionCost&&Boolean(hunt.attackEscape);
    }
    return true;
  });
}

function huntingFlightCandidates(state){
  const flight=state.flight,hunt=flight.hunt,result=[];
  if(hunt.engaging&&hunt.attackEscape&&state.attacksMade===0&&preparedStrikeCandidates(state).length)return result;
  const current=Math.min(...state.enemies.map(e=>e.distance/5));
  const currentPass=flight.diveSetupValue??0;
  const preparingActivity=flight.preferredActivity&&(currentPass>0||flight.moves.some(move=>move.diveSetupValue>0));
  for(const move of flight.moves){
    if(!move.airborne)continue;
    const key=`${move.x},${move.y},${move.elevation}`,staging=move.safety.safe&&move.elevation>=hunt.preferredElevation;
    const heightGain=Math.max(0,Math.min(hunt.preferredElevation,move.elevation)-Math.min(hunt.preferredElevation,flight.origin.elevation))/5;
    const escaping=!flight.safety.safe&&move.safety.safe;
    if(state.visited?.includes(key)&&!escaping)continue;
    const next={...state,actionsRemaining:state.actionsRemaining-1,enemies:state.enemies.map(e=>({...e,...move.targets[e.id]}))};
    const follow=Math.max(0,...preparedStrikeCandidates(next).map(c=>c.assessment.value));
    const attackPass=!preparingActivity&&!['gain-height','recover'].includes(hunt.phase)&&state.actionsRemaining>=3&&follow>0&&Boolean(move.attackEscape);
    if(!staging&&!attackPass&&!(heightGain>0&&move.safety.exposed<=flight.safety.exposed)&&!escaping)continue;
    const losesSight=state.enemies.some(e=>e.lineOfSight!==false)&&state.enemies.every(e=>move.targets[e.id]?.lineOfSight===false);
    const sightPenalty=losesSight?Math.max(2,state.self.averageDamage):0;
    const preparation=state.attacksMade===0&&['gain-height','stalk'].includes(hunt.phase);
    const climb=heightGain*(preparation?2:1)+(staging&&flight.origin.elevation<hunt.preferredElevation?2:0);
    const recovery=escaping?(state.attacksMade>0||state.actionsRemaining===1?state.self.averageDamage*2+2:1):0;
    const progress=staging&&state.attacksMade===0?Math.max(0,current-move.nearestEnemy)*0.15:0;
    const setup=staging?Math.max(0,(move.diveSetupValue??0)-currentPass):0;
    const pass=attackPass?follow+0.25-(move.attackEscape.reactionRisk??0):0;
    const value=climb+recovery+progress+setup+pass+(escaping&&move.safety.aboveReach?1.5:0)-(move.reactionRisk??0)-sightPenalty;
    if(value<=0)continue;
    const phase=attackPass?'attack-pass':state.attacksMade>0?'recover':heightGain>0?'gain-height':'stalk';
    result.push({id:`fly:${key}`,kind:'fly',legal:true,actionCost:1,path:move.path,destination:{x:move.x,y:move.y,elevation:move.elevation},
      movementCost:move.cost,provokes:move.provokes,destinationThreatened:move.destinationThreatened,
      intent:attackPass?'approach for an attack and escape':phase==='recover'?'regain safe hunting altitude':heightGain>0?'climb before hunting':'survey from safe altitude',
      features:{flight:true,flightHunt:true,flightRetreat:phase==='recover'||escaping,flightAttackPass:attackPass,
        plan:{kind:'aerial-hunt',phase,escape:attackPass?move.attackEscape:null}},
      assessment:{value,movement:true,fullTurnPlan:true,goodAttacksLeft:attackPass,nearestEnemy:move.nearestEnemy,currentNearestEnemy:current,distanceMoved:move.cost/5},
      scoringTerms:[{label:'Build hunting altitude before engagement',contribution:climb},{label:'Recover outside melee reach',contribution:recovery},
        {label:'Survey and improve a future safe attack pass',contribution:progress+setup},
        {label:'Strike and measured escape fit the remaining two actions',contribution:pass},
        {label:'Overhead clearance, reactions and lost sight',contribution:(escaping&&move.safety.aboveReach?1.5:0)-(move.reactionRisk??0)-sightPenalty}]});
  }
  if(flight.airborne&&!flight.flown){
    const value=state.actionsRemaining===1&&!result.length?PRIORITY:0.1;
    result.push({id:'fly:hover',kind:'fly',legal:true,actionCost:1,path:[flight.origin],destination:flight.origin,intent:'watch for a safe opening',
      features:{flight:true,hover:true,flightHunt:true},assessment:{value},scoringTerms:[{label:'Remain airborne while waiting for a safe opening',contribution:value}]});
  }
  return result;
}
