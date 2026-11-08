import { enemyDistanceSteps, finishNavigation, finishNavigationAsync } from '../framework/navigation.mjs';

// Measure real routes to clear melee/search stopping positions. Seeding the
// enemy's occupied square and ignoring intervening creatures can falsely reject
// every useful first leg of a detour, especially for a Large footprint.
function* approachSteps(adapter,{targets,awareness,origin,reachable,canEnter,canStop,reachSquares}){
  const goals=new Map(),radius=Math.ceil(reachSquares),footprint=adapter.token.document;
  for(const target of targets){
    const topLeft=adapter.cell(target.document),knowledge=awareness.get(target.id);
    const searching=knowledge?.detection==='undetected'||knowledge?.attackOnSight===false&&!knowledge?.allowAttackEstimate;
    for(let x=topLeft.x-radius-footprint.width+1;x<=topLeft.x+Math.ceil(target.document.width)-1+radius;x++)
      for(let y=topLeft.y-radius-footprint.height+1;y<=topLeft.y+Math.ceil(target.document.height)-1+radius;y++){
        yield;const cell={x,y};if(!canStop(cell))continue;
        const geometry=adapter.targetAt(cell,target,[]);
        if(geometry.distance<=reachSquares*5&&geometry.lineOfSight&&(searching||geometry.physicalPath))goals.set(`${x},${y}`,cell);
      }
  }
  const distances=yield* enemyDistanceSteps([...goals.values()],{needed:[origin,...reachable],canVisit:canEnter,
    canCross:(from,to)=>!adapter.token.constrainMovementPath([adapter.waypoint(from),adapter.waypoint(to)],{ignoreWalls:false,ignoreCost:true})[1]&&
      (from.x===to.x||from.y===to.y||canEnter({x:from.x,y:to.y})&&canEnter({x:to.x,y:from.y}))});
  // Keep the recovered comparer's convention: a melee goal sits at reach.
  const distanceAt=cell=>distances.has(`${cell.x},${cell.y}`)?distances.get(`${cell.x},${cell.y}`)+reachSquares:2147483647;
  return {distanceAt,nearestEnemy:distanceAt(origin),goalCount:goals.size};
}

export const approachNavigation=(...args)=>finishNavigation(approachSteps(...args));
export const approachNavigationAsync=(adapter,options,budget)=>finishNavigationAsync(approachSteps(adapter,options),budget);
