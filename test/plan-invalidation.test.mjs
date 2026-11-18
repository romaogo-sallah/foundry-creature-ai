import test from 'node:test';
import assert from 'node:assert/strict';
import { planningChange } from '../src/foundry/decision-runtime.mjs';

function world() {
  const scene = { id: 'arena', tokens: [{ actorId: 'wolf' }, { actorId: 'fighter' }] };
  const other = { id: 'tavern', tokens: [{ actorId: 'innkeeper' }] };
  globalThis.canvas = { scene };
  globalThis.game = { combat: { id: 'fight' } };
  const actor = id => ({ documentName: 'Actor', id, token: null });
  return { scene, other, actor };
}

test('settings from rules, movement and collision packages invalidate a plan; others do not', () => {
  world();
  for (const key of ['core.gridDiagonals', 'pf2e.automation.flanking', 'foundry-creature-ai.decisionPlanningBackend', 'pf2e-tactical-core.x', 'wall-height.x', 'levels.x'])
    assert.equal(planningChange('updateSetting', { key }), true, key);
  for (const key of ['foundry-mcp-bridge.lastActivity', 'smalltime.position', 'dice-so-nice.settings'])
    assert.equal(planningChange('updateSetting', { key }), false, key);
});

test('tokens, walls and regions count only on the viewed scene', () => {
  const { scene, other } = world();
  for (const event of ['createToken', 'updateToken', 'deleteToken', 'moveToken', 'createWall', 'updateWall', 'deleteWall', 'createRegion', 'updateRegion', 'deleteRegion']) {
    assert.equal(planningChange(event, { parent: scene }), true, event);
    assert.equal(planningChange(event, { parent: other }), false, event);
  }
  assert.equal(planningChange('updateRegionBehavior', { documentName: 'RegionBehavior', parent: { parent: scene } }), true);
  assert.equal(planningChange('updateRegionBehavior', { documentName: 'RegionBehavior', parent: { parent: other } }), false);
});

test('actors and their items count only when the actor has a token on the viewed scene', () => {
  const { scene, actor } = world();
  assert.equal(planningChange('updateActor', actor('wolf')), true);
  assert.equal(planningChange('updateActor', actor('innkeeper')), false);
  assert.equal(planningChange('updateActor', { ...actor('synthetic'), token: { parent: scene } }), true);
  assert.equal(planningChange('updateActor', { ...actor('synthetic'), token: { parent: { id: 'tavern' } } }), false);
  assert.equal(planningChange('createItem', { parent: actor('fighter') }), true);
  assert.equal(planningChange('updateItem', { parent: actor('innkeeper') }), false);
  assert.equal(planningChange('deleteItem', { parent: null }), false, 'a world item belongs to no creature');
});

test('only the current combat counts', () => {
  world();
  assert.equal(planningChange('updateCombat', { id: 'fight' }), true);
  assert.equal(planningChange('updateCombat', { id: 'old' }), false);
  assert.equal(planningChange('updateCombatant', { parent: { id: 'fight' } }), true);
  assert.equal(planningChange('updateCombatant', { parent: { id: 'old' } }), false);
});

test('anything unclear still invalidates', () => {
  world();
  assert.equal(planningChange('canvasReady'), true);
  assert.equal(planningChange('updateToken', {}), true, 'no parent scene');
  assert.equal(planningChange('updateSetting', {}), true, 'no key');
  globalThis.canvas = {};
  assert.equal(planningChange('updateToken', { parent: { id: 'tavern' } }), true, 'no viewed scene');
  globalThis.canvas = { scene: { id: 'arena', tokens: [] } }; globalThis.game = {};
  assert.equal(planningChange('updateCombat', { id: 'old' }), true, 'no current combat');
});
