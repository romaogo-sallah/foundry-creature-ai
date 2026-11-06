import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/dero-fixture.mjs';
import {applyConditionSpell,advanceOngoingSpells,beginSustainedCast,endSustainedCast,resetOngoingSpells} from '../src/foundry/ongoing-spells.mjs';

const ns='foundry-creature-ai';
async function setup(slug='laughing-fit',degree=1){
  const f=fixture(),spell=f.actor.itemTypes.spell.find(s=>s.slug===slug),source={actor:f.actor,token:f.boss};
  const cast=slug==='laughing-fit'?await beginSustainedCast(source,spell,f.player):null;
  await applyConditionSpell({source,target:f.player,spell,degree,castId:cast?.id});
  const native=f.player.actor.deleteEmbeddedDocuments.bind(f.player.actor);
  f.player.actor.deleteEmbeddedDocuments=async(type,ids)=>{
    await new Promise(resolve=>setImmediate(resolve));
    for(const id of ids)if(!f.player.actor.items.has(id))throw new Error(`Item "${id}" does not exist!`);
    return native(type,ids);
  };
  return {...f,spell,cast};
}

test('overlapping time and turn cleanup delete an expired effect once',async()=>{
  const f=await setup('stupefy');game.time.worldTime=61;
  await Promise.all([advanceOngoingSpells(),advanceOngoingSpells({token:f.boss,phase:'start'})]);
  assert.equal(f.player.actor.itemTypes.effect.length,0);
  assert.equal(f.calls.filter(c=>c[0]==='delete-items').length,1);
});

test('concurrent Laughing Fit expiry and manual End do not delete the same source twice',async()=>{
  const f=await setup();game.time.worldTime=601;
  await f.player.actor.createEmbeddedDocuments('Item',[{name:'Unrelated ward',type:'effect',system:{rules:[]}}]);
  await Promise.all([advanceOngoingSpells(),endSustainedCast(f.actor,f.cast.id)]);
  assert.deepEqual(f.player.actor.itemTypes.effect.map(e=>e.name),['Unrelated ward']);
  assert.equal(f.actor.getFlag(ns,'ongoingCasts').length,0);
  assert.equal(f.calls.filter(c=>c[0]==='delete-items').length,1);
});

test('reset and turn-end expiry share the same ongoing spell cleanup queue',async()=>{
  const f=await setup();game.combat.round=2;
  await Promise.all([resetOngoingSpells([f.boss.id]),advanceOngoingSpells({token:f.boss,phase:'end'})]);
  assert.equal(f.player.actor.itemTypes.effect.length,0);
  assert.equal(f.actor.getFlag(ns,'ongoingCasts').length,0);
  assert.equal(f.calls.filter(c=>c[0]==='delete-items').length,1);
});

test('overlapping start-turn hooks downgrade a critical Laughing Fit source only once',async()=>{
  const f=await setup('laughing-fit',0);game.combat.round=2;
  await Promise.all([advanceOngoingSpells({token:f.boss,phase:'start'}),advanceOngoingSpells({token:f.boss,phase:'start'})]);
  assert.equal(f.calls.filter(c=>c[0]==='item-update'&&Object.hasOwn(c[2],'system.rules')).length,1);
  assert.equal(f.player.actor.getCondition('slowed').value,1);
});

test('a failed effect mutation is reported without poisoning subsequent cleanup',async()=>{
  const f=await setup('stupefy');game.time.worldTime=61;
  const native=f.player.actor.deleteEmbeddedDocuments;let fail=true;
  f.player.actor.deleteEmbeddedDocuments=(...args)=>{if(fail){fail=false;return Promise.reject(new Error('Permission denied'));}return native(...args);};
  await assert.rejects(advanceOngoingSpells(),/Permission denied/);
  await advanceOngoingSpells();assert.equal(f.player.actor.itemTypes.effect.length,0);
});
