// Setup actions earn their new benefit, never the full value of a state which
// is already present. Keep a small explicit action cost so a no-op loses to End.
export function setupUtility(state,{gain,retained=0}) {
  const actionCost=Math.max(0.25,Math.min(1,(state.self.averageDamage??5)*0.1));
  const redundantPenalty=gain<=1e-6&&retained>0?actionCost:0;
  return {gain,actionCost,redundantPenalty,value:gain-actionCost-redundantPenalty};
}

export function returnToStartPenalty(state,move){
  return state.visited?.length&&state.startCell?.x===move.x&&state.startCell?.y===move.y
    ?Math.max(1,(state.self.averageDamage??5)*0.25):0;
}
