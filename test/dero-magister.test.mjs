import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/dero-fixture.mjs';
import {createCreatureAdapter,creatureProfile} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {applyConditionSpell,advanceOngoingSpells,ongoingCasts,sustainCast,beginSustainedCast} from '../src/foundry/ongoing-spells.mjs';
import {canReact} from '../src/foundry/reactions.mjs';
import {conditionCastingCandidates} from '../src/framework/condition-spells.mjs';
const ns='foundry-creature-ai',snapshot=async ai=>ai.snapshot(await ai.readLedger(ai.turnKey()));
function caster(options){const f=fixture(options);f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});return f;}
function spell(f,slug){return f.actor.itemTypes.spell.find(s=>s.slug===slug);}
const source=f=>({actor:f.actor,token:f.boss});

test('the supplied Dero export has a taught caster profile and complete native slot availability',async()=>{
 const f=caster(),s=await snapshot(f.adapter);
 assert.equal(creatureProfile(f.actor).id,'dero-magister');
 assert.deepEqual([...new Set(s.spells.map(s=>s.slug))].sort(),['blindness','daze','forbidding-ward','force-barrage','grim-tendrils','laughing-fit','paranoia','phantom-pain','revealing-light','soothe','stupefy','telekinetic-maneuver','vampiric-feast','void-warp']);
 assert.equal(s.spellSlots,11);assert.ok(s.spells.filter(s=>s.slug!=='revealing-light').every(s=>s.available));assert.equal(s.spells.find(s=>s.slug==='revealing-light').available,false,'the exported innate Revealing Light is already expended');
 assert.ok(f.adapter.parts().unsupported.some(s=>s.startsWith('Darkness:')),'untaught spells must be reported explicitly');
});
test('a complete Dero turn casts a native two-action spell and uses its once-per-round gaze',async()=>{
 const f=caster();f.player.document.x=300;const result=await new TurnRunner(f.adapter).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);
 assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,2);
 assert.equal(f.boss.document.getFlag(ns,'conditionCaster').stareRound,1);
 assert.ok(f.player.actor.hasCondition('dazzled'));assert.ok(f.actor.itemTypes.spellcastingEntry[0].system.slots.slot3.value<3||
  f.actor.itemTypes.spellcastingEntry[0].system.slots.slot2.value<4);
});
test('Cytillesh Stare cannot be forecast or executed three times in one turn',async()=>{
 const f=caster();for(const entry of f.actor.itemTypes.spellcastingEntry)for(const slot of Object.values(entry.system.slots))slot.value=0;
 f.actor.itemTypes.spell.find(s=>s.slug==='void-warp').system.location.value='not-prepared';
 f.actor.itemTypes.spell.find(s=>s.slug==='daze').system.location.value='not-prepared';
 const result=await new TurnRunner(f.adapter).run();assert.equal(result.uncertain,false);
 assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,1);
});
test('Laughing Fit critical failure becomes Slowed 1 at the caster next start, then expires without Sustain',async()=>{
 const f=caster(),s=spell(f,'laughing-fit'),commit=await beginSustainedCast(source(f),s,f.player);
 await applyConditionSpell({source:source(f),target:f.player,spell:s,degree:0,castId:commit.id});
 assert.ok(f.player.actor.hasCondition('prone'));assert.equal(f.player.actor.flags.pf2e.noActions,true);assert.equal(canReact(f.player.actor),false);
 game.combat.round=2;
 await advanceOngoingSpells({token:f.boss,phase:'start'});
 assert.equal(f.player.actor.flags.pf2e.noActions,undefined);assert.equal(f.player.actor.getCondition('slowed').value,1);
 assert.equal(canReact(f.player.actor),false);
 await advanceOngoingSpells({token:f.boss,phase:'end'});
 assert.equal(f.player.actor.hasCondition('slowed'),false);assert.equal(canReact(f.player.actor),true);
 assert.ok(f.player.actor.hasCondition('prone'),'expiration does not stand the creature up');
});
test('Sustain costs one future action and prevents expiry until the next caster turn end',async()=>{
 const f=caster(),s=spell(f,'laughing-fit'),c=await beginSustainedCast(source(f),s,f.player);
 await applyConditionSpell({source:source(f),target:f.player,spell:s,degree:1,castId:c.id});
 game.combat.round=2;await sustainCast(f.actor,c.id);
 await advanceOngoingSpells({token:f.boss,phase:'end'});assert.equal(canReact(f.player.actor),false);
 await assert.rejects(sustainCast(f.actor,c.id),/already sustained/);
 game.combat.round=3;await advanceOngoingSpells({token:f.boss,phase:'end'});assert.equal(canReact(f.player.actor),true);
});
test('critical save does not reveal hidden success to the caster concentration plan',async()=>{
 const plans=[];
 for(const degree of [0,3]){
  const f=caster(),s=spell(f,'laughing-fit'),c=await beginSustainedCast(source(f),s,f.player);
  await applyConditionSpell({source:source(f),target:f.player,spell:s,degree,castId:c.id});game.combat.round=2;
  plans.push(ongoingCasts(f.actor).map(({id,slug,targetId,lastRound})=>({id,slug,targetId,lastRound})));
 }
 assert.deepEqual(plans[0],plans[1]);
});
test('Stupefy and Void Warp expire at source start, while brief Blindness expires at target start',async()=>{
 for(const slug of ['stupefy','blindness','void-warp']){
  const f=caster(),s=spell(f,slug);await applyConditionSpell({source:source(f),target:f.player,spell:s,degree:slug==='void-warp'?0:2});
  const condition=slug==='stupefy'?'stupefied':slug==='blindness'?'blinded':'enfeebled';assert.ok(f.player.actor.hasCondition(condition));
  if(slug==='blindness'){
   game.combat.turn=1;await advanceOngoingSpells({token:f.player,phase:'start'});
  }else{game.combat.round=2;await advanceOngoingSpells({token:f.boss,phase:'start'});}
  assert.equal(f.player.actor.hasCondition(condition),false);
 }
});
test('Blindness grants its temporary immunity on a critical success without applying Blinded',async()=>{
 const f=caster(),s=spell(f,'blindness');await applyConditionSpell({source:source(f),target:f.player,spell:s,degree:3});
 assert.equal(f.player.actor.hasCondition('blinded'),false);
 assert.equal(f.player.actor.itemTypes.effect[0].flags[ns].ongoingSpell.slug,'blindness-immunity');
 await applyConditionSpell({source:source(f),target:f.player,spell:s,degree:0});assert.equal(f.player.actor.hasCondition('blinded'),false);
 game.time.worldTime=61;await advanceOngoingSpells();assert.equal(f.player.actor.itemTypes.effect.length,0);
});
test('a Dero can select Sustain plus a new two-action spell without assuming the previous save failed',async()=>{
 const f=caster(),s=spell(f,'laughing-fit');f.player.document.x=300;await beginSustainedCast(source(f),s,f.player);
 game.combat.round=2;const state=await snapshot(f.adapter),candidates=f.adapter.candidates(state);
 assert.ok(candidates.some(c=>c.kind==='sustainSpell'));
 const decision=f.adapter.decide(state);assert.ok(decision.chosen.features.turnPlan.some(step=>step.kind==='sustainSpell'));
});
test('condition ranking uses benchmark saves and declared attempts, never the actual opposing save modifier',async()=>{
 const f=caster(),s=await snapshot(f.adapter),before=conditionCastingCandidates(s).map(c=>({id:c.id,value:c.assessment.value}));
 f.player.actor.getStatistic=()=>({check:{mod:99}});
 const after=conditionCastingCandidates(s).map(c=>({id:c.id,value:c.assessment.value}));assert.deepEqual(before,after);
 s.spellAttempts=[{slug:'blindness',targetId:f.player.id,untilRound:11}];
 assert.ok(conditionCastingCandidates(s).every(c=>c.spellSlug!=='blindness'));
});
