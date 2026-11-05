import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { decide, resolveProfile } from '../src/decision-engine.mjs';

const profiles = JSON.parse(await readFile(new URL('../profiles/creatures.json', import.meta.url)));
const profile = id => resolveProfile(profiles, id);
const candidate = (id, features = {}, extra = {}) => ({ id, kind: 'strike', legal: true, actionCost: 1, features, ...extra });
const end = candidate('end', {}, { kind: 'endTurn', actionCost: 0, fallback: true });
const snapshot = candidates => ({ actionsRemaining: 3, candidates });

test('creatures reuse the same candidates with different tactics', () => {
  const state = snapshot([
    candidate('near', { expectedDamage: 9, targetsNearestEnemy: 1 }),
    candidate('pack', { expectedDamage: 8, allyReachValue: 1 }), end,
  ]);
  assert.equal(decide(state, profile('standard')).chosen.id, 'near');
  assert.equal(decide(state, profile('pack')).chosen.id, 'pack');
  assert.equal(decide(state, profile('mindless')).chosen.id, 'near');
});

test('overrides cannot select illegal, unknown-legality, or unaffordable breath attacks', () => {
  for (const extra of [{ legal: false }, { legal: undefined }, { actionCost: 4 }]) {
    const state = snapshot([
      candidate('breath', { enemyCount: 3, allyCount: 0, expectedDamage: 100 }, { kind: 'breath', ...extra }),
      candidate('strike', { expectedDamage: 5 }), end,
    ]);
    const result = decide(state, profile('dragon-example'));
    assert.equal(result.chosen.id, 'strike');
    assert.equal(result.rejected.length, 1);
  }
});

test('per-creature rules override utility and fall through when no option matches', () => {
  const breath = candidate('breath', { enemyCount: 2, allyCount: 0, expectedDamage: 2 }, { kind: 'breath', actionCost: 2 });
  const strike = candidate('strike', { expectedDamage: 9 });
  assert.equal(decide(snapshot([breath, strike]), profile('dragon-example')).chosen.id, 'breath');
  breath.features.allyCount = 1;
  assert.equal(decide(snapshot([breath, strike]), profile('dragon-example')).chosen.id, 'strike');
});

test('mindless approaches the nearest enemy rather than choosing a distant high-value strike', () => {
  const state = snapshot([
    candidate('distant', { expectedDamage: 40 }),
    candidate('approach', { approachValue: 3, targetsNearestEnemy: 1 }, { kind: 'stride' }), end,
  ]);
  assert.equal(decide(state, profile('mindless')).chosen.id, 'approach');
  state.candidates = [state.candidates[0], end];
  assert.equal(decide(state, profile('mindless')).chosen.id, 'end');
  state.candidates = [state.candidates[0]];
  assert.equal(decide(state, profile('mindless')).chosen, null);
});

test('explicit fallback does not displace useful options and prevents negative-value attacks', () => {
  assert.equal(decide(snapshot([candidate('good', { expectedDamage: 1 }), end]), profile('standard')).chosen.id, 'good');
  assert.equal(decide(snapshot([candidate('bad', { hazardDamage: 4 }), end]), profile('standard')).chosen.id, 'end');
  assert.equal(decide(snapshot([]), profile('standard')).chosen, null);
});

test('candidate changes between decisions affect the next action', () => {
  const state = snapshot([candidate('attack', { expectedDamage: 10 }), end]);
  assert.equal(decide(state, profile('standard')).chosen.id, 'attack');
  state.candidates[0].legal = false;
  assert.equal(decide(state, profile('standard')).chosen.id, 'end');
});

test('equal utility is deterministic; malformed scores and duplicate IDs fail explicitly', () => {
  const state = snapshot([candidate('first', { expectedDamage: 5 }), candidate('second', { expectedDamage: 5 })]);
  assert.equal(decide(state, profile('standard')).chosen.id, 'first');
  assert.throws(() => decide(snapshot([candidate('nan', { expectedDamage: NaN })]), profile('standard')), /Non-finite/);
  assert.throws(() => decide(snapshot([candidate('same'), candidate('same')]), profile('standard')), /unique/);
  assert.throws(() => resolveProfile({ a: { extends: 'b' }, b: { extends: 'a' } }, 'a'), /cycle/);
});
