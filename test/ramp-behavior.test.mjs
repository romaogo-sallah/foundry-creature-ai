import test from 'node:test';
import assert from 'node:assert/strict';
import {RAMP_BEHAVIOR_TYPE,rampConfig,rampFromSettings,validateRampSettings} from '../src/foundry/ramp-geometry.mjs';
import {registerRampBehavior} from '../src/foundry/ramp-behavior.mjs';
import {configureRamp,openRamps} from '../src/foundry/ramp-controls.mjs';
import {surfaceMovementPath,rampElevation,platformElevations} from '../src/foundry/surface-terrain.mjs';
import {floorBelow} from '../src/foundry/flight-surfaces.mjs';
import {unsupportedMovementRegions} from '../src/foundry/movement-regions.mjs';
import {fixture} from './helpers/pyro-fixture.mjs';
const settings={lowerElevation:0,upperElevation:10,direction:'east'};
const rectangle={type:'rectangle',x:200,y:100,width:200,height:300};
const region=(shape=rectangle,config=settings)=>({shapes:[shape],behaviors:{contents:[{type:RAMP_BEHAVIOR_TYPE,disabled:false,system:{...config}}]}});
test('manual ramp endpoints follow compass direction and interpolate across their Region',()=>{
 const r=region();assert.deepEqual(rampConfig(r),{from:{x:200,y:250,elevation:0},to:{x:400,y:250,elevation:10}});
 assert.equal(rampElevation(rampConfig(r),{x:300,y:150}),5);
 const west=rampFromSettings(r,{...settings,direction:'west'});assert.ok(Math.abs(west.from.x-400)<1e-8);assert.ok(Math.abs(west.to.x-200)<1e-8);
 const north=rampFromSettings(r,{...settings,direction:'north'});assert.ok(Math.abs(north.from.y-400)<1e-8);assert.ok(Math.abs(north.to.y-100)<1e-8);
 r.shapes[0]={...rectangle,width:400};assert.equal(rampElevation(rampConfig(r),{x:300,y:250}),2.5,'resizing recomputes the slope');
});
test('rotated rectangles and polygons use actual shape extents rather than stale saved coordinates',()=>{
 const r=region({...rectangle,x:300,y:250,anchorX:0.5,anchorY:0.5,width:200,height:100,rotation:45},{...settings,direction:'southeast'});
 const ramp=rampConfig(r);assert.ok(Math.abs(Math.hypot(ramp.to.x-ramp.from.x,ramp.to.y-ramp.from.y)-200)<1e-8);
 assert.ok(Math.abs(rampElevation(ramp,{x:300,y:250})-5)<1e-8);
 const polygon=region({type:'polygon',points:[0,0,100,0,80,50,10,50]});assert.equal(rampConfig(polygon).to.x,100);
 const ellipse=region({type:'ellipse',x:300,y:200,radiusX:100,radiusY:50,rotation:90});
 assert.ok(Math.abs(rampConfig(ellipse).from.x-250)<1e-8);assert.ok(Math.abs(rampConfig(ellipse).to.x-350)<1e-8);
});
test('disabled/hidden ramp behavior suppresses legacy slope data and corrupt data never divides by zero',()=>{
 const r=region();r.flags={'foundry-creature-ai':{ramp:{from:{x:0,y:0,elevation:0},to:{x:100,y:0,elevation:10}}}};
 r.behaviors.contents[0].disabled=true;assert.equal(rampConfig(r),null);assert.ok(rampConfig(r,{includeDisabled:true}));
 r.behaviors.contents[0].disabled=false;r.hidden=true;assert.equal(rampConfig(r),null);r.hidden=false;
 r.behaviors.contents[0].system.direction='invalid';assert.equal(rampConfig(r),null);
 r.behaviors.contents=[];assert.ok(rampConfig(r),'existing flag-only ramps still work');
 r.flags['foundry-creature-ai'].ramp.to.x=0;assert.equal(rampConfig(r),null);
 for(const bad of [{...settings,upperElevation:0},{...settings,lowerElevation:Infinity},{...settings,direction:'up'}])assert.throws(()=>validateRampSettings(bad));
 assert.throws(()=>rampFromSettings(region({...rectangle,gridBased:true}),settings),/grid-based/);
});
function setup(){
 const f=fixture();canvas.scene.grid=canvas.grid;f.boss.document.width=f.boss.document.height=1;f.boss.document.movementAction='walk';
 const point=(x,elevation=0,y=200,action='walk')=>({x,y,elevation,level:'ground',action,snapped:true});Object.assign(f.boss.document,point(100));
 f.boss.document.getCompleteMovementPath=points=>{const out=[points[0]];for(const point of points.slice(1)){const start=out.at(-1),steps=Math.ceil(Math.max(Math.abs(point.x-start.x),Math.abs(point.y-start.y))/100);for(let i=1;i<=steps;i++)out.push({...point,x:start.x+(point.x-start.x)*i/steps,y:start.y+(point.y-start.y)*i/steps});}return out;};
 const slope=new f.Region({shapes:[rectangle],elevation:{bottom:0,top:15},behaviors:region().behaviors.contents},{parent:canvas.scene});
 const deck=new f.Region({shapes:[{...rectangle,x:400}],elevation:{bottom:10,top:10.1},behaviors:[{type:'defineSurface',disabled:false,system:{move:true,placement:'bottom'}}]},{parent:canvas.scene});
 canvas.scene.regions.contents.push(slope,deck);return {...f,point,slope,deck};
}
test('native manually created ramp connects to an ordinary Define Surface platform without setup flags',()=>{
 const f=setup();assert.equal(surfaceMovementPath(f.boss.document,[f.point(500)]).at(-1).elevation,10);
 Object.assign(f.boss.document,f.point(500,10));assert.equal(surfaceMovementPath(f.boss.document,[f.point(100,10)]).at(-1).elevation,0);
 assert.equal(unsupportedMovementRegions(canvas.scene).length,0);
 Object.assign(f.boss.document,f.point(300,20));assert.equal(floorBelow(f.boss),7.5,'landing uses the configured ramp slope');
});
test('Step/Sneak can follow slopes; Fly, teleport, resize and entry below the slope stay separate',()=>{
 const f=setup();for(const mode of ['step','sneak']){
  f.boss.document.movementAction=mode;const path=surfaceMovementPath(f.boss.document,[f.point(300,0,200,mode)]);
  assert.equal(path.at(-1).elevation,7.5);assert.ok(path.slice(1).every(p=>p.action===mode));
 }
 f.boss.document.movementAction='walk';assert.equal(surfaceMovementPath(f.boss.document,[f.point(500,0,200,'fly')]),null);
 assert.equal(surfaceMovementPath(f.boss.document,[f.point(500)],{teleport:true}),null);
 assert.equal(surfaceMovementPath(f.boss.document,[{...f.point(500),width:2}]),null);
 Object.assign(f.boss.document,f.point(300,0,500));assert.equal(surfaceMovementPath(f.boss.document,[f.point(300)]),null,'walking under the middle does not lift a token');
 f.slope.behaviors.contents[0].disabled=true;Object.assign(f.boss.document,f.point(100));assert.equal(surfaceMovementPath(f.boss.document,[f.point(500)]),null);
 f.deck.behaviors.contents[0].disabled=true;assert.deepEqual(platformElevations(f.deck),[]);
});
test('GM ramp helper creates/updates one native behavior; non-GM and invalid edits are rejected',async()=>{
 const f=setup(),calls=[];f.slope.behaviors.contents=[];
 f.slope.createEmbeddedDocuments=async(type,data)=>{calls.push(['create',type,data]);const b={...data[0],update:async change=>{calls.push(['update',change]);Object.assign(b,change);}};f.slope.behaviors.contents.push(b);return [b];};
 const created=await configureRamp(f.slope,settings);assert.equal(created.type,RAMP_BEHAVIOR_TYPE);assert.equal(calls.length,1);
 await configureRamp(f.slope,{...settings,upperElevation:15,enabled:false});assert.equal(calls.length,2);assert.equal(created.disabled,true);
 await assert.rejects(configureRamp(f.slope,{...settings,upperElevation:0}),/upper elevation/);assert.equal(calls.length,2);
 game.user.isGM=false;await assert.rejects(configureRamp(f.slope,settings),/Only a GM/);
});
test('native behavior registration supplies a schema and the standard Region editor fields',()=>{
 class Field {constructor(options){Object.assign(this,options);}}class Base{}
 globalThis.foundry={data:{regionBehaviors:{RegionBehaviorType:Base},fields:{NumberField:Field,StringField:Field}}};globalThis.CONFIG={RegionBehavior:{dataModels:{}}};
 assert.equal(registerRampBehavior(),true);const Model=CONFIG.RegionBehavior.dataModels[RAMP_BEHAVIOR_TYPE];assert.ok(Model.prototype instanceof Base);
 const fields=Model.defineSchema();assert.equal(fields.lowerElevation.initial,0);assert.equal(fields.upperElevation.initial,5);assert.equal(fields.direction.choices.north,'North ↑');
 assert.throws(()=>Model.validateJoint({...settings,upperElevation:0}));Model.validateJoint(settings);assert.equal(CONFIG.RegionBehavior.typeLabels[RAMP_BEHAVIOR_TYPE],'Ramp / stairs');
});
test('canceling the manual ramp controls never creates a behavior',async()=>{
 const f=setup();let calls=0;f.slope.createEmbeddedDocuments=async()=>{calls++;};
 globalThis.foundry={applications:{api:{DialogV2:{wait:async options=>{assert.match(options.content,/Uphill direction/);return null;}}}}};
 await openRamps(f.slope.id);assert.equal(calls,0);
});
