import test from 'node:test';
import assert from 'node:assert/strict';
import { movementSight } from '../src/framework/pursuit.mjs';
import { fixture } from './helpers/ogre-fixture.mjs';
import { rememberTargets, targetKnowledge } from '../src/foundry/target-memory.mjs';

test('destination visibility tracks each known reference and only penalizes losing every view',()=>{
  const s={self:{averageDamage:8},enemies:[{id:'one',lineOfSight:true},{id:'two',lineOfSight:true}]};
  assert.deepEqual(movementSight(s,{targets:{one:{lineOfSight:false},two:{lineOfSight:true}}}),
    {before:['one','two'],after:['two'],losesAll:false,penalty:0,returnPenalty:0});
  const lost=movementSight(s,{targets:{one:{lineOfSight:false},two:{lineOfSight:false}}});
  assert.equal(lost.losesAll,true);assert.equal(lost.penalty,4);
});

test('native movement lookahead checks sight at the future origin independently of legal movement',async()=>{
  const f=fixture();f.boss.checkCollision=(_destination,{type,origin}={})=>type==='sight'&&origin.y>400;
  const l=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(l);
  assert.equal(s.enemies[0].lineOfSight,true);
  const blocked=s.moves.find(m=>m.y===5&&m.x===2);assert.ok(blocked);
  assert.equal(blocked.targets[f.player.id].physicalPath,true);
  assert.equal(blocked.targets[f.player.id].lineOfSight,false);assert.equal(blocked.targets[f.player.id].lineOfEffect,false);
  assert.ok(Object.values(blocked.targets[f.player.id].strikes).every(p=>p.usable===false));
});

test('a future clear view of a known Hidden square can be valued as a follow-up attack position',async()=>{
  const f=fixture();f.boss.checkCollision=(_destination,{type,origin}={})=>type==='sight'&&origin.y<500;
  await rememberTargets(f.adapter);const check=targetKnowledge(f.adapter).checks[0];
  assert.equal(check.awareness.detection,'hidden');assert.equal(check.awareness.searchRequired,false);
  assert.equal(f.adapter.targetAt(f.adapter.originCell(),check.target,[]).lineOfEffect,false);
  const after=f.adapter.targetAt({x:2,y:4},check.target,[]);
  assert.equal(after.lineOfSight,true);assert.equal(after.lineOfEffect,true);assert.equal(after.inReach,true);
  assert.equal(f.boss.document.y,200,'preview does not move the real token');
});

test('seeing an Undetected enemy’s remembered square does not grant a projected attack',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('undetected');
  f.boss.checkCollision=(_destination,{type,origin}={})=>type==='sight'&&origin.y<500;
  f.player.document.x=1000;const check=targetKnowledge(f.adapter).checks[0];
  assert.equal(check.target.document.x,500);assert.equal(check.awareness.detection,'undetected');
  const after=f.adapter.targetAt({x:2,y:4},check.target,[]);
  assert.equal(after.lineOfSight,true);assert.equal(after.lineOfEffect,false);assert.equal(after.inReach,false);
});

test('an unlocated Invisible creature does not acquire a projected attack location when a remembered area comes into sight',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('invisible');
  f.boss.checkCollision=(_destination,{type,origin}={})=>type==='sight'&&origin.y<500;
  f.player.document.x=1000;const check=targetKnowledge(f.adapter).checks[0];
  assert.equal(check.target.document.x,500);assert.equal(check.awareness.attackOnSight,false);
  assert.equal(f.adapter.targetAt({x:2,y:4},check.target,[]).lineOfEffect,false);
});
