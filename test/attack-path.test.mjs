import test from 'node:test';
import assert from 'node:assert/strict';
import { clearAttackPath, clearSightPath } from '../src/foundry/attack-path.mjs';

function fixture() {
  const rays=[],surfaces=[];
  const scene={grid:{distance:5},testSurfaceCollision:(origin,destination,options)=>{surfaces.push({origin,destination,...options});return false;}};
  const token=(x,depth)=>{
    const document={x,y:0,elevation:10,depth,level:'ground',parent:scene};
    document.getMovementOrigin=()=>({x:x+50,y:50,elevation:10+depth*2.5});
    document.getVisionOrigin=()=>({x:x+50,y:50,elevation:11+depth*2.5});
    return {document,center:{x:x+50,y:50},checkCollision:(destination,options)=>{rays.push({destination,...options});return false;}};
  };
  return {scene,rays,surfaces,attacker:token(0,2),target:token(200,1)};
}

test('attack and sight rays use each token’s native height instead of a two-dimensional center',()=>{
  const f=fixture();
  assert.equal(clearAttackPath(f.attacker,f.target),true);
  assert.equal(clearSightPath(f.attacker,f.target),true);
  assert.equal(f.rays[0].origin.elevation,15);assert.equal(f.rays[0].destination.elevation,12.5);
  assert.equal(f.rays[1].origin.elevation,16);assert.equal(f.rays[1].destination.elevation,13.5);
  assert.deepEqual(f.surfaces.map(ray=>[ray.type,ray.level]),[['move','ground'],['sight','ground']]);
});

test('lookahead changes the ray’s horizontal origin while retaining native height',()=>{
  const f=fixture();
  clearSightPath(f.attacker,f.target,{x:450,y:350});
  assert.deepEqual(f.rays[0].origin,{x:450,y:350,elevation:16});
});

test('a floor below both ray endpoints does not block them, while a crossed surface does',()=>{
  const f=fixture();let plane=10;
  f.scene.testSurfaceCollision=(a,b)=>Math.min(a.elevation,b.elevation)<plane&&Math.max(a.elevation,b.elevation)>=plane;
  assert.equal(clearAttackPath(f.attacker,f.target),true);
  assert.equal(clearSightPath(f.attacker,f.target),true);
  plane=14;
  assert.equal(clearAttackPath(f.attacker,f.target),false);
  assert.equal(clearSightPath(f.attacker,f.target),false);
});

test('transparent walls can still block an attack independently of sight',()=>{
  const f=fixture();f.attacker.checkCollision=(_destination,{type})=>type==='move';
  assert.equal(clearSightPath(f.attacker,f.target),true);
  assert.equal(clearAttackPath(f.attacker,f.target),false);
});
