import { CapabilityRegistry } from '../framework/registry.mjs';
import { recoveryCandidates } from '../framework/recovery.mjs';
import { seekCandidates } from '../framework/perception.mjs';
import { movementSight, sightGain } from '../framework/pursuit.mjs';
import { preparedStrikeCandidates as strikes } from '../framework/strike-capability.mjs';

export const basicCapabilities=new CapabilityRegistry()
  .registerCapability('recovery',state=>[{id:'end',kind:'endTurn',actionCost:0,legal:true,assessment:{value:0}},
    ...state.actionsRemaining>0?recoveryCandidates(state,{canStrike:strikes(state).length>0}):[]])
  .registerCapability('perception',seekCandidates)
  .registerCapability('strikes',strikes)
  .registerCapability('movement',state=>{
    if(state.self.immobile||state.self.unable||state.actionsRemaining<1)return [];
    return state.moves.flatMap(move=>{
      if(!move.cost||state.visited?.includes(`${move.x},${move.y}`))return [];
      const after={...state,actionsRemaining:state.actionsRemaining-1,enemies:state.enemies.map(enemy=>({...enemy,...move.targets[enemy.id]}))};
      const follow=Math.max(0,...strikes(after).map(candidate=>candidate.assessment.value)),sight=movementSight(state,move),regain=sightGain(state,move);
      const risk=(move.kind==='step'?0:move.reactionRisk??0)+(move.terrainRisk??0);
      const value=follow+regain.value-risk-sight.penalty-sight.returnPenalty;
      if(value<0||value===0&&move.nearestEnemy>=state.nearestEnemy)return [];
      return [{id:`basic:move:${move.kind}:${move.x},${move.y}`,kind:move.kind,legal:true,actionCost:1,path:move.path,destination:{x:move.x,y:move.y},
        movementCost:move.cost,provokes:move.kind!=='step'&&move.provokes,destinationThreatened:move.destinationThreatened,
        assessment:{value,movement:true,step:move.kind==='step',goodAttacksLeft:follow>0,nearestEnemy:move.nearestEnemy,
          currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5,reachSquares:state.self.reachSquares},
        features:{visibility:sight},scoringTerms:[{label:'Attack after movement',contribution:follow},{label:'Regain sight',contribution:regain.value},
          {label:'Path and visibility risks',contribution:-risk-sight.penalty-sight.returnPenalty}]}];
    });
  }).registerProfile({id:'basic-npc',capabilities:['recovery','perception','strikes','movement']});
