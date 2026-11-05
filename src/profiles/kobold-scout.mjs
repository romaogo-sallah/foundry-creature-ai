import { tileDistance } from '../dawnsbury/chooser.mjs';
import { chooseTacticalAction } from '../framework/tactical-behaviors.mjs';
import { recoveryCandidates } from '../framework/recovery.mjs';
import { seekCandidates } from '../framework/perception.mjs';
import { sightGain, movementSight, investigationCandidates } from '../framework/pursuit.mjs';
import { setupUtility } from '../framework/setup-utility.mjs';
import { scoutAttackValue, scoutExposure, scoutPositionPlan, scoutPlanTerms } from './scout-tactics.mjs';
import { scoutGroupPosition, scoutSwarmOpportunity, scoutFutureMoves, scoutMeleeProgress } from './scout-group-tactics.mjs';
import {tacticalPosition,backtrackCost} from '../framework/tactical-field.mjs';
export { scoutAttackValue } from './scout-tactics.mjs';

export const SCOUT_SOURCE = 'Compendium.pf2e.pathfinder-monster-core.Actor.PcHQDmPTztw32PhL';
export function scoutCandidates(state) {
  const candidates=[{id:'end',kind:'endTurn',actionCost:0,legal:true,assessment:{value:0}}];
  if(state.actionsRemaining<1||state.self.unable||state.retreatComplete)return candidates;
  candidates.push(...seekCandidates(state),...recoveryCandidates(state,{canStrike:!state.self.restrained&&state.enemies.some(e=>state.strikes.some(s=>e.strikes?.[s.id]?.usable))}));
  if(state.self.restrained)return candidates;
  state={...state,futureMoves:scoutFutureMoves(state).map(entry=>{
    const sight=movementSight(state,entry.move);
    return {...entry,move:{...entry.move,sightPenalty:sight.penalty,returnPenalty:sight.returnPenalty,historyPenalty:backtrackCost(state,entry.move)}};
  })};
  const baseline=scoutExposure(state),initialGroup=scoutGroupPosition(state),initialPosition=tacticalPosition(state),planner=scoutPositionPlan(state),hiddenWeight=state.enemies.reduce((sum,e)=>sum+(e.stealthChance??0),0);
  const best=positions=>Math.max(0,...positions.flatMap(enemy=>state.strikes.map(strike=>scoutAttackValue(state,enemy,enemy.strikes?.[strike.id],strike))));
  const current=best(state.enemies),currentContact=state.enemies.some(e=>(e.threatDistance??e.distance)<=(e.threat?.reach??5)&&e.lineOfSight!==false&&e.physicalPath!==false);
  const addPlan=(candidate,action)=>{
    const plan=planner.first(action);if(!plan)return;
    const movement=plan.sequence.find(a=>['step','stride'].includes(a.kind));
    candidates.push({...candidate,legal:true,actionCost:1,assessment:{value:plan.value+baseline-initialGroup-initialPosition},
      features:{...candidate.features,groupGoal:state.bolts<1?'melee':movement?.targetId?'swarm':movement?'kite':null,plan:plan.sequence},scoringTerms:scoutPlanTerms(plan,baseline,initialGroup,initialPosition)});
  };
  for(const enemy of state.enemies)for(const strike of state.strikes){
    if(!enemy.strikes?.[strike.id]?.usable)continue;
    addPlan({id:`strike:${strike.id}:${enemy.id}`,kind:'strike',targetId:enemy.id,strikeId:strike.id,mapIncreases:1,
      provokes:strike.ranged,features:{frontline:enemy.frontline}}, {kind:'strike',targetId:enemy.id,strikeId:strike.id});
  }
  if(state.hideTargets.length&&state.hideAttempts<1&&(state.bowReady&&state.loaded||state.bladeReady||state.actionsRemaining===1))
    addPlan({id:'hide',kind:'hide'},{kind:'hide'});
  if(!state.loaded&&state.bowReady&&state.bolts>0)addPlan({id:'reload',kind:'reload',provokes:true},{kind:'reload'});
  const equipment=(id,kind)=>addPlan({id,kind,provokes:true},{kind});
  if(!state.bladeReady&&(state.bolts<1&&state.enemies.length||state.enemies.some(e=>e.distance<=5&&e.lineOfEffect)||state.actionsRemaining>=2&&state.futureMoves.some(m=>m.swarmTargetId)))equipment('draw-sword','drawSword');
  if(state.bolts>0&&!state.bowReady&&state.enemies.every(e=>e.distance>5))equipment(state.bladeReady?'stow-sword':'grip-bow',state.bladeReady?'stowSword':'gripBow');
  if(state.self.immobile)return candidates;
  for(const move of state.moves){
    if(!move.cost||state.visited?.includes(`${move.x},${move.y}`))continue;
    const after=state.enemies.map(e=>({...e,...move.targets[e.id]})),regain=sightGain(state,move),sight=movementSight(state,move);
    if(state.bolts<1)regain.value=0;
    const afterContact=after.some(e=>(e.threatDistance??e.distance)<=(e.threat?.reach??5)&&e.lineOfSight!==false&&e.physicalPath!==false);
    const retreat=currentContact&&!afterContact&&state.bolts>0;
    const kinds=[];
    if(move.cost<=state.speed)kinds.push(move.kind);
    // Scamper still requires adjacency; ordinary retreats also recognize reach.
    if(move.kind==='stride'&&state.adjacent&&after.every(e=>e.distance>5)&&move.cost<=state.speed+5)kinds.push('scamper');
    if(move.kind==='stride'&&move.cost<=(state.sneakSpeed??state.speed/2)&&move.sneakObservers.length)kinds.push('sneak');
    for(const kind of kinds){
      const isSneak=kind==='sneak',preserves=isSneak||kind==='step';
      const projected=preserves?(isSneak?move.sneakChances:move.stepChances)??[]:[];
      const positions=after.map(enemy=>({...enemy,stealthChance:projected.find(e=>e.observerId===enemy.id)?.unseenChance??0,
        undetectedChance:projected.find(e=>e.observerId===enemy.id)?.undetectedChance??0}));
      const kept=positions.reduce((sum,e)=>sum+e.stealthChance,0),lost=Math.max(0,hiddenWeight-kept),destinationValue=best(positions);
      if(!destinationValue)regain.value=Math.min(regain.value,0.5);
      const swarm=scoutSwarmOpportunity(state,positions);
      const flank=positions.find(e=>state.strikes.some(strike=>!strike.ranged&&e.strikes?.[strike.id]?.flanked&&e.strikes[strike.id].geometryUsable));
      const kite=scoutGroupPosition(state,positions)>initialGroup+0.05;
      const meleeProgress=scoutMeleeProgress(state,move);
      const meleePosition=positions.some(e=>state.strikes.some(s=>!s.ranged&&e.strikes?.[s.id]?.geometryUsable));
      if(state.bolts<1&&!meleeProgress&&!flank&&!meleePosition)continue;
      const spaceGain=tacticalPosition({...state,tactical:move.tactical})-initialPosition,memoryCost=backtrackCost(state,move);
      const exposure=scoutExposure(state,positions);
      const defense=baseline-scoutExposure(state,positions.map(e=>({...e,
        stealthChance:state.enemies.find(old=>old.id===e.id)?.stealthChance??0,
        undetectedChance:state.enemies.find(old=>old.id===e.id)?.undetectedChance??0})));
      const undetectedGain=isSneak?Math.max(0,scoutExposure(state,positions.map(e=>({...e,undetectedChance:state.enemies.find(old=>old.id===e.id)?.undetectedChance??0})))-exposure):0;
      const needApproach=!current&&!destinationValue&&move.nearestEnemy<state.nearestEnemy;
      const defensiveSneak=isSneak&&(retreat||state.actionsRemaining===1||!current)&&sight.after.length>0;
      const useful=retreat||swarm||flank||kite||spaceGain>0.1||meleeProgress>0||destinationValue>current+0.25||sight.after.length>0&&defense>0.05||regain.value||needApproach||defensiveSneak&&undetectedGain>0.05;
      if(!useful)continue;
      if(!swarm&&!flank&&!currentContact&&afterContact&&current>0&&destinationValue<=current+0.25)continue;
      const reactorIds=move.risk?.reactionIds??state.enemies.map(e=>e.id);
      const protection=isSneak&&reactorIds.length?reactorIds.reduce((sum,id)=>sum+(projected.find(e=>e.observerId===id)?.undetectedChance??0),0)/reactorIds.length:0;
      const risk=(kind==='step'?0:(move.reactionRisk??0)*(1-protection)*(kind==='scamper'?0.8:1))+(move.terrainRisk??0);
      const plan=scoutPositionPlan({...state,enemies:positions,hideEstimates:move.hideEstimates??[],freshHideEstimates:move.hideEstimates??[],
        actionsRemaining:state.actionsRemaining-1,futureMoves:[],tactical:move.tactical,self:{...state.self,threatened:Boolean(move.destinationThreatened),
          reactionRisk:move.destinationThreatened?state.self.averageDamage:0}}).best();
      const cost=setupUtility(state,{gain:0}).actionCost;
      const raw=plan.value+baseline-initialGroup-initialPosition+meleeProgress-cost-risk-memoryCost-sight.penalty-sight.returnPenalty+regain.value;
      const value=needApproach&&risk===0&&memoryCost===0&&spaceGain>=-0.1?Math.max(0,raw):raw;
      candidates.push({id:`${kind}:${move.x},${move.y}`,kind,actionCost:1,legal:true,destination:{x:move.x,y:move.y},path:move.path,movementCost:move.cost,
        targetId:swarm?.id??flank?.id,intent:swarm?'surround isolated enemy':flank?'flank':kite?'kite with ranged allies':isSneak?'reposition without revealing the new square':retreat?'escape melee':'use cover and firing lanes',provokes:kind!=='step'&&move.provokes,
        features:{stealthPreserved:kept,stealthLost:lost,becomesUndetected:undetectedGain>0.05,visibility:sight,destinationSightTargets:sight.after,
          tactical:move.tactical,groupGoal:state.bolts<1?'melee':swarm||flank?'swarm':kite?'kite':null,plan:[{kind},...plan.sequence]},
        assessment:{value,movement:true,fullTurnPlan:true,step:kind==='step',goodAttacksLeft:plan.sequence.some(a=>a.kind==='strike'),
          nearestEnemy:move.nearestEnemy,currentNearestEnemy:state.nearestEnemy,distanceMoved:tileDistance(move,state.self.cell),reachSquares:1},
        scoringTerms:[{label:'Attack from destination',contribution:state.actionsRemaining>1?destinationValue:0},
          {label:'Further planned attacks',contribution:plan.offense-(state.actionsRemaining>1?destinationValue:0)},
          ...scoutPlanTerms({...plan,offense:0},baseline,initialGroup,initialPosition).filter(t=>t.label!=='Expected attacks in remaining actions'),
          {label:'Approach with shortsword after ammunition is exhausted',contribution:meleeProgress},
          {label:'Movement setup action cost',contribution:-cost},{label:'Returning to the turn starting square',contribution:-sight.returnPenalty},
          {label:'Recent movement destinations across turns',contribution:-memoryCost},
          {label:'Losing sight of every known target',contribution:-sight.penalty},{label:'Movement reaction exposure',contribution:-risk},{label:'Regain sight',contribution:regain.value}]
      });
    }
  }
  return [...candidates,...investigationCandidates(state,candidates)];
}
export function chooseScoutAction(state){
  const decision=chooseTacticalAction(scoutCandidates(state),state,{actionsRemaining:state.actionsRemaining,threatened:state.self.threatened});
  return {...decision,diagnostics:{...state.diagnostics,...decision.diagnostics}};
}
