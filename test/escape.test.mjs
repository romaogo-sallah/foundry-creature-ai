import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { escapeBindings, escapeOptions, executeEscape, configureEscapes } from '../src/foundry/escape.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';

function fixture() {
  const grabbed = { id: 'grab-1', slug: 'grabbed', name: 'Grabbed' };
  const immobilized = { id: 'immob-1', slug: 'immobilized', appliedBy: grabbed, isLocked: true };
  const other = { id: 'restrain-2', slug: 'restrained', name: 'Restrained' };
  const conditions = new Map([grabbed, immobilized, other].map(condition => [condition.id, condition]));
  const calls = [], flags = new Map();
  const actor = { uuid: 'Actor.wolf',
    getCondition: slug => [...conditions.values()].filter(condition => condition.slug === slug),
    hasCondition: (...slugs) => [...conditions.values()].some(condition => slugs.includes(condition.slug)),
    deleteEmbeddedDocuments: async (_type, ids) => {
      calls.push(['delete', ids]);
      for (const condition of conditions.values()) if (ids.includes(condition.id) || ids.includes(condition.appliedBy?.id)) conditions.delete(condition.id);
    },
  };
  const source = { id: 'holder', name: 'Holder', actor: { uuid: 'Actor.holder', isOfType: () => true, getStatistic: () => ({ dc: { value: 21 } }) }, document: {} };
  const token = { id: 'wolf', name: 'Wolf', actor, document: {
    getFlag: (_module, key) => flags.get(key), setFlag: async (_module, key, value) => flags.set(key, value),
  } };
  globalThis.canvas = { tokens: { get: id => id === source.id ? source : null, placeables: [token, source] } };
  const action = { getDefaultVariant: () => ({ preview: () => [
    { slug: 'unarmed', modifier: 9 }, { slug: 'acrobatics', modifier: 12 }, { slug: 'athletics', modifier: 6 },
  ] }), use: async params => { calls.push(['roll', params]); return [{ outcome: 'success' }]; } };
  globalThis.game = { user: { settings: { showCheckDialogs: true } }, pf2e: { actions: new Map([['escape', action]]) } };
  const adapter = { actor, token };
  return { adapter, actor, grabbed, immobilized, other, conditions, calls, flags, source, action };
}

test('granted Immobilized is grouped with its owning condition, not another restraint', () => {
  const f = fixture();
  const groups = escapeBindings(f.actor);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.find(group => group.id === f.grabbed.id).conditions.map(condition => condition.id).sort(), ['grab-1', 'immob-1']);
  assert.equal(groups.find(group => group.id === f.grabbed.id).removable, true);
});

test('Escape does not infer a nearby holder and uses the best native preview with an explicit source', () => {
  const f = fixture();
  assert.deepEqual(escapeOptions(f.adapter), []);
  f.flags.set('escapeSources', { 'grab-1': { tokenId: 'holder', actorUuid: 'Actor.holder', customDC: null } });
  const [option] = escapeOptions(f.adapter);
  assert.equal(option.dc, 21);
  assert.equal(option.statistic, 'acrobatics');
  assert.equal(option.bonus, 12);
  f.source.actor.getStatistic = () => ({ dc: { value: 23 } });
  assert.equal(escapeOptions(f.adapter)[0].dc, 23, 'the selected holder DC is refreshed');
  f.source.actor.uuid = 'Actor.someone-else';
  assert.deepEqual(escapeOptions(f.adapter), [], 'replacing a source actor invalidates the old binding');
});

test('successful Escape deletes only the chosen root and its granted restrictions', async () => {
  const f = fixture();
  f.flags.set('escapeSources', { 'grab-1': { customDC: 20 } });
  const result = await executeEscape(f.adapter, { escapeId: 'grab-1', statistic: 'acrobatics' }, { attacksMade: 2 }, () => true);
  assert.deepEqual(f.calls.find(call => call[0] === 'delete')[1], ['grab-1']);
  assert.deepEqual([...f.conditions.keys()], ['restrain-2']);
  assert.equal(result.lastAction.outcome, 'success');
  assert.equal(f.calls.find(call => call[0] === 'roll')[1].multipleAttackPenalty, -5);
});

test('vanished or changed sources are known unexecuted skips, without another roll or deletion', async () => {
  const f = fixture();
  let result = await executeEscape(f.adapter, { escapeId: 'unknown', statistic: 'unarmed' }, { attacksMade: 1 }, () => true);
  assert.equal(result.skipped, true);
  assert.equal(result.pause, undefined);
  result = await executeEscape(f.adapter, { escapeId: 'grab-1', statistic: 'unarmed' }, { attacksMade: 1 }, () => true);
  assert.equal(result.skipped, true);
  assert.equal(result.pause, true);
  assert.deepEqual(f.calls, []);
});

test('Escape does not delete effects or detach a granted root with unrelated effects', () => {
  const f = fixture();
  f.grabbed.appliedBy = { id: 'spell', slug: 'holding-spell', type: 'effect' };
  f.grabbed.isLocked = true;
  f.flags.set('escapeSources', { 'grab-1': { customDC: 20 } });
  assert.deepEqual(escapeOptions(f.adapter), []);
  assert.equal(escapeBindings(f.actor).find(group => group.id === 'grab-1').removable, false);
});

test('an incompletely removed linked restraint pauses instead of silently reassigning its source', async () => {
  const f = fixture();
  f.flags.set('escapeSources', { 'grab-1': { customDC: 20 } });
  f.actor.deleteEmbeddedDocuments = async (_type, ids) => {
    ids.forEach(id => f.conditions.delete(id)); f.immobilized.appliedBy = null; f.immobilized.isLocked = false;
  };
  await assert.rejects(executeEscape(f.adapter, { escapeId: 'grab-1', statistic: 'unarmed' }, { attacksMade: 1 }, () => true), /linked conditions remain/);
  assert.ok(f.conditions.has('restrain-2'));
});

test('a source setup answer invalidated by Stop or a turn change cannot be saved or spent', async () => {
  const f = fixture();
  let valid = true;
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => {
    valid = false; return { tokenId: 'holder', dc: '' };
  } } } } };
  assert.equal(await configureEscapes(f.adapter, { valid: () => valid }), false);
  assert.equal(f.flags.has('escapeSources'), false);
  assert.deepEqual(f.calls, []);
});

function wrapGrapple(f, { recorded = true } = {}) {
  const effect = { id: 'grapple-effect', name: 'Effect: Grabbed until end of attacker next turn', type: 'effect',
    slug: 'effect-grabbed-until-end-of-attacker-next-turn', sourceId: 'Compendium.pf2e-automations.effects.Item.5MNn6cmXxbORB8x8',
    system: { rules: [{ key: 'GrantItem', uuid: 'Compendium.pf2e.conditionitems.kWc1fhmv9LBiTuei' }],
      context: recorded ? { origin: { actor: 'Actor.holder', token: 'Scene.scene.Token.holder' } } : null },
    flags: { pf2e: { itemGrants: { grabbed: { id: f.grabbed.id, onDelete: 'restrict' } } } } };
  f.source.document.uuid = 'Scene.scene.Token.holder';
  Object.assign(f.grabbed, { isLocked: true, appliedBy: effect,
    flags: { pf2e: { grantedBy: { id: effect.id, onDelete: 'cascade' } } } });
  f.actor.items = new Map([[effect.id, effect], ...f.conditions]);
  const originalDelete = f.actor.deleteEmbeddedDocuments;
  f.actor.deleteEmbeddedDocuments = async (type, ids) => {
    // Native PF2e's processGrantDeletions recurses through cascading grants.
    const cascaded = new Set(ids);
    let previousSize;
    do {
      previousSize = cascaded.size;
      for (const condition of f.conditions.values()) if (cascaded.has(condition.appliedBy?.id)) cascaded.add(condition.id);
    } while (cascaded.size !== previousSize);
    await originalDelete(type, ids);
    cascaded.forEach(id => { f.actor.items.delete(id); f.conditions.delete(id); });
  };
  return effect;
}

test('the recognized automation grapple groups the locked condition and child under its removable effect', () => {
  const f = fixture();
  const effect = wrapGrapple(f);
  const group = escapeBindings(f.actor).find(group => group.id === effect.id);
  assert.equal(group.kind, 'grapple-effect');
  assert.equal(group.removable, true);
  assert.deepEqual(group.conditions.map(condition => condition.id).sort(), ['grab-1', 'immob-1']);
});

test('a recorded grapple attacker supplies its current Athletics DC without prompting or guessing', async () => {
  const f = fixture();
  const effect = wrapGrapple(f);
  f.conditions.delete(f.other.id);
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => { throw new Error('Unexpected setup prompt'); } } } } };
  assert.equal(await configureEscapes(f.adapter), true);
  const [option] = escapeOptions(f.adapter);
  assert.equal(option.id, effect.id);
  assert.equal(option.target, f.source);
  assert.equal(option.recordedSource, true);
  assert.equal(option.dc, 21);
  f.source.actor.getStatistic = () => ({ dc: { value: 24 } });
  assert.equal(escapeOptions(f.adapter)[0].dc, 24);
  f.source.actor.uuid = 'Actor.replacement';
  assert.equal(escapeOptions(f.adapter).length, 0, 'a replacement actor does not inherit the original grapple source');
});

test('Escape deletes the granting grapple effect and its conditions while retaining another restraint', async () => {
  const f = fixture();
  const effect = wrapGrapple(f);
  await executeEscape(f.adapter, { escapeId: effect.id, statistic: 'acrobatics' }, { attacksMade: 1 }, () => true);
  assert.deepEqual(f.calls.find(call => call[0] === 'delete')[1], [effect.id]);
  assert.equal(f.actor.items.has(effect.id), false);
  assert.deepEqual([...f.conditions.keys()], ['restrain-2']);
});

test('an automation grapple without recorded origin prompts for a source before rolling', async () => {
  const f = fixture();
  const effect = wrapGrapple(f, { recorded: false });
  f.conditions.delete(f.other.id);
  let prompts = 0;
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => { prompts++; return { tokenId: 'holder', dc: '' }; } } } } };
  assert.equal(await configureEscapes(f.adapter), true);
  assert.equal(prompts, 1);
  assert.equal(f.flags.get('escapeSources')[effect.id].tokenId, 'holder');
  assert.equal(f.calls.length, 0);
});

test('modified, foreign and non-cascading grapple effects remain manual', () => {
  for (const change of ['extra-rule', 'wrong-source', 'other-grant', 'detach', 'temporary']) {
    const f = fixture();
    const effect = wrapGrapple(f);
    if (change === 'extra-rule') effect.system.rules.push({ key: 'FlatModifier', value: 1 });
    if (change === 'wrong-source') effect.sourceId = 'Compendium.other.effects.Item.5MNn6cmXxbORB8x8';
    if (change === 'other-grant') effect.flags.pf2e.itemGrants.other = { id: 'other' };
    if (change === 'detach') f.grabbed.flags.pf2e.grantedBy.onDelete = 'detach';
    if (change === 'temporary') effect.inMemoryOnly = true;
    assert.equal(escapeBindings(f.actor).find(group => group.conditions.some(condition => condition.id === f.grabbed.id)).removable, false, change);
    assert.equal(escapeOptions(f.adapter).length, 0, change);
  }
});

test('a refused grapple-effect deletion pauses instead of reporting a successful removal', async () => {
  const f = fixture();
  const effect = wrapGrapple(f);
  f.actor.deleteEmbeddedDocuments = async () => {};
  await assert.rejects(executeEscape(f.adapter, { escapeId: effect.id, statistic: 'acrobatics' }, { attacksMade: 1 }, () => true), /granting grapple effect remains/);
});

test('an explicit Escape DC overrides the recorded attacker source', () => {
  const f = fixture();
  const effect = wrapGrapple(f);
  f.flags.set('escapeSources', { [effect.id]: { customDC: 26 } });
  const option = escapeOptions(f.adapter)[0];
  assert.equal(option.dc, 26);
  assert.equal(option.target, null);
  assert.equal(option.recordedSource, false);
});

test('a changed Escape DC before execution releases the unexecuted action without rolling', async () => {
  const f = fixture();
  const effect = wrapGrapple(f);
  const result = await executeEscape(f.adapter, { escapeId: effect.id, statistic: 'acrobatics', estimate: { dc: 18 } }, { attacksMade: 1 }, () => true);
  assert.equal(result.skipped, true);
  assert.equal(result.pause, true);
  assert.match(result.skipReason, /DC changed/);
  assert.equal(f.calls.length, 0);
});

test('Escape skips the native PF2e roll dialog with either GM check-dialog preference', async t => {
  const source = await readFile('C:/Users/Roman/AppData/Local/FoundryVTT/Data/systems/pf2e/pf2e.mjs', 'utf8').catch(() => null);
  if (!source) return t.skip('Installed PF2e source is unavailable');
  // Execute only the two stateless functions from the installed system. This
  // verifies native modifier-key behavior rather than duplicating its formula.
  const relevant = source.match(/^function isRelevantEvent\([\s\S]*?^\}/m)?.[0];
  const params = source.match(/^function eventToRollParams\([\s\S]*?^\}/m)?.[0];
  assert.ok(relevant && params, 'native roll-event functions are present');
  const createNative = new Function('game', `${relevant}\n${params}\nreturn eventToRollParams;`);
  for (const showCheckDialogs of [true, false]) {
    const f = fixture();
    game.user.settings.showCheckDialogs = showCheckDialogs;
    f.flags.set('escapeSources', { 'grab-1': { customDC: 20 } });
    const native = createNative(game);
    f.action.use = async options => {
      assert.equal(native(options.event, { type: 'check' }).skipDialog, true);
      assert.equal(options.target, f.actor);
      assert.equal(options.difficultyClass.value, 20);
      return [{ outcome: 'failure' }];
    };
    const result = await executeEscape(f.adapter, { escapeId: 'grab-1', statistic: 'acrobatics' }, { attacksMade: 1 }, () => true);
    assert.equal(result.lastAction.outcome, 'failure');
    assert.equal(result.escapeBlocked, false);
  }
});
