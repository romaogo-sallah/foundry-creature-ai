import {aerialAttackCandidates} from './spike-volley.mjs';
import {PRIORITY} from '../dawnsbury/chooser.mjs';

const distance=(a,b)=>Math.max(Math.abs(a.x-b.x)*5,Math.abs(a.y-b.y)*5)+
  Math.max(0,b.elevation-a.elevation)*2+Math.max(0,a.elevation-b.elevation)/2;
export function aerialEngagementCandidates(state){
  const f=state.flight,plan=f.airCombat,result=[],damage=state.self.averageDamage;
  if(plan.mode==='disengage'&&plan.protectedHere&&!f.airborne)return result;
  const usableAttacks=s=>aerialAttackCandidates(s).filter(c=>!f.ranged||c.features?.ranged||c.kind==='spikeVolley');
  const attacks=usableAttacks(state),currentAttack=Math.max(0,...attacks.map(c=>c.assessment.value));
  const readyDive=state.actionsRemaining>=2&&(f.dives??[]).some(c=>c.assessment.value>0);
  const preparing=plan.mode==='setup'&&!readyDive&&!currentAttack&&f.moves.some(move=>move.diveSetupValue>0);
  const coverDistance=p=>Math.min(...plan.coverGoals.map(goal=>distance(p,goal)));
  for(const move of f.moves){
    if(!move.airborne&&plan.mode!=='disengage')continue;
    const key=`${move.x},${move.y},${move.elevation}`,escaping=!f.safety.safe&&move.safety.safe;
    if(state.visited?.includes(key)&&!escaping)continue;
    const next={...state,actionsRemaining:state.actionsRemaining-1,enemies:state.enemies.map(e=>({...e,...move.targets[e.id]}))};
    const follow=Math.max(0,...usableAttacks(next).map(c=>c.assessment.value));
    const progress=Math.max(0,(state.enemies.find(e=>e.id===plan.targetId)?.distance??0)-(move.targets[plan.targetId]?.distance??Infinity))/5;
    const heightGain=preparing?Math.max(0,Math.min(plan.setupElevation,move.elevation)-Math.min(plan.setupElevation,f.origin.elevation))/5:0;
    const setup=heightGain*(damage/6+0.5);
    const clearance=escaping?Math.min(1,Math.max(0,(move.targets[plan.targetId]?.distance??0)-(state.enemies.find(e=>e.id===plan.targetId)?.distance??0))/20)+
      Math.min(f.speed/2,Math.max(0,move.elevation-f.origin.elevation))/5*0.4:0;
    const recovery=escaping&&(state.attacksMade>0||state.actionsRemaining===1)?damage*2+2+clearance:0;
    const closing=plan.mode==='engage'&&state.attacksMade===0?progress*0.3:0;
    const protection=plan.mode==='disengage'?Math.max(0,coverDistance(f.origin)-coverDistance(move))/5*0.8:0;
    if(plan.mode==='disengage'&&protection<=0&&!escaping)continue;
    const protectedFinish=plan.mode==='disengage'&&plan.coverGoals.some(goal=>distance(move,goal)<1)?2:0;
    const attackGain=state.attacksMade===0?follow:0;
    // Do not spend the penultimate action entering melee and then flee on the
    // last action without ever striking. Preparation may still climb safely.
    if(attackGain>0&&!move.safety.safe&&state.actionsRemaining<3&&state.attacksMade===0)continue;
    const exposure=move.safety.safe?0:(state.actionsRemaining===1?damage:0.2);
    // There is no reward for being higher than a flying opponent. A move must
    // buy an attack, a finite preparation step, protection, or a real escape.
    if(f.ranged&&currentAttack>0&&follow<=currentAttack&&!recovery&&!protection)continue;
    if(currentAttack>0&&state.attacksMade===0&&attackGain<=currentAttack&&!recovery&&!protection)continue;
    const value=attackGain+closing+setup+recovery+protection+protectedFinish-exposure-(move.reactionRisk??0)-move.cost/1000;
    if(value<=0)continue;
    result.push({id:`fly:${key}`,kind:'fly',legal:true,actionCost:1,path:move.path,destination:{x:move.x,y:move.y,elevation:move.elevation},
      movementCost:move.cost,provokes:move.provokes,destinationThreatened:move.destinationThreatened,
      intent:protection>0?'descend toward cover and hide':recovery?'withdraw from the aerial clash':setup>0?'build a bounded speed advantage':'close for an aerial attack',
      features:{flight:true,aerialSetup:setup>0,aerialPlan:plan,flightRetreat:recovery>0,defensiveSetup:protection>0},
      assessment:{value,movement:true,fullTurnPlan:true,goodAttacksLeft:follow>0,nearestEnemy:move.nearestEnemy,
        currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5},
      scoringTerms:[{label:'Affordable attack after Fly',contribution:attackGain},{label:'Close three-dimensional attack reach',contribution:closing},
        {label:'Bounded preparation using superior flight speed',contribution:setup},{label:'Leave immediate melee danger after attacking',contribution:recovery},
        {label:'Descend to known protection for Hide',contribution:protection+protectedFinish},
        {label:'Reaction exposure, finish and movement cost',contribution:-exposure-(move.reactionRisk??0)-move.cost/1000}]});
  }
  if(f.airborne&&!f.flown){
    const value=state.actionsRemaining===1&&!result.length?PRIORITY:0.1;
    result.push({id:'fly:hover',kind:'fly',legal:true,actionCost:1,path:[f.origin],destination:f.origin,intent:'maintain flight',
      features:{flight:true,hover:true,aerialPlan:plan},assessment:{value},scoringTerms:[{label:'Use Fly to remain airborne',contribution:value}]});
  }
  return result;
}
