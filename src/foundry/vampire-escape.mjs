import {vampireState} from './vampire-state.mjs';
import {MANAGED_MOVEMENT} from './movement-options.mjs';
const ns='foundry-creature-ai';
// Bounded A* to a real scene edge. Only native wall/surface geometry is used;
// no opponent positions or attack plans are consulted by damage-immune mist.
export function mistEscapeRoute(token,{limit=4096,speed=10,edge=null}={}){
 const size=canvas.grid.size,rect=canvas.dimensions.sceneRect,w=token.document.width,h=token.document.height;
 const left=Math.ceil(rect.x/size),top=Math.ceil(rect.y/size),right=Math.floor((rect.x+rect.width)/size)-w,bottom=Math.floor((rect.y+rect.height)/size)-h;
 const start={x:Math.round(token.document.x/size),y:Math.round(token.document.y/size),diagonals:0,cost:0,path:[]};
 const distance=p=>edge==='left'?p.x-left:edge==='right'?right-p.x:edge==='top'?p.y-top:edge==='bottom'?bottom-p.y:
  Math.min(p.x-left,right-p.x,p.y-top,bottom-p.y);
 if(distance(start)<=0)return {atEdge:true,path:[],cost:0,totalCost:0,edge,goal:{x:start.x,y:start.y}};
 const queue=[start],best=new Map();let visits=0;
 while(queue.length&&visits++<limit){queue.sort((a,b)=>a.cost+5*distance(a)-b.cost-5*distance(b));const current=queue.shift();
  if(distance(current)===0){let cost=0,diagonals=0;const path=[];let previous=start;
   for(const point of current.path){const diagonal=point.x!==previous.x&&point.y!==previous.y,step=diagonal?(++diagonals%2?5:10):5;
    if(cost+step>speed)break;cost+=step;path.push(point);previous=point;}return {path,cost,totalCost:current.cost,atEdge:false,edge,goal:{x:current.x,y:current.y}};}
  for(const dx of [-1,0,1])for(const dy of [-1,0,1]){if(!dx&&!dy)continue;
   const p={x:current.x+dx,y:current.y+dy},diagonals=current.diagonals+Number(Boolean(dx&&dy));
   if(p.x<left||p.x>right||p.y<top||p.y>bottom)continue;
   const from={x:current.x*size+token.w/2,y:current.y*size+token.h/2,elevation:token.document.elevation},to={x:p.x*size+token.w/2,y:p.y*size+token.h/2,elevation:token.document.elevation};
   if(token.checkCollision(to,{origin:from,type:'move',mode:'any'})||token.document.parent.testSurfaceCollision?.(from,to,{type:'move',mode:'any',level:token.document.level}))continue;
   const cost=current.cost+(dx&&dy?(diagonals%2?5:10):5),key=`${p.x},${p.y},${diagonals%2}`;
   if((best.get(key)??Infinity)<=cost)continue;best.set(key,cost);queue.push({...p,cost,diagonals,path:[...current.path,p]});
  }
 }
 return {path:[],cost:0,blocked:true,edge};
}
export async function executeMistEscape(adapter,choice){
 if(choice.kind==='escapeScene'){
  await adapter.actor.setFlag(ns,'vampire',{...vampireState(adapter.actor),escaped:true});
  return {resolved:true,retreatComplete:true,note:'Mist reached the scene border and escaped toward its coffin.'};
 }
 const points=choice.path.map(p=>({x:p.x*canvas.grid.size,y:p.y*canvas.grid.size,elevation:adapter.token.document.elevation,level:adapter.token.document.level,action:'fly',snapped:true}));
 const completed=await adapter.token.document.move(points,{[MANAGED_MOVEMENT]:true,[`${ns}:ignore-action-restrictions`]:true,showRuler:true});
 await adapter.waitForMovement();
 return {resolved:true,destination:adapter.originCell(),note:completed?'Mist flies toward the scene border.':'Mist movement was constrained; the next action replans from the actual square.'};
}
