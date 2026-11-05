import test from 'node:test';
import assert from 'node:assert/strict';
import { ReactionEngine, reactionCycle, shieldBlockEligible, REACTION_AUTO_DAMAGE } from '../src/foundry/reactions.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';

function fixture({ answer = 'pass', degree = 1 } = {}) {
  const calls = [], prompts = [];
  const scene = { id: 'scene' };
  const damage = { total: 7, instances: [{ type: 'piercing', total: 7, persistent: false }] };
  function actor(id, features) {
    const flags = new Map(), conditions = new Set();
    return {
      id, uuid: `Actor.${id}`, conditions, flags, hitPoints: { value: 30 },
      system: { traits: { value: [] }, actions: [] },
      attributes: { shield: { itemId: 'shield', raised: true, broken: false, destroyed: false, hardness: 5 } },
      itemTypes: { feat: features.map(slug => ({ slug })), action: [] },
      hasCondition: (...slugs) => slugs.some(slug => conditions.has(slug)),
      getFlag: (namespace, key) => flags.get(`${namespace}:${key}`),
      setFlag: async (namespace, key, value) => { flags.set(`${namespace}:${key}`, structuredClone(value)); calls.push(['flag', id, value]); },
      getReach: ({ weapon }) => weapon.reach ?? 5,
      isEnemyOf: other => other.id !== id,
      getSelfRollOptions: (prefix = 'self') => [`${prefix}:trait:humanoid`],
    };
  }
  function token(id, x, features) {
    const a = actor(id, features);
    a.applyDamage = async options => { calls.push(['applyDamage', id, options]); a.hitPoints.value -= options.damage.total; };
    const document = { id, parent: scene, x, y: 0, elevation: 0, level: 'ground', actor: a };
    return { id, name: id, actor: a, document,
      get center() { return { x: document.x + 50, y: document.y + 50 }; },
      checkCollision: () => false,
      distanceTo: other => Math.max(Math.abs(document.x - other.document.x), Math.abs(document.y - other.document.y)) / 100 * 5,
    };
  }
  const mover = token('wolf', 0, []), reactor = token('fighter', 100, ['shield-block', 'reactive-strike']);
  const item = { id: 'sword', name: 'Sword', isMelee: true, reach: 5, getRollOptions: () => ['item:damage:type:slashing'] };
  const strike = { type: 'strike', ready: true, canAttack: true, item, label: 'Sword',
    variants: [0, 1, 2].map(index => ({ roll: async params => {
      calls.push(['strike', index, params]);
      assert.equal(reactor.actor.getFlag(MODULE_ID, 'reaction').spent, true, 'reserve before rolling');
      return { degreeOfSuccess: degree };
    } })),
    damage: async params => { calls.push(['damage', params]); return damage; },
    critical: async params => { calls.push(['critical', params]); return { ...damage, total: 14 }; },
  };
  reactor.actor.system.actions = [strike];
  const gm = { id: 'gm', active: true, isGM: true };
  const turns = [{ id: 'wolf-turn', tokenId: mover.id, sceneId: 'scene' }, { id: 'fighter-turn', tokenId: reactor.id, sceneId: 'scene' }];
  globalThis.game = { user: gm, users: { activeGM: gm }, paused: false,
    combat: { id: 'combat', started: true, round: 1, turn: 0, turns, combatants: turns, combatant: turns[0] } };
  globalThis.canvas = { scene, tokens: { placeables: [mover, reactor] } };
  const engine = new ReactionEngine({ prompts: { ask: async request => { prompts.push(request); return answer; } } });
  return { mover, reactor, engine, calls, prompts, damage, strike, item };
}

test('Shield Block requires the ability, raised usable shield and immediate physical damage', () => {
  const f = fixture();
  assert.equal(shieldBlockEligible(f.reactor, f.damage), true);
  for (const flag of ['broken', 'destroyed']) {
    f.reactor.actor.attributes.shield[flag] = true;
    assert.equal(shieldBlockEligible(f.reactor, f.damage), false);
    f.reactor.actor.attributes.shield[flag] = false;
  }
  f.reactor.actor.attributes.shield.raised = false;
  assert.equal(shieldBlockEligible(f.reactor, f.damage), false);
  f.reactor.actor.attributes.shield.raised = true;
  for (const instance of [{ type: 'fire', total: 7 }, { type: 'bleed', total: 7 },
    { type: 'piercing', total: 7, persistent: true }, { type: 'piercing', total: 0 }]) {
    assert.equal(shieldBlockEligible(f.reactor, { instances: [instance] }), false);
  }
  f.reactor.actor.itemTypes.feat = [];
  assert.equal(shieldBlockEligible(f.reactor, f.damage), false);
});

test('Shield Block is reserved before application and confirmed after native damage completes', async () => {
  const f = fixture({ answer: 'block' });
  const block = await f.engine.shieldBlock({ origin: f.mover, target: f.reactor, damage: f.damage });
  assert.equal(f.prompts.length, 1);
  assert.equal(f.calls.some(c => c[0] === 'applyDamage'), false);
  assert.equal(f.engine.available(f.reactor), false);
  assert.equal(block.reservation.uncertain, true);
  await f.engine.confirm(block.token, block.reservation);
  assert.equal(f.reactor.actor.getFlag(MODULE_ID, 'reaction').uncertain, false);
  assert.equal(await f.engine.shieldBlock({ origin: f.mover, target: f.reactor, damage: f.damage }), false);
  assert.equal(f.prompts.length, 1);
});

test('passing Shield Block keeps the reaction; closing pauses without applying damage', async () => {
  const f = fixture();
  assert.equal(await f.engine.shieldBlock({ origin: f.mover, target: f.reactor, damage: f.damage }), false);
  assert.equal(f.engine.available(f.reactor), true);
  f.engine.prompts.ask = async () => 'pause';
  await assert.rejects(f.engine.shieldBlock({ origin: f.mover, target: f.reactor, damage: f.damage }), /Damage has not been applied/);
  assert.equal(f.engine.available(f.reactor), true);
});

test('the ordinary reaction refreshes on the creature turn, not when a new round begins', async () => {
  const f = fixture();
  await f.engine.setSpent(f.reactor, true);
  const initial = reactionCycle(f.reactor);
  assert.equal(f.engine.available(f.reactor), false);
  game.combat.turn = 1;
  game.combat.combatant = game.combat.turns[1];
  assert.notEqual(reactionCycle(f.reactor), initial);
  assert.equal(f.engine.available(f.reactor), true);
  await f.engine.setSpent(f.reactor, true);
  game.combat.round = 2;
  game.combat.turn = 0;
  game.combat.combatant = game.combat.turns[0];
  assert.equal(f.engine.available(f.reactor), false);
  game.combat.turn = 1;
  game.combat.combatant = game.combat.turns[1];
  assert.equal(f.engine.available(f.reactor), true);
});

test('incapacitated, minion, dead and out-of-combat creatures cannot react', () => {
  const f = fixture();
  for (const condition of ['unconscious', 'dying', 'dead', 'paralyzed', 'petrified', 'stunned']) {
    f.reactor.actor.conditions.add(condition);
    assert.equal(f.engine.available(f.reactor), false);
    f.reactor.actor.conditions.delete(condition);
  }
  f.reactor.actor.hitPoints.value = 0;
  assert.equal(f.engine.available(f.reactor), false);
  f.reactor.actor.hitPoints.value = 30;
  f.reactor.actor.system.traits.value = ['minion'];
  assert.equal(f.engine.available(f.reactor), false);
  f.reactor.actor.system.traits.value = [];
  game.combat.turns = [game.combat.turns[0]];
  assert.equal(f.engine.available(f.reactor), false);
});

test('Reactive Strike always rolls the first variant without increasing the NPC MAP ledger', async () => {
  const f = fixture({ answer: 'strike-0-0' });
  const result = await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.deepEqual(result, {});
  assert.equal(f.calls.find(c => c[0] === 'strike')[1], 0);
  assert.equal(f.calls.some(c => c[0] === 'damage'), false);
  assert.equal(f.engine.available(f.reactor), false);
});

test('a critical Reactive Strike rolls critical damage, applies it once and does not disrupt ordinary movement', async () => {
  const f = fixture({ answer: 'strike-0-0', degree: 3 });
  const result = await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.deepEqual(result, {});
  assert.equal(f.calls.filter(c => c[0] === 'critical').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'applyDamage').length, 1);
  assert.equal(f.calls.find(c => c[0] === 'critical')[1].mapIncreases, 0);
  assert.equal(f.calls.find(c => c[0] === 'strike')[2].options.includes(REACTION_AUTO_DAMAGE), true);
  assert.equal(f.mover.actor.hitPoints.value, 16);
});

test('Reactive Strike lethal damage stops movement; rolls-only hits pause for damage application', async () => {
  const f = fixture({ answer: 'strike-0-0', degree: 2 });
  f.mover.actor.hitPoints.value = 7;
  let pauses = 0;
  f.engine.onPause = () => { pauses++; };
  const ended = await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.equal(ended.endTurn, true);
  assert.equal(Boolean(ended.pause), false);
  assert.equal(pauses, 0, 'an ordinary NPC death must not stop other AI runners');
  const g = fixture({ answer: 'strike-0-0', degree: 2 });
  const result = await g.engine.movement({ mover: g.mover, seen: new Set(), applyDamage: false });
  assert.equal(result.pause, true);
  assert.equal(g.calls.some(c => c[0] === 'applyDamage'), false);
  assert.equal(g.engine.available(g.reactor), false);
});

test('passing offers at most one prompt per reacting creature for each move action', async () => {
  const f = fixture();
  const seen = new Set();
  await f.engine.movement({ mover: f.mover, seen });
  await f.engine.movement({ mover: f.mover, seen });
  assert.equal(f.prompts.length, 1);
  assert.equal(f.engine.available(f.reactor), true);
  await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.equal(f.prompts.length, 2);
});

test('Shield Block and Reactive Strike share one ordinary reaction', async () => {
  const f = fixture({ answer: 'block' });
  await f.engine.shieldBlock({ origin: f.mover, target: f.reactor, damage: f.damage });
  await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.equal(f.prompts.length, 1);
  assert.equal(f.calls.some(c => c[0] === 'strike'), false);
});

test('reach, ready melee weapons, sight and elevation determine Reactive Strike eligibility', () => {
  const f = fixture();
  assert.equal(f.engine.reactors(f.mover).length, 1);
  f.reactor.document.x = 200;
  assert.equal(f.engine.reactors(f.mover).length, 0);
  f.item.reach = 10;
  assert.equal(f.engine.reactors(f.mover).length, 1);
  f.strike.ready = false;
  assert.equal(f.engine.reactors(f.mover).length, 0);
  f.strike.ready = true;
  f.item.isMelee = false;
  assert.equal(f.engine.reactors(f.mover).length, 0);
  f.item.isMelee = true;
  f.reactor.checkCollision = () => true;
  assert.equal(f.engine.reactors(f.mover).length, 0);
  f.reactor.checkCollision = () => false;
  f.mover.document.elevation = 5;
  assert.equal(f.engine.reactors(f.mover).length, 1,'different elevations can still be inside 3D reach');
  f.mover.document.elevation = 20;
  assert.equal(f.engine.reactors(f.mover).length, 0);
});

test('unarmed or melee alternative usages are offered individually when in reach', () => {
  const f = fixture();
  f.item.isMelee = false;
  f.strike.altUsages = [{ ...f.strike, item: { ...f.item, isMelee: true, name: 'Bayonet' } }];
  assert.deepEqual(f.engine.meleeStrikes(f.reactor, f.mover).map(c => c.id), ['strike-0-1']);
});

test('a legacy Attack of Opportunity ability is recognized, while mere proximity never prompts', async () => {
  const f = fixture();
  f.reactor.actor.itemTypes.feat = [];
  await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.equal(f.prompts.length, 0);
  f.reactor.actor.itemTypes.action = [{ slug: 'attack-of-opportunity' }];
  await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.equal(f.prompts.length, 1);
});

test('an invalidated trigger cannot spend or roll the offered reaction', async () => {
  const f = fixture();
  let valid = true;
  f.engine.prompts.ask = async () => { valid = false; return 'strike-0-0'; };
  const result = await f.engine.movement({ mover: f.mover, seen: new Set(), valid: () => valid });
  assert.equal(result.pause, true);
  assert.equal(f.engine.available(f.reactor), true);
  assert.equal(f.calls.some(c => c[0] === 'strike'), false);
});

test('simultaneous requests cannot spend the same reaction twice', async () => {
  const f = fixture({ answer: 'strike-0-0' });
  await Promise.all([f.engine.movement({ mover: f.mover, seen: new Set() }), f.engine.movement({ mover: f.mover, seen: new Set() })]);
  assert.equal(f.prompts.length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'strike').length, 1);
});

test('cancelled reaction rolls retain a spent uncertain reservation', async () => {
  const f = fixture({ answer: 'strike-0-0' });
  f.strike.variants[0].roll = async () => null;
  await assert.rejects(f.engine.movement({ mover: f.mover, seen: new Set() }), /roll was cancelled/);
  assert.equal(f.engine.available(f.reactor), false);
  assert.equal(f.reactor.actor.getFlag(MODULE_ID, 'reaction').uncertain, true);
  await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.equal(f.prompts.length, 1);
});

test('the GM can correct reactions used manually, and other users cannot change counts', async () => {
  const f = fixture();
  await f.engine.setSpent(f.reactor, true);
  assert.equal(f.engine.available(f.reactor), false);
  await f.engine.setSpent(f.reactor, false);
  assert.equal(f.engine.available(f.reactor), true);
  game.user = { id: 'player' };
  await assert.rejects(f.engine.setSpent(f.reactor, true), /active GM/);
});

test('invalid or out-of-reach weapon selections never roll or consume a reaction', async () => {
  for (const mode of ['invalid', 'moved']) {
    const f = fixture();
    f.engine.prompts.ask = async () => {
      if (mode === 'moved') f.reactor.document.x = 1000;
      return mode === 'invalid' ? 'not-a-strike' : 'strike-0-0';
    };
    await assert.rejects(f.engine.movement({ mover: f.mover, seen: new Set() }), /weapon or reach changed/);
    assert.equal(f.engine.available(f.reactor), true);
    assert.equal(f.calls.some(c => c[0] === 'strike'), false);
  }
});

test('a combatant marked defeated is not offered a reaction even with HP left', () => {
  const f = fixture();
  game.combat.turns[1].defeated = true;
  assert.equal(f.engine.available(f.reactor), false);
});

test('Shield Block recognizes nullable slugs through native item roll options or canonical source identity', async () => {
  for (const identity of [
    { slug: null, getRollOptions: prefix => [`${prefix}:slug:shield-block`] },
    { slug: null, name: 'Translated ability', sourceId: 'Compendium.pf2e.feats-srd.Item.jM72TjJ965jocBV8' },
    { slug: null, _stats: { compendiumSource: 'Compendium.pf2e.feats-srd.Item.jM72TjJ965jocBV8' } },
    { slug: null, sourceId: 'Actor.imported.Item.copy', _stats: { compendiumSource: 'Compendium.pf2e.feats-srd.Item.jM72TjJ965jocBV8' } },
    { slug: null, flags: { core: { sourceId: 'Compendium.pf2e.feats-srd.jM72TjJ965jocBV8' } } },
  ]) {
    const f = fixture({ answer: 'block' });
    f.reactor.actor.itemTypes.feat = [identity];
    assert.equal(shieldBlockEligible(f.reactor, f.damage), true);
    assert.equal(Boolean(await f.engine.shieldBlock({ origin: f.mover, target: f.reactor, damage: f.damage })), true);
    assert.equal(f.prompts.length, 1);
  }
});

test('a raised shield and extra-reaction feat alone do not grant Shield Block', () => {
  const f = fixture();
  f.reactor.actor.itemTypes.feat = [{ slug: 'quick-shield-block', getRollOptions: () => ['item:slug:quick-shield-block'] }];
  assert.equal(shieldBlockEligible(f.reactor, f.damage), false);
});

test('a skipped Shield Block records whether Reactive Strike already spent the shared reaction', async () => {
  const f = fixture({ answer: 'strike-0-0' });
  await f.engine.movement({ mover: f.mover, seen: new Set() });
  assert.equal(await f.engine.shieldBlock({ origin: f.mover, target: f.reactor, damage: f.damage }), false);
  const check = f.engine.lastShieldChecks.get(f.reactor.actor.uuid);
  assert.match(check.reason, /already spent on Reactive Strike/);
  assert.equal(check.abilityFound, true);
  assert.equal(check.shieldRaised, true);
  assert.equal(check.reactionAvailable, false);
  assert.equal(f.prompts.length, 1);
});

test('Shield Block diagnostics distinguish the missing ability, lowered shield and nonphysical damage', async () => {
  const f = fixture();
  assert.equal(f.engine.inspectShieldBlock(f.reactor, { damage: f.damage }).eligible, true);
  f.reactor.actor.attributes.shield.raised = false;
  assert.match(f.engine.inspectShieldBlock(f.reactor).reason, /not raised/);
  f.reactor.actor.attributes.shield.raised = true;
  assert.match(f.engine.inspectShieldBlock(f.reactor, { damage: { instances: [{ type: 'fire', total: 6 }] } }).reason, /no positive immediate physical/);
  f.reactor.actor.itemTypes.feat = [];
  assert.match(f.engine.inspectShieldBlock(f.reactor).reason, /ability was not found/);
});
