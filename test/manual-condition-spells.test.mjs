import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/dero-fixture.mjs';
import {wrapConditionSave,installManualConditionSpells,resolveManualSpellSave} from '../src/foundry/manual-condition-spells.mjs';
import {applyConditionSpell,beginSustainedCast,advanceOngoingSpells,ongoingCasts,resetOngoingSpells,installOngoingSpells} from '../src/foundry/ongoing-spells.mjs';
import {concealmentDC} from '../src/foundry/environment-rolls.mjs';
const ns='foundry-creature-ai';
function setup(slug='laughing-fit'){
 const f=fixture(),spell=f.actor.itemTypes.spell.find(s=>s.slug===slug);
 const message={id:'manual-save',author:game.user,speaker:{token:f.player.id},flags:{pf2e:{origin:{uuid:spell.uuid},context:{type:'saving-throw',outcome:'failure'}}},rolls:[{degreeOfSuccess:1}]};
 game.messages=new Map([[message.id,message]]);globalThis.fromUuid=async uuid=>uuid===spell.uuid?spell:null;
 installManualConditionSpells({reactions:f.reactions});return {...f,spell,message};
}
test('a manually rolled PC spell save resolves one shared outcome and waits for the effects',async()=>{
 const f=setup(),context={type:'saving-throw',actor:f.player.actor,item:f.spell,options:new Set()};let callbackCalled=0;
 const native=async(_check,ctx,_event,callback)=>{
  assert.ok(ctx.options.has('skip-handling-message'),'external automation must not add duplicate conditions');
  await callback({degreeOfSuccess:1},'failure',f.message);return {degreeOfSuccess:1};
 };
 const roll=await wrapConditionSave(native,{},context,null,async()=>callbackCalled++);
 assert.equal(roll.degreeOfSuccess,1);assert.equal(callbackCalled,1);assert.equal(f.player.actor.flags.pf2e.noUseReactions,true);
 assert.equal(f.player.actor.getCondition('slowed').value,1);assert.equal(f.player.actor.itemTypes.effect.length,1);
 await wrapConditionSave(native,{},context,null,async()=>callbackCalled++);
 assert.equal(f.player.actor.itemTypes.effect.length,1,'duplicate save processing is idempotent');
});
test('manual casting uses the same resolver even when the caster is a PC rather than a Dero',async()=>{
 const f=setup('stupefy');f.actor.type='character';
 await resolveManualSpellSave({messageId:f.message.id,sceneId:canvas.scene.id},game.user);
 assert.equal(f.player.actor.getCondition('stupefied').value,2);
});
test('AI-managed saves and unrelated saves are left to their original resolver',async()=>{
 const f=setup(),calls=[];const native=(...args)=>calls.push(args);
 await wrapConditionSave(native,{}, {type:'saving-throw',item:f.spell,options:[`${ns}:managed`]});
 await wrapConditionSave(native,{}, {type:'saving-throw',item:{slug:'banishment'},options:[]});
 assert.equal(calls.length,2);assert.equal(f.player.actor.itemTypes.effect.length,0);
 assert.deepEqual(calls[1][1].options,[]);
});
test('manual effect requests cannot forge a save author or alter an unowned target',async()=>{
 const f=setup();await assert.rejects(resolveManualSpellSave({messageId:f.message.id,sceneId:canvas.scene.id},{id:'someone',isGM:false}),/validate/);
 const owner={id:'owner',isGM:false};f.message.author=owner;f.player.actor.testUserPermission=()=>false;
 await assert.rejects(resolveManualSpellSave({messageId:f.message.id,sceneId:canvas.scene.id},owner),/own/);
 assert.equal(f.player.actor.itemTypes.effect.length,0);
});
test('Blinded and Dazzled PC attackers receive the appropriate targeting flat check',()=>{
 const f=fixture();f.actor.conditionsSet.add('dazzled');assert.equal(concealmentDC(f.boss,f.player),5);
 f.actor.conditionsSet.add('blinded');assert.equal(concealmentDC(f.boss,f.player),11);
 f.actor.conditionsSet.clear();assert.equal(concealmentDC(f.boss,f.player),null);
});
test('round-boundary turn-end hooks use the round that actually ended',async()=>{
 const f=setup(),source={actor:f.actor,token:f.boss},cast=await beginSustainedCast(source,f.spell,f.player);
 await applyConditionSpell({source,target:f.player,spell:f.spell,degree:1,castId:cast.id});
 const hooks=new Map();globalThis.Hooks={on:(name,fn)=>hooks.set(name,fn)};
 installOngoingSpells({reactions:f.reactions,onError:error=>{throw error;}});
 game.combat.round=2;game.combat.turn=0;
 hooks.get('pf2e.endTurn')({...f.combat.combatants[0],getFlag:()=>1},game.combat);
 await f.reactions.barrier.wait();
 assert.equal(f.player.actor.flags.pf2e.noUseReactions,true,'the first turn ending must not count as skipping next turn Sustain');
});
test('resetting a caster removes only its ongoing spells from other tokens',async()=>{
 const f=setup(),source={actor:f.actor,token:f.boss},cast=await beginSustainedCast(source,f.spell,f.player);
 await applyConditionSpell({source,target:f.player,spell:f.spell,degree:1,castId:cast.id});
 await f.player.actor.createEmbeddedDocuments('Item',[{name:'Unrelated ward',type:'effect',system:{rules:[]}}]);
 await resetOngoingSpells([f.boss.id]);assert.equal(ongoingCasts(f.actor).length,0);
 assert.equal(f.player.actor.flags.pf2e.noUseReactions,undefined);
 assert.deepEqual(f.player.actor.itemTypes.effect.map(e=>e.name),['Unrelated ward']);
});
test('an unsustained spell ends after combat as world time advances',async()=>{
 const f=setup(),source={actor:f.actor,token:f.boss},cast=await beginSustainedCast(source,f.spell,f.player);
 await applyConditionSpell({source,target:f.player,spell:f.spell,degree:1,castId:cast.id});
 game.combat.started=false;game.time.worldTime=13;await advanceOngoingSpells();
 assert.equal(f.player.actor.flags.pf2e.noUseReactions,undefined);
});
