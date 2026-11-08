import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {fixture as eagleFixture} from './helpers/eagle-fixture.mjs';
import {fixture as pyroFixture} from './helpers/pyro-fixture.mjs';
import {BrowserWorker} from './helpers/browser-worker.mjs';
import {decisionWorker} from '../src/foundry/decision-runtime.mjs';
import {planningWorker} from '../src/foundry/planning-worker.mjs';
import {planningData,decisionModel} from '../src/foundry/decision-snapshot.mjs';
import {planCreatureDecision} from '../src/framework/decision-engine.mjs';
import {planningBudget} from '../src/shared/planning-budget.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
const lich=JSON.parse(await readFile(new URL('./fixtures/lich-mechanics.json',import.meta.url)));
function enable(t){const old=globalThis.Worker;globalThis.Worker=BrowserWorker;decisionWorker.failed=false;t.after(()=>{decisionWorker.close();if(old)globalThis.Worker=old;else delete globalThis.Worker;});const get=game.settings.get;game.settings.get=(ns,key)=>key==='decisionPlanningBackend'?'worker':get(ns,key);}
test('Lich preparation yields and its complete decision/forecast runs in a real worker',async t=>{
 const f=fixture({npcData:lich,size:12});enable(t);let ticks=0;const timer=setInterval(()=>ticks++,1);t.after(()=>clearInterval(timer));
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey())),before=decisionWorker.completed;
 assert.equal(state.behavior.selection,undefined,'tactics are deferred to the worker');assert.doesNotThrow(()=>structuredClone(planningData(state)));
 const decision=await f.adapter.planDecision(state);assert.equal(decisionWorker.completed,before+1);assert.equal(decision.diagnostics.decisionPlanning.backend,'worker');assert.ok(ticks>0);assert.ok(state.diagnostics.preparation.yields>0);assert.ok(decision.chosen);
 const local=planCreatureDecision({state:planningData(state),model:decisionModel(f.adapter,state)});
 assert.ok(local.tiedIds.includes(decision.chosen.id)||local.chosen.id===decision.chosen.id);
});
test('a worker-backed complete Lich turn revalidates and spends real actions without freezing the caller',async t=>{
 const previous=globalThis.fromUuid;globalThis.fromUuid=async()=>({toObject:()=>({name:'Native support effect fixture',type:'effect',system:{slug:'native-support',rules:[],duration:{value:1,unit:'rounds'},level:{value:1}}})});t.after(()=>{if(previous)globalThis.fromUuid=previous;else delete globalThis.fromUuid;});
 const f=fixture({npcData:lich,size:10});for(const item of f.actor.itemTypes.spell)item.loadVariant=({castRank})=>({...item,rank:castRank});f.player.document.x=f.boss.document.x+200;f.player.document.y=f.boss.document.y;enable(t);const result=await new TurnRunner(f.adapter).run();assert.equal(result.uncertain,false);assert.ok(result.done||result.actionsRemaining===0);assert.ok(decisionWorker.completed>=2);
});
test('an airborne melee profile uses the same decision worker',async t=>{
 const f=eagleFixture({altitude:25});enable(t);const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),state=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()),{movement:false});
 const result=await adapter.planDecision(state);assert.equal(result.diagnostics.decisionPlanning.backend,'worker');
});
test('flight route and decision workers cooperate through a complete Eagle Dive turn',async t=>{
 const f=eagleFixture({altitude:25});enable(t);planningWorker.failed=false;t.after(()=>planningWorker.close());
 f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),before=decisionWorker.completed,result=await new TurnRunner(adapter).run();
 assert.equal(result.uncertain,false);assert.ok(result.done||result.actionsRemaining===0);assert.ok(decisionWorker.completed>before);assert.ok(planningWorker.completed>0);assert.ok(f.calls.some(c=>c[0]==='attack'));
});
test('movement while the worker is thinking invalidates its result before a reservation',async t=>{
 const f=fixture({npcData:lich,size:10});enable(t);const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false});
 const result=f.adapter.planDecision(state);f.player.document.x+=100;await assert.rejects(result,{name:'StalePlanningError'});assert.equal(ledger.actionsRemaining,3);
});
test('Stop cancels a pending decision and leaves the action budget untouched',async t=>{
 const f=fixture({npcData:lich,size:10});enable(t);const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false}),controller=new AbortController();
 const result=f.adapter.planDecision(state,{signal:controller.signal});controller.abort();await assert.rejects(result,{name:'AbortError'});assert.equal(ledger.actionsRemaining,3);assert.equal(decisionWorker.pending.size,0);assert.equal(decisionWorker.worker,null,'cancel interrupts the CPU job instead of queuing another turn behind it');
});
test('a Region or condition change invalidates a result even when token coordinates stayed the same',async t=>{
 const f=fixture({npcData:lich,size:10});enable(t);const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false});
 const pending=f.adapter.planDecision(state);Hooks.callAll('updateRegion',{});await assert.rejects(pending,{name:'StalePlanningError'});assert.equal(ledger.actionsRemaining,3);
});
test('worker unavailability pauses rather than silently running the forecast on the interface thread',async t=>{
 const f=fixture({npcData:lich,size:10});enable(t);const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false});
 decisionWorker.failed=true;const native=f.adapter.decide;f.adapter.decide=()=>{throw new Error('Unwanted native fallback');};t.after(()=>{f.adapter.decide=native;});
 await assert.rejects(f.adapter.planDecision(state),/Decision Web Worker unavailable/);
});
test('Scout field scoring also runs in the worker after batched native graph preparation',async t=>{
 const data=JSON.parse(await readFile(new URL('./fixtures/kobold-scout-mechanics.json',import.meta.url))),f=fixture({npcData:data,size:10});enable(t);
 f.actor.sourceId=data.source;f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const before=decisionWorker.completed,state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));assert.ok(state.tactical);assert.ok(decisionWorker.completed>before);assert.equal((await f.adapter.planDecision(state)).diagnostics.decisionPlanning.backend,'worker');
});
for(const directive of ['confused','fleeing'])test(`${directive} keeps its condition policy in the decision worker`,async t=>{
 const f=fixture({npcData:lich,size:10});f.actor.conditionsSet.add(directive);enable(t);const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false});
 const result=await f.adapter.planDecision(state);assert.match(result.reason,new RegExp(directive));assert.equal(result.diagnostics.decisionPlanning.backend,'worker');
});
test('planning data refuses live Documents and executable values',()=>{
 class Document{}assert.throws(()=>planningData({actor:new Document()}),/Live planning object/);assert.throws(()=>planningData({roll(){}}),/Non-data/);
});
test('native preparation batches can be cancelled between work items',async()=>{
 const controller=new AbortController(),work=planningBudget({signal:controller.signal,milliseconds:0});await work.checkpoint();controller.abort();await assert.rejects(work.checkpoint(),{name:'AbortError'});
});
for(const kind of ['wolf','ogre-boss','ogre','kobold-scout','goblin-pyro','dero-magister','vampire-guardian','vampire-count','vampire-mastermind','cinder-dragon-young','cinder-dragon-caster-young','manticore-scorpion','manticore-quill'])test(`${kind} produces legal worker candidates with its own kit`,async t=>{
 let data=JSON.parse(await readFile(new URL(`./fixtures/${kind}-mechanics.json`,import.meta.url)));
 if(kind==='wolf'){
  const source=data;data=structuredClone(lich);data.system.traits.value=['animal'];data.system.details.level.value=2;
  const jaws=structuredClone(lich.items.find(i=>i.type==='melee'));jaws._id='wolf-jaws';jaws.name=source.jaws.name;jaws.system.attackEffects={value:source.jaws.attackEffects};jaws.system.damageRolls=source.jaws.damageRolls;
  data.items=[jaws,...source.abilities.map((a,i)=>({...a,_id:`wolf-ability-${i}`,type:'action'}))];
 }
 const f=kind==='goblin-pyro'?pyroFixture({size:10}):fixture({npcData:data,size:10});enable(t);
 f.actor.sourceId=data.source??data._stats?.compendiumSource??f.actor.sourceId;f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 assert.equal(f.adapter.profileId,kind==='cinder-dragon-young'?'cinder-dragon':kind==='cinder-dragon-caster-young'?'cinder-dragon-caster':kind);
 if(kind==='wolf')for(const strike of f.actor.system.actions)strike.item.attackEffects=strike.item.system.attackEffects?.value??[];
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false}),result=await f.adapter.planDecision(state);
 assert.equal(result.diagnostics.decisionPlanning.backend,'worker');assert.ok(result.chosen);
 if(result.chosen.kind!=='endTurn')assert.ok((await f.adapter.planningCandidates(state)).some(c=>c.id===result.chosen.id&&c.legal));
});
