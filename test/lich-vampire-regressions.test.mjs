import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {visibleDispelTargets,liveDispelTarget} from '../src/foundry/counteract-spells.mjs';
import {genericCastingCandidates,outcomeSpellValue} from '../src/framework/generic-casting.mjs';
import {conditionSpellValue} from '../src/framework/condition-spells.mjs';
import {waitingCaster} from '../src/framework/caster-defense.mjs';
import {observePublicAttack,witnessedThreat} from '../src/foundry/spell-observations.mjs';
import {chooseTacticalAction} from '../src/framework/tactical-behaviors.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {recoverMistTurn} from '../src/foundry/mist-turn-recovery.mjs';
const ns='foundry-creature-ai';
const count=JSON.parse(await readFile(new URL('./fixtures/vampire-count-mechanics.json',import.meta.url)));

test('Dispel ignores obsolete Haste on 0-HP escaping mist in both planning and live resolution',async()=>{
 const f=fixture({npcData:count});
 const effect={id:'haste',uuid:'Actor.player.Item.haste',system:{context:{origin:{item:'Spell.haste'}}},flags:{[ns]:{supportSpell:{slug:'haste'}}}};
 f.player.actor.items.set(effect.id,{...effect,type:'effect'});
 assert.ok(visibleDispelTargets(f.adapter).some(e=>e.id==='haste'));
 assert.equal(liveDispelTarget(f.adapter,f.player.id,effect.uuid),f.player);
 f.player.actor.hitPoints.value=0;await f.player.actor.setFlag(ns,'vampire',{escape:true,form:'mist',expiresAt:7200});
 assert.equal(visibleDispelTargets(f.adapter).some(e=>e.id==='haste'),false);
 assert.equal(liveDispelTarget(f.adapter,f.player.id,effect.uuid),null);
});

test('observed nonliving categories exclude living-only spells, but unknown bodies retain uncertainty',async()=>{
 const f=fixture(),ledger=await f.adapter.readLedger(f.adapter.turnKey());
 f.player.actor.system.traits.value.push('undead');
 const state=await f.adapter.snapshot(ledger,{movement:false}),target=state.enemies[0];
 assert.equal(target.knownModeOfBeing,'undead');
 for(const slug of ['vision-of-death','vampiric-exsanguination']){
  const spell={slug,living:true,kind:'save',range:120,damage:35,dc:25,castRank:4,outcomes:[{damage:2},{damage:1},{damage:.5},{damage:0}]};
  assert.equal(outcomeSpellValue(state,spell,{...target,distance:5}),0);
  assert.ok(outcomeSpellValue(state,spell,{...target,distance:5,knownModeOfBeing:undefined})>0);
 }
 assert.equal(conditionSpellValue(state,{slug:'vampiric-feast',living:true,range:5,damage:21,dc:25},{...target,distance:5}),0);
 assert.equal(outcomeSpellValue(state,{slug:'toxic-cloud',kind:'save',range:120,damage:25},{...target,distance:5}),0);
});

test('shared caster waiting expires after two quiet turns and does not count retries twice',async()=>{
 const f=fixture({npcData:count}),ledger=await f.adapter.readLedger(f.adapter.turnKey());
 const read=async()=>{const s=await f.adapter.snapshot(ledger,{movement:false});s.enemies.forEach(e=>{e.distance=90;e.tactics={role:'melee'};});return s;};
 assert.equal(waitingCaster(await read()),true);
 await f.adapter.recordOutcome({kind:'endTurn'},ledger,{});await f.adapter.recordOutcome({kind:'endTurn'},ledger,{});
 assert.equal((await read()).casterDefense.holdTurns,1);
 game.combat.round++;await f.adapter.recordOutcome({kind:'endTurn'},ledger,{});
 assert.equal(waitingCaster(await read()),false);
 await f.adapter.recordOutcome({kind:'strike'},ledger,{});assert.equal((await read()).casterDefense.holdTurns,0);
});

test('witnessed public ranged casting changes apparent role; secret casting never does',async()=>{
 const f=fixture({npcData:count}),message={speaker:{scene:canvas.scene.id,token:f.player.id},item:{type:'spell',system:{range:{value:'60 feet'}}},flags:{},rolls:[]};
 await observePublicAttack({...message,blind:true});assert.equal(witnessedThreat(f.boss,f.player.id),undefined);
 await observePublicAttack({...message,whisper:['gm']});assert.equal(witnessedThreat(f.boss,f.player.id),undefined);
 await observePublicAttack(message);assert.equal(witnessedThreat(f.boss,f.player.id).role,'caster');
});

test('shared ranking selects another legal action after a known-unexecuted rejection',()=>{
 const state={self:{threatened:false},actionsRemaining:3,rejectedActionIds:['bad-dispel']};
 const d=chooseTacticalAction([{id:'bad-dispel',kind:'castSpell',legal:true,actionCost:2,assessment:{value:50}},
  {id:'strike',kind:'strike',legal:true,actionCost:1,assessment:{value:5}}],state);
 assert.equal(d.chosen.id,'strike');
});

test('a real 0-HP mist turn passes through all attached adapters and advances after movement',async()=>{
 const f=fixture({npcData:count,size:30});f.actor.hitPoints.value=0;
 f.flags.get(`token-boss:${ns}:config`).autoAdvance=true;
 await f.actor.setFlag(ns,'vampire',{form:'mist',escape:true,escapeTriggered:true,expiresAt:7200});
 f.boss.document.x=1400;f.boss.document.y=1400;
 const kinds=[];f.adapter.report=async(d,ledger,result)=>{kinds.push(d.chosen.kind);await f.adapter.recordOutcome(d.chosen,ledger,result);};
 const ledger=await new TurnRunner(f.adapter).run();assert.ok(kinds.includes('mistFly'));assert.equal(ledger.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='next-turn').length,1);assert.equal(ledger.uncertain,false);
});

test('post-effect turn change recovers a missing mist start once, and respects Stop and existing ledgers',async()=>{
 const f=fixture({npcData:count}),config=f.flags.get(`token-boss:${ns}:config`);config.autoRun=true;
 f.actor.hitPoints.value=0;await f.actor.setFlag(ns,'vampire',{form:'mist',escape:true,expiresAt:7200});
 let runs=0;const run=async(_token,options)=>{runs++;await f.boss.document.setFlag(ns,'ledger',{turn:options.expectedTurn});};
 assert.equal(await recoverMistTurn(game.combat,{paused:true,run}),false);
 assert.equal(await recoverMistTurn(game.combat,{activeRuns:new Map([[f.boss.id,Promise.resolve()]]),run}),false);
 assert.equal(await recoverMistTurn(game.combat,{run}),true);assert.equal(runs,1);
 assert.equal(await recoverMistTurn(game.combat,{run}),false);assert.equal(runs,1);
});

test('a Vampire Count makes a meaningful Stride instead of treating a short gaze as artillery',async()=>{
 const f=fixture({npcData:count,size:16});f.player.document.x=1200;
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 const decision=f.adapter.decide(state);
 assert.notEqual(decision.diagnostics.tactic.planId,'defensive');
 assert.equal(decision.chosen.kind,'stride');
 assert.ok(decision.chosen.assessment.distanceMoved>=4,'the first leg should cover at least 20 feet');
});

test('See the Unseen answers known Invisibility, not ordinary Hidden or blocked sight',()=>{
 const spell={id:'see',bindingId:'see:1',slug:'see-the-unseen',name:'See the Unseen',resolver:'outcomes',kind:'buff',
  selfOnly:true,range:5,available:true,actionCost:2,unlimited:true,cantrip:false};
 const state={actionsRemaining:3,attacksMade:0,spellSlots:1,spells:[spell],self:{id:'self',hpFraction:1},
  casterAllies:[{id:'self',self:true,distance:0,hpFraction:1,buffs:[]}],enemies:[{id:'hidden',awareness:{detection:'hidden'}}]};
 assert.equal(genericCastingCandidates(state).some(c=>c.spellSlug==='see-the-unseen'),false);
 state.enemies[0].knownConditions=['invisible'];
 assert.equal(genericCastingCandidates(state).some(c=>c.spellSlug==='see-the-unseen'),true);
});

test('an existing allied ice wall suppresses another distant low-pressure partition but not an emergency melee barrier',()=>{
 const spell={id:'wall',bindingId:'wall:1',slug:'wall-of-ice',name:'Wall of Ice',resolver:'outcomes',kind:'lingering',role:'control',
  wall:true,ice:true,range:120,available:true,actionCost:3,unlimited:true,areas:[]};
 const enemy={id:'enemy',distance:80,tactics:{role:'caster',reach:5,speed:25}},area={id:'area',enemies:[],bystanders:[]};
 area.enemies=[enemy];spell.areas=[area];
 const state={actionsRemaining:3,attacksMade:0,spellSlots:1,spells:[spell],self:{hpFraction:1},enemies:[enemy],battlefieldControl:{alliedIceWalls:1}};
 assert.equal(genericCastingCandidates(state).length,0);
 enemy.distance=20;enemy.tactics={role:'melee',reach:10,speed:25};
 assert.equal(genericCastingCandidates(state).length,1);
});
