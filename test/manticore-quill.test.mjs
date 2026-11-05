import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/quill-fixture.mjs';
import {creatureProfile,createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {quillSupply,consumeSpikes,setSpikesRemaining} from '../src/foundry/spike-supply.mjs';
import {applySpikePin} from '../src/foundry/spike-pin.mjs';
import {escapeBindings,escapeOptions,executeEscape} from '../src/foundry/escape.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
const ns='foundry-creature-ai';
const ledger=async f=>({...await f.adapter.readLedger(f.adapter.turnKey()),attacksMade:1});
const choice=(f,mode='pin',targetIds=[f.player.id])=>({kind:'spikeVolley',mode,targetId:targetIds[0],targetIds,strikeId:f.adapter.parts().spike.item.id});

test('supplied Quill Tail binds the native one-action Volley and ranged Spike without scorpion venom',async()=>{
 const f=fixture(),parts=f.adapter.parts();
 assert.equal(creatureProfile(f.actor).id,'manticore-quill');assert.equal(parts.spike.item.system.range.increment,40);
 assert.equal(parts.volley.actionCost.value,1);assert.equal(parts.claw.variants[1].penalty,-4);assert.deepEqual(parts.unsupported,[]);
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false});
 assert.equal(state.volley.remaining,12);assert.equal(state.strikes.find(s=>s.id===parts.spike.item.id).ranged,true);
 assert.ok(f.adapter.candidates(state).some(c=>c.kind==='spikeVolley'&&c.mode==='pin'));
 assert.equal(f.calls.length,0,'preview has no charges, rolls, or document writes');
});

test('quill supply persists across combat resets and heals, regrows only spent spikes after 24 hours',async()=>{
 const f=fixture();await consumeSpikes(f.actor,2);game.time.worldTime=100;await consumeSpikes(f.actor,1);
 game.combat.id='another-fight';f.actor.hitPoints.value=90;assert.equal(quillSupply(f.actor).remaining,9);
 game.time.worldTime=86400;assert.equal(quillSupply(f.actor).remaining,11);
 game.time.worldTime=86500;assert.equal(quillSupply(f.actor).remaining,12);
 await setSpikesRemaining(f.actor,1);await assert.rejects(consumeSpikes(f.actor,2),/Not enough/);
 await assert.rejects(setSpikesRemaining(f.actor,13),/0 to 12/);
});

test('concurrent resource reservations cannot spend the same final spike twice',async()=>{
 const f=fixture();await setSpikesRemaining(f.actor,1);
 const result=await Promise.allSettled([consumeSpikes(f.actor,1),consumeSpikes(f.actor,1)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(quillSupply(f.actor).remaining,0);
});

test('two-target Volley uses one action and one MAP increment, with both native attacks at pre-Volley MAP',async()=>{
 const f=fixture();const other=f.addTarget('other',700,200);
 f.adapter.decide=state=>({chosen:f.adapter.candidates(state).find(c=>c.kind==='spikeVolley'&&c.mode==='split'),diagnostics:state.diagnostics});
 const result=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(result.actionsRemaining,2);assert.equal(result.attacksMade,1);assert.equal(result.uncertain,false);
 const attacks=f.calls.filter(c=>c[0]==='attack');assert.equal(attacks.length,2);assert.deepEqual(attacks.map(c=>c[3]),[0,0]);
 assert.deepEqual(attacks.map(c=>c[4].target.id),[f.player.id,other.id]);assert.equal(quillSupply(f.actor).remaining,10);
 assert.equal(f.player.actor.itemTypes.effect.length,0);assert.equal(other.actor.itemTypes.effect.length,0);
});

test('split Volley after an earlier attack keeps MAP -5 for both attacks',async()=>{
 const f=fixture(),other=f.addTarget('other');
 await f.adapter.executeProfileAction(choice(f,'split',[f.player.id,other.id]),{...await ledger(f),attacksMade:2});
 assert.deepEqual(f.calls.filter(c=>c[0]==='attack').map(c=>c[3]),[1,1]);
});

test('pin Volley rolls one Strike and one spike damage even on a critical hit, charges two spikes and grants Immobilized',async()=>{
 const f=fixture({attackDegree:3});await f.adapter.executeProfileAction(choice(f),await ledger(f));
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);assert.equal(f.calls.filter(c=>c[0]==='critical-roll').length,1);
 assert.equal(f.calls.filter(c=>c[0]==='damage-roll').length,0);assert.equal(quillSupply(f.actor).remaining,10);
 const effect=f.player.actor.itemTypes.effect[0];assert.equal(effect.flags[ns].escapeDC,23);
 assert.equal(effect.system.rules[0].inMemoryOnly,true);assert.ok(effect.system.rules[0].uuid.endsWith('eIcWbB5o3pP6OIMe'));
 await applySpikePin(f.adapter,f.player);assert.equal(f.player.actor.itemTypes.effect.length,1,'same pin is not applied twice');
});

test('a missed pin Volley spends its spikes but never pins the target',async()=>{
 const f=fixture({attackDegree:1});await f.adapter.executeProfileAction(choice(f),await ledger(f));
 assert.equal(quillSupply(f.actor).remaining,10);assert.equal(f.player.actor.itemTypes.effect.length,0);
});

test('failed concealment flat checks consume two pin spikes without rolling an attack or creating a pin',async t=>{
 const f=fixture();f.player.actor.conditionsSet.add('concealed');
 const previous=globalThis.Roll;globalThis.Roll=class{total=1;async evaluate(){return this;}async toMessage(){}};
 t.after(()=>{globalThis.Roll=previous;});
 const result=await f.adapter.executeProfileAction(choice(f),await ledger(f));
 assert.equal(result.lastAction.hit,false);assert.equal(quillSupply(f.actor).remaining,10);
 assert.equal(f.calls.some(c=>c[0]==='attack'),false);assert.equal(f.player.actor.itemTypes.effect.length,0);
});

test('a hidden Volley attacker reveals after its first Strike instead of granting Hidden benefits to both attacks',async()=>{
 const f=fixture(),other=f.addTarget('other');
 f.actor.conditionsSet.add('concealed');
 await f.boss.document.setFlag(ns,'stealth',{combatId:game.combat.id,sceneId:canvas.scene.id,
  entries:[f.player,other].map(t=>({observerId:t.id,state:'hidden',knownPosition:{x:200,y:200,elevation:0,level:'ground',width:2,height:2}}))});
 await f.adapter.executeProfileAction(choice(f,'split',[f.player.id,other.id]),await ledger(f));
 const attacks=f.calls.filter(c=>c[0]==='attack');
 assert.equal(attacks[0][4].options.includes('target:condition:off-guard'),true);
 assert.equal(attacks[1][4].options.includes('target:condition:off-guard'),false);
});

test('a pin records Escape DC 23 and a successful Escape deletes that source while preserving another Immobilized cause',async()=>{
 const f=fixture();await applySpikePin(f.adapter,f.player);f.player.actor.conditionsSet.add('immobilized');
 const adapter={actor:f.player.actor,token:f.player};const pin=escapeBindings(f.player.actor).find(g=>g.root.flags?.[ns]?.restraint==='spike-pin');
 const option=escapeOptions(adapter).find(e=>e.id===pin.id);assert.equal(option.dc,23);assert.equal(option.target,null);
 await executeEscape(adapter,{escapeId:pin.id,statistic:option.statistic,estimate:{dc:23}},await ledger(f),()=>true);
 assert.equal(f.player.actor.itemTypes.effect.length,0);assert.equal(f.player.actor.hasCondition('immobilized'),true);
});

test('split Volley rejects targets more than twenty feet apart before spending spikes or rolling',async()=>{
 const f=fixture(),other=f.addTarget('other',1200,200),state=await f.adapter.snapshot(await ledger(f),{movement:false});
 assert.ok(!f.adapter.candidates(state).some(c=>c.kind==='spikeVolley'&&c.mode==='split'));
 const result=await f.adapter.executeProfileAction(choice(f,'split',[f.player.id,other.id]),await ledger(f));
 assert.equal(result.skipped,true);assert.equal(quillSupply(f.actor).remaining,12);assert.equal(f.calls.length,0);
});

test('an already Immobilized target receives no pin advantage and a lone remaining spike can still be fired',async()=>{
 const f=fixture();f.player.actor.conditionsSet.add('immobilized');
 let state=await f.adapter.snapshot(await ledger(f),{movement:false});assert.ok(!f.adapter.candidates(state).some(c=>c.kind==='spikeVolley'));
 await setSpikesRemaining(f.actor,1);state=await f.adapter.snapshot(await ledger(f),{movement:false});
 const spike=parts=>parts.spike.item.id;
 assert.ok(f.adapter.candidates(state).some(c=>c.kind==='strike'&&c.strikeId===spike(f.adapter.parts())));
 await f.adapter.executeProfileAction({kind:'strike',targetId:f.player.id,strikeId:spike(f.adapter.parts())},await ledger(f));
 assert.equal(quillSupply(f.actor).remaining,0);
});

test('a lethal ranged reaction prevents launch and pinning and leaves spikes unspent',async t=>{
 const f=fixture();t.mock.method(f.reactions,'action',async()=>({endTurn:true,incapacitationReason:'dead'}));
 const result=await f.adapter.executeProfileAction(choice(f),await ledger(f));
 assert.equal(result.endTurn,true);assert.equal(result.attackNotAttempted,true);assert.equal(quillSupply(f.actor).remaining,12);
 assert.equal(f.calls.some(c=>c[0]==='attack'),false);
});

test('split Volley waits through each ranged reaction and only charges actually launched shots',async t=>{
 const f=fixture(),other=f.addTarget('other');let reactions=0;
 t.mock.method(f.reactions,'action',async()=>++reactions===2?{endTurn:true,incapacitationReason:'dead'}:{});
 const result=await f.adapter.executeProfileAction(choice(f,'split',[f.player.id,other.id]),await ledger(f));
 assert.equal(result.endTurn,true);assert.equal(result.attackNotAttempted,false);assert.equal(quillSupply(f.actor).remaining,11);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);
});

test('manual damage keeps both split attack cards and pauses after the complete activity',async()=>{
 const f=fixture(),other=f.addTarget('other');f.flags.get(`token-boss:${ns}:config`).applyDamage=false;
 const result=await f.adapter.executeProfileAction(choice(f,'split',[f.player.id,other.id]),await ledger(f));
 assert.equal(result.pause,true);assert.equal(f.calls.filter(c=>c[0]==='attack').length,2);assert.equal(f.calls.some(c=>c[0]==='damage-applied'),false);
});

test('Alt+W saves an explicit remaining-spike correction without rolling or consuming an action',async t=>{
 const f=fixture(),previousHooks=globalThis.Hooks,previousFoundry=globalThis.foundry,previousUI=globalThis.ui;
 t.after(()=>{globalThis.Hooks=previousHooks;globalThis.foundry=previousFoundry;globalThis.ui=previousUI;});
 globalThis.Hooks={on(){},once(){}};globalThis.ui={notifications:{info(){}}};
 globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{
  assert.match(config.content,/Manticore \(Quill Tail\)/);assert.match(config.content,/Spikes remaining/);
  const elements={targetMode:{value:'alliance'},autoRun:{checked:false},autoAdvance:{checked:false},
   applyDamage:{checked:true},pauseForReactions:{checked:true},quillsRemaining:{value:'7'}};
  return config.buttons.find(b=>b.action==='save').callback({}, {form:{elements}});
 }}}}};
 const {openControls}=await import('../src/foundry/main.mjs?quill-controls');await openControls(f.boss);
 assert.equal(quillSupply(f.actor).remaining,7);assert.equal(f.calls.some(c=>['attack','move'].includes(c[0])),false);
 assert.equal(f.boss.document.getFlag(ns,'config').quillPreviewRemaining,undefined);
});
