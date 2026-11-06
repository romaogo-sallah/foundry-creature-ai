export function installSpellRegionFixture(tokens){
 class Region{
  constructor(data){Object.assign(this,data);this.id='preview';}
  testPoint(p){return this.shapes.some(s=>{
   if(s.type==='rectangle')return p.x>=s.x&&p.x<s.x+s.width&&p.y>=s.y&&p.y<s.y+s.height;
   if(s.type==='ellipse')return ((p.x-s.x)/s.radiusX)**2+((p.y-s.y)/s.radiusY)**2<=1;
   if(s.type==='polygon'){let inside=false,a=s.points;for(let i=0,j=a.length-2;i<a.length;j=i,i+=2)if((a[i+1]>p.y)!==(a[j+1]>p.y)&&p.x<(a[j]-a[i])*(p.y-a[i+1])/(a[j+1]-a[i+1])+a[i])inside=!inside;return inside;}
   const dx=p.x-s.x,dy=p.y-s.y,angle=Math.atan2(dy,dx)*180/Math.PI;
   return Math.hypot(dx,dy)<=s.radius&&Math.abs(((angle-s.rotation+540)%360)-180)<=45;
  });}
 }
 CONFIG.Region={documentClass:Region};
 for(const token of tokens)token.document.testInsideRegion=(region,position={})=>{
  if(region.levels?.length&&!region.levels.includes(position.level??token.document.level))return false;
  if(region.elevation&&Math.abs((position.elevation??token.document.elevation)-region.elevation.bottom)>0.1)return false;
  for(let x=0;x<token.document.width;x++)for(let y=0;y<token.document.height;y++)if(region.testPoint({x:(position.x??token.document.x)+(x+0.5)*canvas.grid.size,y:(position.y??token.document.y)+(y+0.5)*canvas.grid.size}))return true;return false;
 };
}
