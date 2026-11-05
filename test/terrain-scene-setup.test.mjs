import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingShape,tileShape } from '../src/foundry/terrain-shapes.mjs';
import { environmentBehavior,hazardBehavior,ENVIRONMENT_SCRIPT } from '../src/foundry/terrain-contract.mjs';
import { zoneConfig } from '../src/foundry/environment-zones.mjs';
import { unsupportedMovementRegions } from '../src/foundry/movement-regions.mjs';
import { applySceneSetup,sourceSignature } from '../src/foundry/scene-setup.mjs';
import { createHazardHandler,hazardUnits,hazardousAt,terrainRiskForPath } from '../src/foundry/hazardous-terrain.mjs';
import { fixture } from './helpers/ogre-fixture.mjs';
import { ReactionBarrier } from '../src/wolf/reaction-barrier.mjs';
const ns='foundry-creature-ai';

test('drawing/tile rectangles use explicit native center anchors and preserve rotation',()=>{
  assert.deepEqual(drawingShape({x:100,y:200,rotation:30,shape:{type:'r',width:140,height:70}}),
    {type:'rectangle',x:170,y:235,width:140,height:70,anchorX:0.5,anchorY:0.5,rotation:30,hole:false});
  assert.deepEqual(tileShape({x:100,y:200,width:80,height:40,rotation:90}),
    {type:'rectangle',x:140,y:220,width:80,height:40,anchorX:0.5,anchorY:0.5,rotation:90,hole:false});
  const ellipse=drawingShape({x:100,y:200,shape:{type:'e',width:140,height:70}});
  assert.equal(ellipse.x,170);assert.equal(ellipse.radiusY,35);
});

test('drawing polygons retain their actual shape and an open line is not turned into terrain',()=>{
  const polygon=drawingShape({x:100,y:200,shape:{type:'p',width:100,height:100,points:[0,0,100,0,0,100,0,0]}});
  assert.deepEqual(polygon.points,[100,200,200,200,100,300]);
  const rotated=drawingShape({x:0,y:0,rotation:90,shape:{type:'p',width:100,height:100,points:[0,0,100,0,0,100]}});
  assert.ok(Math.abs(rotated.points[0]-100)<1e-8);assert.ok(Math.abs(rotated.points[1])<1e-8);
  assert.throws(()=>drawingShape({x:0,y:0,shape:{type:'p',points:[0,0,100,0]}}),/area drawings/);
});

test('attached environment behavior owns enable/disable and coexists with native difficult terrain',()=>{
  const b=environmentBehavior({enabled:true,cover:'standard',coverMode:'intervening',concealment:'none'});
  const region={hidden:false,flags:{[ns]:{environment:{enabled:true,cover:'greater',coverMode:'occupants',concealment:'none'}}},behaviors:{contents:[b,{type:'modifyMovementCost',disabled:false}]}};
  assert.equal(zoneConfig(region).cover,'standard');assert.equal(unsupportedMovementRegions({regions:{contents:[region]}}).length,0);
  b.disabled=true;assert.equal(zoneConfig(region),null,'the legacy flag cannot keep a disabled behavior active');
  b.disabled=false;region.hidden=true;assert.equal(zoneConfig(region),null,'native hidden regions deactivate their behavior');
  region.hidden=false;b.system.source='unknown code';assert.equal(unsupportedMovementRegions({regions:{contents:[region]}}).length,1,'unknown scripts still need manual movement');
});

function setupFixture(){
  const calls=[],flags=new Map(),note={_id:'note',x:50,y:50,text:'Concealment',levels:[]};
  const scene={id:'scene',active:true,notes:new Map([['note',note]]),regions:{contents:[]},getFlag:(_,key)=>flags.get(key),setFlag:async(_,key,value)=>flags.set(key,value),
    createEmbeddedDocuments:async(type,data)=>{calls.push([type,data]);const docs=data.map((raw,i)=>({...raw,id:`region${i}`}));scene.regions.contents.push(...docs);return docs;}};
  globalThis.game={user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},world:{id:'world'},scenes:new Map([['scene',scene]])};
  const plan={id:'setup',worldId:'world',sceneId:'scene',sources:[{kind:'notes',id:'note',signature:sourceSignature(note,'notes')}],
    regions:['first','second'].map(key=>({name:key,shapes:[],flags:{[ns]:{sceneSetup:{id:'setup',key}}},behaviors:[environmentBehavior({enabled:true,cover:'none',coverMode:'occupants',concealment:'occupants'})]}))};
  return {scene,plan,note,calls,flags};
}

test('scene setup uses native embedded creation, preserves annotations and is idempotent',async()=>{
  const f=setupFixture(),before=structuredClone(f.note);
  assert.deepEqual(await applySceneSetup(f.plan),{created:2,total:2});assert.deepEqual(f.note,before);
  assert.equal(f.calls[0][0],'Region');assert.equal(f.calls[0][1][0].behaviors[0].system.source,ENVIRONMENT_SCRIPT);
  assert.equal((await applySceneSetup(f.plan)).alreadyApplied,true);assert.equal(f.calls.length,1);
});

test('scene setup refuses changed annotations, the wrong world/scene and a non-active GM',async()=>{
  const f=setupFixture();f.note.text='different';await assert.rejects(applySceneSetup(f.plan),/source changed/);assert.equal(f.calls.length,0);
  f.note.text='Concealment';game.world.id='other';await assert.rejects(applySceneSetup(f.plan),/active world/);
  game.world.id='world';f.scene.active=false;await assert.rejects(applySceneSetup(f.plan),/active world/);
  f.scene.active=true;game.user.id='other-gm';await assert.rejects(applySceneSetup(f.plan),/active GM/);
});

test('a partially completed setup resumes without replacing its regions or relying on object key order',async()=>{
  const f=setupFixture();f.scene.regions.contents.push({...structuredClone(f.plan.regions[0]),id:'existing'});
  assert.equal((await applySceneSetup(f.plan)).created,1);assert.equal(f.scene.regions.contents[0].id,'existing');
  const one={_id:'d',x:0,y:0,shape:{type:'r',width:70,height:35}};
  const two={shape:{height:35,width:70,type:'r'},y:0,x:0,_id:'d'};
  assert.equal(sourceSignature(one,'drawings'),sourceSignature(two,'drawings'));
});

let sequence=0;
function hazardFixture(frequency='per5'){
  const f=fixture({footprint:1}),id=`hazard-${++sequence}`,b={...hazardBehavior({frequency}),id:'behavior'};
  const region={id,name:'Cactus',parent:canvas.scene,hidden:false,levels:new Set(['ground']),behaviors:{contents:[b]},
    testPoint:p=>p.x>=300&&p.x<400&&p.y>=200&&p.y<300};
  canvas.scene.regions.contents.push(region);
  const token=f.boss.document;token.name=f.boss.name;token.pauseMovement=()=>{f.calls.push(['pause']);return async()=>{f.calls.push(['resume']);};};
  token.stopMovement=()=>{f.calls.push(['stop-movement']);return true;};
  const movement={id:`move-${id}`,subpathId:`action-${id}`,origin:{x:200,y:200},method:'api',passed:{distance:0,waypoints:[{x:300,y:200,action:'walk'}]}};
  token.movement=movement;
  return {...f,region,b,token,movement,event:(name='tokenMoveIn',distance=0)=>{movement.passed.distance=distance;return {name,user:game.user,data:{token,movement}};}};
}

test('hazardous terrain adds route risk and the planner can choose a longer safe route',async()=>{
  const f=hazardFixture();
  assert.equal(hazardousAt(f.boss,{x:300,y:200,elevation:0,level:'ground'}).length,1);
  assert.equal(terrainRiskForPath(f.boss,[{x:2,y:2},{x:3,y:2},{x:4,y:2}],cell=>({x:cell.x*100,y:cell.y*100,elevation:0,level:'ground'})),3.5);
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  const route=state.moves.find(move=>move.x===4&&move.y===2&&move.kind==='stride');
  assert.ok(route);assert.equal(route.risk.hazardous,false);assert.equal(route.cost,15);
  assert.equal(route.path.some(cell=>cell.x===3&&cell.y===2),false);
});

test('hazard counters charge entered squares once, including equal-distance native checkpoints, and never the exit',()=>{
  const f=hazardFixture();
  f.region.testPoint=p=>p.x>=300&&p.x<600&&p.y>=200&&p.y<300;
  assert.equal(hazardUnits(f.event(),f.region,f.b),1);
  assert.equal(hazardUnits(f.event(),f.region,f.b),0);
  assert.equal(hazardUnits(f.event('tokenMoveWithin',5),f.region,f.b),0);
  f.movement.origin={x:300,y:200};f.movement.passed.waypoints=[{x:400,y:200,action:'walk'}];
  assert.equal(hazardUnits(f.event('tokenMoveWithin',5),f.region,f.b),1);
  f.movement.passed.cost=100;assert.equal(hazardUnits(f.event('tokenMoveWithin',5),f.region,f.b),0);
  f.movement.origin={x:400,y:200};f.movement.passed.waypoints=[{x:500,y:200,action:'walk'}];
  assert.equal(hazardUnits(f.event('tokenMoveWithin',5),f.region,f.b),1);
  f.movement.origin={x:500,y:200};f.movement.passed.waypoints=[{x:600,y:200,action:'walk'}];
  assert.equal(hazardUnits(f.event('tokenMoveWithin',5),f.region,f.b),0);
});

test('once-per-action hazards stay once when automated movement uses multiple native move IDs',()=>{
  const f=hazardFixture('entry'),key='one-stride';
  assert.equal(hazardUnits(f.event(),f.region,f.b,key),1);
  f.movement.id+='next';assert.equal(hazardUnits(f.event('tokenMoveWithin',5),f.region,f.b,key),0);
  f.movement.id+='last';assert.equal(hazardUnits(f.event('tokenMoveWithin',5),f.region,f.b,key),0);
});

test('flying, displacement and undo do not trigger ground hazard damage',()=>{
  for(const mode of ['fly','displace','burrow']){const f=hazardFixture();f.movement.passed.waypoints[0].action=mode;assert.equal(hazardUnits(f.event(),f.region,f.b),0);}
  const f=hazardFixture();f.movement.method='undo';assert.equal(hazardUnits(f.event(),f.region,f.b),0);
});

function damageClass(f,total=3){
  globalThis.CONFIG={Dice:{rolls:[class DamageRoll{
    constructor(formula){this.formula=formula;}async evaluate(){this.total=total;f.calls.push(['hazard-roll',this.formula]);return this;}
    async toMessage(data){f.calls.push(['hazard-message',data]);}
  }]}};
}

test('hazard damage pauses movement and applies each damage instance separately through native IWR',async()=>{
  const f=hazardFixture(),barrier=new ReactionBarrier();damageClass(f);
  f.region.testPoint=p=>p.x>=300&&p.x<500&&p.y>=200&&p.y<300;
  f.movement.passed.waypoints=[{x:300,y:200,action:'walk'},{x:400,y:200,action:'walk'}];
  f.actor.applyDamage=async({damage})=>{f.actor.hitPoints.value-=Math.max(0,damage.total-2);f.calls.push(['native-hp']);};
  const handler=createHazardHandler({resolve:op=>barrier.resolve(op)}),before=f.actor.hitPoints.value;
  await handler(f.event('tokenMoveWithin',10),f.region,f.b);
  assert.equal(before-f.actor.hitPoints.value,2,'resistance is applied to each 1d6 separately');
  assert.deepEqual(f.calls.filter(c=>['pause','native-hp','resume'].includes(c[0])).map(c=>c[0]),['pause','native-hp','native-hp','resume']);
  assert.equal(f.calls.filter(c=>c[0]==='hazard-roll').length,2);assert.equal(barrier.pending,false);
  assert.equal(f.calls.find(c=>c[0]==='hazard-message')[1].flags.pf2e.suppressDamageButtons,true);
});

test('lethal hazard damage stops the move without stopping all AI or resuming the dead mover',async()=>{
  const f=hazardFixture();damageClass(f,999);let paused=0;
  const handler=createHazardHandler({onPause:()=>paused++});await handler(f.event(),f.region,f.b);
  assert.equal(f.calls.filter(c=>c[0]==='stop-movement').length,1);assert.equal(f.calls.some(c=>c[0]==='resume'),false);assert.equal(paused,0);
});

test('manual hazard mode stops for GM damage and does not roll or apply HP changes',async()=>{
  const f=hazardFixture('manual');let paused=0;const before=f.actor.hitPoints.value;
  await createHazardHandler({onPause:()=>paused++})(f.event(),f.region,f.b);
  assert.equal(paused,1);assert.equal(f.actor.hitPoints.value,before);assert.equal(f.calls.some(c=>c[0]==='hazard-roll'||c[0]==='damage-applied'),false);
  assert.match(f.calls.find(c=>c[0]==='chat')[1].content,/manually/);
});

test('the shared barrier remains held until asynchronous hazard HP application finishes',async()=>{
  const f=hazardFixture(),barrier=new ReactionBarrier();damageClass(f);let release;
  const pendingHP=new Promise(resolve=>release=resolve);f.actor.applyDamage=async()=>pendingHP;
  const pending=createHazardHandler({resolve:op=>barrier.resolve(op)})(f.event(),f.region,f.b);
  assert.equal(barrier.pending,true);let released=false;const waiter=barrier.wait().then(()=>released=true);
  await Promise.resolve();assert.equal(released,false);release();await pending;await waiter;
  assert.equal(released,true);assert.equal(f.calls.at(-1)[0],'resume');
});
