export const PIT_BEHAVIOR_TYPE='pf2e-tactical-movement.pit';
const ns='foundry-creature-ai';
export function pitConfig(region){
 if(region.hidden)return null;
 const behavior=(region.behaviors?.contents??region.behaviors??[]).find(b=>b.type===PIT_BEHAVIOR_TYPE);
 const value=behavior?(behavior.disabled?null:behavior.system):region.flags?.[ns]?.pit;
 if(!value)return null;
 return {rim:Number(value.rim??0),depth:Math.max(5,Number(value.depth??10)),climbDC:Math.max(0,Number(value.climbDC??20))};
}
// Region bounds padded by a pixel, so points on an edge stay in. Null when the Region cannot report bounds,
// which keeps the full per-point test. Region.testPoint is false outside its bounds.
function regionBox(region){
 let b=null;try{b=region.bounds;}catch{b=null;}
 return b&&[b.x,b.y,b.width,b.height].every(Number.isFinite)?{x0:b.x-1,y0:b.y-1,x1:b.x+b.width+1,y1:b.y+b.height+1}:null;
}
const inBox=(box,p)=>!box||p.x>=box.x0&&p.x<=box.x1&&p.y>=box.y0&&p.y<=box.y1;
// Whether the segment from a to b touches the box (Liang-Barsky clipping).
function segmentTouchesBox(a,b,box){
 let t0=0,t1=1;const dx=b.x-a.x,dy=b.y-a.y;
 for(const [p,q] of [[-dx,a.x-box.x0],[dx,box.x1-a.x],[-dy,a.y-box.y0],[dy,box.y1-a.y]]){
  if(p===0){if(q<0)return false;continue;}
  const r=q/p;
  if(p<0){if(r>t1)return false;if(r>t0)t0=r;}else{if(r<t0)return false;if(r<t1)t1=r;}
 }
 return true;
}
function scenePits(scene){
 return (scene?.regions?.contents??[]).flatMap(region=>{const config=pitConfig(region);return config?[{region,config,box:regionBox(region)}]:[];});
}
function pitAmong(pits,level,point){
 return pits.flatMap(({region,config,box})=>{
  if(region.includedInLevel&&!region.includedInLevel(level)||!inBox(box,point))return [];
  const bottom=region.elevation?.bottom,top=region.elevation?.top;
  return region.testPoint({...point,elevation:Number.isFinite(bottom)?bottom+(Number.isFinite(top)?top-bottom:0)/2:config.rim-1})?[{region,...config,bottom:config.rim-config.depth}]:[];
 }).sort((a,b)=>a.bottom-b.bottom)[0]??null;
}
export function pitAt(document,position=document._source??document){
 const pits=scenePits(document.parent);if(!pits.length)return null;
 const size=document.parent?.grid?.size??globalThis.canvas?.grid?.size??1,point={x:position.x+document.width*size/2,y:position.y+document.height*size/2};
 return pitAmong(pits,position.level??document.level,point);
}
export function pitWalkable(document,position){
 const before=pitAt(document),after=pitAt(document,position),z=document.elevation;
 if(before&&z<before.rim-0.1)return before.region.id===after?.region.id;
 return !after||z<after.rim-0.1||z>after.rim+0.1;
}
export function pitBlocksRay(observer,target,from,to){
 const scene=observer.document.parent,pits=scenePits(scene);
 if(!pits.length)return false;
 // A ray that misses every pit's bounds has no sample inside a pit, so it cannot cross a pit wall.
 if(pits.every(pit=>pit.box&&!segmentTouchesBox(from,to,pit.box)))return false;
 const scale=scene?.grid?.size??canvas.grid.size,n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/(scale/4)));
 let previous=null;
 for(let i=0;i<=n;i++){
  const f=i/n,p={x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f,elevation:(from.elevation??0)+((to.elevation??0)-(from.elevation??0))*f},
   pit=pitAmong(pits,observer.document.level,p);
  if(i>0&&previous?.region.id!==pit?.region.id){const edge=previous??pit;if(edge&&p.elevation<edge.rim-0.01&&p.elevation>edge.bottom+0.01)return true;}
  previous=pit;
 }
 return false;
}
