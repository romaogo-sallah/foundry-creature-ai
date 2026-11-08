// Bounded search by risk category, then distance. The adapter measures whole paths
// with Foundry's terrain rules; risk is not added to the physical movement cost.
// Diagonal parity stays in the search key because alternating diagonals affect future costs.
export function* reachableCellSteps(start, budget, { canEnter, canStop = canEnter, canTraverse, pathCost, edgeRisk = () => ({}), maxNodes = 2000 }) {
  const compare = (a, b) => a.risk.state - b.risk.state || a.risk.reactionIds.length - b.risk.reactionIds.length ||
    (Math.abs(a.cost - b.cost) > 1e-8 ? a.cost - b.cost :
    Math.abs(a.geometricLength - b.geometricLength) > 1e-8 ? a.geometricLength - b.geometricLength : a.bends - b.bends);
  const keyOf = node => JSON.stringify([node.x, node.y, node.diagonals % 2, node.risk.state, node.risk.reactionIds]);
  const origin = { ...start, cost: 0, path: [{ ...start }], diagonals: 0, geometricLength: 0, bends: 0, direction: null,
    risk: { state: 0, provokes: false, hazardous: false, tumbles: false, reactionIds: [] } };
  const queue = [origin], best = new Map([[keyOf(origin), origin]]), destinations = new Map();
  let count = 0;
  while (queue.length && count++ < maxNodes) {
    yield;
    queue.sort(compare);
    const node = queue.shift();
    const key = keyOf(node);
    if (compare(node, best.get(key)) > 0) continue;
    const positionKey = `${node.x},${node.y}`;
    // A willing ally's square can be an intermediate node without being a
    // destination. Keep searching through it at the normal measured path cost.
    if (canStop(node) && (!destinations.has(positionKey) || compare(node, destinations.get(positionKey)) < 0)) destinations.set(positionKey, node);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const next = { x: node.x + dx, y: node.y + dy };
      if (!canEnter(next) || !canTraverse(node, next)) continue;
      // Apply this guard to impassable spaces; willing allies do not block corners.
      if (dx && dy && (!canEnter({ x: node.x + dx, y: node.y }) || !canEnter({ x: node.x, y: node.y + dy }))) continue;
      const path = [...node.path, next], cost = pathCost(path);
      if (!Number.isFinite(cost) || cost > budget || cost <= node.cost) continue;
      const diagonals = node.diagonals + Number(Boolean(dx && dy));
      const edge = edgeRisk(node, next);
      const reactionIds = [...new Set([...node.risk.reactionIds, ...(edge.reactionIds ?? [])])].sort();
      const provokes = node.risk.provokes || Boolean(edge.provokes) || reactionIds.length > 0;
      const hazardous = node.risk.hazardous || Boolean(edge.hazardous), tumbles = node.risk.tumbles || Boolean(edge.tumbles);
      const risk = { state: Number(provokes) + 2 * Number(hazardous) + 4 * Number(tumbles), provokes, hazardous, tumbles, reactionIds };
      const direction = `${dx},${dy}`;
      const nextNode = { ...next, cost, path, diagonals, direction, risk,
        geometricLength: node.geometricLength + Math.hypot(dx, dy),
        bends: node.bends + Number(node.direction !== null && node.direction !== direction) };
      const nextKey = keyOf(nextNode);
      if (best.has(nextKey) && compare(nextNode, best.get(nextKey)) >= 0) continue;
      best.set(nextKey, nextNode);
      queue.push(nextNode);
    }
  }
  return [...destinations.values()];
}

// Dawnsbury's nearest-enemy measure is an eight-neighbour flood distance, not
// straight-line closing distance. The Foundry adapter supplies wall constraints.
export function* enemyDistanceSteps(seeds, { canVisit, canCross, needed, maxNodes = 20000 }) {
  const key = cell => `${cell.x},${cell.y}`;
  const distances = new Map(), queue = [], pending = new Set(needed.map(key));
  for (const seed of seeds) if (canVisit(seed) && !distances.has(key(seed))) {
    distances.set(key(seed), 0); queue.push(seed); pending.delete(key(seed));
  }
  for (let i = 0; i < queue.length && i < maxNodes && pending.size; i++) {
    yield;
    const from = queue[i], distance = distances.get(key(from));
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const to = { x: from.x + dx, y: from.y + dy }, id = key(to);
      // Search outward from enemies; test the edge in the NPC's approach direction.
      if (distances.has(id) || !canVisit(to) || !canCross(to, from)) continue;
      distances.set(id, distance + 1); queue.push(to); pending.delete(id);
    }
  }
  return distances;
}

export function finishNavigation(iterator){let step;do{step=iterator.next();}while(!step.done);return step.value;}
export async function finishNavigationAsync(iterator,budget){let step;do{await budget.checkpoint();step=iterator.next();}while(!step.done);return step.value;}
export const reachableCells=(...args)=>finishNavigation(reachableCellSteps(...args));
export const enemyDistances=(...args)=>finishNavigation(enemyDistanceSteps(...args));
export const reachableCellsAsync=(start,budget,options,work)=>finishNavigationAsync(reachableCellSteps(start,budget,options),work);
export const enemyDistancesAsync=(seeds,options,work)=>finishNavigationAsync(enemyDistanceSteps(seeds,options),work);
