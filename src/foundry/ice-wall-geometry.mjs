const ns='foundry-creature-ai';
export function segmentHitsBox(from,to,box){
 let lo=0,hi=1;
 for(const [axis,min,max]of [['x',box.x,box.x+box.width],['y',box.y,box.y+box.height],['elevation',box.bottom,box.top]]){
  const a=from[axis]??0,d=(to[axis]??0)-a;
  if(Math.abs(d)<1e-7){if(a<min||a>=max)return false;continue;}
  const t=(min-a)/d,u=(max-a)/d;lo=Math.max(lo,Math.min(t,u));hi=Math.min(hi,Math.max(t,u));if(hi<lo)return false;
 }return hi>1e-6&&lo<1-1e-6;
}
export function iceBlocksRay(scene,from,to,level){
 return (scene?.regions?.contents??[]).some(r=>!r.hidden&&(!r.includedInLevel||r.includedInLevel(level))&&r.flags?.[ns]?.iceWall?.segments.some(s=>s.hp>0&&segmentHitsBox(from,to,s)));
}
export function iceBlocksMovement(token,from,to,height=5){
 const size=token.document.parent?.grid?.size??globalThis.canvas?.grid?.size??1,w=token.document.width*size,h=token.document.height*size,
  a={...from,x:from.x+w/2,y:from.y+h/2},b={...to,x:to.x+w/2,y:to.y+h/2};
 return (token.document.parent?.regions?.contents??[]).some(r=>!r.hidden&&r.flags?.[ns]?.iceWall?.segments.some(s=>s.hp>0&&segmentHitsBox(a,b,{...s,x:s.x-w/2+0.01,y:s.y-h/2+0.01,width:s.width+w-0.02,height:s.height+h-0.02,bottom:s.bottom-height+0.01})));
}
