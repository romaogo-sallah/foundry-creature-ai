import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/ogre-fixture.mjs';
import {ManualMovement} from '../src/foundry/manual-movement.mjs';
import {combatStamp} from '../src/foundry/reaction-prompts.mjs';
import {landSpeed,swimSpeed} from '../src/foundry/flight-costs.mjs';
import {WATER_BEHAVIOR_TYPE,LEGACY_WATER_BEHAVIOR_TYPE,validateWaterElevations,waterAt,waterConfig,waterMovementPath} from '../src/foundry/water-geometry.mjs';
import {registerWaterBehavior} from '../src/foundry/water-behavior.mjs';
import {configureWater,openWaterZones} from '../src/foundry/water-controls.mjs';

function setup(){
  const f=fixture({footprint:1}),behavior={type:WATER_BEHAVIOR_TYPE,disabled:false,system:{},update:async change=>Object.assign(behavior,change)};
  f.actor.system.movement={speeds:{land:{value:25},fly:{value:100},swim:{value:10}}};
  Object.assign(f.boss.document,{elevation:0,level:'ground',movementAction:'swim',object:f.boss});
  f.boss.document.getMovementOrigin=point=>({x:point.x+50,y:point.y+50});
  f.boss.document.getCompleteMovementPath=points=>points;
  f.boss.measureMovementPath=path=>({cost:path.slice(1).reduce((total,point,index)=>total+Math.max(
    Math.abs(point.x-path[index].x)/100*5,Math.abs(point.y-path[index].y)/100*5,Math.abs(point.elevation-path[index].elevation)),0)});
  const region={id:'water',name:'Pool',parent:canvas.scene,hidden:false,elevation:{bottom:-20,top:0},behaviors:{contents:[behavior]},
    includedInLevel:level=>level==='ground',testPoint:point=>point.x>=100&&point.x<=500&&point.y>=100&&point.y<=500&&point.elevation>=-20&&point.elevation<0,
    update:async change=>{region.elevation={...region.elevation,...change.elevation};},
    createEmbeddedDocuments:async(_type,entries)=>{const created={...entries[0],update:async change=>Object.assign(created,change)};region.behaviors.contents.push(created);return [created];}};
  canvas.scene.regions.contents.push(region);game.user.active=true;
  return {...f,region,behavior};
}

test('Water Region elevation bounds form a negative-elevation swimmable volume',()=>{
  const f=setup();
  assert.deepEqual(validateWaterElevations({bottom:'-20',top:'0'}),{bottom:-20,top:0});
  assert.throws(()=>validateWaterElevations({bottom:0,top:0}),/higher/);
  assert.equal(waterConfig(f.region).bottom,-20);
  f.behavior.type=LEGACY_WATER_BEHAVIOR_TYPE;assert.equal(waterConfig(f.region).bottom,-20,'legacy worlds retain water behavior');
  f.behavior.type=WATER_BEHAVIOR_TYPE;
  assert.equal(waterAt(f.boss.document,{x:200,y:200,elevation:0,level:'ground'}).region,f.region,'surface is included');
  assert.equal(waterAt(f.boss.document,{x:200,y:200,elevation:-15,level:'ground'}).region,f.region);
  assert.equal(waterAt(f.boss.document,{x:200,y:200,elevation:-25,level:'ground'}),null);
  assert.equal(waterAt(f.boss.document,{x:700,y:200,elevation:-5,level:'ground'}),null);
  f.region.hidden=true;assert.ok(waterAt(f.boss.document,{x:200,y:200,elevation:-5,level:'ground'}),'hiding the Region drawing does not disable its mechanics');
  f.behavior.disabled=true;assert.equal(waterAt(f.boss.document,{x:200,y:200,elevation:-5,level:'ground'}),null);
});

test('PF2e 8.7 prepared speeds tolerate a nullable land Speed',()=>{
  const actor={system:{movement:{speeds:{land:{value:null},swim:{value:15}}},attributes:{}}};
  assert.equal(landSpeed(actor),0);assert.equal(swimSpeed(actor),15);
});

test('Swim paths can descend below zero but cannot leave the Water volume',()=>{
  const f=setup(),origin={x:200,y:200,elevation:0,level:'ground',action:'swim'},deep={...origin,elevation:-15};
  const path=waterMovementPath(f.boss.document,[origin,deep]);
  assert.equal(path.at(-1).elevation,-15);assert.ok(path.every(point=>point.action==='swim'));
  assert.throws(()=>waterMovementPath(f.boss.document,[origin,{...deep,elevation:-25}]),/inside an enabled Water Region/);
  assert.throws(()=>waterMovementPath(f.boss.document,[origin,{...deep,x:700}]),/inside an enabled Water Region/);
  assert.equal(waterMovementPath(f.boss.document,[{...origin,action:'fly'}, {...deep,action:'fly'}]),null,'Fly remains separate');
});

test('manual vertical swimming uses Swim Speed rather than land or Fly Speed',async()=>{
  const f=setup(),movement=new ManualMovement(f.reactions,{enabled:()=>false});
  assert.equal(swimSpeed(f.actor),10);
  const origin={x:200,y:200,elevation:0,level:'ground'},destination={...origin,elevation:-10,action:'swim'};
  const data={sceneId:'scene',tokenId:f.boss.id,origin,path:[{...origin,action:'swim'},destination],mode:'swim',stamp:combatStamp(),expires:Date.now()+60000};
  assert.equal(await movement.receive(data,game.user),true);assert.equal(f.boss.document.elevation,-10);
  assert.equal(f.calls.find(call=>call[0]==='move')[2].at(-1).action,'swim');
  Object.assign(f.boss.document,origin);data.path=[{...origin,action:'swim'},{...destination,elevation:-15}];data.origin={...origin};
  await assert.rejects(movement.receive(data,game.user),/exceeds one Swim/);
  assert.equal(f.boss.document.elevation,0,'the 100-foot Fly Speed does not authorize a longer Swim');
});

test('Water behavior registration and GM helper create one editable native behavior',async()=>{
  const f=setup();f.region.behaviors.contents=[];
  class Base{};globalThis.foundry={data:{regionBehaviors:{RegionBehaviorType:Base}}};globalThis.CONFIG={RegionBehavior:{dataModels:{}}};
  assert.equal(registerWaterBehavior(),true);const Model=CONFIG.RegionBehavior.dataModels[WATER_BEHAVIOR_TYPE];
  assert.ok(Model.prototype instanceof Base);assert.deepEqual(Model.defineSchema(),{});assert.equal(CONFIG.RegionBehavior.typeLabels[WATER_BEHAVIOR_TYPE],'Water');
  const created=await configureWater(f.region,{bottom:-30,top:-5,enabled:true});
  assert.equal(f.region.elevation.bottom,-30);assert.equal(f.region.elevation.top,-5);assert.equal(created.type,WATER_BEHAVIOR_TYPE);
  await configureWater(f.region,{bottom:-25,top:0,enabled:false});assert.equal(created.disabled,true);assert.equal(f.region.behaviors.contents.length,1);
  game.user.isGM=false;await assert.rejects(configureWater(f.region,{bottom:-20,top:0}),/Only a GM/);
});

test('canceling Water controls leaves the selected Region unchanged',async()=>{
  const f=setup(),before=structuredClone(f.region.elevation);let updates=0;f.region.update=async()=>{updates++;};
  globalThis.foundry={applications:{api:{DialogV2:{wait:async dialog=>{assert.match(dialog.content,/Negative bottom elevations/);return null;}}}}};
  await openWaterZones(f.region.id);assert.equal(updates,0);assert.deepEqual(f.region.elevation,before);
});
