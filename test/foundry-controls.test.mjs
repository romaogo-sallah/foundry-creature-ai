import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PF2eWolfAdapter, MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';

test('Foundry controls preview with the reaction engine and reopen a saved choice without deciding again', async t => {
  const once = new Map(), dialogs = [], module = {};
  globalThis.libWrapper = { register: () => {} };
  globalThis.Hooks = { once: (name, fn) => once.set(name, fn), on: () => {} };
  globalThis.game = { settings:{get:(_namespace,key)=>key==='decisionPlanningBackend'?'native':undefined}, system: { id: 'pf2e' }, release: { generation: 14 }, modules: { get: () => module }, messages: { contents: [] },combat:{id:'combat',combatants:[]} };
  globalThis.canvas = { scene: { id: 'scene' }, tokens: { get: id => ({ name: id }),placeables:[] } };
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async data => dialogs.push(data) } } } };
  const profiles = JSON.parse(await readFile(new URL('../profiles/creatures.json', import.meta.url)));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => profiles }));
  const { preview, explainLast } = await import('../src/foundry/main.mjs');
  await once.get('ready')();
  assert.equal(module.api.explainLast, explainLast);

  const choice = { id: 'bite', kind: 'strike', targetId: 'fighter', assessment: { value: 5 } };
  const decision = { chosen: choice, ranked: [{ candidate: choice, layer: 6, utility: 5, terms: [] }],
    reason: 'dawnsbury ranking', tiedIds: ['bite'], diagnostics: { referenceAC: 18, encounterLevel: 1 } };
  const token = { id: 'wolf', name: 'Wolf', actor: { type: 'npc', system: { traits: { value: ['animal'] } }, alliance: 'opposition',
    getStatistic:()=>null,hitPoints:{value:10,max:10},
    itemTypes: { action: [{ slug: 'knockdown', system: { rules: [] } }, { system: { rules: [{ key: 'RollOption', option: 'pack-attack' }] } }] } }, document: { getFlag: () => ({}) } };
  t.mock.method(PF2eWolfAdapter.prototype, 'assertReady', async () => {});
  t.mock.method(PF2eWolfAdapter.prototype, 'turnKey', () => 'turn');
  t.mock.method(PF2eWolfAdapter.prototype, 'readLedger', async () => ({ actionsRemaining: 3 }));
  t.mock.method(PF2eWolfAdapter.prototype, 'snapshot', async function () {
    assert.equal(typeof this.reactions?.reactors, 'function', 'Preview must use the live reaction engine, like Run turn');
    return {self:{referenceAC:18},enemies:[],moves:[],actionsRemaining:3};
  });
  t.mock.method(PF2eWolfAdapter.prototype, 'decide', () => decision);
  assert.equal(await preview(token), decision);
  assert.match(dialogs.at(-1).content, /Chosen/);

  const record = { chosenId: 'saved-bite', reason: 'saved random tie', tiedIds: ['saved-bite', 'other-bite'],
    options: [{ id: 'saved-bite', kind: 'strike', targetId: 'magus', selected: true, layer: 6, value: 7, terms: [] }],
    rejected: [], totalOptions: 1 };
  game.messages.contents.push({ flags: { [MODULE_ID]: { tokenId: 'wolf', sceneId: 'scene', decisionLog: record } } },
    { flags: { [MODULE_ID]: { tokenId: 'wolf', sceneId: 'another-scene', decisionLog: { ...record, chosenId: 'wrong' } } } });
  t.mock.method(PF2eWolfAdapter.prototype, 'decide', () => { throw new Error('A saved decision must not be recalculated'); });
  assert.equal(await explainLast(token), record);
  assert.match(dialogs.at(-1).content, /saved random tie/);
  assert.match(dialogs.at(-1).content, /magus/);
});
