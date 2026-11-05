export const cellKey=cell=>`${cell.x},${cell.y}`;
export const tacticalPosition=(state,gear=state)=>(state.tactical?.positionValue??0)*(gear.bowReady&&gear.bolts>0?1:0.25);
export function backtrackCost(state,move){
  const visits=(state.motionMemory??[]).filter(e=>e.cell.x===move.x&&e.cell.y===move.y);
  return Math.min(2.5,visits.reduce((sum,e)=>sum+1/(1+Math.max(0,state.round-e.round)),0)*(state.self.averageDamage??3.5)*0.4);
}

// Small binary heap: tactical maps are bounded, but repeated sorted queues are
// expensive when evaluating every legal destination and pursuer footprint.
function push(heap,item){let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p].cost<=item.cost)break;heap[i]=heap[p];i=p;}heap[i]=item;}
function pop(heap){const result=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].cost<heap[c].cost)c++;if(heap[c].cost>=last.cost)break;heap[i]=heap[c];i=c;}heap[i]=last;}return result;}
export function gridDistances(graph,seeds,{budget=Infinity,accept=()=>true,reach=false}={}){
  const distances=new Map(),heap=[];
  for(const id of seeds)if(graph.has(id)){distances.set(id,0);push(heap,{id,cost:0});}
  while(heap.length){const current=pop(heap);if(current.cost!==distances.get(current.id))continue;
    for(const edge of graph.get(current.id).edges){
      if(!accept(edge.to))continue;
      const cost=current.cost+(reach?5:edge.cost);
      if(cost>budget||cost>=(distances.get(edge.to)??Infinity))continue;
      distances.set(edge.to,cost);push(heap,{id:edge.to,cost});
    }
  }
  return distances;
}

function footprintGraph(graph,width,height){
  const fits=new Set();
  for(const [id,node]of graph){let valid=true;
    for(let dx=0;dx<width&&valid;dx++)for(let dy=0;dy<height&&valid;dy++){
      const at=graph.get(`${node.x+dx},${node.y+dy}`);
      if(!at||dx&& !at.edges.some(e=>e.to===`${node.x+dx-1},${node.y+dy}`)||dy&&!at.edges.some(e=>e.to===`${node.x+dx},${node.y+dy-1}`))valid=false;
    }
    if(valid)fits.add(id);
  }
  const result=new Map();
  for(const id of fits){const node=graph.get(id),edges=[];
    for(const edge of node.edges){if(!fits.has(edge.to))continue;const to=graph.get(edge.to),dx=to.x-node.x,dy=to.y-node.y;
      if(dx&&dy&&(!fits.has(`${node.x+dx},${node.y}`)||!fits.has(`${node.x},${node.y+dy}`)))continue;
      let cost=edge.cost,valid=true;
      for(let x=0;x<width&&valid;x++)for(let y=0;y<height&&valid;y++){
        const step=graph.get(`${node.x+x},${node.y+y}`).edges.find(e=>e.to===`${to.x+x},${to.y+y}`);
        if(!step)valid=false;else cost=Math.max(cost,step.cost);
      }
      if(valid)edges.push({to:edge.to,cost});
    }
    result.set(id,{...node,edges});
  }
  return result;
}

export function buildTacticalField(graph,{origin,threats=[],speed=25,needed=[origin]}={}){
  const arrivals=new Map([...graph.keys()].map(id=>[id,{}])),footprints=new Map(),unmappedThreatIds=[];
  for(const threat of threats){
    const width=Math.max(1,Math.min(4,Math.ceil(threat.width??1))),height=Math.max(1,Math.min(4,Math.ceil(threat.height??1))),shape=`${width},${height}`;
    if(!footprints.has(shape))footprints.set(shape,footprintGraph(graph,width,height));
    const pursuit=gridDistances(footprints.get(shape),[cellKey(threat.cell)],{budget:Math.max(0,threat.speed)*3});
    if(!pursuit.size)unmappedThreatIds.push(threat.id);
    for(const [id,travel]of pursuit){
      const anchor=graph.get(id),seeds=[];
      for(let x=0;x<width;x++)for(let y=0;y<height;y++)seeds.push(`${anchor.x+x},${anchor.y+y}`);
      // A large pursuer can reach into a narrow passage without being able to
      // walk down it. Reach expands through clear local edges, not solid walls.
      const area=gridDistances(graph,seeds,{budget:threat.reach??5,reach:true});
      const actions=travel===0?0:travel/Math.max(1,threat.speed);
      for(const target of area.keys()){const row=arrivals.get(target);if(actions<(row[threat.id]??Infinity))row[threat.id]=actions;}
    }
  }
  const result=new Map(),desired=Math.max(12,(speed/5)**2*1.5);
  for(const cell of needed){const id=cellKey(cell),node=graph.get(id);if(!node)continue;
    const earliest=key=>Math.min(Infinity,...Object.values(arrivals.get(key)??{}));
    const safe=gridDistances(graph,[id],{budget:speed*2,accept:key=>graph.get(key).passable!==false&&earliest(key)>1});
    const space=[...safe.keys()].filter(key=>graph.get(key).stoppable!==false).length;
    const exits=node.edges.filter(e=>graph.get(e.to).passable!==false&&earliest(e.to)>1).length;
    const mobility=Math.min(1,space/desired),trap=space<desired*0.25&&exits<=2?(1-mobility)*1.5:0;
    result.set(id,{x:cell.x,y:cell.y,arrivals:arrivals.get(id),enemyArrival:earliest(id),safeSpace:space,exits,
      positionValue:mobility*1.5-trap});
  }
  return {cells:result,visitedCells:graph.size,unmappedThreatIds,origin:result.get(cellKey(origin))};
}
