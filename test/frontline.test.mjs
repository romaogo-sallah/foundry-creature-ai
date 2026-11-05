import test from 'node:test';
import assert from 'node:assert/strict';
import { frontlineAssessments } from '../src/foundry/frontline.mjs';

const character = (id, maxHP, ac, current = maxHP) => ({ id, name: id,
  actor: { type: 'character', hitPoints: { value: current, max: maxHP }, armorClass: { value: ac } } });

test('high HP and high AC jointly identify front line without relying on class or armor labels', () => {
  const tank = character('tank', 100, 26), mage = character('mage', 55, 21), rogue = character('rogue', 70, 23);
  tank.actor.class = { slug: 'wizard' };
  mage.actor.class = { slug: 'fighter' };
  const assessed = frontlineAssessments([tank, mage, rogue]);
  assert.equal(assessed.get('tank').frontline, true);
  assert.equal(assessed.get('mage').frontline, false);
  assert.equal(assessed.get('tank').hpThreshold, 70);
  assert.equal(assessed.get('tank').acThreshold, 23);
});

test('high HP alone and high AC alone do not qualify a character', () => {
  const assessment = frontlineAssessments([character('hp', 140, 18), character('ac', 40, 30), character('balanced', 85, 25)]);
  assert.equal(assessment.get('hp').frontline, false);
  assert.equal(assessment.get('ac').frontline, false);
  assert.equal(assessment.get('balanced').frontline, true);
});

test('wounds do not change role; actual prepared AC changes are recalculated', () => {
  const tank = character('tank', 100, 26, 1), mage = character('mage', 50, 21);
  assert.equal(frontlineAssessments([tank, mage]).get('tank').frontline, true);
  tank.actor.armorClass.value = 18;
  assert.equal(frontlineAssessments([tank, mage]).get('tank').frontline, false);
});

test('missing max HP or AC is never replaced by remaining HP or a class stereotype', () => {
  const invalid = character('unknown', undefined, undefined, 100);
  invalid.actor.class = { slug: 'champion' };
  invalid.actor.attributes = { shield: { raised: true } };
  assert.equal(frontlineAssessments([invalid]).size, 0);
  const fallback = { id: 'fallback', name: 'Fallback', actor: { type: 'character', system: { attributes: { hp: { max: 90 }, ac: { value: 25 } } } } };
  assert.equal(frontlineAssessments([fallback]).get('fallback').frontline, true);
});

test('ties and a sole opponent are stable, and NPCs do not skew the player-character comparison', () => {
  const one = character('one', 80, 24), two = character('two', 80, 24);
  const npc = character('npc', 500, 45); npc.actor.type = 'npc';
  assert.deepEqual([...frontlineAssessments([one, two, npc]).values()].map(entry => entry.frontline), [true, true]);
  assert.equal(frontlineAssessments([one]).get('one').frontline, true);
});
