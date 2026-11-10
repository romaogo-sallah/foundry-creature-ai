import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {formSpellcastingRestriction} from '../src/foundry/form-restrictions.mjs';
import {guardCast,guardItemMessage,checkRestriction} from '../src/foundry/action-restrictions.mjs';
import {conditionFacts,manualConditionViolation} from '../src/foundry/condition-actions.mjs';
import {conditionViolation} from '../src/framework/condition-rules.mjs';
import {executeSpell} from '../src/foundry/spellcasting.mjs';
import {genericCastingCandidates} from '../src/framework/generic-casting.mjs';
import {BrowserWorker} from './helpers/browser-worker.mjs';
import {decisionWorker} from '../src/foundry/decision-runtime.mjs';
const ns='foundry-creature-ai',mastermind=JSON.parse(await readFile(new URL('./fixtures/vampire-mastermind-mechanics.json',import.meta.url)));

test('polymorph alone permits casting, while active native battle forms respect their canCast exception',()=>{
 const actor={flags:{pf2e:{polymorphed:true}},rules:[]};assert.equal(formSpellcastingRestriction(actor),null);
 actor.flags.pf2e.battleForm=true;assert.match(formSpellcastingRestriction(actor),/battle form/);
 actor.rules=[{key:'BattleForm',canCast:true}];assert.equal(formSpellcastingRestriction(actor),null);
 actor.rules[0].canCast=false;assert.match(formSpellcastingRestriction(actor),/battle form/);
 actor.flags.pf2e.battleForm=false;actor.rules[0].ignored=true;assert.equal(formSpellcastingRestriction(actor),null);
 actor.rules[0].ignored=false;actor.rules[0].item={isExpired:true};assert.equal(formSpellcastingRestriction(actor),null);
});

test('vampire bat and mist cannot cast; native Vapor Form also restricts manual characters',async()=>{
 const f=fixture({npcData:mastermind});
 for(const form of ['bat','mist']){await f.actor.setFlag(ns,'vampire',{form});assert.ok(formSpellcastingRestriction(f.actor));
  assert.ok(conditionViolation(conditionFacts(f.actor),{kind:'castSpell'}));assert.equal(manualConditionViolation(f.actor,{kind:'fly',traits:['move']}),null);}
 await f.actor.setFlag(ns,'vampire',{form:'vampire'});assert.equal(formSpellcastingRestriction(f.actor),null);
 const vapor={id:'vapor',type:'effect',slug:'spell-effect-vapor-form',system:{}};f.player.actor.items.set(vapor.id,vapor);
 assert.match(formSpellcastingRestriction(f.player.actor),/Vapor Form/);vapor.isExpired=true;assert.equal(formSpellcastingRestriction(f.player.actor),null);
});

test('manual spellcasting and spell attacks are blocked before native calls while browsing and saves remain possible',async()=>{
 const f=fixture({npcData:mastermind});await f.actor.setFlag(ns,'vampire',{form:'bat'});let calls=0;
 globalThis.ui={notifications:{warn:()=>{}}};const spell=f.actor.itemTypes.spell[0];
 await guardCast.call({actor:f.actor},()=>calls++,spell,{});
 await guardItemMessage.call(spell,()=>calls++,null,{actualCast:true});assert.equal(calls,0);
 await guardItemMessage.call(f.actor.itemTypes.action.find(a=>a.slug==='vampire-true-dominate'),()=>calls++,null,{actualUse:true});assert.equal(calls,0,'the innate-spell ability card has the same restriction');
 await guardItemMessage.call(spell,()=>calls++,null,{});assert.equal(calls,1);
 assert.ok(checkRestriction({}, {actor:f.actor,item:spell,type:'attack-roll',action:'spell-attack-roll'}));
 assert.equal(checkRestriction({}, {actor:f.actor,item:spell,type:'saving-throw'}),null);
 await f.actor.setFlag(ns,'vampire',{form:'vampire'});await guardCast.call({actor:f.actor},()=>calls++,spell,{});assert.equal(calls,2);
});

for(const backend of ['native','worker'])test(`${backend}: a bat has no casting candidates and can revert on the ground`,async t=>{
 const f=fixture({npcData:mastermind});await f.actor.setFlag(ns,'vampire',{form:'bat'});
 if(backend==='worker'){const old=globalThis.Worker;globalThis.Worker=BrowserWorker;decisionWorker.failed=false;const get=game.settings.get;
  game.settings.get=(ns,key)=>key==='decisionPlanningBackend'?'worker':get(ns,key);t.after(()=>{decisionWorker.close();if(old)globalThis.Worker=old;else delete globalThis.Worker;});}
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false});
 assert.ok(state.spells.length);assert.ok(state.spells.every(s=>!s.available));
 const candidates=await f.adapter.planningCandidates(state);assert.equal(candidates.some(c=>c.kind==='castSpell'),false);
 assert.ok(candidates.some(c=>c.kind==='vampireForm'&&c.form==='vampire'));
 await f.actor.setFlag(ns,'vampire',{form:'vampire'});const restored=await f.adapter.snapshot(ledger,{movement:false});assert.ok(restored.spells.some(s=>s.available));
});

test('a form change before AI commitment skips casting without consuming a slot',async()=>{
 const f=fixture({npcData:mastermind}),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false});
 const choice=genericCastingCandidates(state).find(c=>c.spellSlug==='haste');assert.ok(choice);
 await f.actor.setFlag(ns,'vampire',{form:'bat'});const result=await executeSpell(f.adapter,choice,ledger);
 assert.equal(result.skipped,true);assert.match(result.skipReason,/bat/);assert.equal(f.calls.some(c=>c[0]==='consume-spell'),false);
});

test('a transformation during a casting reaction prevents completion while keeping committed costs',async()=>{
 const f=fixture({npcData:mastermind}),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false});
 const choice=genericCastingCandidates(state).find(c=>c.spellSlug==='haste');
 f.reactions.beforeSpell=async()=>{await f.actor.setFlag(ns,'vampire',{form:'bat'});return false;};
 const result=await executeSpell(f.adapter,choice,ledger);assert.equal(result.skipped,undefined);assert.match(result.note,/committed/);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);assert.equal(f.actor.itemTypes.effect.some(e=>e.flags?.[ns]?.supportSpell?.slug==='haste'),false);
});
