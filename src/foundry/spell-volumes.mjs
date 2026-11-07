import {boxInVolume,volumeProjection} from '../shared/area-volume.mjs';
import {tokenHeight} from './vertical-geometry.mjs';
export function volumeContains(token,volume,position=token.document){
 const unit=canvas.dimensions.distance??canvas.grid.distance??5,scale=unit/canvas.grid.size;
 return boxInVolume({x:position.x*scale,y:position.y*scale,z:position.elevation??token.document.elevation,
  width:token.document.width*unit,height:token.document.height*unit,depth:tokenHeight(token)},volume);
}
export function volumeAreas(adapter,spell,enemies,position=adapter.actualWaypoint()){
 const unit=canvas.dimensions.distance??canvas.grid.distance??5,size=canvas.grid.size,scale=unit/size,caster=adapter.token,
  center={x:(position.x+caster.w/2)*scale,y:(position.y+caster.h/2)*scale,z:(position.elevation??caster.document.elevation)+tokenHeight(caster)/2},result=new Map();
 for(const enemy of enemies.filter(e=>e.awareness?.detection!=='undetected'&&e.lineOfSight!==false)){
  const token=adapter.perceivedSpellTarget(enemy),p=token.document,
   target={x:token.center.x*scale,y:token.center.y*scale,z:p.elevation+tokenHeight(token)/2};
  if(spell.area.type==='burst'){
   if(Math.hypot(target.x-center.x,target.y-center.y,target.z-center.z)>spell.range)continue;
   const key=`burst:${target.x},${target.y},${target.z}`;
   result.set(key,{id:key,volume:{type:'burst',origin:target,range:spell.area.value},shapes:[{type:'ellipse',x:target.x/scale,y:target.y/scale,radiusX:spell.area.value/scale,radiusY:spell.area.value/scale,rotation:0,hole:false}]});
  }else{
   const dx=target.x-center.x,dy=target.y-center.y,dz=target.z-center.z,length=Math.hypot(dx,dy,dz);if(!length)continue;
   const direction={x:dx/length,y:dy/length,z:dz/length},offset=Math.min(caster.document.width,caster.document.height)*unit/2,
    origin={x:center.x+direction.x*offset,y:center.y+direction.y*offset,z:center.z+direction.z*Math.min(offset,tokenHeight(caster)/2)},key=`${spell.area.type}:${enemy.id}`;
   result.set(key,{id:key,volume:{type:spell.area.type,origin,direction,range:spell.area.value},shapes:[{type:'cone',x:origin.x/scale,y:origin.y/scale,radius:spell.area.value/scale,angle:spell.area.type==='line'?5:90,rotation:Math.atan2(dy,dx)*180/Math.PI,gridBased:false}]});
  }
 }
 return [...result.values()].map(a=>({...a,shapes:[volumeProjection(a.volume,scale)]}));
}
