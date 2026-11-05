import test from 'node:test';
import assert from 'node:assert/strict';
import { ReactionPrompts, reactionOwner, combatStamp, REACTION_QUERY } from '../src/foundry/reaction-prompts.mjs';

function fixture({ localAnswer = 'block', remoteAnswer = 'block' } = {}) {
  const requests = [], dialogs = [];
  const gm = { id: 'gm', isGM: true, active: true };
  const owner = { id: 'player', name: 'Player', isGM: false, active: true, character: { id: 'fighter' } };
  const actor = { id: 'fighter', testUserPermission: user => user.id === owner.id || user.isGM };
  const document = { id: 'token', actor, parent: { id: 'scene' } };
  const token = { id: document.id, name: 'Fighter', actor, document };
  const scene = { id: 'scene', tokens: new Map([[document.id, document]]) };
  const combat = { id: 'combat', started: true, round: 1, turn: 0, combatant: { id: 'wolf-turn' } };
  globalThis.game = { user: gm, users: { activeGM: gm, contents: [gm, owner] }, combat, paused: false,
    scenes: new Map([[scene.id, scene]]) };
  globalThis.canvas = { scene, tokens: { get: () => token } };
  let id = 0;
  let wait = async config => { dialogs.push(config); return localAnswer; };
  globalThis.foundry = { utils: { randomID: () => `request-${++id}` }, applications: { api: { DialogV2: {
    wait: config => wait(config),
  } } } };
  globalThis.CONFIG = { queries: {} };
  owner.query = async (name, data, options) => { requests.push({ name, data, options }); return remoteAnswer; };
  const prompts = new ReactionPrompts({ timeoutMs: 1000, pollMs: 5 });
  const ask = valid => prompts.ask({ token, title: 'Shield Block', description: 'Incoming 7 damage',
    choices: [{ id: 'block', label: 'Shield Block' }], valid });
  const data = () => ({ id: 'example', tokenId: token.id, sceneId: scene.id, stamp: combatStamp(), expires: Date.now() + 1000,
    title: 'Shield Block', description: '<Fighter>', choices: [{ id: 'block', label: 'Shield Block' }] });
  return { prompts, token, owner, gm, requests, dialogs, ask, data, setWait: fn => { wait = fn; } };
}

test('reaction ownership prefers the assigned character owner, with GM fallback', () => {
  const f = fixture();
  const coOwner = { id: 'aaa', active: true, isGM: false };
  f.token.actor.testUserPermission = user => ['aaa', 'player', 'gm'].includes(user.id);
  game.users.contents.push(coOwner);
  assert.equal(reactionOwner(f.token).id, 'player');
  f.owner.active = false;
  assert.equal(reactionOwner(f.token).id, 'aaa');
  coOwner.active = false;
  assert.equal(reactionOwner(f.token).id, 'gm');
});

test('prompts register a namespaced authenticated User.query handler on every client', () => {
  const f = fixture();
  f.prompts.install();
  assert.equal(typeof CONFIG.queries[REACTION_QUERY], 'function');
});

test('movement choices use the owner transport without presenting them as reactions', async () => {
  const f = fixture({ localAnswer: 'step' }); game.user = f.owner;
  assert.equal(await f.prompts.receive({ ...f.data(), kind: 'movement', title: 'Movement',
    choices: [{ id: 'stride', label: 'Stride' }, { id: 'step', label: 'Step' }] }, f.gm), 'step');
  assert.match(f.dialogs[0].content, /movement action/);
  assert.doesNotMatch(f.dialogs[0].content, /Using a reaction spends/);
  assert.equal(f.dialogs[0].buttons.find(button => button.action === 'pass').label, 'Cancel movement');
});

test('the GM requests exactly one owner response using serializable data', async () => {
  const f = fixture();
  assert.equal(await f.ask(), 'block');
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].name, REACTION_QUERY);
  assert.equal(f.requests[0].data.tokenId, 'token');
  assert.equal(f.requests[0].data.stamp, combatStamp());
  assert.equal(f.dialogs.length, 0);
  assert.doesNotThrow(() => JSON.stringify(f.requests[0].data));
});

test('a player sees a prompt only for an owned actor and from the active GM', async () => {
  const f = fixture();
  game.user = f.owner;
  assert.equal(await f.prompts.receive(f.data(), f.gm), 'block');
  assert.match(f.dialogs[0].content, /&lt;Fighter&gt;/);
  await assert.rejects(f.prompts.receive(f.data(), f.owner), /active GM/);
  await assert.rejects(f.prompts.receive(f.data(), { id: 'otherGM', isGM: true }), /active GM/);
  f.token.actor.testUserPermission = () => false;
  assert.equal(await f.prompts.receive(f.data(), f.gm), 'pause');
  assert.equal(f.dialogs.length, 1);
});

test('a player cannot request a reaction or close a prompt as the GM', async () => {
  const f = fixture();
  game.user = f.owner;
  await assert.rejects(f.ask(), /active GM/);
  await assert.rejects(f.prompts.receive({ id: 'example', cancel: true }, f.owner), /active GM/);
});

test('dismissed dialogs and unknown answers pause instead of silently declining', async () => {
  const f = fixture({ remoteAnswer: null });
  assert.equal(await f.ask(), 'pause');
  f.owner.query = async () => 'unknown';
  assert.equal(await f.ask(), 'pause');
  f.owner.active = false;
  f.setWait(async () => null);
  assert.equal(await f.ask(), 'pause');
});

test('a stopped runner cancels a remote prompt and ignores its late reply', async () => {
  const f = fixture();
  let reply;
  f.owner.query = async (name, data) => {
    f.requests.push({ name, data });
    if (data.cancel) return 'pause';
    return new Promise(resolve => { reply = resolve; });
  };
  let valid = true;
  const pending = f.ask(() => valid);
  while (!reply) await new Promise(resolve => setImmediate(resolve));
  valid = false;
  assert.equal(await pending, 'pause');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.requests.some(request => request.data.cancel), true);
  reply('block');
  assert.equal(f.dialogs.length, 0);
});

test('owner disconnection or a failed remote query falls back to the GM', async () => {
  const f = fixture();
  f.owner.query = async (_name, data) => { if (data.cancel) return 'pause'; throw new Error('disconnected'); };
  assert.equal(await f.ask(), 'block');
  assert.equal(f.dialogs.length, 1);
  assert.match(f.dialogs[0].content, /GM decision/);
});

test('remote timeout offers the decision to the GM without assuming Pass', async () => {
  const f = fixture();
  f.prompts.timeoutMs = 10;
  f.owner.query = async (_name, data) => data.cancel ? 'pause' : new Promise(() => {});
  assert.equal(await f.ask(), 'block');
  assert.match(f.dialogs[0].content, /timed out/);
});

test('a local dialog closes when its combat turn changes', async () => {
  const f = fixture();
  f.owner.active = false;
  let shown = false, closes = 0;
  f.setWait(config => new Promise(resolve => {
    config.render({}, { close: async () => { closes++; resolve(null); } });
    shown = true;
  }));
  const pending = f.ask();
  while (!shown) await new Promise(resolve => setImmediate(resolve));
  game.combat.turn++;
  assert.equal(await pending, 'pause');
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(closes, 1);
  assert.equal(f.prompts.dialogs.size, 0);
});

test('stale combat stamps or lost ownership cannot accept a displayed reaction', async () => {
  const f = fixture();
  const data = f.data();
  game.combat.round++;
  assert.equal(await f.prompts.receive(data, f.gm), 'pause');
  assert.equal(f.dialogs.length, 0);
  game.user = f.owner;
  f.setWait(async () => { f.token.actor.testUserPermission = () => false; return 'block'; });
  assert.equal(await f.prompts.receive(f.data(), f.gm), 'pause');
});

test('an owner viewing another scene can answer for the triggering combat', async () => {
  const f = fixture();
  const combat = game.combat;
  const data = { ...f.data(), combatId: combat.id };
  game.user = f.owner;
  game.combats = new Map([[combat.id, combat]]);
  game.combat = null;
  canvas.scene = { id: 'another-scene' };
  assert.equal(await f.prompts.receive(data, f.gm), 'block');
});

test('ownership is checked on the current synthetic actor after a token update', async () => {
  const f = fixture();
  game.user = f.owner;
  f.setWait(async () => {
    f.token.document.actor = { ...f.token.actor, testUserPermission: () => false };
    return 'block';
  });
  assert.equal(await f.prompts.receive(f.data(), f.gm), 'pause');
});
