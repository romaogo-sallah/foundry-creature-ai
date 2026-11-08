import {tokenAt,distanceToPosition} from './vertical-geometry.mjs';
import {clearSightPath} from './attack-path.mjs';
import {pitAt} from './pit-geometry.mjs';
import {MANAGED_MOVEMENT} from './movement-options.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
function* translocationSteps(adapter,state){
 const source=adapter.token,size=canvas.grid.size,rect=canvas.dimensions.sceneRect,result=[];
 for(const feet of [30,60,90,120])for(let i=0;i<16;i++){
  yield;
  const a=i*Math.PI/8,p={x:Math.round((source.document.x+Math.cos(a)*feet/5*size)/size)*size,y:Math.round((source.document.y+Math.sin(a)*feet/5*size)/size)*size,elevation:source.document.elevation,level:source.document.level};
  if(!rect.contains(p.x,p.y)||!rect.contains(p.x+source.w-1,p.y+source.h-1)||pitAt(source.document,p)||
   canvas.tokens.placeables.some(t=>t!==source&&occupiesMovementSpace(t)&&t.document.elevation===p.elevation&&p.x<t.document.x+t.w&&p.x+source.w>t.document.x&&p.y<t.document.y+t.h&&p.y+source.h>t.document.y))continue;
  const proxy=tokenAt(source,p);if(source.distanceTo(proxy)>120||!clearSightPath(source,proxy))continue;
  const nearest=Math.min(Infinity,...state.enemies.map(e=>distanceToPosition(source,adapter.perceivedTarget(e),p))),before=state.nearestEnemy??Math.min(Infinity,...state.enemies.map(e=>e.distance)),
   value=Math.min(15,Math.max(0,nearest-before)*0.3)+(state.self.threatened&&nearest>=30?8:0);
  if(value>0)result.push({position:p,value});
 }
 return result.sort((a,b)=>b.value-a.value).slice(0,4);
}
export function translocationDestinations(...args){const iterator=translocationSteps(...args);let step;do{step=iterator.next();}while(!step.done);return step.value;}
export async function translocationDestinationsAsync(adapter,state,budget){const iterator=translocationSteps(adapter,state);let step;do{await budget?.checkpoint();step=iterator.next();}while(!step.done);return step.value;}
export async function executeTranslocate(adapter,spell,choice){
 // Recheck the exact endpoint, independently of the planner's shortlist/rank.
 const p=choice.destination,proxy=p&&tokenAt(adapter.token,p);
 if(!proxy||pitAt(adapter.token.document,p)||adapter.token.distanceTo(proxy)>Number.parseFloat(spell.system.range.value)||!clearSightPath(adapter.token,proxy)||
  canvas.tokens.placeables.some(t=>t!==adapter.token&&occupiesMovementSpace(t)&&t.document.elevation===p.elevation&&p.x<t.document.x+t.w&&p.x+adapter.token.w>t.document.x&&p.y<t.document.y+t.h&&p.y+adapter.token.h>t.document.y))return {resolved:true,note:'The teleport destination became unavailable; its actions and slot remain spent.'};
 await adapter.token.document.move([{...p,action:'displace',snapped:true}],{[MANAGED_MOVEMENT]:true,showRuler:false,constrainOptions:{ignoreWalls:true,ignoreCost:true}});
 return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id},note:'Translocated to a visible unoccupied position without traversing intervening squares.'};
}
