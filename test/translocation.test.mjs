import test from 'node:test';
import assert from 'node:assert/strict';
import {clearTeleportSight,teleportSpaceClear} from '../src/foundry/teleport-geometry.mjs';
import {tokenAt} from '../src/foundry/vertical-geometry.mjs';
import {translocationDestinations,translocationDestinationsAsync,executeTranslocate} from '../src/foundry/translocation.mjs';
import {clearSightPath} from '../src/foundry/attack-path.mjs';
import {readFile} from 'node:fs/promises';
import {fixture as casterFixture} from './helpers/modular-caster-fixture.mjs';
import {genericCastingCandidates} from '../src/framework/generic-casting.mjs';
import {executeSpell} from '../src/foundry/spellcasting.mjs';
const lich=JSON.parse(await readFile(new URL('./fixtures/lich-mechanics.json',import.meta.url)));

function fixture(){
 class Rectangle{constructor(x,y,width,height){Object.assign(this,{x,y,width,height});}contains(x,y){return x>=this.x&&y>=this.y&&x<this.x+this.width&&y<this.y+this.height;}}
 globalThis.PIXI={Rectangle};globalThis.game={};
 const scene={id:'scene',grid:{size:100,distance:5},regions:{contents:[]},walls:{contents:[]}},moves=[];
 const token=(x,y,elevation=0)=>{
  const actor={dimensions:{height:5},hitPoints:{value:10},isOfType:()=>true,hasCondition:()=>false},document={x,y,elevation,width:1,height:1,depth:1,level:'ground',parent:scene};
  document.move=async(path,options)=>{moves.push({path,options});Object.assign(document,path.at(-1));};
  return {id:`${x}:${y}`,document,actor,w:100,h:100,get center(){return {x:document.x+50,y:document.y+50};},checkCollision:(p,o)=>o.type==='move'&&o.mode==='all'?CONFIG.Canvas.polygonBackends.move.testCollision(o.origin,p):false,
   distanceTo(other){return Math.max(Math.abs(this.document.x-other.document.x),Math.abs(this.document.y-other.document.y))/20;}};
 };
 const source=token(1000,1000),enemy=token(1200,1000);
 globalThis.canvas={scene,grid:scene.grid,dimensions:{sceneRect:new Rectangle(0,0,5000,5000)},tokens:{placeables:[source,enemy]}};
 globalThis.CONFIG={Canvas:{polygonBackends:{move:{testCollision:()=>[]}}}};
 const adapter={token:source,perceivedTarget:()=>enemy},state={enemies:[{distance:10}],nearestEnemy:10,self:{threatened:true}};
 const destination={x:600,y:1000,elevation:0,level:'ground'},spell={id:'translocate',system:{range:{value:'120 feet'}}};
 const wall=(c,other={})=>({c,move:20,sight:10,levels:new Set(['ground']),...other});
 return {scene,moves,token,source,enemy,adapter,state,destination,spell,wall};
}

test('a single movement-blocking terrain edge permits native sight but is unsafe for AI teleport placement',()=>{
 const f=fixture(),target=tokenAt(f.source,f.destination);
 CONFIG.Canvas.polygonBackends.move.testCollision=()=>[{edges:new Set([{type:'wall',move:20,sight:10}])}];
 assert.equal(clearSightPath(f.source,target),true);assert.equal(clearTeleportSight(f.source,target),false);
});

test('transparent barriers do not require a walkable route, and opaque barriers still block teleport sight',()=>{
 const f=fixture(),target=tokenAt(f.source,f.destination);
 CONFIG.Canvas.polygonBackends.move.testCollision=()=>[{edges:new Set([{type:'wall',move:20,sight:0}])}];
 assert.equal(clearTeleportSight(f.source,target),true);
 CONFIG.Canvas.polygonBackends.move.testCollision=()=>[];assert.equal(clearTeleportSight(f.source,target),true);
 f.source.checkCollision=()=>true;assert.equal(clearTeleportSight(f.source,target),false);
});

test('teleport space checks the full footprint against thin walls, allowing boundary contact',()=>{
 const f=fixture();f.scene.walls.contents=[f.wall([695,990,695,1110])];
 assert.equal(teleportSpaceClear(f.source,f.destination),false,'the center is clear but the eastern edge clips a wall');
 f.scene.walls.contents[0].c=[700,990,700,1110];assert.equal(teleportSpaceClear(f.source,f.destination),true);
 f.source.document.width=2;f.source.w=200;assert.equal(teleportSpaceClear(f.source,f.destination),false,'Large creatures must fit too');
});

test('footprint checks respect open doors and other levels, but closed transparent walls still occupy space',()=>{
 const f=fixture(),w=f.wall([650,990,650,1110],{door:1,ds:1});f.scene.walls.contents=[w];
 assert.equal(teleportSpaceClear(f.source,f.destination),true);w.ds=0;assert.equal(teleportSpaceClear(f.source,f.destination),false);
 w.levels=new Set(['upper']);assert.equal(teleportSpaceClear(f.source,f.destination),true);
 w.levels=new Set(['ground']);w.sight=0;assert.equal(teleportSpaceClear(f.source,f.destination),false);
});

test('body overlap blocks teleport even when occupants have different base elevations',()=>{
 const f=fixture(),other=f.token(600,1000,4);canvas.tokens.placeables.push(other);
 assert.equal(teleportSpaceClear(f.source,f.destination),false);
 other.document.elevation=5;assert.equal(teleportSpaceClear(f.source,f.destination),true,'vertically adjacent bodies do not overlap');
 other.document.elevation=0;other.actor.hitPoints.value=0;assert.equal(teleportSpaceClear(f.source,f.destination),true,'corpses remain passable');
});

test('intact ice-wall volumes block the footprint independently of native wall documents',()=>{
 const f=fixture(),segment={x:690,y:1000,width:10,height:100,bottom:0,top:10,hp:40};
 f.scene.regions.contents=[{flags:{'foundry-creature-ai':{iceWall:{segments:[segment]}}}}];
 assert.equal(teleportSpaceClear(f.source,f.destination),false);
 segment.hp=0;assert.equal(teleportSpaceClear(f.source,f.destination),true);
 segment.hp=40;segment.bottom=5;assert.equal(teleportSpaceClear(f.source,f.destination),true);
});

test('the body cannot intersect a surface, but can stand on its floor',()=>{
 const f=fixture();let plane=0;
 f.scene.testSurfaceCollision=(a,b)=>a.elevation<plane&&b.elevation>=plane;
 assert.equal(teleportSpaceClear(f.source,f.destination),true);
 plane=3;assert.equal(teleportSpaceClear(f.source,f.destination),false);
 plane=5;assert.equal(teleportSpaceClear(f.source,f.destination),true,'head contact is permitted');
 f.scene.testSurfaceCollision=(a,b)=>a.x>690&&a.elevation<3&&b.elevation>3;
 assert.equal(teleportSpaceClear(f.source,f.destination),false,'a low ceiling over a corner also blocks placement');
});

test('malformed and out-of-bounds destinations never move the actor',async()=>{
 const f=fixture();for(const p of [null,{...f.destination,x:NaN},{...f.destination,x:4950},{...f.destination,y:-100}]){
  const result=await executeTranslocate(f.adapter,f.spell,{destination:p});assert.match(result.note,/unavailable/);
 }assert.equal(f.moves.length,0);
});

test('planner removes ambiguous terrain destinations before ranking, including cooperative planning',async()=>{
 const f=fixture();CONFIG.Canvas.polygonBackends.move.testCollision=(_a,b)=>b.x>1500?[{edges:new Set([{type:'wall',move:20,sight:10}])}]:[];
 const sync=translocationDestinations(f.adapter,f.state);let checkpoints=0;
 const asyncResult=await translocationDestinationsAsync(f.adapter,f.state,{checkpoint:async()=>checkpoints++});
 assert.ok(sync.length);assert.ok(sync.every(c=>c.position.x+50<=1500));assert.deepEqual(asyncResult,sync);assert.ok(checkpoints>=64);
});

test('a confined caster retains distinct short teleport choices when every 30-foot landing is blocked',()=>{
 const f=fixture();f.source.checkCollision=(p,o)=>o.type==='move'&&o.mode==='all'?[]:
  Math.abs(p.x-1050)>200||Math.abs(p.y-1050)>200;
 const choices=translocationDestinations(f.adapter,f.state);
 assert.ok(choices.length);assert.equal(new Set(choices.map(c=>`${c.position.x},${c.position.y}`)).size,choices.length);
 assert.ok(choices.every(c=>f.source.distanceTo(tokenAt(f.source,c.position))<=10));
});

test('a wall added after planning stops the teleport at execution, while a valid jump bypasses intervening movement',async()=>{
 const f=fixture();assert.equal(teleportSpaceClear(f.source,f.destination),true);
 f.scene.walls.contents=[f.wall([650,990,650,1110])];
 const blocked=await executeTranslocate(f.adapter,f.spell,{destination:f.destination});assert.match(blocked.note,/remain spent/);assert.equal(f.moves.length,0);
 f.scene.walls.contents=[];const result=await executeTranslocate(f.adapter,f.spell,{destination:f.destination});assert.equal(result.resolved,true);
 assert.equal(f.moves.length,1);assert.equal(f.moves[0].path[0].action,'displace');assert.equal(f.moves[0].options.constrainOptions.ignoreWalls,true);
});

async function castingFixture(){
 const f=casterFixture({npcData:lich});CONFIG.Canvas={polygonBackends:{move:{testCollision:()=>[]}}};canvas.scene.walls={contents:[]};
 f.boss.checkCollision=(_p,o)=>o.type==='move'&&o.mode==='all'?[]:false;
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false}),destination={x:1000,y:1000,elevation:0,level:'ground'};
 const choice=genericCastingCandidates({...state,teleportDestinations:[{position:destination,value:30}]}).find(c=>c.spellSlug==='translocate');
 assert.ok(choice);return {...f,ledger,choice};
}

test('a newly blocked destination before commitment preserves the prepared spell slot',async()=>{
 const f=await castingFixture();canvas.scene.walls.contents=[{c:[1050,1000,1050,1100],move:20}];
 const result=await executeSpell(f.adapter,f.choice,f.ledger);
 assert.equal(result.skipped,true);assert.match(result.skipReason,/teleport destination/);
 assert.equal(f.calls.some(c=>c[0]==='consume-spell'),false);assert.equal(f.calls.some(c=>c[0]==='move'),false);
});

test('a destination blocked during a casting reaction cancels displacement but keeps the committed slot spent',async()=>{
 const f=await castingFixture();f.reactions.beforeSpell=async()=>{canvas.scene.walls.contents=[{c:[1050,1000,1050,1100],move:20}];return false;};
 const result=await executeSpell(f.adapter,f.choice,f.ledger);
 assert.equal(result.resolved,true);assert.match(result.note,/remain spent/);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);assert.equal(f.calls.some(c=>c[0]==='move'),false);
});
