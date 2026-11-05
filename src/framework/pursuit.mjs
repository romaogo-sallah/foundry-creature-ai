import { returnToStartPenalty } from './setup-utility.mjs';

// Moving to see a known square is useful even when it does not shorten melee
// distance or leave an immediate attack. It grants neither an attack nor Seek.
export function sightGain(state, move) {
  // Seeing another distant square is not a new tactical capability when the
  // creature already has a view of opponents. Attack improvements score below.
  if(state.enemies.some(enemy=>enemy.lineOfSight===true))return {value:0,targetId:null};
  const enemy = state.enemies.find(enemy => enemy.awareness?.state === 'known-square' && !enemy.awareness.searchRequired &&
    enemy.lineOfSight === false && move.targets[enemy.id]?.lineOfSight === true);
  return enemy ? { value: 2, targetId: enemy.id } : { value: 0, targetId: null };
}

// These are rays to known targets/squares, not the live locations of Undetected
// enemies. Moving into cover must not silently count as keeping a firing lane.
export function movementSight(state, move) {
  const before=state.enemies.filter(enemy=>enemy.lineOfSight!==false).map(enemy=>enemy.id);
  const after=state.enemies.filter(enemy=>move.targets[enemy.id]&&move.targets[enemy.id].lineOfSight!==false).map(enemy=>enemy.id);
  const losesAll=before.length>0&&after.length===0;
  return {before,after,losesAll,penalty:losesAll?Math.max(2,state.self.averageDamage??0)*0.5:0,
    returnPenalty:returnToStartPenalty(state,move)};
}

export function investigationCandidates(state,offered=[]){
  if(!state.seek?.available||!state.self||state.self.unable||state.self.immobile||state.self.restrained||state.morale?.broken||state.retreatComplete||
    !(state.actionsRemaining>0||state.bonusMovementActions>0)||!state.seek?.available)return [];
  const references=state.enemies.filter(enemy=>enemy.awareness?.state==='known-square'&&enemy.awareness.position);
  if(!references.length)return [];
  const movementKinds=['step','stride','crawl','escapeStride','sneak','scamper'];
  if(offered.some(choice=>choice.legal&&(['strike','trip','knockdown','sweepingHook'].includes(choice.kind)||
    movementKinds.includes(choice.kind)&&(choice.assessment.value>0||choice.assessment.nearestEnemy<choice.assessment.currentNearestEnemy))))return [];
  const currentDistance=Math.min(...references.map(enemy=>enemy.distance));
  const possible=(state.moves??[]).filter(move=>move.cost>0&&!state.visited?.includes(`${move.x},${move.y}`)&&
    references.some(enemy=>move.targets[enemy.id]?.lineOfSight===true&&move.targets[enemy.id].distance<=currentDistance+5));
  const minimum=Math.min(10,Math.max(0,...possible.map(move=>move.cost)));
  return possible.filter(move=>move.cost>=minimum).flatMap(move=>{
    const useBonus=state.bonusMovementActions>0&&['step','stride'].includes(move.kind),cost=useBonus?0:1;
    if(cost>state.actionsRemaining)return [];
    const reference=references.filter(enemy=>move.targets[enemy.id]?.lineOfSight===true)
      .sort((a,b)=>move.targets[a.id].distance-move.targets[b.id].distance)[0];
    const progress=Math.max(0,currentDistance-move.targets[reference.id].distance)*0.05;
    const sight=movementSight(state,move),risk=(move.reactionRisk??0)+(move.terrainRisk??0);
    const value=0.75+progress-risk-sight.penalty-sight.returnPenalty;
    if(value<=0)return [];
    return [{id:`investigate:${move.kind}:${move.x},${move.y}`,kind:move.kind,legal:true,actionCost:cost,
      ...(useBonus?{bonusActionCost:1}:{}),destination:{x:move.x,y:move.y},path:move.path,movementCost:move.cost,targetId:reference.id,
      intent:'investigate the known enemy area from another position',provokes:move.kind!=='step'&&move.provokes,
      features:{investigation:true,visibility:sight,destinationSightTargets:sight.after},
      assessment:{value,movement:true,step:move.kind==='step',goodAttacksLeft:state.actionsRemaining-cost>0&&(state.seek.scope==='field'||move.targets[reference.id].distance<=30),
        nearestEnemy:move.nearestEnemy,currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5,reachSquares:state.self.reachSquares},
      scoringTerms:[{label:'Change position to investigate a known enemy area',contribution:0.75},
        {label:'Toward the remembered area',contribution:progress},{label:'Movement risk and lost sight',contribution:-risk-sight.penalty},
        {label:'Returning to the turn starting square',contribution:-sight.returnPenalty}]}];
  });
}
