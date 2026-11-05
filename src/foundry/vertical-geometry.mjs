import {tokenRayPoint} from './attack-path.mjs';

export const tokenHeight=token=>token.actor?.dimensions?.height??(token.document.depth??token.document.height??1)*(canvas.grid?.distance??5);
export function tokenAt(token,position){
  const source=token.document._source??token.document,point={...source,...position};
  point.width??=token.w/canvas.grid.size||1;point.height??=token.h/canvas.grid.size||1;
  const document={...point,parent:token.document.parent};
  for(const method of ['getMovementOrigin','getVisionOrigin'])if(typeof token.document[method]==='function')
    document[method]=()=>token.document[method](point);
  const size=canvas.grid.size,w=point.width*size,h=point.height*size;
  return {id:token.id,name:token.name,actor:token.actor,document,w,h,
    center:{x:point.x+w/2,y:point.y+h/2},mechanicalBounds:new PIXI.Rectangle(point.x,point.y,w,h)};
}
export function rayAt(token,position,type='sight'){
  const current=token.document._source??token.document,native=tokenRayPoint(token,type);
  return {x:position.x+canvas.grid.size*token.document.width/2,y:position.y+canvas.grid.size*token.document.height/2,
    elevation:(position.elevation??current.elevation)+native.elevation-current.elevation};
}
export function distanceToPosition(token,target,position,reach){
  const source=token.document._source??token.document;
  const proxy=['x','y','elevation'].every(key=>(position[key]??source[key])===source[key])?token:tokenAt(token,position);
  const native=typeof target.distanceTo==='function'?target.distanceTo(proxy,{reach}):token.distanceTo.call(proxy,target,{reach});
  // Native PF2e measures cuboids in 3D. Keep a vertical lower bound for geometry
  // proxies supplied by other modules that implement only 2D distanceTo.
  const a=proxy.document.elevation,b=target.document.elevation,ah=tokenHeight(proxy),bh=tokenHeight(target);
  const step=canvas.grid?.distance??5;
  const lowA=Math.floor(a/step)*step,lowB=Math.floor(b/step)*step,highA=Math.ceil((a+ah)/step)*step,highB=Math.ceil((b+bh)/step)*step;
  const gap=lowA>=highB?lowA-highB:lowB>=highA?lowB-highA:-1;
  return Math.max(native,gap<0?0:(Math.ceil(gap/step)+1)*step);
}
export function volumesOverlap(one,two,{acrossLevels=false}={}){
  const a=one.document,b=two.document;
  return (acrossLevels||a.level===b.level)&&a.elevation<b.elevation+tokenHeight(two)&&a.elevation+tokenHeight(one)>b.elevation&&
    a.x< b.x+two.w&&a.x+one.w>b.x&&a.y<b.y+two.h&&a.y+one.h>b.y;
}
