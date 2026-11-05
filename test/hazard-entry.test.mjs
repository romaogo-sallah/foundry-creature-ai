import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { hazardousMovementPath, installHazardMovement, hazardUnits, createHazardHandler } from '../src/foundry/hazardous-terrain.mjs';
import { hazardBehavior } from '../src/foundry/terrain-contract.mjs';
import { REQUESTED_MOVEMENT } from '../src/foundry/movement-options.mjs';

let sequence=0;
function setup({footprint=1,frequency='per5'}={}){
  const f=fixture({footprint}),token=f.boss.document,behavior={...hazardBehavior({frequency}),id:'behavior'};
  const region={id:`hazard-${++sequence}`,name:'Cactus',hidden:false,levels:new Set(['ground']),behaviors:{contents:[behavior]},
    testPoint:p=>p.x>=300&&p.x<600&&p.y>=200&&p.y<500};
  canvas.scene.regions.contents.push(region);
  token.movementAction='walk';token.name='Mover';
  const point=(x,y=200,extra={})=>({x,y,elevation:0,level:'ground',width:footprint,height:footprint,depth:1,action:'walk',snapped:true,...extra});
  const move=(from,to,{distance=5,cost=5,id=`move-${sequence}`,name='tokenMoveWithin'}={})=>({name,user:game.user,data:{token,
    movement:{id,subpathId:`action-${sequence}`,origin:from,destination:to,method:'api',passed:{distance,cost,waypoints:[to]}}}});
  const nativePath=[point(200),point(300),point(400),point(500),point(600),point(700)];
  token.getCompleteMovementPath=()=>nativePath;
  return {...f,token,region,behavior,point,move,nativePath};
}

test('long native drags receive checkpoints at hazardous destinations, preserving safe waypoints and input data',()=>{
  const f=setup(),destination=f.point(700),before=structuredClone(f.nativePath);
  const path=hazardousMovementPath(f.token,[destination]);
  assert.deepEqual(path.map(point=>[point.x,!!point.checkpoint]),[[300,true],[400,true],[500,true],[600,false],[700,false]]);
  assert.deepEqual(f.nativePath,before);assert.equal(destination.checkpoint,undefined);
});

test('the native pre-update wrapper handles direct updates and preserves unrelated data and native constraints',async()=>{
  const f=setup();let wrapper;
  globalThis.libWrapper={register:(id,path,fn)=>{assert.equal(path,'CONFIG.Token.documentClass.prototype._preUpdate');wrapper=fn;}};
  installHazardMovement();
  const changed={x:700,y:200,rotation:45,texture:{tint:'#abcdef'}},options={constrainOptions:{ignoreWalls:false,maxCost:25},showRuler:true};
  let calls=0;
  const result=await wrapper.call(f.token,(received,op,user)=>{
    calls++;assert.equal(received,changed);assert.deepEqual(op.constrainOptions,{ignoreWalls:false,maxCost:25});
    assert.equal(op.movement[f.token.id].waypoints[0].checkpoint,true);assert.equal(user,game.user);return 'native-result';
  },changed,options,game.user);
  assert.equal(result,'native-result');assert.equal(calls,1);assert.equal(changed.rotation,45);
  assert.deepEqual(options[REQUESTED_MOVEMENT].map(p=>p.x),[200,700],'save user intent before inserting hazard checkpoints');
  const untouched={};await wrapper.call(f.token,(data,op)=>assert.equal(op.movement,undefined),{flags:{test:true}},untouched,game.user);
});

test('ordinary region movement captures partial drag requests even when there are no active hazards',async()=>{
  const f=setup();f.region.hidden=true;let wrapper;
  globalThis.libWrapper={register:(id,path,fn)=>wrapper=fn};installHazardMovement();
  const options={movement:{[f.token.id]:{method:'dragging',waypoints:[{x:700}]}}};
  const before=structuredClone(options.movement);
  await wrapper.call(f.token,(changed,operation)=>{
    const request=operation[REQUESTED_MOVEMENT];
    assert.deepEqual(request.map(p=>[p.x,p.y,p.elevation,p.level,p.action]),[[200,200,0,'ground','walk'],[700,200,0,'ground','walk']]);
    assert.deepEqual(operation.movement,before,'ordinary movement instructions stay native');
  },{x:700},options,game.user);
});

test('movement metadata preserves intermediate requested corners rather than replacing them with hazard grid steps',async()=>{
  const f=setup();let wrapper;
  globalThis.libWrapper={register:(id,path,fn)=>wrapper=fn};installHazardMovement();
  const options={movement:{[f.token.id]:{method:'dragging',waypoints:[{x:400,y:200,explicit:true},{x:700,y:300}]}}};
  await wrapper.call(f.token,(changed,operation)=>{
    assert.deepEqual(operation[REQUESTED_MOVEMENT].map(p=>[p.x,p.y]),[[200,200],[400,200],[700,300]]);
    assert.equal(operation[REQUESTED_MOVEMENT][1].explicit,true);
    assert.ok(operation.movement[f.token.id].waypoints.some(point=>point.checkpoint));
  },{x:700,y:300},options,game.user);
});

test('undo, paste, planned movement, teleport, dimension changes and harmless paths retain their native workflow',()=>{
  const f=setup();
  for(const options of [{isUndo:true},{isPaste:true},{planned:true},{teleport:true},{method:'hud'},{method:'config'}])
    assert.equal(hazardousMovementPath(f.token,[f.point(700)],options),null);
  f.nativePath[1].width=2;assert.equal(hazardousMovementPath(f.token,[f.point(700)]),null);
  f.nativePath[1].width=1;f.region.hidden=true;assert.equal(hazardousMovementPath(f.token,[f.point(700)]),null);
  f.region.hidden=false;f.region.testPoint=()=>false;assert.equal(hazardousMovementPath(f.token,[f.point(700)]),null);
});

test('flying and displacement are not given ground-hazard checkpoints',()=>{
  for(const action of ['fly','burrow','displace']){
    const f=setup();for(const point of f.nativePath)point.action=action;
    assert.equal(hazardousMovementPath(f.token,[f.point(700)]),null);
  }
});

test('entering and moving within hazardous squares hurt immediately; leaving for safety never does',()=>{
  const f=setup();
  for(const [from,to,units] of [[200,300,1],[300,400,1],[400,500,1],[500,600,0]]){
    const event=f.move(f.point(from),f.point(to));
    assert.equal(hazardUnits(event,f.region,f.behavior),units);
    assert.equal(hazardUnits(event,f.region,f.behavior),0,'duplicate notifications do not deal extra damage');
  }
  assert.equal(hazardUnits(f.move(f.point(600),f.point(500)),f.region,f.behavior),1,'re-entering a vacated hazardous square hurts again');
});

test('Large creatures receive one instance per translation rather than one per occupied square',()=>{
  const f=setup({footprint:2});
  assert.equal(hazardUnits(f.move(f.point(100),f.point(200)),f.region,f.behavior),1);
  assert.equal(hazardUnits(f.move(f.point(200),f.point(300)),f.region,f.behavior),1);
  assert.equal(hazardUnits(f.move(f.point(500),f.point(600)),f.region,f.behavior),0);
});

test('grid entry counts do not use difficult-terrain cost or diagonal movement cost',()=>{
  const f=setup();
  assert.equal(hazardUnits(f.move(f.point(200),f.point(300,300),{distance:10,cost:20}),f.region,f.behavior),1);
  assert.equal(hazardUnits(f.move(f.point(300,300),f.point(300,300),{distance:0,cost:0}),f.region,f.behavior),0);
});

test('entry-only frequency is preserved across multiple updates of one action',()=>{
  const f=setup({frequency:'entry'});
  assert.equal(hazardUnits(f.move(f.point(200),f.point(300)),f.region,f.behavior,'stride'),1);
  assert.equal(hazardUnits(f.move(f.point(300),f.point(400)),f.region,f.behavior,'stride'),0);
  assert.equal(hazardUnits(f.move(f.point(400),f.point(500),{id:'next-action'}),f.region,f.behavior,'next-stride'),1);
});

test('movement pauses synchronously and damage waits for the entered-square animation, then resumes',async()=>{
  const f=setup(),event=f.move(f.point(200),f.point(300));let arrive,damage=0;
  event.data.movement.animation={ended:new Promise(resolve=>arrive=resolve)};
  f.token.movement=event.data.movement;f.token.pauseMovement=()=>{f.calls.push(['pause']);return ()=>f.calls.push(['resume']);};
  globalThis.CONFIG={Dice:{rolls:[class DamageRoll{async evaluate(){this.total=3;return this;}async toMessage(){}}]}};
  f.actor.applyDamage=async()=>{damage++;};
  const handler=createHazardHandler(),pending=handler(event,f.region,f.behavior);
  assert.equal(f.calls[0][0],'pause');await Promise.resolve();assert.equal(damage,0);
  arrive();await pending;assert.equal(damage,1);assert.equal(f.calls.at(-1)[0],'resume');
  const safe=f.move(f.point(500),f.point(600));await handler(safe,f.region,f.behavior);assert.equal(damage,1);
  assert.equal(f.calls.filter(call=>call[0]==='pause').length,1,'leaving a hazardous square does not pause for damage');
});
