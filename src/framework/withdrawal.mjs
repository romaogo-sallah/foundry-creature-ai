// Distances, weapon roles and protection are already known/projected by the
// adapter. No opposing HP, ammunition, defenses or secret Stealth results enter.
export function withdrawalPosition(state,move){
  const threats=state.enemies.map(enemy=>{
    const geometry=move?.targets?.[enemy.id]??enemy;
    const incoming=(move?.withdrawal??state.withdrawal)?.[enemy.id]?.incoming??geometry.incoming??{};
    const distance=geometry.distance??enemy.distance,role=enemy.tactics?.role;
    const ranged=role==='ranged',increment=enemy.tactics?.rangeIncrement>0?enemy.tactics.rangeIncrement:60;
    const safeDistance=ranged?increment*2+5:Math.max(30,(enemy.tactics?.reach??5)+(enemy.tactics?.speed??25)+5);
    const blocked=geometry.physicalPath===false;
    const potential=blocked?0:ranged?1/(1+Math.max(0,Math.ceil(distance/increment)-1)*0.35):Math.max(0,1-distance/safeDistance);
    const protection=(1-Math.min(4,incoming.coverBonus??0)*0.08)*(incoming.concealed?0.8:1)*(incoming.blocked?0.5:1);
    return {id:enemy.id,distance,ranged,safe:blocked||distance>=safeDistance,exposure:potential*protection};
  });
  return {safe:threats.every(threat=>threat.safe),nearest:Math.min(...threats.map(threat=>threat.distance)),
    exposure:threats.reduce((sum,threat)=>sum+threat.exposure,0)/Math.max(1,threats.length),threats};
}

export function withdrawalCandidates(state,selection){
  if(selection.planId!=='avoiding'||state.self.immobile||state.self.unable||
    !state.actionsRemaining&&!state.bonusMovementActions||state.morale?.broken)return [];
  const before=withdrawalPosition(state);if(before.safe)return [];
  return (state.moves??[]).flatMap(move=>{
    if(!['stride','step','crawl','escapeStride'].includes(move.kind)||!move.cost||state.visited?.includes(`${move.x},${move.y}`))return [];
    const after=withdrawalPosition(state,move);
    const safety=(before.exposure-after.exposure)*7;
    const distance=Math.min(3,Math.max(-2,(after.nearest-before.nearest)*0.1));
    const risk=(move.kind==='step'?0:move.reactionRisk??0)+(move.terrainRisk??0);
    const value=safety+distance-risk;if(!Number.isFinite(value)||value<=0.05)return [];
    const bonus=state.bonusMovementActions>0&&['stride','step'].includes(move.kind);
    if(!bonus&&!state.actionsRemaining)return [];
    return [{id:`behavior:avoid:${move.kind}:${move.x},${move.y}`,kind:move.kind,legal:true,actionCost:bonus?0:1,bonusActionCost:bonus?1:0,
      destination:{x:move.x,y:move.y},path:move.path,movementCost:move.cost,intent:'withdraw from known threats',
      provokes:move.kind!=='step'&&move.provokes,destinationThreatened:move.destinationThreatened,
      features:{avoidance:true},assessment:{value,movement:true,fullTurnPlan:true,step:move.kind==='step',
        nearestEnemy:move.nearestEnemy,currentNearestEnemy:state.nearestEnemy,distanceMoved:move.cost/5},
      scoringTerms:[{label:'Reduce known weapon exposure and break firing lines',contribution:safety},
        {label:'Create distance from known opponents',contribution:distance},{label:'Movement risk',contribution:-risk}]}];
  });
}
