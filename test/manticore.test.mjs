import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/manticore-fixture.mjs';
import {creatureProfile,createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {poisonStage} from '../src/framework/poison.mjs';
import {exposeToPoison,advancePoisons,expirePoisons,installPoisonHooks} from '../src/foundry/poison-effects.mjs';
const ns='foundry-creature-ai',effect=f=>f.player.actor.itemTypes.effect.find(e=>e.flags?.[ns]?.poison);
const data=f=>effect(f)?.flags[ns].poison;

test('supplied scorpion-tail Manticore binds three native melee weapons and shared flight, without spike attacks or Eagle Dive',async()=>{
 const f=fixture({altitude:25}),adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 assert.equal(creatureProfile(f.actor).id,'manticore-scorpion');
 assert.equal(adapter.parts().stinger.item.reach,10);assert.equal(adapter.planningReach(),10);
 assert.equal(adapter.parts().claw.variants[1].penalty,-4);assert.deepEqual(adapter.parts().unsupported,[]);
 const state=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
 assert.equal(state.flight.speed,40);assert.equal(state.strikes.length,3);
 assert.ok(state.strikes.every(s=>!s.ranged));assert.ok(!adapter.candidates(state).some(c=>c.kind==='eagleDive'));
 assert.equal(f.calls.length,0,'preview performs no saves, damage, or document mutations');
 f.actor.system.actions.find(s=>s.item.name==='Stinger').item.system.attackEffects.value=[];
 assert.equal(creatureProfile(f.actor).id,'basic-npc','regular spike variants do not inherit this venom profile');
});

test('melee flying Manticore completes Fly, Stinger, Fly and ends outside known enemy reach',async()=>{
 const f=fixture({altitude:25});f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const state=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
 assert.equal(adapter.decide(state).chosen.kind,'fly');
 const result=await new TurnRunner(adapter).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);
 assert.equal(f.calls.find(c=>c[0]==='attack')[2],adapter.parts().stinger.item.id);
 assert.equal(f.calls.filter(c=>['move','attack'].includes(c[0])).at(-1)[0],'move');
 assert.ok(f.boss.document.elevation>=25);assert.equal(f.calls.filter(c=>c[0]==='venom-save').length,1);
});

test('venom stage transitions distinguish exposure from recovery saves and clamp at stage three',()=>{
 assert.deepEqual([0,1,2,3].map(d=>poisonStage(0,d,{exposure:true})),[2,1,0,0]);
 assert.deepEqual([0,1,2,3].map(d=>poisonStage(2,d)),[3,3,1,0]);
 assert.equal(poisonStage(2,3,{exposure:true}),2);
 assert.throws(()=>poisonStage(1,null),/resolved native/);
});

test('native venom exposure rolls Fortitude DC 22, applies poison IWR and grants owned stage Enfeebled',async()=>{
 const f=fixture();await exposeToPoison(f.adapter,f.player);
 assert.equal(data(f).stage,1);assert.equal(data(f).uncertain,false);
 const save=f.calls.find(c=>c[0]==='venom-save')[1];assert.equal(save.dc.value,22);assert.equal(save.skipDialog,true);
 assert.equal(save.item,f.adapter.parts().venom);assert.ok(save.extraRollOptions.includes('poison'));
 const damage=f.calls.find(c=>c[0]==='damage-applied');assert.equal(damage[2].damage.formula,'1d10[poison]');
 assert.equal(damage[2].item,effect(f));assert.ok(damage[2].rollOptions.has('poison'));
 assert.equal(effect(f).system.rules[0].inMemoryOnly,true);assert.equal(effect(f).system.rules[0].alterations[0].value,1);
 assert.equal(f.calls.some(c=>c[0]==='condition'),false,'an independently applied Enfeebled is never overwritten');
});

test('initial critical failure starts at stage two; successful first exposure creates no effect or damage',async()=>{
 const f=fixture();f.degrees=[0];await exposeToPoison(f.adapter,f.player);assert.equal(data(f).stage,2);
 assert.equal(f.calls.find(c=>c[0]==='poison-damage')[1],'2d10[poison]');
 for(const degree of [2,3]){
  const g=fixture();g.degrees=[degree];assert.equal((await exposeToPoison(g.adapter,g.player)).saved,true);
  assert.equal(effect(g),undefined);assert.equal(g.calls.some(c=>c[0]==='damage-applied'),false);
 }
});

test('repeated poison exposure escalates on failure, preserves maximum duration, and never recovers on success',async()=>{
 const f=fixture();await exposeToPoison(f.adapter,f.player);const expiry=data(f).expiresAt;
 game.time.worldTime=6;game.combat.round=2;f.degrees=[3,0];
 await exposeToPoison(f.adapter,f.player);assert.equal(data(f).stage,1);
 await exposeToPoison(f.adapter,f.player);assert.equal(data(f).stage,3);
 assert.equal(data(f).expiresAt,expiry);assert.equal(data(f).expiresRound,7);
 assert.equal(effect(f).system.rules[0].alterations[0].value,2);
 assert.equal(f.player.actor.itemTypes.effect.length,1);
});

test('end-turn poison save recovers, repeats damage at the cap, and cannot resolve the same end-turn twice',async()=>{
 const f=fixture();f.degrees=[0,1,1,3,2];await exposeToPoison(f.adapter,f.player);
 await advancePoisons(f.player);assert.equal(data(f).stage,3);
 const saves=f.calls.filter(c=>c[0]==='venom-save').length;
 await advancePoisons(f.player);assert.equal(f.calls.filter(c=>c[0]==='venom-save').length,saves);
 game.combat.round++;await advancePoisons(f.player);assert.equal(data(f).stage,3);
 game.combat.round++;await advancePoisons(f.player);assert.equal(data(f).stage,1);
 game.combat.round++;await advancePoisons(f.player);assert.equal(effect(f),undefined);
 assert.deepEqual(f.calls.filter(c=>c[0]==='poison-damage').map(c=>c[1]),['2d10[poison]','2d10[poison]','2d10[poison]','1d10[poison]']);
});

test('maximum duration expiry removes only the owned venom effect and its granted condition',async()=>{
 const f=fixture();f.player.actor.conditionsSet.add('enfeebled');await exposeToPoison(f.adapter,f.player);
 game.time.worldTime=36;await expirePoisons();assert.equal(effect(f),undefined);
 assert.equal(f.player.actor.hasCondition('enfeebled'),true);assert.equal(f.calls.filter(c=>c[0]==='venom-save').length,1);
});

test('poison immunity and an existing externally managed venom avoid duplicate saves and effects',async()=>{
 const f=fixture();f.player.actor.attributes.immunities.push({type:'poison'});
 assert.equal((await exposeToPoison(f.adapter,f.player)).immune,true);assert.equal(f.calls.length,0);
 f.player.actor.attributes.immunities=[];
 await f.player.actor.createEmbeddedDocuments('Item',[{name:'Manticore Venom',type:'effect',system:{slug:'manticore-venom'}}]);
 assert.equal((await exposeToPoison(f.adapter,f.player)).external,true);assert.equal(f.calls.some(c=>c[0]==='venom-save'),false);
});

test('cancelled ongoing poison saves reserve their interval and cannot silently reroll on retry',async()=>{
 const f=fixture();await exposeToPoison(f.adapter,f.player);f.degrees=[null];
 await assert.rejects(advancePoisons(f.player),/cancelled/);assert.equal(data(f).uncertain,true);
 await assert.rejects(advancePoisons(f.player),/unresolved/);
 game.combat.round++;await assert.rejects(advancePoisons(f.player),/unresolved/);
 assert.equal(f.calls.filter(c=>c[0]==='venom-save').length,2);
});

test('end-turn hooks hold the shared reaction barrier through the venom save and stage damage',async t=>{
 const f=fixture(),handlers=new Map(),errors=[];await exposeToPoison(f.adapter,f.player);
 const previous=globalThis.Hooks;globalThis.Hooks={on:(name,fn)=>handlers.set(name,fn)};
 t.after(()=>{globalThis.Hooks=previous;});
 let finish;
 f.player.actor.getStatistic=()=>({check:{roll:()=>new Promise(resolve=>{finish=resolve;})}});
 installPoisonHooks({reactions:f.reactions,onError:error=>errors.push(error)});
 handlers.get('pf2e.endTurn')({tokenId:f.player.id,getFlag:()=>game.combat.round},game.combat);
 assert.equal(f.reactions.barrier.pending,true);
 await new Promise(resolve=>setImmediate(resolve));
 finish({degreeOfSuccess:1});await f.reactions.barrier.wait();
 assert.equal(data(f).stage,2);assert.equal(data(f).uncertain,false);assert.deepEqual(errors,[]);
 assert.equal(f.calls.filter(c=>c[0]==='poison-damage').length,2);
});

test('manual damage mode creates native poison damage buttons and pauses; non-active GMs do not resolve venom',async()=>{
 const f=fixture();f.flags.get(`token-boss:${ns}:config`).applyDamage=false;
 assert.equal((await exposeToPoison(f.adapter,f.player)).pause,true);
 assert.equal(f.calls.find(c=>c[0]==='poison-damage')[2].flags.pf2e.suppressDamageButtons,false);
 assert.equal(f.calls.some(c=>c[0]==='damage-applied'),false);
 game.user.id='other';assert.equal((await exposeToPoison(f.adapter,f.player)).skipped,true);
});

test('a native Stinger miss does not expose venom and its critical hit applies one exposure',async()=>{
 for(const degree of [1,3]){
  const f=fixture({attackDegree:degree});f.player.document.x=400;
  const strike=f.adapter.parts().stinger,ledger={...await f.adapter.readLedger(f.adapter.turnKey()),attacksMade:1};
  await f.adapter.executeProfileAction({kind:'strike',targetId:f.player.id,strikeId:strike.item.id},ledger);
  assert.equal(f.calls.filter(c=>c[0]==='venom-save').length,degree===3?1:0);
 }
});

test('Manticore planning remembers its own Stinger hits regardless of secret saving throw result',async()=>{
 const f=fixture(),choice={kind:'strike',targetId:f.player.id,strikeId:f.adapter.parts().stinger.item.id};
 await f.adapter.recordOutcome(choice,{}, {lastAction:{hit:true}});
 const first=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 const score=first.enemies[0].strikeEffectValues[choice.strikeId];
 f.player.actor.getStatistic=()=>{throw new Error('Planning may not inspect secret target Fortitude');};
 await f.player.actor.createEmbeddedDocuments('Item',[{name:'Secret venom',type:'effect',system:{slug:'secret-venom'},flags:{[ns]:{poison:{id:'manticore-venom',stage:3}}}}]);
 const second=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.equal(second.enemies[0].strikeEffectValues[choice.strikeId],score);
 assert.deepEqual(f.boss.document.getFlag(ns,'manticoreHunts').hits,{fighter:1});
});
