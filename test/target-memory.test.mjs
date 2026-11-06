import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture as makeFixture } from './helpers/ogre-fixture.mjs';
import { PF2eOgreBruteAdapter } from '../src/foundry/ogre-brute-adapter.mjs';
import { createCreatureAdapter } from '../src/foundry/creature-profiles.mjs';
import { rememberTargets, targetKnowledge, movementKnowledge } from '../src/foundry/target-memory.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';

const data=JSON.parse(await readFile(new URL('./fixtures/ogre-mechanics.json',import.meta.url)));
const fixture=()=>{
  const f=makeFixture({npcData:data,Adapter:PF2eOgreBruteAdapter});
  globalThis.Roll=class{async evaluate(){this.total=15;return this;}async toMessage(data){f.calls.push(['flat',data]);}};
  return f;
};
const memory=token=>token.document.getFlag(MODULE_ID,'targetMemory');

test('losing sight remembers the observed square rather than tracking live movement behind cover',async()=>{
  const f=fixture();await rememberTargets(f.adapter);
  assert.equal(memory(f.boss).entries[0].position.x,500);
  f.boss.checkCollision=(destination,{type}={})=>type==='sight'&&destination.x>=700;
  f.player.document.x=900;await rememberTargets(f.adapter);
  let state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(memory(f.boss).entries[0].position.x,500);
  assert.equal(state.enemies[0].awareness.position.x,500);
  assert.equal(state.enemies[0].distance,10,'distance uses remembered geometry, not the enemy’s actual square');
  assert.equal(state.enemies[0].awareness.searchRequired,true,'the remembered square is now visible and needs investigation');
  assert.equal(state.enemies[0].inReach,false,'a visible empty remembered square never becomes an attack target');
  assert.equal(f.adapter.decide(state).chosen.kind,'seek');
  f.player.document.x=1100;await rememberTargets(f.adapter);
  assert.equal(memory(f.boss).entries[0].position.x,500);
  f.boss.checkCollision=()=>false;await rememberTargets(f.adapter);
  state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(memory(f.boss).entries[0].position.x,1100);
  assert.equal(state.enemies[0].awareness.state,'observed');
});

test('an explicit Hidden enemy can be sought automatically without removing its global condition',async()=>{
  const f=fixture();f.player.actor.conditionsSet.add('hidden');
  const native=f.actor.getStatistic;
  f.actor.getStatistic=slug=>slug==='perception'?{check:{mod:20,roll:async options=>{f.calls.push(['perception',options]);return {total:35,dice:[{faces:20,total:15}]};}}}:native(slug);
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies.length,1);assert.equal(state.enemies[0].awareness.state,'known-square');
  assert.equal(state.enemies[0].awareness.searchRequired,true);
  assert.equal(state.enemies[0].lineOfEffect,true);assert.equal(state.enemies[0].concealmentDC,11);
  assert.equal(f.adapter.decide(state).chosen.kind,'seek');
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining,0);assert.equal(ledger.done,true);
  assert.equal(f.calls.filter(call=>call[0]==='perception').length,1);assert.equal(f.calls.filter(call=>call[0]==='attack').length,2);
  assert.equal(f.player.actor.hasCondition('hidden'),true,'Seek affects one observer without deleting global Hidden');
});

test('undetected enemies retain only previously observed locations; unknown newcomers are not located',async()=>{
  const f=fixture();await rememberTargets(f.adapter);
  f.player.document.x=1000;f.player.actor.conditionsSet.add('undetected');
  await rememberTargets(f.adapter);
  const known=targetKnowledge(f.adapter).checks[0];
  assert.equal(known.target.document.x,500);assert.equal(known.awareness.searchRequired,true);
  assert.equal(known.awareness.detection,'undetected','a last-known search does not locate the current undetected square');
  assert.equal(memory(f.boss).entries[0].position.x,500);
  f.combat.id='new-combat';
  const unknown=targetKnowledge(f.adapter).checks[0];
  assert.equal(unknown.target,null);assert.match(unknown.reason,/no known square/);
});

test('normal movement preserves an already-known square behind an obstacle, while Undetected and teleport do not reveal a new square',async()=>{
  const f=fixture();await rememberTargets(f.adapter);
  f.boss.checkCollision=(_destination,{type}={})=>type==='sight';
  f.player.document.x=900;
  const move={method:'dragging',passed:{waypoints:[{action:'walk'}]}};
  await rememberTargets(f.adapter,()=>true,movementKnowledge(f.player.document,move));
  assert.equal(memory(f.boss).entries[0].position.x,900);
  assert.equal(memory(f.boss).entries[0].source,'known movement');
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies[0].awareness.detection,'hidden');
  assert.equal(state.enemies[0].awareness.searchRequired,false);
  assert.ok(state.moves.length>0,'the known square behind the obstacle remains a movement goal');
  f.player.actor.conditionsSet.add('undetected');f.player.document.x=1100;
  await rememberTargets(f.adapter,()=>true,movementKnowledge(f.player.document,move));
  assert.equal(memory(f.boss).entries[0].position.x,900);
  assert.equal(movementKnowledge(f.player.document,move,{teleport:true}),null);
  assert.equal(movementKnowledge(f.player.document,{...move,passed:{waypoints:[{action:'displace'}]}}),null);
});

test('native movement knowledge never evaluates the deprecated teleport compatibility getter',()=>{
  const f=fixture(),operation={};
  Object.defineProperty(operation,'teleport',{get(){throw new Error('Deprecated teleport getter was read');}});
  const move={method:'api',passed:{waypoints:[{action:'walk'}]}};
  assert.equal(movementKnowledge(f.player.document,move,operation).tokenId,f.player.id);
  assert.equal(movementKnowledge(f.player.document,{...move,passed:{waypoints:[{action:'displace'}]}},operation),null);
});

test('custom native teleport actions never broadcast a new remembered square',()=>{
  const f=fixture(),previous=globalThis.CONFIG;
  globalThis.CONFIG={Token:{movement:{actions:{portal:{teleport:true},walk:{teleport:false}}}}};
  try{
    const move={method:'api',passed:{waypoints:[{action:'walk'},{action:'portal'}]}};
    assert.equal(movementKnowledge(f.player.document,move),null);
  }finally{globalThis.CONFIG=previous;}
});

test('target knowledge is per observer and persists when an adapter is recreated',async()=>{
  const f=fixture();await rememberTargets(f.adapter);
  f.boss.checkCollision=()=>true;f.player.document.x=900;
  const other=f.token('other',f.makeActor('other',data),900,900,2);
  f.combat.combatants.push({id:'c-other',tokenId:other.id,sceneId:'scene',actor:other.actor});
  f.flags.set(`token-other:${MODULE_ID}:config`,{enabled:true,packMorale:false});
  const second=createCreatureAdapter(other,null,{reactions:f.reactions});await rememberTargets(second);
  assert.equal(memory(f.boss).entries[0].position.x,500);
  assert.equal(memory(other).entries[0].position.x,900);
  const rebuilt=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
  assert.equal(targetKnowledge(rebuilt).checks[0].target.document.x,500);
});

test('Preview projects knowledge without creating saved memory or altering the target document',async()=>{
  const f=fixture();f.boss.checkCollision=(_destination,{type}={})=>type==='sight';
  const before={x:f.player.document.x,y:f.player.document.y};
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies[0].awareness.state,'known-square');
  assert.equal(memory(f.boss),undefined);
  assert.deepEqual({x:f.player.document.x,y:f.player.document.y},before);
});

test('Blinded hearing locates ordinary enemies but never tracks Undetected movement; unconscious observers learn nothing',async()=>{
  const f=fixture();await rememberTargets(f.adapter);
  f.actor.conditionsSet.add('blinded');f.player.document.x=600;
  await rememberTargets(f.adapter);
  assert.equal(memory(f.boss).entries[0].position.x,600);
  assert.equal(targetKnowledge(f.adapter).checks[0].awareness.detection,'hidden');
  f.player.actor.conditionsSet.add('undetected');f.player.document.x=650;
  await rememberTargets(f.adapter);
  assert.equal(memory(f.boss).entries[0].position.x,600,'Sneak prevents ambient hearing from following the live square');
  f.player.actor.conditionsSet.delete('undetected');
  f.actor.conditionsSet.delete('blinded');f.actor.conditionsSet.add('unconscious');f.player.document.x=700;
  await rememberTargets(f.adapter);
  assert.equal(memory(f.boss).entries[0].position.x,600);
  f.actor.conditionsSet.delete('unconscious');await rememberTargets(f.adapter);
  assert.equal(memory(f.boss).entries[0].position.x,700);
});

test('concealment preserves observed position updates and uses automatic flat checks rather than Seek',async()=>{
  const f=fixture();await rememberTargets(f.adapter);
  f.player.actor.conditionsSet.add('concealed');f.player.document.x=600;
  await rememberTargets(f.adapter);
  assert.equal(memory(f.boss).entries[0].position.x,600);
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies[0].awareness.detection,'observed');
  assert.equal(state.enemies[0].awareness.flatCheckRequired,true);
  assert.equal(state.enemies[0].lineOfEffect,true);assert.equal(state.enemies[0].concealmentDC,5);
  assert.equal(f.adapter.candidates(state).some(c=>c.kind==='seek'),false);
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0);assert.ok(f.calls.some(c=>c[0]==='flat'));assert.ok(f.calls.some(c=>c[0]==='attack'));
});

test('a commanded Ogre spends its restricted movement action to gain sight even by moving farther away',async()=>{
  const f=makeFixture(),ally=f.token('brute',f.makeActor('brute',data),900,500,2);
  globalThis.Roll=class{async evaluate(){this.total=15;return this;}async toMessage(data){f.calls.push(['flat',data]);}};
  f.combat.combatants.push({id:'c-brute',tokenId:ally.id,sceneId:'scene',actor:ally.actor});
  f.flags.set(`token-brute:${MODULE_ID}:config`,{enabled:true,packMorale:false,applyDamage:true,refuseCount:0});
  await f.adapter.execute({kind:'bellow'},{turn:f.adapter.turnKey(),attacksMade:0},{canContinue:()=>true});
  f.combat.turn=2;f.combat.combatant=f.combat.turns[2];
  f.player.actor.conditionsSet.add('hidden');
  ally.checkCollision=(_destination,{type,origin=ally.center}={})=>type==='sight'&&origin.y<850;
  const adapter=createCreatureAdapter(ally,null,{reactions:f.reactions});
  const before=await adapter.readLedger(adapter.turnKey());
  const decision=adapter.decide(await adapter.snapshot(before));
  assert.ok(['stride','step'].includes(decision.chosen.kind));
  assert.equal(decision.chosen.bonusActionCost,1);
  assert.match(decision.chosen.intent,/regain sight/);
  const ledger=await new TurnRunner(adapter).run({oneAction:true});
  assert.equal(ledger.actionsRemaining,3);assert.equal(ledger.bonusMovementActions,0);
  assert.ok(ally.document.y>=800,'moves to a clear view rather than closer to the enemy');
  const held=await new TurnRunner(adapter).run();
  assert.equal(held.actionsRemaining,0);assert.equal(held.done,true);
  assert.equal(f.player.actor.hasCondition('hidden'),true);
});
