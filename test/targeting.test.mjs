import test from 'node:test';
import assert from 'node:assert/strict';
import { allianceSide, canAssignTarget, targetingMode, targetRoster } from '../src/foundry/targeting.mjs';

function fixture(alliance = 'opposition') {
  const actor = { alliance }, token = { id: 'wolf', actor };
  const records = [
    ['aysa', 'party', 'scene'], ['fighter', 'party', 'scene'], ['party-npc', 'party', 'scene'],
    ['other-wolf', 'opposition', 'scene'], ['neutral', null, 'scene'],
    ['other-scene', 'party', 'elsewhere'],
  ];
  const combatants = records.map(([tokenId, , sceneId]) => ({ tokenId, sceneId }));
  const tokens = new Map(records.map(([id, side]) => [id, { id, actor: { alliance: side } }]));
  tokens.set('bystander', { id: 'bystander', actor: { alliance: 'party' } });
  const combat = { scene: null, combatants }, scene = { id: 'scene' };
  const roster = config => targetRoster(token, config, combat, scene, tokens);
  return { token, actor, tokens, combat, roster };
}

test('opposition defaults to all Party combatants, including allied NPCs and the untargeted fighter', () => {
  const f = fixture();
  assert.deepEqual(f.roster({ targetIds: ['aysa'] }), ['aysa', 'fighter', 'party-npc']);
  assert.equal(targetingMode(f.actor, {}), 'alliance');
});

test('Party defaults to Opposition combatants without including neutrals or other Party creatures', () => {
  const f = fixture('party');
  assert.deepEqual(f.roster({}), ['other-wolf']);
});

test('manual selection keeps its saved list, and neutral actors always use manual selection', () => {
  const f = fixture();
  assert.deepEqual(f.roster({ targetMode: 'manual', targetIds: ['aysa'] }), ['aysa']);
  f.actor.alliance = null;
  assert.equal(targetingMode(f.actor, {}), 'manual');
  assert.equal(targetingMode(f.actor, { targetMode: 'alliance' }), 'manual');
  assert.deepEqual(f.roster({ targetIds: ['fighter', 'neutral', 'fighter'] }), ['fighter', 'neutral']);
});

test('new combatants and alliance changes update the automatic roster immediately', () => {
  const f = fixture();
  f.tokens.set('new-player', { actor: { alliance: 'party' } });
  f.combat.combatants.push({ tokenId: 'new-player', sceneId: 'scene' });
  assert.ok(f.roster({}).includes('new-player'));
  f.tokens.get('fighter').actor.alliance = 'opposition';
  assert.equal(f.roster({}).includes('fighter'), false);
  f.actor.alliance = 'party';
  assert.deepEqual(f.roster({}), ['fighter', 'other-wolf']);
});

test('automatic selection excludes absent tokens, other scenes, duplicate combatants and noncombat bystanders', () => {
  const f = fixture();
  f.combat.combatants.push({ tokenId: 'missing', sceneId: 'scene' }, { tokenId: 'aysa', sceneId: 'scene' });
  assert.deepEqual(f.roster({}), ['aysa', 'fighter', 'party-npc']);
});

test('neutral hostility requires manual assignment; same-alliance creatures cannot be assigned as enemies', () => {
  const party = { alliance: 'party' }, opposition = { alliance: 'opposition' }, neutral = { alliance: null };
  assert.equal(canAssignTarget(party, opposition), true);
  assert.equal(canAssignTarget(opposition, party), true);
  assert.equal(canAssignTarget(party, { alliance: 'party' }), false);
  assert.equal(canAssignTarget(opposition, { alliance: 'opposition' }), false);
  assert.equal(canAssignTarget(neutral, party), true);
  assert.equal(canAssignTarget(party, neutral), true);
  assert.equal(canAssignTarget(neutral, neutral), false);
  assert.equal(allianceSide(neutral), null);
});

test('a creature can be configured for alliance targeting before combat exists', () => {
  const f = fixture();
  assert.deepEqual(targetRoster(f.token, {}, null, { id: 'scene' }, f.tokens), []);
});
