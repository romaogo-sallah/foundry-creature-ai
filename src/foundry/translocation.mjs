import {tokenAt,distanceToPosition} from './vertical-geometry.mjs';
import {clearTeleportSight,teleportSpaceClear} from './teleport-geometry.mjs';
import {MANAGED_MOVEMENT} from './movement-options.mjs';
function* translocationSteps(adapter,state){
 const source=adapter.token,size=canvas.grid.size,result=[],seen=new Set();
 for(const feet of [5,10,15,20,30,60,90,120])for(let i=0;i<16;i++){
  yield;
  const a=i*Math.PI/8,p={x:Math.round((source.document.x+Math.cos(a)*feet/5*size)/size)*size,y:Math.round((source.document.y+Math.sin(a)*feet/5*size)/size)*size,elevation:source.document.elevation,level:source.document.level};
  const key=`${p.x},${p.y}`;if(seen.has(key))continue;seen.add(key);
  const proxy=tokenAt(source,p);if(source.distanceTo(proxy)>120||!clearTeleportSight(source,proxy)||!teleportSpaceClear(source,p))continue;
  const nearest=Math.min(Infinity,...state.enemies.map(e=>distanceToPosition(source,adapter.perceivedTarget(e),p))),before=state.nearestEnemy??Math.min(Infinity,...state.enemies.map(e=>e.distance)),
   value=Math.min(15,Math.max(0,nearest-before)*0.3)+(state.self.threatened&&nearest>=30?8:0);
  if(value>0)result.push({position:p,value});
 }
 return result.sort((a,b)=>b.value-a.value).slice(0,4);
}
export function translocationDestinations(...args){const iterator=translocationSteps(...args);let step;do{step=iterator.next();}while(!step.done);return step.value;}
export async function translocationDestinationsAsync(adapter,state,budget){const iterator=translocationSteps(adapter,state);let step;do{await budget?.checkpoint();step=iterator.next();}while(!step.done);return step.value;}
export function canTranslocate(adapter,spell,choice){
 const p=choice.destination,range=Number.parseFloat(spell.system.range.value);
 if(!teleportSpaceClear(adapter.token,p)||!Number.isFinite(range))return false;
 const proxy=tokenAt(adapter.token,p);
 return adapter.token.distanceTo(proxy)<=range&&clearTeleportSight(adapter.token,proxy);
}
export async function executeTranslocate(adapter,spell,choice){
 // Recheck the exact endpoint, independently of the planner's shortlist/rank.
 const p=choice.destination;
 if(!canTranslocate(adapter,spell,choice))return {resolved:true,note:'The teleport destination became unavailable; its actions and slot remain spent.'};
 await adapter.token.document.move([{...p,action:'displace',snapped:true}],{[MANAGED_MOVEMENT]:true,showRuler:false,constrainOptions:{ignoreWalls:true,ignoreCost:true}});
 return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id},note:'Translocated to a visible unoccupied position without traversing intervening squares.'};
}
