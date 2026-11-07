export const PIT_BEHAVIOR_TYPE='pf2e-tactical-movement.pit';
const ns='foundry-creature-ai';
export function pitConfig(region){
 if(region.hidden)return null;
 const behavior=(region.behaviors?.contents??region.behaviors??[]).find(b=>b.type===PIT_BEHAVIOR_TYPE);
 const value=behavior?(behavior.disabled?null:behavior.system):region.flags?.[ns]?.pit;
 if(!value)return null;
 return {rim:Number(value.rim??0),depth:Math.max(5,Number(value.depth??10)),climbDC:Math.max(0,Number(value.climbDC??20))};
}
export function pitAt(document,position=document._source??document){
 if(!(document.parent?.regions?.contents??[]).some(pitConfig))return null;
 const size=document.parent?.grid?.size??globalThis.canvas?.grid?.size??1,point={x:position.x+document.width*size/2,y:position.y+document.height*size/2};
 return (document.parent?.regions?.contents??[]).flatMap(region=>{
  const config=pitConfig(region);if(!config||region.includedInLevel&&!region.includedInLevel(position.level??document.level))return [];
  const bottom=region.elevation?.bottom,top=region.elevation?.top;
  return region.testPoint({...point,elevation:Number.isFinite(bottom)?bottom+(Number.isFinite(top)?top-bottom:0)/2:config.rim-1})?[{region,...config,bottom:config.rim-config.depth}]:[];
 }).sort((a,b)=>a.bottom-b.bottom)[0]??null;
}
export function pitWalkable(document,position){
 const before=pitAt(document),after=pitAt(document,position),z=document.elevation;
 if(before&&z<before.rim-0.1)return before.region.id===after?.region.id;
 return !after||z<after.rim-0.1||z>after.rim+0.1;
}
export function pitBlocksRay(observer,target,from,to){
 if(!(observer.document.parent?.regions?.contents??[]).some(pitConfig))return false;
 const scale=observer.document.parent?.grid?.size??canvas.grid.size,n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/(scale/4)));
 let previous=null;
 for(let i=0;i<=n;i++){
  const f=i/n,p={x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f,elevation:(from.elevation??0)+((to.elevation??0)-(from.elevation??0))*f},
   proxy={width:0,height:0,parent:observer.document.parent,level:observer.document.level},pit=pitAt(proxy,p);
  if(i>0&&previous?.region.id!==pit?.region.id){const edge=previous??pit;if(edge&&p.elevation<edge.rim-0.01&&p.elevation>edge.bottom+0.01)return true;}
  previous=pit;
 }
 return false;
}
