import test from 'node:test';
import assert from 'node:assert/strict';
import {pitAt,pitBlocksRay,pitConfig,PIT_BEHAVIOR_TYPE} from '../src/foundry/pit-geometry.mjs';

// The implementation before the bounds prefilter, kept here as the reference.
function referencePitAt(document,position=document._source??document){
 if(!(document.parent?.regions?.contents??[]).some(pitConfig))return null;
 const size=document.parent?.grid?.size??1,point={x:position.x+document.width*size/2,y:position.y+document.height*size/2};
 return (document.parent?.regions?.contents??[]).flatMap(region=>{
  const config=pitConfig(region);if(!config||region.includedInLevel&&!region.includedInLevel(position.level??document.level))return [];
  const bottom=region.elevation?.bottom,top=region.elevation?.top;
  return region.testPoint({...point,elevation:Number.isFinite(bottom)?bottom+(Number.isFinite(top)?top-bottom:0)/2:config.rim-1})?[{region,...config,bottom:config.rim-config.depth}]:[];
 }).sort((a,b)=>a.bottom-b.bottom)[0]??null;
}
function referencePitBlocksRay(observer,target,from,to){
 if(!(observer.document.parent?.regions?.contents??[]).some(pitConfig))return false;
 const scale=observer.document.parent.grid.size,n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/(scale/4)));
 let previous=null;
 for(let i=0;i<=n;i++){
  const f=i/n,p={x:from.x+(to.x-from.x)*f,y:from.y+(to.y-from.y)*f,elevation:(from.elevation??0)+((to.elevation??0)-(from.elevation??0))*f},
   proxy={width:0,height:0,parent:observer.document.parent,level:observer.document.level},pit=referencePitAt(proxy,p);
  if(i>0&&previous?.region.id!==pit?.region.id){const edge=previous??pit;if(edge&&p.elevation<edge.rim-0.01&&p.elevation>edge.bottom+0.01)return true;}
  previous=pit;
 }
 return false;
}

function random(seed){let s=seed>>>0;return()=>((s=Math.imul(s^s>>>15,1|s)+0x6D2B79F5>>>0)/4294967296);}
const pit=(id,x,y,w,h,{rim=0,depth=10,round=false,bounds=true,level}={})=>({id,elevation:{bottom:rim-depth,top:rim+1},
 behaviors:{contents:[{type:PIT_BEHAVIOR_TYPE,system:{rim,depth,climbDC:20}}]},
 ...(bounds?{bounds:{x,y,width:w,height:h}}:{}),
 ...(level?{includedInLevel:l=>l===level}:{}),
 testPoint:p=>{if(p.elevation<rim-depth||p.elevation>=rim+1)return false;
  if(round){const cx=x+w/2,cy=y+h/2;return((p.x-cx)/(w/2))**2+((p.y-cy)/(h/2))**2<=1;}
  return p.x>=x&&p.x<x+w&&p.y>=y&&p.y<y+h;}});
function scene(regions){
 const s={grid:{size:100,distance:5},regions:{contents:regions}};
 const token=level=>({document:{parent:s,level,width:1,height:1,x:0,y:0}});
 return {s,token};
}

test('the bounds prefilter gives the same pit ray answers as sampling every point',()=>{
 const rand=random(7);
 const regions=[pit('a',1000,1000,200,200),pit('b',2500,600,300,300,{round:true}),pit('c',600,2400,200,300,{rim:5,depth:15}),
  pit('d',3000,2000,200,200,{bounds:false}),pit('e',1800,1800,100,100,{level:'upper'}),
  {id:'plain',behaviors:{contents:[]},bounds:{x:0,y:0,width:100,height:100},testPoint:()=>true}];
 const {token}=scene(regions);
 let blocked=0;
 for(let i=0;i<3000;i++){
  const observer=token(rand()<0.2?'upper':undefined),target=token();
  const from={x:rand()*4000,y:rand()*3000,elevation:-15+rand()*30},to={x:rand()*4000,y:rand()*3000,elevation:-15+rand()*30};
  const expected=referencePitBlocksRay(observer,target,from,to);
  assert.equal(pitBlocksRay(observer,target,from,to),expected,JSON.stringify({from,to,level:observer.document.level}));
  if(expected)blocked++;
 }
 assert.ok(blocked>20,`only ${blocked} blocked rays were exercised`);
});

test('pitAt finds the same pit with and without bounds',()=>{
 const rand=random(11);
 const regions=[pit('a',1000,1000,200,200),pit('deep',1000,1000,100,100,{depth:20}),pit('b',2500,600,300,300,{round:true,bounds:false})];
 const {s}=scene(regions);
 for(let i=0;i<2000;i++){
  const document={parent:s,width:1,height:1,level:undefined},position={x:rand()*3000-50,y:rand()*2000-50};
  assert.equal(pitAt(document,position)?.region.id,referencePitAt(document,position)?.region.id);
 }
});

test('a scene without pits never blocks a ray',()=>{
 const {token}=scene([{id:'plain',behaviors:{contents:[]},testPoint:()=>true}]);
 assert.equal(pitBlocksRay(token(),token(),{x:0,y:0,elevation:-5},{x:900,y:900,elevation:0}),false);
});
