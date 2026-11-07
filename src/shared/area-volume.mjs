// Coordinates are scene distance units. Test occupied five-foot cube centers,
// rather than treating every token as a point at ground elevation.
export function pointInVolume(p,v){
 const d={x:p.x-v.origin.x,y:p.y-v.origin.y,z:p.z-v.origin.z},r=Math.hypot(d.x,d.y,d.z);
 if(v.type==='burst')return r<=v.range+0.01;
 const along=d.x*v.direction.x+d.y*v.direction.y+d.z*v.direction.z;
 if(along<0||along>v.range+0.01)return false;
 const cross=Math.sqrt(Math.max(0,r*r-along*along));
 return cross<=(v.type==='line'?2.5:along)+0.01;
}
export function boxInVolume(box,v){
 const points=(lo,hi)=>{const n=Math.max(1,Math.ceil((hi-lo)/5));return Array.from({length:n},(_,i)=>lo+(i+0.5)*(hi-lo)/n);};
 for(const x of points(box.x,box.x+box.width))for(const y of points(box.y,box.y+box.height))for(const z of points(box.z,box.z+box.depth))
  if(pointInVolume({x,y,z},v))return true;
 return false;
}
export function volumeProjection(v,scale){
 if(v.type==='burst')return {type:'ellipse',x:v.origin.x/scale,y:v.origin.y/scale,radiusX:v.range/scale,radiusY:v.range/scale,rotation:0,hole:false};
 const d=v.direction,normal=Math.abs(d.z)<0.9?{x:0,y:0,z:1}:{x:1,y:0,z:0},u0={x:d.y*normal.z-d.z*normal.y,y:d.z*normal.x-d.x*normal.z,z:d.x*normal.y-d.y*normal.x},len=Math.hypot(u0.x,u0.y,u0.z),u={x:u0.x/len,y:u0.y/len,z:u0.z/len},w={x:d.y*u.z-d.z*u.y,y:d.z*u.x-d.x*u.z,z:d.x*u.y-d.y*u.x},points=[];
 for(const end of [0,v.range])for(let i=0;i<24;i++){const a=i*Math.PI/12,r=v.type==='line'?2.5:end;points.push({x:(v.origin.x+d.x*end+r*(u.x*Math.cos(a)+w.x*Math.sin(a)))/scale,y:(v.origin.y+d.y*end+r*(u.y*Math.cos(a)+w.y*Math.sin(a)))/scale});}
 points.sort((a,b)=>a.x-b.x||a.y-b.y);const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x),half=list=>{const h=[];for(const p of list){while(h.length>=2&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}h.pop();return h;};
 const hull=[...half(points),...half([...points].reverse())];return {type:'polygon',points:hull.flatMap(p=>[p.x,p.y]),hole:false};
}
