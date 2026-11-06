import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/ogre-fixture.mjs';
import {fixture as eagleFixture} from './helpers/eagle-fixture.mjs';
import {conditionDirective} from '../src/framework/condition-directives.mjs';
import {attachConfusionSystem} from '../src/foundry/confused-adapter.mjs';
import {attachFleeingSystem} from '../src/foundry/fleeing-adapter.mjs';
import {reactionRestriction,checkRestriction} from '../src/foundry/action-restrictions.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {conditionFacts} from '../src/foundry/condition-actions.mjs';
import {conditionViolation} from '../src/framework/condition-rules.mjs';
const ns='foundry-creature-ai';
function setup(factory=fixture){const f=factory();attachFleeingSystem(attachConfusionSystem(f.adapter,{random:()=>0}));return f;}
test('compulsion precedence is Fleeing, Confused, Controlled; lower conditions retain reaction denial',()=>{
 const f=setup();for(const slug of ['controlled','confused','fleeing'])f.actor.conditionsSet.add(slug);
 assert.equal(conditionDirective(f.actor),'fleeing');assert.equal(reactionRestriction(f.actor).kind,'confused');
 f.actor.conditionsSet.delete('fleeing');assert.equal(conditionDirective(f.actor),'confused');
 f.actor.conditionsSet.delete('confused');assert.equal(conditionDirective(f.actor),'controlled');
});
test('Confused can act despite Controlled and stops using the override when only Controlled remains',async()=>{
 const f=setup();f.actor.conditionsSet.add('confused');f.actor.conditionsSet.add('controlled');await f.adapter.assertReady();
 const ledger=await f.adapter.readLedger(f.adapter.turnKey());await f.adapter.prepareTurn({ledger});
 assert.equal((await f.adapter.snapshot(ledger,{movement:false})).confusion.targetId,f.player.id);
 f.actor.conditionsSet.delete('confused');await assert.rejects(()=>f.adapter.assertReady(),/controlled/);
});
test('Fleeing spends its turn moving away instead of attacking even while Confused and Controlled',async()=>{
 const f=setup();for(const slug of ['fleeing','confused','controlled'])f.actor.conditionsSet.add(slug);
 const before=f.boss.document.x;await f.actor.setFlag(ns,'conditionContext',{fleeingSourceId:f.player.id});
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.done,true);
 assert.ok(f.calls.some(c=>c[0]==='move'));assert.ok(f.boss.document.x<before||f.boss.document.y!==200);
 assert.equal(f.calls.some(c=>['attack','trip','spell-attack'].includes(c[0])),false);
 assert.equal(f.actor.hasCondition('confused'),true);assert.equal(f.actor.hasCondition('controlled'),true);
});
test('Fleeing can use a same-alliance source and does not set a permanent morale retreat flag',async()=>{
 const f=setup();f.actor.conditionsSet.add('fleeing');const ally=f.addOgre('fear-source',500,200);
 await f.actor.setFlag(ns,'conditionContext',{fleeingSourceId:ally.id});
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 assert.equal(state.fleeing.sources[0].id,ally.id);assert.ok(f.adapter.decide(state).chosen.features.fleeing);
 await new TurnRunner(f.adapter).run({oneAction:true});assert.equal(f.boss.document.getFlag(ns,'retreated'),undefined);
});
test('queued Fleeing and Confused actions are skipped and normal strategy resumes with the same ledger',async()=>{
 const f=setup();f.actor.conditionsSet.add('fleeing');const ledger=await f.adapter.readLedger(f.adapter.turnKey());
 const flee=f.adapter.decide(await f.adapter.snapshot(ledger)).chosen;assert.ok(flee.features.fleeing);
 f.actor.conditionsSet.delete('fleeing');f.actor.conditionsSet.add('confused');assert.equal((await f.adapter.execute(flee,ledger)).skipped,true);
 await f.adapter.prepareTurn({ledger});const confused=f.adapter.decide(await f.adapter.snapshot(ledger)).chosen;
 f.actor.conditionsSet.add('fleeing');assert.equal((await f.adapter.execute(confused,ledger)).skipped,true);
 assert.equal(ledger.actionsRemaining,3);assert.equal(f.calls.some(c=>c[0]==='move'),false);
});
test('Fleeing without a known source finishes safely without reading GM-hidden coordinates',async()=>{
 const f=setup();f.actor.conditionsSet.add('fleeing');f.player.document.hidden=true;
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 assert.deepEqual(state.fleeing.sources,[]);assert.equal(f.adapter.decide(state).chosen.kind,'endTurn');
});
test('an allied fear source keeps its remembered square when it becomes hidden and moves elsewhere',async()=>{
 const f=setup();f.actor.conditionsSet.add('fleeing');const source=f.addOgre('source',900,200);
 await f.actor.setFlag(ns,'conditionContext',{fleeingSourceId:source.id});
 const ledger=await f.adapter.readLedger(f.adapter.turnKey());await f.adapter.prepareTurn({ledger});
 const memory=f.boss.document.getFlag(ns,'fleeingMemory');assert.equal(memory.point.x,900);
 source.document.hidden=true;source.document.x=100;
 const state=await f.adapter.snapshot(ledger);assert.equal(state.fleeing.sources[0].id,source.id);
 const choice=f.adapter.decide(state).chosen;
 assert.ok(choice.destination.x<2||choice.destination.y!==2,'flee the remembered source, not the secret new square');
 assert.equal(f.boss.document.getFlag(ns,'fleeingMemory').point.x,900);
});
test('Fleeing flyers use flight away from the source without an attack or hunting tactic',async()=>{
 const f=setup(eagleFixture);f.actor.conditionsSet.add('fleeing');f.actor.conditionsSet.add('confused');
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 const choice=f.adapter.decide(state).chosen;assert.equal(choice.kind,'fly');assert.equal(choice.features.fleeing,true);
 assert.ok(state.fleeing.moves.some(move=>move.progress>0));assert.equal(choice.features.flightAttackPass,undefined);
});
test('shared manual rules reject attacking while Fleeing but permit movement and attack-enabling recovery',()=>{
 const f=setup();f.actor.conditionsSet.add('fleeing');f.actor.conditionsSet.add('fascinated');
 const facts=conditionFacts(f.actor);assert.equal(facts.fascinated,false);
 for(const kind of ['strike','castSpell','sustainSpell','hide'])assert.match(conditionViolation(facts,{kind}),/Fleeing/);
 for(const kind of ['stride','stand','escape','force-open','interact'])assert.equal(conditionViolation(facts,{kind}),null);
});
test('Fleeing alone allows manual reactions; underlying Confused continues to forbid them',()=>{
 const f=setup();f.actor.conditionsSet.add('fleeing');
 const context={actor:f.actor,type:'attack-roll',action:'reactive-strike',options:[`${ns}:reaction`]};
 assert.equal(checkRestriction({},context),null);f.actor.conditionsSet.add('confused');
 assert.equal(checkRestriction({},context).kind,'confused');
});
