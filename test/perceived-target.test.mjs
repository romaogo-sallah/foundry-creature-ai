import test from 'node:test';
import assert from 'node:assert/strict';
import { PF2eCreatureAdapter, PF2eWolfAdapter } from '../src/foundry/pf2e-adapter.mjs';

// Pits, translocation and decision snapshots call perceivedTarget on every profile, including wolves and
// other adapters that do not define it themselves.
test('every creature adapter can name the target it perceives', () => {
  const live = { id: 'pc' };
  globalThis.canvas = { tokens: { get: id => id === 'pc' ? live : null } };
  for (const Adapter of [PF2eCreatureAdapter, PF2eWolfAdapter]) {
    const adapter = Object.create(Adapter.prototype);
    assert.equal(typeof adapter.perceivedTarget, 'function', Adapter.name);
    assert.equal(adapter.perceivedTarget({ id: 'pc' }), live, Adapter.name);
  }
});
