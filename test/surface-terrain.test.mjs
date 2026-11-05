import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/pyro-fixture.mjs';
import {surfaceMovementPath} from '../src/foundry/surface-terrain.mjs';
import {ManualMovement} from '../src/foundry/manual-movement.mjs';
import {installHazardMovement} from '../src/foundry/hazardous-terrain.mjs';
import {REQUESTED_MOVEMENT} from '../src/foundry/movement-options.mjs';
const ns='foundry-creature-ai';
function setup(){
 const f=fixture();canvas.scene.grid=canvas.grid;
 f.boss.document.width=f.boss.document.height=1;
 f.boss.document.movementAction='walk';
 f.boss.document.getCompleteMovementPath=points=>{
  const out=[points[0]];
  for(const point of points.slice(1)){
   const start=out.at(-1),steps=Math.ceil(Math.max(Math.abs(point.x-start.x),Math.abs(point.y-start.y))/100);
   for(let i=1;i<=steps;i++)out.push({...point,x:start.x+(point.x-start.x)*i/steps,y:start.y+(point.y-start.y)*i/steps});
  }
  return out;
 };
 const add=(shape,flag,elevation)=>canvas.scene.regions.contents.push(new f.Region({shapes:[shape],elevation,flags:{[ns]:flag}},{parent:canvas.scene}));
 add({type:'rectangle',x:400,y:100,width:200,height:300},{platform:{elevation:10}},{bottom:10,top:10.1});
 add({type:'rectangle',x:200,y:100,width:200,height:300},{ramp:{from:{x:200,y:250,elevation:0},to:{x:400,y:250,elevation:10}}},{bottom:0,top:15});
 const point=(x,elevation=0,y=200)=>({x,y,elevation,level:'ground',action:'walk',snapped:true});
 Object.assign(f.boss.document,point(100));
 return {...f,point};
}
test('walking a ramp reaches its platform at the annotated elevation',()=>{
 const f=setup(),path=surfaceMovementPath(f.boss.document,[f.point(500)]);
 assert.ok(path);assert.equal(path.at(-1).elevation,10);
 assert.deepEqual(path.filter(p=>!p.intermediate).map(p=>[p.x,p.elevation]),[[100,0],[200,2.5],[300,7.5],[400,10],[500,10]]);
 assert.ok(path.some(p=>p.x===350&&p.elevation===10),'the foot reaches deck height at its boundary');
});
test('walking down a ramp returns to the ground without teleporting or a roll',()=>{
 const f=setup();Object.assign(f.boss.document,f.point(500,10));
 const path=surfaceMovementPath(f.boss.document,[f.point(100,10)]);
 assert.equal(path.at(-1).elevation,0);
 assert.ok(path.some(p=>p.x===150&&p.elevation===0));assert.equal(f.calls.length,0);
});
test('a creature can continue a later move from the middle of a ramp',()=>{
 const f=setup();Object.assign(f.boss.document,f.point(300,7.5));
 const path=surfaceMovementPath(f.boss.document,[f.point(500,7.5)]);
 assert.equal(path.at(-1).elevation,10);
});
test('moving beneath a deck does not raise a creature without a ramp',()=>{
 const f=setup();Object.assign(f.boss.document,f.point(500,0,500));
 assert.equal(surfaceMovementPath(f.boss.document,[f.point(500,0,200)]),null);
});
test('walking off a raised deck without a ramp is rejected',()=>{
 const f=setup();Object.assign(f.boss.document,f.point(500,10));
 assert.throws(()=>surfaceMovementPath(f.boss.document,[f.point(700,10)]),/Use a ramp/);
});
test('flying, forced displacement and undo do not get recast as ramp walking',()=>{
 const f=setup();
 for(const action of ['fly','displace','climb'])assert.equal(surfaceMovementPath(f.boss.document,[{...f.point(500),action}]),null);
 assert.equal(surfaceMovementPath(f.boss.document,[f.point(500)],{isUndo:true}),null);
});
test('manual movement accepts the owned elevation profile but keeps unrelated elevation changes manual',()=>{
 const f=setup(),movement=new ManualMovement(null);
 const path=movement.path(f.boss,[f.point(100),f.point(500)]);
 assert.equal(path.at(-1).elevation,10);
 assert.ok(path.some(p=>p.intermediate&&p.x===350));
 canvas.scene.regions.contents=[];
 assert.throws(()=>movement.path(f.boss,[f.point(100),f.point(500,10)]),/one elevation/);
});
test('native pre-update inserts ramp elevations before collision testing while retaining walls and costs',async()=>{
 const f=setup();let wrapper;
 globalThis.libWrapper={register:(id,name,fn)=>{wrapper=fn;}};installHazardMovement();
 const options={constrainOptions:{ignoreWalls:false,maxCost:25}};
 await wrapper.call(f.boss.document,(changed,op)=>{
  assert.equal(op.movement[f.boss.id].waypoints.at(-1).elevation,10);
  assert.ok(op.movement[f.boss.id].waypoints.every(p=>p.intermediate===false),'native continuations retain each required slope corner');
  assert.ok(op.movement[f.boss.id].waypoints.every(p=>p.explicit!==true),'generated corners do not change native measurement intent');
  assert.equal(op[REQUESTED_MOVEMENT].at(-1).elevation,10);
  assert.deepEqual(op.constrainOptions,{ignoreWalls:false,maxCost:25});
 },{x:500,y:200},options,game.user);
});
