import test from 'node:test';
import assert from 'node:assert/strict';
import { projectStealth, stealthBelief, saveStealthBelief } from '../src/foundry/stealth-belief.mjs';
import { fixture } from './helpers/ogre-fixture.mjs';

test('estimated Hide and Sneak probabilities use prior belief, own modifier and a reference DC',()=>{
  const hidden=projectStealth('hide',{observerId:'foe',unseenChance:0,undetectedChance:0},{bonus:7,referenceDC:18,canHide:true});
  assert.ok(Math.abs(hidden.unseenChance-0.5)<1e-9);assert.equal(hidden.undetectedChance,0);
  const sneak=projectStealth('sneak',hidden,{bonus:7,referenceDC:18,canHide:true});
  assert.ok(sneak.unseenChance<hidden.unseenChance);assert.ok(Math.abs(sneak.undetectedChance-0.25)<1e-9);
  const covered=projectStealth('hide',{observerId:'foe'},{bonus:7,referenceDC:18,canHide:true,coverBonus:2});
  assert.ok(covered.unseenChance>hidden.unseenChance);
  assert.equal(projectStealth('sneak',hidden,{bonus:7,referenceDC:18,canHide:false}).unseenChance,0);
});

test('stored belief strips secret roll fields and expires with its scene or encounter',async()=>{
  const f=fixture();
  await saveStealthBelief(f.boss,[{observerId:'foe',unseenChance:0.5,undetectedChance:0.2,total:30,dc:25,degree:3,state:'hidden'}]);
  assert.deepEqual(stealthBelief(f.boss),[{observerId:'foe',unseenChance:0.5,undetectedChance:0.2}]);
  assert.deepEqual(Object.keys(f.boss.document.getFlag('foundry-creature-ai','stealthBelief').entries[0]),['observerId','unseenChance','undetectedChance']);
  f.combat.id='next';assert.deepEqual(stealthBelief(f.boss),[]);
});

test('repeating Hide cannot inflate confidence about a secret result the creature has not learned',()=>{
  const previous={observerId:'foe',unseenChance:0.55,undetectedChance:0.2};
  assert.deepEqual(projectStealth('hide',previous,{bonus:20,referenceDC:15,canHide:true,coverBonus:4}),previous);
  assert.equal(projectStealth('hide',previous,{bonus:20,referenceDC:15,canHide:false}).unseenChance,0);
});
