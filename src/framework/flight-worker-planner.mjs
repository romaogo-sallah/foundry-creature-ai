// Pure numeric flight proposals. Native Foundry geometry and costs validate
// the shortlist on the main thread before any action can execute.
import {reachableFlightCells} from './flight-navigation.mjs';
const epsilon=1e-7;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function hull(points){
  const sorted=points.slice().sort((a,b)=>a.x-b.x||a.y-b.y),one=[],two=[];
  for(const p of sorted){while(one.length>1&&cross(one.at(-2),one.at(-1),p)<=0)one.pop();one.push(p);}
  for(const p of sorted.reverse()){while(two.length>1&&cross(two.at(-2),two.at(-1),p)<=0)two.pop();two.push(p);}
  return [...one.slice(0,-1),...two.slice(0,-1)];
}
function expandedPolygon(points,width,height){
  return hull(points.flatMap(p=>[[-width/2,-height/2],[-width/2,height/2],[width/2,-height/2],[width/2,height/2]]
    .map(([x,y])=>({x:p.x+x,y:p.y+y}))));
}
function hitsPolygon(a,b,polygon){
  if(polygon.length<3)return false;
  // Clip a segment against a convex obstacle. Tangency alone is not overlap.
  let lo=0,hi=1;
  for(let i=0;i<polygon.length;i++){
    const p=polygon[i],q=polygon[(i+1)%polygon.length],start=cross(p,q,a),delta=cross(p,q,b)-start;
    if(Math.abs(delta)<epsilon){if(start<epsilon)return false;continue;}
    const t=(epsilon-start)/delta;
    if(delta>0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
    if(lo>=hi)return false;
  }
  return hi>0&&lo<1;
}
const overlap=(a,b,f)=>a.x<b.x+b.width-epsilon&&a.x+f.width>b.x+epsilon&&a.y<b.y+b.height-epsilon&&
  a.y+f.height>b.y+epsilon&&a.elevation<b.elevation+b.depth-epsilon&&a.elevation+f.depth>b.elevation+epsilon;

export function numericFlightCost(path,step=5){
  let cost=0,diagonals=0;
  for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],dx=Math.abs(b.x-a.x),dy=Math.abs(b.y-a.y),dz=Math.abs(b.elevation-a.elevation)/step;
    const n=Math.ceil(Math.max(dx,dy,dz));
    // Proposals use grid steps; this estimate also cheaply bounds straight Dives.
    for(let j=0;j<n;j++){
      const axes=Number(dx>epsilon)+Number(dy>epsilon)+Number(dz>epsilon);
      let edge=axes>1?(++diagonals%2?step:step*2):step;
      if(b.elevation>a.elevation)edge+=step;
      else if(b.elevation<a.elevation&&dx<epsilon&&dy<epsilon)edge/=2;
      cost+=edge;
    }
  }
  return cost;
}

export function planFlightRoutes(model){
  const {origin,footprint:f,limits,budget,goals=[],occupied=[],walls=[],surfaces=[]}=model;
  if(![origin.x,origin.y,origin.elevation,budget,f.width,f.height,f.depth].every(Number.isFinite)||budget<=0)throw new Error('Invalid numeric flight snapshot');
  const wallPolygons=walls.map(w=>({...w,polygon:expandedPolygon([{x:w.x1,y:w.y1},{x:w.x2,y:w.y2}],f.width,f.height)}));
  const surfacePolygons=surfaces.map(s=>({...s,polygon:expandedPolygon(s.points,f.width,f.height)}));
  const canEnter=p=>p.x>=limits.left&&p.x<=limits.right&&p.y>=limits.top&&p.y<=limits.bottom&&
    p.elevation>=limits.low&&p.elevation<=limits.high&&!occupied.some(box=>!box.passable&&overlap(p,box,f));
  const canStop=p=>canEnter(p)&&!occupied.some(box=>overlap(p,box,f));
  const canTraverse=(a,b)=>{
    const one={x:a.x+f.width/2,y:a.y+f.height/2},two={x:b.x+f.width/2,y:b.y+f.height/2};
    const low=Math.min(a.elevation,b.elevation),high=Math.max(a.elevation,b.elevation)+f.depth;
    if(wallPolygons.some(w=>low<(w.high??Infinity)&&high>(w.low??-Infinity)&&hitsPolygon(one,two,w.polygon)))return false;
    for(const s of surfacePolygons){
      if(low>=s.elevation-epsilon||high<=s.elevation+epsilon)continue;
      const dz=b.elevation-a.elevation;
      let t0=0,t1=1;
      if(Math.abs(dz)>epsilon){const first=(s.elevation-f.depth-a.elevation)/dz,last=(s.elevation-a.elevation)/dz;
        t0=Math.max(0,Math.min(first,last));t1=Math.min(1,Math.max(first,last));}
      if(t0>=t1)continue;
      const at=t=>({x:one.x+(two.x-one.x)*t,y:one.y+(two.y-one.y)*t});
      if(hitsPolygon(at(t0),at(t1),s.polygon))return false;
    }
    return true;
  };
  const actualGoals=goals.filter(p=>p.x!==origin.x||p.y!==origin.y||p.elevation!==origin.elevation);
  const nodes=reachableFlightCells(origin,budget,{canEnter,canStop,canTraverse,goals:actualGoals,maxNodes:450,pathCost:numericFlightCost}).filter(n=>n.cost>0);
  const distance=(p,g)=>Math.max(Math.abs(p.x-g.x),Math.abs(p.y-g.y),Math.abs(p.elevation-g.elevation)/5);
  const preferred=model.preferredElevation??origin.elevation;
  const score=p=>Math.min(preferred,p.elevation)/5*2-(actualGoals.length?Math.min(...actualGoals.map(g=>distance(p,g))):0)*0.2-p.cost/100;
  const chosen=new Map(),key=p=>`${p.x},${p.y},${p.elevation}`;
  const add=p=>{if(p)chosen.set(key(p),p);};
  // Preserve altitude, per-goal routes and directional diversity before filling
  // the bounded shortlist. Exact costs and attacks are evaluated by Foundry.
  nodes.sort((a,b)=>score(b)-score(a)||a.cost-b.cost);
  nodes.slice(0,6).forEach(add);
  for(const goal of actualGoals.slice(0,12))nodes.slice().sort((a,b)=>distance(a,goal)-distance(b,goal)||a.cost-b.cost).slice(0,2).forEach(add);
  const sectors=new Set();
  for(const p of nodes){const sector=`${Math.sign(p.x-origin.x)},${Math.sign(p.y-origin.y)},${Math.sign(p.elevation-origin.elevation)}`;
    if(!sectors.has(sector)&&chosen.size<24){sectors.add(sector);add(p);}}
  for(const p of nodes){if(chosen.size>=24)break;add(p);}
  return {nodes:[...chosen.values()].slice(0,24).map(({x,y,elevation,path,cost,risk})=>({x,y,elevation,path,cost,risk})),exploredDestinations:nodes.length};
}

export function rankDiveSetups({origins,endpoints,speed,preferredElevation}){
  return origins.map(origin=>{
    const groups=new Map();
    endpoints.forEach((end,index)=>{
      const horizontal=Math.max(Math.abs(origin.x-end.point.x),Math.abs(origin.y-end.point.y))*5,drop=origin.elevation-end.point.elevation;
      const lowerBound=horizontal===0?drop/2:Math.max(horizontal,drop);
      if(drop<10||lowerBound>speed*2||
        Math.max(0,preferredElevation-end.point.elevation)*2>speed)return;
      const list=groups.get(end.enemyId)??[];
      list.push({index,value:end.value,cost:numericFlightCost([origin,end.point])});groups.set(end.enemyId,list);
    });
    return [...groups.values()].flatMap(list=>list.sort((a,b)=>b.value-a.value||a.cost-b.cost).slice(0,4).map(e=>e.index));
  });
}
