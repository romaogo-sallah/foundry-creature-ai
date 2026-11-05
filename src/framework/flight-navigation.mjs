// Goal-directed, bounded 3D search. Physical cost and collision tests belong to
// the rules adapter. Altitude and diagonal parity are part of every state key.
export function reachableFlightCells(start,budget,{canEnter,canStop=canEnter,canTraverse,pathCost,goals=[],edgeRisk=()=>0,maxNodes=500,step=5}){
  const heuristic=p=>goals.length?Math.min(...goals.map(g=>Math.max(Math.abs(p.x-g.x),Math.abs(p.y-g.y),Math.abs(p.elevation-g.elevation)/step))):0;
  const compare=(a,b)=>a.risk-b.risk||a.priority-b.priority||a.cost-b.cost||a.path.length-b.path.length;
  const heap=[];
  const push=node=>{heap.push(node);let i=heap.length-1;while(i){const parent=(i-1)>>1;if(compare(heap[parent],node)<=0)break;heap[i]=heap[parent];i=parent;}heap[i]=node;};
  const pop=()=>{const result=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&compare(heap[c+1],heap[c])<0)c++;if(compare(last,heap[c])<=0)break;heap[i]=heap[c];i=c;}heap[i]=last;}return result;};
  const key=p=>`${p.x},${p.y},${p.elevation}:${p.diagonals%2}`;
  const origin={...start,cost:0,risk:0,diagonals:0,path:[start],priority:heuristic(start)},best=new Map([[key(origin),origin]]),found=new Map();push(origin);
  let expanded=0;
  while(heap.length&&expanded++<maxNodes){
    const node=pop();if(best.get(key(node))!==node)continue;
    const position=`${node.x},${node.y},${node.elevation}`,prior=found.get(position);
    if(canStop(node)&&(!prior||node.risk<prior.risk||node.risk===prior.risk&&node.cost<prior.cost))found.set(position,node);
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(let dz=-1;dz<=1;dz++){
      if(!dx&&!dy&&!dz)continue;
      const point={x:node.x+dx,y:node.y+dy,elevation:node.elevation+dz*step};
      if(!canEnter(point)||!canTraverse(node,point))continue;
      const path=[...node.path,point],cost=pathCost(path);
      if(!Number.isFinite(cost)||cost<=node.cost||cost>budget+1e-8)continue;
      const next={...point,path,cost,risk:Math.max(node.risk,edgeRisk(node,point)),
        diagonals:node.diagonals+Number(Number(Boolean(dx))+Number(Boolean(dy))+Number(Boolean(dz))>1)};
      next.priority=heuristic(next)+cost/20;
      const previous=best.get(key(next));
      if(previous&&(previous.risk<next.risk||previous.risk===next.risk&&previous.cost<=cost))continue;
      best.set(key(next),next);push(next);
    }
  }
  return [...found.values()];
}
