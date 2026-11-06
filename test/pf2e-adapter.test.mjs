import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveProfile } from '../src/decision-engine.mjs';
import { PF2eWolfAdapter, MODULE_ID, MANAGED_OPTION, MANAGED_TRIP_OPTION, SKIP_RULE_AUTOMATION, wolfParts } from '../src/foundry/pf2e-adapter.mjs';
import { TurnRunner } from '../src/wolf/turn-runner.mjs';
import { ReactionEngine, REACTION_OPTION, REACTION_AUTO_DAMAGE } from '../src/foundry/reactions.mjs';
import { packAssessment } from '../src/foundry/pack-morale.mjs';

const profile = resolveProfile(JSON.parse(await readFile(new URL('../profiles/creatures.json', import.meta.url))), 'wolf');

test('wolves can choose automatic Seek while restrained without spending attack MAP',async()=>{
  const f=fixture();f.targetConditions.add('hidden');f.conditions.add('restrained');
  const native=f.actor.getStatistic;
  f.actor.getStatistic=slug=>slug==='perception'?{check:{mod:7,roll:async options=>{
    f.calls.push(['perception',options]);return {total:22,dice:[{faces:20,total:15}]};}}}:native(slug);
  const current=await f.adapter.readLedger(f.adapter.turnKey());
  const seek=f.adapter.candidates(await f.adapter.snapshot(current)).find(c=>c.kind==='seek');assert.ok(seek);
  const result=await f.adapter.execute(seek,{...current,actionsRemaining:2});
  assert.equal(result.resolved,true);assert.equal(result.lastAction.kind,'seek');assert.equal(seek.mapIncreases,undefined);
  assert.equal(f.calls.filter(c=>c[0]==='perception').length,1);
});

function fixture({ remaster = true, applyDamage = true, hit = 2, outcome = 'success', gridSize = 100, sceneSize = 6 } = {}) {
  const calls = [], conditions = new Set(), targetConditions = new Set(), flags = new Map();
  let packActive = false;
  class Rectangle {
    constructor(x, y, width, height) { Object.assign(this, { x, y, width, height, left: x, right: x + width, top: y, bottom: y + height }); }
  }
  globalThis.PIXI = { Rectangle };
  const targetActor = {
    type: 'character', uuid: 'Actor.target', size: 'med', hitPoints: { value: 40 }, canAttack: true,
    attributes: { flanking: { flankable: true, canFlank: true }, immunities: [] },
    system: { traits: { value: ['humanoid'] } },
    isOfType: type => type === 'creature',
    isAllyOf: other => targetActor.alliance != null && targetActor.alliance === other.alliance,
    hasCondition: (...names) => names.some(n => targetConditions.has(n)),
    increaseCondition: async c => { targetConditions.add(c); calls.push(['targetCondition', c]); },
    getReach: () => 5, getSelfRollOptions: () => ['self:trait:humanoid'],
    getStatistic: slug => ({ check: { mod: slug === 'athletics' ? 8 : 5 }, dc: { value: slug === 'athletics' ? 18 : 15 } }),
    applyDamage: async options => { assert.equal(typeof options.damage, 'object'); calls.push(['applyDamage', options]); targetActor.hitPoints.value -= options.damage.total; },
  };
  const pack = { id: 'pack', system: { rules: [
    { key: 'RollOption', domain: 'damage', option: 'pack-attack' },
    { key: 'DamageDice', diceNumber: 1, dieSize: 'd4', selector: ['strike-damage'], predicate: ['pack-attack'] },
  ] } };
  const knockdown = { slug: 'knockdown', actionCost: { type: 'action', value: 1 }, system: { rules: [], publication: { remaster } } };
  const item = { id: 'jaws', isMelee: true, attackEffects: ['knockdown'],
    system: { damageRolls: { base: { damage: '1d6+2' } } }, getRollOptions: () => ['item:damage:type:piercing'] };
  const strike = { item, type: 'strike', get totalModifier() { return 9 - (conditions.has('prone') ? 2 : 0); },
    variants: [0, -5, -10].map((penalty, index) => ({ penalty, roll: async params => {
      calls.push(['strike', { ...params, index, packActive }]); return { degreeOfSuccess: hit };
    } })),
    damage: async params => { calls.push(['damage', params]); return { total: packActive ? 8 : 5 }; },
    critical: async params => { calls.push(['critical', params]); return { total: packActive ? 16 : 10 }; },
  };
  const actor = {
    type: 'npc', level: 1, size: 'med', canAttack: true, uuid: 'Scene.scene.Token.wolf.Actor.wolf', hitPoints: { value: 24 },
    system: { traits: { value: ['animal'] }, actions: [strike], movement: { speeds: { land: { value: 35 } } }, attributes: { speed: { value: 35 } } },
    attributes: { flanking: { canFlank: true } }, itemTypes: { action: [pack, knockdown] },
    hasCondition: (...names) => names.some(n => conditions.has(n)),
    getCondition: (slug, { all = false } = {}) => {
      const condition = conditions.has(slug) ? { id: slug, slug, isLocked: false, readonly: false, inMemoryOnly: false } : null;
      return all ? condition ? [condition] : [] : condition;
    },
    deleteEmbeddedDocuments: async (type, ids) => {
      assert.equal(type, 'Item');
      ids.forEach(id => conditions.delete(id));
      calls.push(['selfDelete', ids]);
    },
    decreaseCondition: async c => { conditions.delete(c); calls.push(['selfRemove', c]); },
    increaseCondition: async c => { conditions.add(c); calls.push(['selfCondition', c]); },
    getReach: () => 5, isEnemyOf: other => other === targetActor, isAllyOf: other => actor.alliance != null && actor !== other && actor.alliance === other.alliance,
    getStatistic: slug => ({ check: { mod: slug === 'athletics' ? 6 : 7 }, dc: { value: slug === 'athletics' ? 16 : 17 } }),
    getRollOptions: () => packActive ? ['pack-attack'] : [], getSelfRollOptions: prefix => [`${prefix}:trait:animal`],
    toggleRollOption: async (domain, option, id, value) => { assert.equal(domain, 'damage'); assert.equal(option, 'pack-attack'); assert.equal(id, 'pack'); packActive = value; calls.push(['pack', value]); },
  };
  const scene = { id: 'scene', regions: { size: 0, contents: [] } };
  function makeToken(id, a, x, y) {
    const doc = { id, x, y, width: 1, height: 1, elevation: 0, level: 'ground', parent: scene,
      getSnappedPosition: (position = {}) => ({ x: Math.round((position.x ?? doc.x) / gridSize) * gridSize,
        y: Math.round((position.y ?? doc.y) / gridSize) * gridSize, elevation: position.elevation ?? doc.elevation }),
      getFlag: (namespace, key) => flags.get(`${id}:${namespace}:${key}`),
      setFlag: async (namespace, key, value) => flags.set(`${id}:${namespace}:${key}`, structuredClone(value)),
      move: async path => { Object.assign(doc, path.at(-1)); calls.push(['move', path]); return true; },
    };
    const token = { id, name: id, actor: a, document: doc, w: gridSize, h: gridSize,
      get center() { return { x: doc.x + gridSize / 2, y: doc.y + gridSize / 2 }; },
      get mechanicalBounds() { return new Rectangle(doc.x, doc.y, gridSize, gridSize); },
      checkCollision: () => false, canFlank: () => true, onOppositeSides: () => false,
      distanceTo(other) { return Math.max(Math.abs(this.document.x - other.mechanicalBounds.x), Math.abs(this.document.y - other.mechanicalBounds.y)) / gridSize * 5; },
      constrainMovementPath: path => [path, false],
      measureMovementPath: path => { let cost = 0, diagonal = 0; for (let i = 1; i < path.length; i++) {
        const dx = Math.abs(path[i].x - path[i - 1].x), dy = Math.abs(path[i].y - path[i - 1].y);
        const calculated = dx && dy ? (++diagonal % 2 ? 5 : 10) : dx || dy ? 5 : 0;
        cost += dx || dy ? path[i].cost ?? calculated : 0;
      } return { cost }; },
    };
    return token;
  }
  const wolf = makeToken('wolf', actor, 0, 0), target = makeToken('target', targetActor, gridSize * 2, 0);
  const tokens = [wolf, target];
  globalThis.canvas = { ready: true, scene,
    grid: { type: 1, distance: 5, size: gridSize, getOffset: p => ({ i: Math.floor(p.y / gridSize), j: Math.floor(p.x / gridSize) }),
      getTopLeftPoint: p => ({ x: p.j * gridSize, y: p.i * gridSize }) },
    dimensions: { sceneRect: { contains: (x, y) => x >= 0 && x < sceneSize * gridSize && y >= 0 && y < sceneSize * gridSize } },
    tokens: { placeables: tokens, get: id => tokens.find(t => t.id === id), controlled: [wolf] },
  };
  globalThis.CONST = { GRID_TYPES: { SQUARE: 1 } };
  globalThis.game = { paused: false, user: { id: 'gm', isGM: true, settings: { showCheckDialogs: true, showDamageDialogs: true } },
    users: { activeGM: { id: 'gm' } },
    combat: { id: 'combat', round: 1, started: true, scene: null,
      getFlag: (namespace, key) => flags.get(`combat:${namespace}:${key}`),
      setFlag: async (namespace, key, value) => flags.set(`combat:${namespace}:${key}`, structuredClone(value)),
      combatant: { id: 'combatant', tokenId: 'wolf', sceneId: scene.id },
      combatants: [{ tokenId: 'wolf', sceneId: scene.id }, { tokenId: 'target', sceneId: scene.id }] },
    pf2e: { settings: { automation: { flanking: true } }, actions: new Map([['trip', { use: async params => { calls.push(['trip', params]); return [{ outcome }]; } }]]) },
  };
  globalThis.ChatMessage = { create: async data => calls.push(['chat', data]), getWhisperRecipients: () => [{ id: 'gm' }], getSpeaker: () => ({ token: 'wolf' }) };
  flags.set('wolf:foundry-creature-ai:config', { enabled: true, targetIds: ['target'], applyDamage, pauseForReactions: false,
    entertaining: false, packMorale: false });
  const adapter = new PF2eWolfAdapter(wolf, profile);
  return { adapter, wolf, target, actor, strike, calls, conditions, targetConditions, flags, setPack: value => { packActive = value; }, pack: () => packActive };
}

function addReactions(f, { answer = 'pass', degree = 1 } = {}) {
  const prompts = [];
  f.flags.get('wolf:foundry-creature-ai:config').pauseForReactions = true;
  const a = f.target.actor;
  a.uuid = 'Actor.target';
  a.itemTypes = { feat: [{ slug: 'shield-block' }, { slug: 'reactive-strike' }], action: [] };
  a.attributes.shield = { itemId: 'shield', raised: true, hardness: 3, broken: false, destroyed: false };
  a.isEnemyOf = other => other === f.actor;
  a.getFlag = (namespace, key) => f.flags.get(`target-actor:${namespace}:${key}`);
  a.setFlag = async (namespace, key, value) => f.flags.set(`target-actor:${namespace}:${key}`, structuredClone(value));
  const item = { id: 'sword', name: 'Sword', isMelee: true, getRollOptions: () => ['item:damage:type:slashing'] };
  a.system.actions = [{ type: 'strike', ready: true, canAttack: true, item, label: 'Sword', variants: [
    { roll: async options => { f.calls.push(['reactionStrike', options]); return { degreeOfSuccess: degree }; } },
  ], damage: async () => ({ total: 4, instances: [{ type: 'slashing', total: 4 }] }),
  critical: async () => ({ total: 8, instances: [{ type: 'slashing', total: 8 }] }) }];
  f.actor.applyDamage = async options => { f.calls.push(['wolfDamage', options]); f.actor.hitPoints.value -= options.damage.total; };
  f.adapter.reactions = new ReactionEngine({ prompts: { ask: async request => { prompts.push(request); return answer; } } });
  return prompts;
}

function addCombatTarget(f, id, { alliance = 'party', x = 100, y = 0, inCombat = true, sceneId = 'scene' } = {}) {
  const conditions = new Set();
  const actor = { ...f.target.actor, uuid: `Actor.${id}`, alliance, hitPoints: { value: 40 },
    isAllyOf: other => alliance != null && alliance === other.alliance,
    hasCondition: (...slugs) => slugs.some(slug => conditions.has(slug)),
    increaseCondition: async slug => conditions.add(slug),
  };
  actor.applyDamage = async options => { actor.hitPoints.value -= options.damage.total; f.calls.push(['applyDamage', options]); };
  const document = { ...f.target.document, id, x, y, parent: { id: sceneId } };
  const token = { ...f.target, id, name: id, actor, document,
    get center() { return { x: document.x + 50, y: document.y + 50 }; },
    get mechanicalBounds() { return new PIXI.Rectangle(document.x, document.y, 100, 100); },
    distanceTo: other => Math.max(Math.abs(document.x - other.mechanicalBounds.x), Math.abs(document.y - other.mechanicalBounds.y)) / 100 * 5,
  };
  canvas.tokens.placeables.push(token);
  if (inCombat) game.combat.combatants.push({ tokenId: id, sceneId });
  return token;
}

function keepBattleActive(f) {
  f.actor.alliance = 'opposition'; f.target.actor.alliance = 'party';
  return addCombatTarget(f, 'surviving-ally', { alliance: 'opposition', x: 500, y: 500 });
}

function addEscape(f, { slugs = ['restrained'], outcomes = ['success'], configured = true, dc = 18 } = {}) {
  slugs.forEach(slug => f.conditions.add(slug));
  game.pf2e.actions.set('escape', {
    getDefaultVariant: () => ({ preview: () => [
      { slug: 'unarmed', modifier: f.strike.totalModifier }, { slug: 'acrobatics', modifier: 7 }, { slug: 'athletics', modifier: 6 },
    ] }),
    use: async params => { f.calls.push(['escape', params]); return [{ outcome: outcomes.shift() ?? 'failure' }]; },
  });
  if (configured) f.flags.set(`wolf:${MODULE_ID}:escapeSources`, Object.fromEntries(slugs.map(slug => [slug, { customDC: dc }])));
}

function moralePack(f, { fallen = 2 } = {}) {
  f.actor.alliance = 'opposition'; f.target.actor.alliance = 'party';
  f.actor.isAllyOf = other => other.alliance === 'opposition';
  f.wolf.document.actorId = 'wolf-base';
  f.actor.hitPoints.max = 24;
  f.flags.get(`wolf:${MODULE_ID}:config`).packMorale = true;
  Object.assign(canvas.dimensions.sceneRect, { x: 0, y: 0, width: 1200, height: 1200 });
  const pack = [];
  for (let i = 0; i < 3; i++) {
    const token = addCombatTarget(f, `pack-${i}`, { alliance: 'opposition', x: 900 + i * 100, y: 900 });
    token.actor = { ...f.actor, uuid: `Actor.pack-${i}`, hitPoints: { value: i < fallen ? 0 : 24, max: 24 } };
    token.document.actorId = 'wolf-base';
    token.document.getFlag = (namespace, key) => f.flags.get(`${token.id}:${namespace}:${key}`);
    f.flags.set(`${token.id}:${MODULE_ID}:config`, { enabled: true, packMorale: true, targetIds: ['target'] });
    pack.push(token);
  }
  return pack;
}

test('entertainment showcases a legal Knockdown once per combat, retaining the action cost and MAP', async () => {
  const f = fixture({ outcome: 'failure' });
  f.wolf.document.x = 100;
  f.target.actor.level = 5;
  f.flags.get(`wolf:${MODULE_ID}:config`).entertaining = true;
  const previous = { ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 2, attacksMade: 1,
    lastAction: { kind: 'strike', hit: true, targetId: 'target', strikeId: 'jaws' } };
  await f.adapter.saveLedger(previous);
  await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(f.calls.filter(call => call[0] === 'trip').length, 1);
  const saved = await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(saved.actionsRemaining, 1);
  assert.equal(saved.attacksMade, 1);
  assert.equal(f.flags.get(`wolf:${MODULE_ID}:playState`).knockdownShown, true, 'a failed attempt still showed the ability');
  const after = await f.adapter.snapshot({ ...previous, lastAction: previous.lastAction });
  assert.equal(after.style.knockdownShown, true);
  assert.equal(f.adapter.decide(after).chosen.kind, 'strike');
});

test('a front-line character gets one engagement preference and the ledger retains it across retries', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.flags.get(`wolf:${MODULE_ID}:config`).entertaining = true;
  f.target.actor.hitPoints.max = 80;
  f.target.actor.armorClass = { value: 24 };
  f.flags.get(`wolf:${MODULE_ID}:config`).frontlineTargetIds = [];
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.frontlineEngaged, true);
  const state = await f.adapter.snapshot(ledger);
  const bite = f.adapter.decide(state).ranked.find(entry => entry.candidate.kind === 'strike');
  assert.equal(bite.terms.find(term => /front line/.test(term.label)).contribution, 0);
  const fresh = await f.adapter.readLedger(`${game.combat.id}:2:combatant`);
  assert.equal(fresh.frontlineEngaged, false);
});

test('front-line selection uses live HP/AC comparisons and ignores old manual selections', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition'; f.target.actor.alliance = 'party';
  const config = f.flags.get(`wolf:${MODULE_ID}:config`);
  config.entertaining = true;
  config.frontlineTargetIds = ['mage'];
  f.target.actor.hitPoints.max = 90;
  f.target.actor.armorClass = { value: 25 };
  const mage = addCombatTarget(f, 'mage', { x: 100, y: 100 });
  mage.actor.hitPoints.max = 50;
  mage.actor.armorClass = { value: 20 };
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies.find(enemy => enemy.id === 'target').frontline, true);
  assert.equal(state.enemies.find(enemy => enemy.id === 'mage').frontline, false);
  assert.equal(state.diagnostics.frontlineAnalysis.find(entry => entry.id === 'target').maxHP, 90);
  f.target.actor.hitPoints.value = 1;
  const wounded = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(wounded.enemies.find(enemy => enemy.id === 'target').frontline, true);
});

test('a broken pack retreats with native movement, waits for reactions and advances only when enabled', async () => {
  const f = fixture({ sceneSize: 12 });
  f.wolf.document.x = 100;
  moralePack(f);
  const prompts = addReactions(f, { answer: 'pass' });
  enableAdvancement(f);
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.completionReason, 'retreated');
  assert.equal(ledger.done, true);
  assert.ok(ledger.actionsRemaining >= 0 && ledger.actionsRemaining < 3);
  assert.equal(ledger.attacksMade, 0);
  assert.equal(f.calls.some(call => call[0] === 'strike'), false);
  assert.ok(prompts.length > 0, 'retreat does not suppress a valid Reactive Strike prompt');
  assert.ok(f.calls.some(call => call[0] === 'move'));
  assert.equal(f.flags.get(`wolf:${MODULE_ID}:retreated`).combatId, 'combat');
  assert.equal(f.calls.filter(call => call[0] === 'nextTurn').length, 1);
  assert.ok(canvas.tokens.get(f.wolf.id), 'the escaped token is retained');
});

test('morale is shared, survives healing and keeps different pack groups separate', async () => {
  const f = fixture({ sceneSize: 12 });
  const pack = moralePack(f);
  await f.adapter.prepareTurn();
  pack.forEach(token => { token.actor.hitPoints.value = 24; });
  const survivor = new PF2eWolfAdapter(pack[2], profile);
  assert.equal(packAssessment(survivor).broken, true);
  f.flags.get(`${pack[2].id}:${MODULE_ID}:config`).packGroup = 'separate';
  assert.equal(packAssessment(survivor).broken, false);
  f.flags.get(`${pack[2].id}:${MODULE_ID}:config`).packGroup = 'separate pack';
  const firstKey = packAssessment(survivor).key;
  f.flags.get(`${pack[2].id}:${MODULE_ID}:config`).packGroup = 'separate_pack';
  assert.notEqual(packAssessment(survivor).key, firstKey, 'pack names cannot collide after key encoding');
});

test('an escaped wolf sits out later turns without spending actions or attacking', async () => {
  const f = fixture({ sceneSize: 12 });
  moralePack(f, { fallen: 0 });
  f.flags.set(`wolf:${MODULE_ID}:retreated`, { combatId: game.combat.id });
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.completionReason, 'retreated');
  assert.equal(ledger.actionsRemaining, 3);
  assert.equal(f.calls.some(call => ['move', 'strike', 'trip'].includes(call[0])), false);
  assert.equal(f.calls.some(call => call[0] === 'nextTurn'), false, 'autoAdvance remains optional');
});

test('blocked retreat holds its actions; it does not attack or falsely mark the wolf escaped', async () => {
  const f = fixture({ sceneSize: 12 });
  moralePack(f);
  canvas.scene.regions.contents.push({ name: 'Manual zone', behaviors: { contents: [{ disabled: false }] } });
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.done, false);
  assert.equal(ledger.actionsRemaining, 3);
  assert.equal(f.flags.get(`wolf:${MODULE_ID}:retreated`), undefined);
  assert.equal(f.calls.some(call => call[0] === 'strike'), false);
});

test('a death reaction during retreat finishes as incapacitated without recording an escape', async () => {
  const f = fixture({ sceneSize: 12 });
  f.wolf.document.x = 100;
  moralePack(f);
  f.actor.hitPoints.value = 1;
  addReactions(f, { answer: 'strike-0-0', degree: 2 });
  enableAdvancement(f);
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.completionReason, 'incapacitated');
  assert.equal(f.flags.get(`wolf:${MODULE_ID}:retreated`), undefined);
  assert.equal(f.calls.filter(call => call[0] === 'nextTurn').length, 1);
});

test('style and retirement reset in a new combat, and disabling morale lets the GM resume fighting', async () => {
  const f = fixture({ sceneSize: 12 });
  moralePack(f, { fallen: 0 });
  f.flags.set(`wolf:${MODULE_ID}:playState`, { combatId: 'previous', knockdownShown: true, packShown: true });
  f.flags.set(`wolf:${MODULE_ID}:retreated`, { combatId: 'previous' });
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  const fresh = await f.adapter.snapshot(ledger);
  assert.equal(fresh.style.knockdownShown, false);
  assert.equal(fresh.retreatComplete, false);
  f.flags.set(`wolf:${MODULE_ID}:retreated`, { combatId: game.combat.id });
  assert.equal((await f.adapter.snapshot(ledger)).retreatComplete, true);
  f.flags.get(`wolf:${MODULE_ID}:config`).packMorale = false;
  const resumed = await f.adapter.snapshot(ledger);
  assert.equal(resumed.morale.broken, false);
  assert.equal(resumed.retreatComplete, false);
});

test('a five-foot Step through a threatened square spends one action without offering Reactive Strike', async () => {
  const f = fixture();
  const prompts = addReactions(f, { answer: 'strike-0-0', degree: 2 });
  f.target.actor.getReach = () => 10;
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(f.adapter.decide(state).chosen.kind, 'step');
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(ledger.attacksMade, 0);
  assert.equal(f.wolf.document.x, 100);
  assert.equal(f.actor.hitPoints.value, 24);
  assert.equal(prompts.length, 0);
  assert.equal(f.adapter.reactions.available(f.target), true);
});

test('the adapter chooses a safe route and recalculates it after the fighter spends its reaction', async () => {
  const f = fixture();
  addReactions(f);
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  const route = async () => (await f.adapter.snapshot(ledger)).moves.find(move => move.kind === 'stride' && move.x === 4 && move.y === 0);
  const safe = await route();
  assert.ok(safe, 'a safe detour is reachable within Speed');
  assert.equal(safe.provokes, false);
  assert.equal(safe.risk.state, 0);
  await f.adapter.reactions.setSpent(f.target, true);
  const direct = await route();
  assert.equal(direct.provokes, false);
  assert.ok(direct.cost < safe.cost, 'once the reaction is spent, the shorter route is preferred');
});

test('unknown reactors do not influence planning, while reaction execution still knows about them', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  addReactions(f);
  f.targetConditions.add('undetected');
  assert.ok(f.adapter.reactions.reactors(f.wolf).some(token => token.id === f.target.id));
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.self.threatened, false);
  assert.equal(state.self.reactionRisk, 0);
});

test('GM reports preserve the actual ranked decision and explain unavailable Knockdown', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.targetConditions.add('prone');
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  const decision = f.adapter.decide(await f.adapter.snapshot(ledger));
  await f.adapter.report(decision, ledger);
  const message = f.calls.find(call => call[0] === 'chat')[1];
  const record = message.flags[MODULE_ID].decisionLog;
  assert.equal(record.chosenId, decision.chosen.id);
  assert.equal(record.options.find(option => option.selected).id, decision.chosen.id);
  assert.match(message.content, /Why this decision/);
  assert.match(message.content, /target is already prone/);
  assert.deepEqual(message.whisper, ['gm']);
  const chosen = record.options.find(option => option.selected);
  assert.ok(Math.abs(chosen.value - chosen.terms.reduce((sum, term) => sum + term.contribution, 0)) < 1e-6);
});

test('Step respects Speed, difficult-terrain cost and the turn diagonal history', async () => {
  const f = fixture();
  f.actor.system.movement.speeds.land.value = 5;
  const snapshot = () => f.adapter.snapshot({ actionsRemaining: 3, attacksMade: 0 });
  assert.ok(!(await snapshot()).moves.some(move => move.kind === 'step'));
  f.actor.system.movement.speeds.land.value = 35;
  const measure = f.wolf.measureMovementPath;
  f.wolf.measureMovementPath = path => {
    const result = measure(path);
    if (path.at(-1).x === 100 && path.at(-1).y === 0) result.cost += 5;
    return result;
  };
  assert.ok(!(await snapshot()).moves.some(move => move.kind === 'step' && move.x === 1 && move.y === 0));
  f.wolf.measureMovementPath = measure;
  Object.assign(f.wolf.document, { x: 100, y: 100, movementHistory: [{ x: 0, y: 0 }, { x: 100, y: 100 }] });
  f.target.document.x = 500;
  const state = await snapshot();
  assert.ok(state.moves.some(move => move.kind === 'stride' && move.x === 2 && move.y === 2));
  assert.ok(!state.moves.some(move => move.kind === 'step' && move.x === 2 && move.y === 2));
});

test('a prone wolf can bite instead of provoking a reaction by standing', async () => {
  const f = fixture({ hit: 1 });
  f.wolf.document.x = 100;
  f.conditions.add('prone');
  const prompts = addReactions(f, { answer: 'strike-0-0' });
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.lastAction.kind, 'strike');
  assert.equal(f.conditions.has('prone'), true);
  assert.equal(f.strike.totalModifier, 7);
  assert.equal(prompts.length, 0);
  assert.equal(f.calls.some(call => call[0] === 'selfDelete'), false);
});

test('Crawl stays prone, moves only five feet and resolves its movement reaction normally', async () => {
  const f = fixture();
  f.conditions.add('prone');
  const get = f.actor.getCondition;
  f.actor.getCondition = (slug, options) => slug === 'prone' && options?.all ? [{ id: 'prone', slug, isLocked: true }] : get(slug, options);
  const prompts = addReactions(f, { answer: 'pass' });
  f.target.actor.getReach = () => 10;
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.lastAction.kind, 'crawl');
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(f.conditions.has('prone'), true);
  assert.equal(prompts.length, 1);
  assert.equal(f.calls.find(call => call[0] === 'move')[1][0].action, 'crawl');
  assert.equal(Math.max(Math.abs(f.wolf.document.x), Math.abs(f.wolf.document.y)), 100);
  assert.equal(f.calls.some(call => call[0] === 'selfDelete'), false);
});

test('a known enemy behind a corner remains a pursuit target and the wolf routes around the wall before attacking', async () => {
  const f = fixture();
  const crossesWall = (from, to) => {
    if ((from.x < 200) === (to.x < 200)) return false;
    const crossingY = from.y + (to.y - from.y) * (200 - from.x) / (to.x - from.x);
    return crossingY >= 0 && crossingY < 200;
  };
  f.wolf.checkCollision = (destination, { origin = f.wolf.center } = {}) => crossesWall(origin, destination);
  f.wolf.constrainMovementPath = path => [path, path.slice(1).some((point, i) =>
    crossesWall({ x: path[i].x + 50, y: path[i].y + 50 }, { x: point.x + 50, y: point.y + 50 }))];
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies.length, 1);
  assert.equal(state.enemies[0].lineOfSight, false);
  assert.equal(state.enemies[0].lineOfEffect, false);
  assert.equal(state.diagnostics.pursuitTargets[0].id, 'target');
  assert.equal(state.diagnostics.pursuitTargets[0].state, 'known-square');
  assert.equal(state.diagnostics.encounterComplete, false);
  assert.equal(f.adapter.decide(state).chosen.kind, 'stride');
  assert.equal(f.adapter.candidates(state).some(choice => ['strike', 'knockdown'].includes(choice.kind)), false);
  const first = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(first.actionsRemaining, 2);
  assert.equal(f.calls.some(call => call[0] === 'strike'), false);
  let previous = { x: 50, y: 50 };
  for (const point of f.calls.find(call => call[0] === 'move')[1]) {
    const center = { x: point.x + 50, y: point.y + 50 };
    assert.equal(crossesWall(previous, center), false, 'the executed path cannot cross the wall');
    previous = center;
  }
  assert.equal(f.adapter.sight(f.wolf.center, f.target), true, 'the move finds an attack position with sight');
  await new TurnRunner(f.adapter).run();
  assert.ok(f.calls.some(call => call[0] === 'strike'));
  assert.ok(f.calls.findIndex(call => call[0] === 'move') < f.calls.findIndex(call => call[0] === 'strike'));
});

test('blocked sight with a clear physical path prevents an immediate bite and Knockdown without removing the enemy', async () => {
  const f = fixture(); f.wolf.document.x = 100;
  f.wolf.checkCollision = (_destination, { type }) => type === 'sight';
  const state = await f.adapter.snapshot({ ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 2, attacksMade: 1,
    lastAction: { kind: 'strike', hit: true, targetId: 'target', strikeId: 'jaws' } }, { movement: false });
  assert.equal(state.enemies.length, 1);
  assert.equal(state.enemies[0].physicalPath, true);
  assert.equal(state.enemies[0].lineOfSight, false);
  assert.equal(state.enemies[0].inReach, false);
  const decision = f.adapter.decide(state);
  assert.equal(decision.ranked.some(row => ['strike', 'knockdown'].includes(row.candidate.kind)), false);
  assert.match(decision.rejected.find(choice => choice.kind === 'strike').reason, /line of sight is blocked/);
  await assert.rejects(f.adapter.execute({ kind: 'strike', targetId: 'target', strikeId: 'jaws' },
    { turn: f.adapter.turnKey(), attacksMade: 1 }), /not currently observed/);
  assert.equal(f.calls.some(call => call[0] === 'strike'), false);
});

test('pursuit does not locate previously unknown undetected, unnoticed or invisible enemies', async () => {
  for (const condition of ['undetected', 'unnoticed', 'invisible']) {
    const f = fixture(); f.targetConditions.add(condition);
    const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
    assert.equal(state.enemies.length, 0, condition);
    assert.equal(state.moves.length, 0, condition);
    assert.match(state.diagnostics.rejectedTargets[0].reason, /hidden|invisible|undetected|concealed/);
  }
});

test('a transparent physical barrier blocks bites, Knockdown and Reactive Strike despite a clear sight ray', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.wolf.checkCollision = (_destination, { type }) => type === 'move';
  const state = await f.adapter.snapshot({ actionsRemaining: 2, attacksMade: 1,
    lastAction: { kind: 'strike', hit: true, targetId: 'target', strikeId: 'jaws' } }, { movement: false });
  assert.equal(state.enemies.length, 1, 'the target remains visible');
  assert.equal(state.enemies[0].lineOfEffect, false);
  assert.ok(!f.adapter.decide(state).ranked.some(entry => ['strike', 'knockdown'].includes(entry.candidate.kind)));
  await assert.rejects(f.adapter.execute({ kind: 'strike', targetId: 'target', strikeId: 'jaws' },
    { turn: f.adapter.turnKey(), attacksMade: 1 }), /physical barrier/);
  addReactions(f);
  f.target.checkCollision = (_destination, { type }) => type === 'move';
  assert.equal(f.adapter.reactions.reactors(f.wolf).length, 0);
});

test('grabbed wolves can bite, while restrained wolves cannot attack before escaping', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  addEscape(f, { slugs: ['grabbed'], outcomes: ['failure'] });
  let state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(f.adapter.decide(state).chosen.kind, 'strike');
  assert.equal(state.moves.length, 0);
  f.conditions.delete('grabbed'); f.conditions.add('restrained');
  f.flags.set(`wolf:${MODULE_ID}:escapeSources`, { restrained: { customDC: 18 } });
  state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.ok(!f.adapter.decide(state).ranked.some(entry => ['strike', 'knockdown', 'stand'].includes(entry.candidate.kind)));
  assert.equal(f.adapter.decide(state).chosen.kind, 'escape');
});

test('Escape uses the best prepared statistic, pays MAP and removes only the selected cause', async () => {
  const f = fixture();
  addEscape(f, { slugs: ['restrained', 'immobilized'] });
  await f.adapter.saveLedger({ ...await f.adapter.readLedger(f.adapter.turnKey()), attacksMade: 1, actionsRemaining: 2 });
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  const params = f.calls.find(call => call[0] === 'escape')[1];
  assert.equal(params.statistic, 'unarmed');
  assert.equal(params.multipleAttackPenalty, -5);
  assert.equal(params.difficultyClass.value, 18);
  assert.ok(params.rollOptions.includes(SKIP_RULE_AUTOMATION));
  assert.equal(ledger.attacksMade, 2);
  assert.equal(ledger.actionsRemaining, 1);
  assert.equal(f.conditions.size, 1, 'an unrelated restriction is not removed');
});

test('Escape critical failure prevents retrying this turn and may end a fully restrained turn', async () => {
  const f = fixture();
  addEscape(f, { outcomes: ['criticalFailure'] });
  enableAdvancement(f);
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.escapeBlocked, true);
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(ledger.attacksMade, 1);
  assert.equal(ledger.completionReason, 'escape-blocked');
  assert.equal(ledger.advanced, true);
  assert.equal(f.calls.filter(call => call[0] === 'escape').length, 1);
  assert.equal(f.conditions.has('restrained'), true);
});

test('Escape critical failure still permits a grabbed wolf to bite at its increased MAP and resets next turn', async () => {
  const f = fixture();
  addEscape(f, { slugs: ['grabbed'], outcomes: ['criticalFailure'] });
  const runner = new TurnRunner(f.adapter);
  const first = await runner.run({ oneAction: true });
  assert.equal(first.escapeBlocked, true);
  f.target.document.x = 100;
  const second = await runner.run({ oneAction: true });
  assert.equal(second.lastAction.kind, 'strike');
  assert.equal(second.attacksMade, 2);
  assert.equal(f.calls.find(call => call[0] === 'strike')[1].index, 1);
  assert.equal(f.calls.filter(call => call[0] === 'escape').length, 1);
  game.combat.round++;
  const fresh = await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(fresh.escapeBlocked, false);
  assert.equal(fresh.attacksMade, 0);
});

test('Escape failure persists its MAP across retries; cancelled rolls keep the reserved action uncertain', async () => {
  const f = fixture();
  addEscape(f, { outcomes: ['failure', 'failure'] });
  const runner = new TurnRunner(f.adapter);
  await runner.run({ oneAction: true });
  await runner.run({ oneAction: true });
  assert.deepEqual(f.calls.filter(call => call[0] === 'escape').map(call => call[1].multipleAttackPenalty), [0, -5]);
  game.pf2e.actions.get('escape').use = async () => [];
  await assert.rejects(runner.run({ oneAction: true }), /cancelled/);
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 3);
  assert.equal(ledger.uncertain, true);
  assert.equal(f.conditions.has('restrained'), true);
});

test('Escape critical success can take its optional five-foot Stride with no action or MAP cost', async () => {
  const f = fixture();
  addEscape(f, { outcomes: ['criticalSuccess'] });
  await f.adapter.saveLedger({ ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 1 });
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 1);
  assert.equal(ledger.lastAction.kind, 'escapeStride');
  assert.equal(ledger.freeEscapeStride, false);
  assert.equal(f.wolf.document.x, 100);
  assert.equal(f.conditions.has('restrained'), false);
  assert.equal(f.calls.filter(call => call[0] === 'move').length, 1);
});

test('an optional Escape Stride still provokes reactions and waits for their resolution', async () => {
  const f = fixture();
  f.target.actor.getReach = () => 10;
  const prompts = addReactions(f, { answer: 'pass' });
  f.target.actor.getReach = () => 10;
  const ledger = { ...await f.adapter.readLedger(f.adapter.turnKey()), attacksMade: 1, actionsRemaining: 0 };
  const result = await f.adapter.execute({ kind: 'escapeStride', actionCost: 0, destination: { x: 1, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] }, ledger);
  assert.equal(prompts.length, 1);
  assert.equal(result.pause, false);
  assert.equal(f.wolf.document.x, 100);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 1);
});

test('custom-DC Escape never silently uses an unrelated token selected with the target tool', async () => {
  const f = fixture();
  addEscape(f);
  game.user.targets = new Set([f.target]);
  await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(f.calls.find(call => call[0] === 'escape')[1].target, f.actor);
  assert.equal(f.calls.find(call => call[0] === 'escape')[1].difficultyClass.value, 18);
});

test('swimming targets cannot receive Knockdown, including a change just before execution', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.target.document.movementAction = 'swim';
  const ledger = { ...await f.adapter.readLedger(f.adapter.turnKey()), attacksMade: 1,
    lastAction: { kind: 'strike', hit: true, targetId: 'target', strikeId: 'jaws' } };
  const state = await f.adapter.snapshot(ledger);
  assert.ok(!f.adapter.decide(state).ranked.some(entry => entry.candidate.kind === 'knockdown'));
  const result = await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, ledger);
  assert.equal(result.skipped, true);
  assert.equal(f.calls.some(call => call[0] === 'trip'), false);
});

test('unknown Escape sources ask the GM before spending an action and use the explicitly selected source DC', async () => {
  const f = fixture();
  addEscape(f, { configured: false });
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async config => {
    assert.equal(f.calls.some(call => call[0] === 'escape'), false);
    assert.equal((await f.adapter.readLedger(f.adapter.turnKey())).actionsRemaining, 3);
    return config.buttons[0].callback({}, { form: { elements: { source: { value: 'target' }, dc: { value: '' } } } });
  } } } } };
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  const params = f.calls.find(call => call[0] === 'escape')[1];
  assert.equal(params.target, f.target);
  assert.equal(params.difficultyClass.value, 18);
  assert.equal(ledger.actionsRemaining, 2);
});

test('a PF2e Automations Restrained effect escapes against its recorded attacker without source setup', async () => {
  const f = fixture();
  addEscape(f, { configured: false });
  const effect = { id: 'restraining-effect', type: 'effect', name: 'Effect: Restrained until end of attacker next turn',
    slug: 'effect-restrained-until-end-of-attacker-next-turn', sourceId: 'Compendium.pf2e-automations.effects.Item.zol83j7l2cBSmY3a',
    system: { rules: [{ key: 'GrantItem', uuid: 'Compendium.pf2e.conditionitems.VcDeM8A5oI6VqhbM' }],
      context: { origin: { actor: f.target.actor.uuid, token: 'Scene.scene.Token.target' } } },
    flags: { pf2e: { itemGrants: { restrained: { id: 'restrained', onDelete: 'restrict' } } } } };
  const condition = { id: 'restrained', slug: 'restrained', isLocked: true, appliedBy: effect,
    flags: { pf2e: { grantedBy: { id: effect.id, onDelete: 'cascade' } } } };
  f.actor.items = new Map([[effect.id, effect], [condition.id, condition]]);
  f.actor.getCondition = (slug, { all = false } = {}) => {
    const entries = f.conditions.has(slug) && slug === 'restrained' ? [condition] : [];
    return all ? entries : entries[0] ?? null;
  };
  const remove = f.actor.deleteEmbeddedDocuments;
  f.actor.deleteEmbeddedDocuments = async (type, ids) => {
    if (ids.includes(effect.id)) { f.actor.items.delete(effect.id); f.conditions.delete('restrained'); }
    return remove(type, ids);
  };
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => { throw new Error('No setup prompt should be needed'); } } } } };
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  const escape = f.calls.find(call => call[0] === 'escape')[1];
  assert.equal(escape.target, f.target);
  assert.equal(escape.difficultyClass.value, 18);
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(ledger.attacksMade, 1);
  assert.equal(f.conditions.has('restrained'), false);
  assert.deepEqual(f.calls.find(call => call[0] === 'selfDelete')[1], [effect.id]);
});

test('closing Escape setup spends no action, and locked granted restrictions are not deleted', async () => {
  const f = fixture();
  addEscape(f, { configured: false });
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => null } } } };
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 3);
  assert.equal(f.calls.some(call => call[0] === 'escape'), false);
  const get = f.actor.getCondition;
  f.actor.getCondition = (slug, options) => slug === 'restrained' && options?.all ? [{ id: slug, slug, isLocked: true }] : get(slug, options);
  const state = await f.adapter.snapshot(ledger);
  assert.ok(!f.adapter.decide(state).ranked.some(entry => entry.candidate.kind === 'escape'));
  assert.equal(f.calls.some(call => call[0] === 'selfDelete'), false);
});

test('death while configuring an unknown Escape source ends the turn without spending an action', async () => {
  const f = fixture();
  keepBattleActive(f);
  addEscape(f, { configured: false });
  enableAdvancement(f);
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async () => { f.actor.hitPoints.value = 0; return null; } } } } };
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 3);
  assert.equal(ledger.completionReason, 'incapacitated');
  assert.equal(ledger.advanced, true);
  assert.equal(f.calls.some(call => call[0] === 'escape'), false);
});

test('opposition wolves Stride straight through pack members in a corridor at normal cost', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition'; f.target.actor.alliance = 'party';
  f.target.document.x = 400;
  f.actor.system.movement.speeds.land.value = 15;
  canvas.dimensions.sceneRect.contains = (x, y) => x >= 0 && x < 600 && y >= 0 && y < 100;
  const ally1 = addCombatTarget(f, 'pack-1', { alliance: 'opposition', x: 100 });
  const ally2 = addCombatTarget(f, 'pack-2', { alliance: 'opposition', x: 200 });
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  const state = await f.adapter.snapshot(ledger), choice = f.adapter.decide(state).chosen;
  assert.equal(choice.kind, 'stride');
  assert.deepEqual(choice.path, [0, 1, 2, 3].map(x => ({ x, y: 0 })));
  assert.equal(choice.movementCost, 15);
  assert.ok(!state.moves.some(cell => cell.x === 1 || cell.x === 2 || cell.x >= 4), 'only the free endpoint is offered');
  const result = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(result.actionsRemaining, 2);
  assert.equal(f.wolf.document.x, 300);
  assert.equal(f.calls.find(call => call[0] === 'move')[1].length, 3);
  assert.equal(ally1.document.x, 100);
  assert.equal(ally2.document.x, 200);
});

test('willing allies are passable for either alliance; neutral creatures and objects still block', async () => {
  for (const side of ['party', 'opposition']) {
    for (const occupantKind of ['ally', 'neutral', 'object']) {
      const f = fixture();
      f.actor.alliance = side; f.target.actor.alliance = side === 'party' ? 'opposition' : 'party';
      f.target.document.x = 300;
      canvas.dimensions.sceneRect.contains = (x, y) => x >= 0 && x < 600 && y >= 0 && y < 100;
      const occupant = addCombatTarget(f, 'occupant', { alliance: occupantKind === 'neutral' ? null : side, x: 100 });
      if (occupantKind === 'object') occupant.actor.isOfType = () => false;
      const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
      assert.equal(state.moves.some(cell => cell.x === 2), occupantKind === 'ally', `${side}: ${occupantKind}`);
      assert.ok(!state.moves.some(cell => cell.x === 1), 'no planned destination on another token');
    }
  }
});

test('a larger ally is passable across its entire footprint but cannot be a planned endpoint', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition'; f.target.actor.alliance = 'party';
  f.target.document.x = 400;
  canvas.dimensions.sceneRect.contains = (x, y) => x >= 0 && x < 600 && y >= 0 && y < 100;
  const ally = addCombatTarget(f, 'large-ally', { alliance: 'opposition', x: 100 });
  ally.document.width = 2; ally.w = 200;
  const snapshot = () => f.adapter.snapshot({ actionsRemaining: 3, attacksMade: 0 });
  const state = await snapshot();
  assert.deepEqual(state.moves.map(cell => cell.x), [3]);
  ally.actor.alliance = null;
  ally.actor.isAllyOf = () => false;
  assert.equal((await snapshot()).moves.length, 0, 'alliance changes immediately change passability');
});

test('recovered planning uses the encounter-level benchmark without reading target base AC', async () => {
  const f = fixture();
  f.target.actor.level = 8;
  Object.defineProperty(f.target.actor, 'armorClass', { get() { throw new Error('Target base AC was inspected'); } });
  const fighter = addCombatTarget(f, 'fighter'); fighter.actor.level = 4;
  game.combat.combatants.push({ tokenId: 'fighter', sceneId: 'scene' }); // Duplicate must not weight its level twice.
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.self.encounterLevel, 6);
  assert.equal(state.self.referenceAC, 24);
  assert.equal(state.diagnostics.policy, 'dawnsbury-4.44-pack');
  assert.ok(f.adapter.decide(state).ranked.every(entry => Number.isInteger(entry.layer)));
});

test('the adapter supplies flood distances and alternating-diagonal own distances to the recovered chooser', async () => {
  const f = fixture();
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.nearestEnemy, 2);
  const candidate = f.adapter.decide(state).ranked.find(entry => entry.candidate.id === 'stride:2,2').candidate;
  assert.equal(candidate.assessment.distanceMoved, 3);
  assert.equal(candidate.assessment.nearestEnemy, 2);
  assert.equal(candidate.assessment.goodAttacksLeft, true);
  assert.equal(state.self.referenceAC, 18, 'missing character levels fall back to the wolf level');
});

test('an enabled opposition wolf can bite an unassigned fighter by default', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition';
  f.target.actor.alliance = 'party';
  const fighter = addCombatTarget(f, 'fighter');
  assert.deepEqual(f.adapter.config.targetIds, ['target'], 'old saved roster contains only the original enemy');
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(f.calls.find(c => c[0] === 'strike')[1].target.id, fighter.id);
});

test('an allied wolf defaults to opposition combatants without requiring a saved target list', async () => {
  const f = fixture();
  f.actor.alliance = 'party';
  f.target.actor.alliance = 'opposition';
  f.flags.get('wolf:foundry-creature-ai:config').targetIds = [];
  const friend = addCombatTarget(f, 'party-ally');
  const neutral = addCombatTarget(f, 'neutral', { alliance: null });
  await f.adapter.assertReady();
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.deepEqual(state.enemies.map(e => e.id), ['target']);
  assert.equal(f.adapter.liveTarget(friend.id), null);
  assert.equal(f.adapter.liveTarget(neutral.id), null);
});

test('alliance target selection retains visibility, HP and combat-scene eligibility checks', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition';
  f.target.actor.alliance = 'party';
  const hidden = addCombatTarget(f, 'hidden'); hidden.document.hidden = true;
  const defeated = addCombatTarget(f, 'defeated'); defeated.actor.hitPoints.value = 0;
  addCombatTarget(f, 'bystander', { inCombat: false });
  addCombatTarget(f, 'other-scene', { sceneId: 'elsewhere' });
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.deepEqual(state.enemies.map(e => e.id), ['target']);
  assert.equal(state.diagnostics.targetMode, 'alliance');
  assert.match(state.diagnostics.rejectedTargets.find(t => t.id === hidden.id).reason, /hidden/);
  assert.match(state.diagnostics.rejectedTargets.find(t => t.id === defeated.id).reason, /HP/);
});

test('manual override can restrict an aligned wolf, and neutral wolves retain explicit enemies', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition';
  f.target.actor.alliance = 'party';
  const fighter = addCombatTarget(f, 'fighter');
  f.flags.get('wolf:foundry-creature-ai:config').targetMode = 'manual';
  assert.equal(f.adapter.liveTarget(fighter.id), null);
  f.actor.alliance = null;
  f.actor.isEnemyOf = () => false; // Native PF2e neutrals have no implicit enemies.
  assert.equal(f.adapter.liveTarget('target'), f.target);
  assert.equal(f.adapter.liveTarget(fighter.id), null);
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.deepEqual(state.enemies.map(e => e.id), ['target']);
});

test('a changed alliance invalidates an automatic target immediately before execution', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition';
  f.target.actor.alliance = 'party';
  f.wolf.document.x = 100;
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  const chosen = f.adapter.decide(await f.adapter.snapshot(ledger)).chosen;
  assert.equal(chosen.kind, 'strike');
  f.target.actor.alliance = 'opposition';
  await assert.rejects(f.adapter.revalidate(chosen, ledger), /no longer available/);
  assert.equal(f.calls.some(c => c[0] === 'strike'), false);
});

test('defeating the old saved enemy does not finish the encounter while an opposing fighter remains', async () => {
  const f = fixture();
  f.actor.alliance = 'opposition';
  f.target.actor.alliance = 'party';
  f.target.actor.hitPoints.value = 0;
  addCombatTarget(f, 'fighter');
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.deepEqual(state.enemies.map(e => e.id), ['fighter']);
  assert.equal(state.diagnostics.encounterComplete, false);
});

test('reaction prompts replace the blanket reach error and run after Stand clears Prone', async () => {
  const f = fixture();
  f.conditions.add('prone');
  const prompts = addReactions(f, { answer: 'strike-0-0' });
  f.target.actor.getReach = () => 10; // Threatened by a reach weapon, with no bite available while prone.
  const ask = f.adapter.reactions.prompts.ask;
  f.adapter.reactions.prompts.ask = async request => {
    assert.equal(f.conditions.has('prone'), false, 'Stand must complete before its reaction');
    assert.match(request.description, /finishes Standing/);
    return ask(request);
  };
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(ledger.attacksMade, 0);
  assert.equal(prompts.length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'reactionStrike').length, 1);
});

test('simply being near an enemy without Reactive Strike does not block Stand', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.conditions.add('prone');
  const prompts = addReactions(f);
  f.target.actor.itemTypes.feat = [];
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(prompts.length, 0);
});

test('Shield Block prompts before wolf damage application and passes the choice to native PF2e', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  const prompts = addReactions(f, { answer: 'block' });
  f.strike.damage = async () => ({ total: 5, instances: [{ type: 'piercing', total: 5 }] });
  const apply = f.target.actor.applyDamage;
  f.target.actor.applyDamage = async options => {
    assert.equal(prompts.length, 1);
    assert.equal(options.shieldBlockRequest, true);
    assert.equal(f.target.actor.getFlag(MODULE_ID, 'reaction').uncertain, true);
    await apply(options);
  };
  await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(f.calls.filter(c => c[0] === 'applyDamage').length, 1);
  assert.equal(f.target.actor.getFlag(MODULE_ID, 'reaction').uncertain, false);
});

test('closing Shield Block keeps wolf damage unapplied and cannot advance or duplicate the strike', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  addReactions(f, { answer: 'pause' });
  f.strike.damage = async () => ({ total: 5, instances: [{ type: 'piercing', total: 5 }] });
  const runner = new TurnRunner(f.adapter);
  await assert.rejects(runner.run(), /Damage has not been applied/);
  assert.equal(f.target.actor.hitPoints.value, 40);
  assert.equal((await f.adapter.readLedger(f.adapter.turnKey())).actionsRemaining, 2);
  await assert.rejects(runner.run(), /previous action/);
  assert.equal(f.calls.filter(c => c[0] === 'strike').length, 1);
});

test('Stride checks departures along the path, including entering then leaving reach, for one action', async () => {
  const f = fixture();
  f.target.document.y = 100;
  const prompts = addReactions(f);
  const ask = f.adapter.reactions.prompts.ask;
  f.adapter.reactions.prompts.ask = async request => {
    assert.equal(f.wolf.document.x, 100, 'the first threatened departure occurs after the first segment');
    return ask(request);
  };
  const result = await f.adapter.execute({ kind: 'stride', destination: { x: 3, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] }, { turn: f.adapter.turnKey() });
  assert.equal(result.pause, false);
  assert.equal(prompts.length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 3);
  assert.equal(result.movement.cost, 15);
  assert.deepEqual(result.destination, { x: 3, y: 0 });
});

test('arriving in reach without leaving a threatened square does not provoke', async () => {
  const f = fixture();
  const prompts = addReactions(f);
  await f.adapter.execute({ kind: 'stride', destination: { x: 1, y: 0 }, path: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { turn: f.adapter.turnKey() });
  assert.equal(prompts.length, 0);
});

test('pausing a mid-Stride reaction preserves the reached square and the single spent action', async () => {
  const f = fixture();
  f.target.document.y = 100;
  addReactions(f, { answer: 'pause' });
  f.adapter.decide = () => ({ chosen: { id: 'test-stride', kind: 'stride', actionCost: 1, destination: { x: 3, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } });
  f.adapter.revalidate = async () => {};
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(ledger.uncertain, false);
  assert.deepEqual(ledger.visited, ['1,0']);
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
});

test('new-turn ledgers explicitly erase death and advancement flags under Foundry-style flag merging', async () => {
  const f = fixture();
  const flagKey = `wolf:${MODULE_ID}:ledger`;
  f.flags.set(flagKey, { turn: 'earlier-turn', actionsRemaining: 0, done: true, completionReason: 'incapacitated',
    incapacitationReason: 'dead', advanceRequested: true, advanced: true });
  f.wolf.document.setFlag = async (namespace, key, value) => {
    const id = `wolf:${namespace}:${key}`;
    f.flags.set(id, { ...f.flags.get(id), ...structuredClone(value) });
  };
  const fresh = await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(fresh.completionReason, null);
  assert.equal(fresh.incapacitationReason, null);
  assert.equal(fresh.advanceRequested, false);
  assert.equal(fresh.advanced, false);
  await new TurnRunner(f.adapter).run({ oneAction: true });
  const saved = f.flags.get(flagKey);
  assert.equal(saved.actionsRemaining, 2);
  assert.equal(saved.done, false);
  assert.equal(saved.completionReason, null);
  assert.equal(saved.incapacitationReason, null);
  assert.equal(saved.advanceRequested, false);
  assert.equal(saved.advanced, false);
});

test('a healed wolf surviving 11 reaction damage at 13 HP does not repeat an old death message', async () => {
  for (const done of [true, false]) {
    const f = fixture();
    f.target.document.y = 100;
    addReactions(f, { answer: 'strike-0-0', degree: 2 });
    f.target.actor.system.actions[0].damage = async () => ({ total: 11, instances: [{ type: 'slashing', total: 11 }] });
    enableAdvancement(f);
    await f.adapter.saveLedger({ ...await f.adapter.readLedger(f.adapter.turnKey()), done, actionsRemaining: 1,
      completionReason: 'incapacitated', incapacitationReason: 'dead' });
    f.adapter.decide = () => ({ chosen: { id: 'test-stride', kind: 'stride', actionCost: 1, destination: { x: 2, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], intent: 'approach' } });
    f.adapter.revalidate = async () => {};
    const ledger = await new TurnRunner(f.adapter).run();
    assert.equal(f.actor.hitPoints.value, 13);
    assert.equal(f.wolf.document.x, 200);
    assert.equal(ledger.actionsRemaining, 0);
    assert.equal(ledger.attacksMade, 0);
    assert.equal(ledger.done, true);
    assert.equal(ledger.completionReason, null);
    assert.equal(ledger.incapacitationReason, null);
    assert.equal(f.calls.filter(call => call[0] === 'nextTurn').length, 1, 'passes only after spending the last action');
    const chat = f.calls.filter(call => call[0] === 'chat').map(call => call[1].content).join('');
    assert.match(chat, /0 actions left/);
    assert.doesNotMatch(chat, /can no longer act|\(dead\)/);
  }
});

test('reports never present an old death reason as the live wolf status', async () => {
  const f = fixture();
  f.actor.hitPoints.value = 13;
  await f.adapter.report({ chosen: { kind: 'stride' } }, { actionsRemaining: 0, completionReason: 'incapacitated', incapacitationReason: 'dead' });
  assert.doesNotMatch(f.calls.find(call => call[0] === 'chat')[1].content, /can no longer act|\(dead\)/);
});

test('a lethal mid-Stride Reactive Strike stops before the next segment', async () => {
  const f = fixture();
  f.actor.hitPoints.value = 4;
  f.target.document.y = 100;
  addReactions(f, { answer: 'strike-0-0', degree: 2 });
  const result = await f.adapter.execute({ kind: 'stride', destination: { x: 3, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] }, { turn: f.adapter.turnKey() });
  assert.equal(result.endTurn, true);
  assert.equal(result.pause, false);
  assert.equal(f.actor.hitPoints.value, 0);
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
  assert.deepEqual(result.destination, { x: 1, y: 0 });
});

test('death to Reactive Strike completes the wolf turn and respects automatic passing', async () => {
  for (const autoAdvance of [true, false]) {
    const f = fixture();
    keepBattleActive(f);
    f.actor.hitPoints.value = 4;
    f.target.document.y = 100;
    addReactions(f, { answer: 'strike-0-0', degree: 2 });
    let pauses = 0;
    f.adapter.reactions.onPause = () => { pauses++; };
    enableAdvancement(f);
    f.flags.get('wolf:foundry-creature-ai:config').autoAdvance = autoAdvance;
    f.adapter.decide = () => ({ chosen: { id: 'test-stride', kind: 'stride', actionCost: 1, destination: { x: 3, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } });
    f.adapter.revalidate = async () => {};
    const runner = new TurnRunner(f.adapter);
    const ledger = await runner.run();
    assert.equal(ledger.done, true);
    assert.equal(ledger.completionReason, 'incapacitated');
    assert.equal(ledger.actionsRemaining, 2, 'unused actions are recorded, without inventing extra spent actions');
    assert.equal(ledger.uncertain, false);
    assert.deepEqual(ledger.visited, ['1,0']);
    assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
    assert.equal(f.calls.some(c => ['strike', 'trip'].includes(c[0])), false);
    assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, Number(autoAdvance));
    assert.equal(pauses, 0);
    assert.equal(runner.running, false);
    if (!autoAdvance) {
      const again = await runner.run();
      assert.equal(again.actionsRemaining, 2);
      assert.equal(f.calls.filter(c => c[0] === 'reactionStrike').length, 1);
    }
  }
});

test('a lethal reaction after Stand can pass the turn even in One action mode', async () => {
  const f = fixture();
  keepBattleActive(f);
  f.actor.hitPoints.value = 4;
  f.conditions.add('prone');
  addReactions(f, { answer: 'strike-0-0', degree: 2 });
  f.target.actor.getReach = () => 10;
  enableAdvancement(f);
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.completionReason, 'incapacitated');
  assert.equal(ledger.advanced, true);
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(f.calls.filter(c => c[0] === 'selfDelete').length, 1);
  assert.equal(f.calls.some(c => ['move', 'strike', 'trip'].includes(c[0])), false);
});

test('0 HP, dead, dying, unconscious or defeated wolves finish without attempting an action', async () => {
  for (const condition of ['0 HP', 'dead', 'dying', 'unconscious', 'defeated']) {
    const f = fixture();
    keepBattleActive(f);
    enableAdvancement(f);
    if (condition === '0 HP') f.actor.hitPoints.value = 0;
    else if (condition === 'defeated') game.combat.combatants[0].defeated = true;
    else f.conditions.add(condition);
    const ledger = await new TurnRunner(f.adapter).run();
    assert.equal(ledger.done, true, condition);
    assert.equal(ledger.actionsRemaining, 3, condition);
    assert.equal(ledger.advanced, true, condition);
    assert.equal(f.calls.some(c => ['move', 'strike', 'trip'].includes(c[0])), false);
  }
});

test('death while revalidating an action finishes without reserving its cost', async () => {
  const f = fixture();
  keepBattleActive(f);
  enableAdvancement(f);
  f.adapter.revalidate = async () => { f.actor.hitPoints.value = 0; throw new Error('no longer able to act'); };
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 3);
  assert.equal(ledger.uncertain, false);
  assert.equal(ledger.advanced, true);
  assert.equal(f.calls.some(c => ['move', 'strike', 'trip'].includes(c[0])), false);
});

test('death during state refresh is completed before choosing another action', async () => {
  const f = fixture();
  keepBattleActive(f);
  enableAdvancement(f);
  const snapshot = f.adapter.snapshot.bind(f.adapter);
  f.adapter.snapshot = async ledger => { f.actor.hitPoints.value = 0; return snapshot(ledger); };
  const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(ledger.completionReason, 'incapacitated');
  assert.equal(ledger.actionsRemaining, 3);
  assert.equal(ledger.advanced, true);
  assert.equal(f.calls.some(c => ['move', 'strike', 'trip'].includes(c[0])), false);
});

test('another module advancing on death does not cause a second nextTurn request', async () => {
  const f = fixture();
  f.actor.hitPoints.value = 4;
  f.target.document.y = 100;
  addReactions(f, { answer: 'strike-0-0', degree: 2 });
  enableAdvancement(f);
  let pauses = 0;
  f.adapter.reactions.onPause = () => { pauses++; };
  const apply = f.actor.applyDamage;
  f.actor.applyDamage = async options => {
    await apply(options);
    await game.combat.nextTurn();
  };
  f.adapter.decide = () => ({ chosen: { id: 'stride', kind: 'stride', actionCost: 1, destination: { x: 3, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } });
  f.adapter.revalidate = async () => {};
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.done, true);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
  assert.equal(pauses, 0);
});

test('an ally defeated with HP still present no longer supplies Pack Attack support', () => {
  const f = fixture();
  f.actor.alliance = 'opposition';
  const ally = addCombatTarget(f, 'defeated-ally', { alliance: 'opposition' });
  assert.ok(f.adapter.allies(f.target).includes(ally));
  game.combat.combatants.find(c => c.tokenId === ally.id).defeated = true;
  assert.equal(f.adapter.allies(f.target).includes(ally), false);
});

test('Stop still holds the turn when the wolf dies while its reaction is resolving', async () => {
  const f = fixture();
  keepBattleActive(f);
  f.actor.hitPoints.value = 4;
  f.conditions.add('prone');
  addReactions(f, { answer: 'strike-0-0', degree: 2 });
  f.target.actor.getReach = () => 10;
  enableAdvancement(f);
  const runner = new TurnRunner(f.adapter), apply = f.actor.applyDamage;
  f.actor.applyDamage = async options => { await apply(options); runner.cancel(); };
  const ledger = await runner.run();
  assert.equal(ledger.completionReason, 'incapacitated');
  assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false);
});

test('turn cancellation during a reaction prompt prevents the next Stride segment', async () => {
  const f = fixture();
  f.target.document.y = 100;
  addReactions(f);
  let canContinue = true;
  f.adapter.reactions.prompts.ask = async () => { canContinue = false; return 'strike-0-0'; };
  const result = await f.adapter.execute({ kind: 'stride', destination: { x: 3, y: 0 },
    path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] },
  { turn: f.adapter.turnKey() }, { canContinue: () => canContinue });
  assert.equal(result.pause, true);
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
  assert.equal(f.calls.some(c => c[0] === 'reactionStrike'), false);
});

test('failed native damage application retains Shield Block as spent and uncertain', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  addReactions(f, { answer: 'block' });
  f.strike.damage = async () => ({ total: 5, instances: [{ type: 'piercing', total: 5 }] });
  f.target.actor.applyDamage = async () => { throw new Error('damage interrupted'); };
  await assert.rejects(new TurnRunner(f.adapter).run(), /damage interrupted/);
  assert.equal(f.target.actor.getFlag(MODULE_ID, 'reaction').spent, true);
  assert.equal(f.target.actor.getFlag(MODULE_ID, 'reaction').uncertain, true);
  assert.equal((await f.adapter.readLedger(f.adapter.turnKey())).uncertain, true);
});

test('the final wolf action waits for both the Shield Block answer and its damage before advancing', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  addReactions(f);
  enableAdvancement(f);
  f.strike.damage = async () => ({ total: 5, instances: [{ type: 'piercing', total: 5 }] });
  await f.adapter.saveLedger({ ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 1 });
  let answer, applyDamage;
  f.adapter.reactions.prompts.ask = () => new Promise(resolve => { answer = resolve; });
  const apply = f.target.actor.applyDamage;
  f.target.actor.applyDamage = options => new Promise(resolve => { applyDamage = async () => { await apply(options); resolve(); }; });
  const running = new TurnRunner(f.adapter).run();
  while (!answer) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.adapter.reactions.barrier.pending, true);
  assert.equal(f.calls.filter(c => c[0] === 'strike').length, 1);
  assert.equal(f.calls.some(c => ['applyDamage', 'trip', 'nextTurn'].includes(c[0])), false);
  answer('block');
  while (!applyDamage) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.adapter.reactions.barrier.pending, true, 'AI stays paused during native HP/shield updates');
  assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false);
  await applyDamage();
  const ledger = await running;
  assert.equal(ledger.advanced, true);
  assert.equal(f.adapter.reactions.barrier.pending, false);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
});

test('Stride and subsequent attacks wait for the Reactive Strike prompt and its roll to resolve', async () => {
  const f = fixture();
  f.target.document.y = 100;
  addReactions(f);
  enableAdvancement(f);
  let answer, finishRoll;
  f.adapter.reactions.prompts.ask = () => new Promise(resolve => { answer = resolve; });
  f.target.actor.system.actions[0].variants[0].roll = () => new Promise(resolve => { finishRoll = () => resolve({ degreeOfSuccess: 1 }); });
  const decide = f.adapter.decide.bind(f.adapter);
  let first = true;
  f.adapter.decide = state => {
    if (!first) return decide(state);
    first = false;
    return { chosen: { id: 'test-stride', kind: 'stride', actionCost: 1, destination: { x: 3, y: 0 },
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }] } };
  };
  f.adapter.revalidate = async () => {};
  const running = new TurnRunner(f.adapter).run();
  while (!answer) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
  assert.equal(f.calls.some(c => ['strike', 'trip', 'nextTurn'].includes(c[0])), false);
  answer('strike-0-0');
  while (!finishRoll) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
  assert.equal(f.adapter.reactions.barrier.pending, true);
  assert.equal(f.calls.some(c => ['strike', 'trip', 'nextTurn'].includes(c[0])), false);
  finishRoll();
  const ledger = await running;
  assert.equal(ledger.advanced, true);
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 3);
  assert.equal(f.calls.filter(c => c[0] === 'strike').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
});

test('an already-completed wolf turn cannot advance across another pending reaction', async () => {
  const f = fixture();
  addReactions(f);
  enableAdvancement(f);
  let answer;
  const resolving = f.adapter.reactions.resolve(() => new Promise(resolve => { answer = resolve; }));
  const ledger = { ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 0, done: true };
  const finishing = f.adapter.finishTurn(ledger);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false);
  assert.equal(f.wolf.document.getFlag(MODULE_ID, 'ledger'), undefined, 'no advancement reservation before reactions finish');
  answer();
  await resolving;
  assert.equal((await finishing).advanced, true);
});

test('a reaction opened while reserving turn advancement blocks nextTurn until resolved', async () => {
  const f = fixture();
  addReactions(f);
  enableAdvancement(f);
  let answer, resolving;
  const save = f.adapter.saveLedger.bind(f.adapter);
  f.adapter.saveLedger = async value => {
    await save(value);
    if (value.advanceRequested) resolving = f.adapter.reactions.resolve(() => new Promise(resolve => { answer = resolve; }));
  };
  const finishing = f.adapter.finishTurn({ ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 0, done: true });
  while (!answer) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false);
  answer();
  await resolving;
  assert.equal((await finishing).advanced, true);
});

test('healing while advancement is being reserved cancels death-based passing and preserves unspent actions', async () => {
  const f = fixture();
  keepBattleActive(f);
  enableAdvancement(f);
  f.actor.hitPoints.value = 0;
  const save = f.adapter.saveLedger.bind(f.adapter);
  let healed = false;
  f.adapter.saveLedger = async value => {
    await save(value);
    if (value.advanceRequested && !healed) { healed = true; f.actor.hitPoints.value = 13; }
  };
  const runner = new TurnRunner(f.adapter);
  const terminal = { ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 2, attacksMade: 1,
    done: true, completionReason: 'incapacitated', incapacitationReason: '0 HP' };
  const result = await runner.completeTurn(terminal, {}, f.adapter.turnKey());
  assert.equal(healed, true);
  assert.equal(f.calls.some(call => call[0] === 'nextTurn'), false);
  assert.equal(result.done, false);
  assert.equal(result.actionsRemaining, 2);
  assert.equal(result.attacksMade, 1);
  assert.equal(result.advanceRequested, false);
  assert.equal(result.completionReason, null);
  assert.equal(result.incapacitationReason, null);
});

test('adapter runs Stride → jaws hit → remaster Knockdown with one MAP increase', async () => {
  const f = fixture();
  const ledger = await new TurnRunner(f.adapter).run();
  assert.deepEqual(f.calls.filter(c => ['move', 'strike', 'trip'].includes(c[0])).map(c => c[0]), ['move', 'strike', 'trip']);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 1);
  assert.equal(f.calls.find(c => c[0] === 'trip')[1].multipleAttackPenalty, 0);
  assert.equal(f.calls.find(c => c[0] === 'strike')[1].event.shiftKey, true);
  assert.equal(f.targetConditions.has('prone'), true);
  assert.equal(f.calls.filter(c => c[0] === 'applyDamage').length, 1);
});

test('a prone wolf spends one Stand then attacks and uses Knockdown', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.conditions.add('prone');
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(f.conditions.has('prone'), false);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 1);
  assert.deepEqual(f.calls.filter(c => ['selfDelete', 'strike', 'trip'].includes(c[0])).map(c => c[0]),
    ['selfDelete', 'strike', 'trip']);
});

test('duplicate Prone entries are cleared together for one Stand action', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.conditions.add('prone');
  let sources = [{ id: 'prone-a', active: true }, { id: 'prone-b', active: false }];
  const getCondition = f.actor.getCondition;
  f.actor.getCondition = (slug, options) => slug === 'prone'
    ? options?.all ? sources : sources[0] ?? null : getCondition(slug, options);
  // Match native decreaseCondition: deleting one source leaves the other active.
  f.actor.decreaseCondition = async () => {
    sources.shift();
    if (!sources.length) f.conditions.delete('prone');
    f.calls.push(['singleRemove']);
  };
  f.actor.deleteEmbeddedDocuments = async (type, ids) => {
    assert.equal(type, 'Item');
    sources = sources.filter(source => !ids.includes(source.id));
    if (!sources.length) f.conditions.delete('prone');
    f.calls.push(['selfDelete', ids]);
  };
  const ledger = await new TurnRunner(f.adapter).run();
  assert.deepEqual(f.calls.filter(c => c[0] === 'selfDelete').map(c => c[1]), [['prone-a', 'prone-b']]);
  assert.equal(f.calls.some(c => c[0] === 'singleRemove'), false);
  assert.equal(f.conditions.has('prone'), false);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(f.calls.filter(c => c[0] === 'strike').length, 1);
  assert.equal(f.calls.filter(c => c[0] === 'trip').length, 1);
});

test('locked or temporary Prone sources allow other legal actions without attempting Stand', async () => {
  for (const flag of ['isLocked', 'readonly', 'inMemoryOnly']) {
    const f = fixture();
    f.conditions.add('prone');
    f.actor.getCondition = (slug, options) => slug === 'prone' && options?.all ? [{ id: 'prone', [flag]: true }] : null;
    const ledger = await new TurnRunner(f.adapter).run({ oneAction: true });
    assert.equal(ledger.actionsRemaining, 2);
    assert.equal(ledger.uncertain, false);
    assert.equal(f.calls.some(c => c[0] === 'selfDelete'), false);
  }
});

test('a condition deletion that leaves Prone active stops before a second Stand, including on retry', async () => {
  const f = fixture();
  f.conditions.add('prone');
  f.flags.get('wolf:foundry-creature-ai:config').autoAdvance = true;
  game.combat.nextTurn = async () => assert.fail('an unresolved Stand must hold the turn');
  f.actor.deleteEmbeddedDocuments = async () => { f.calls.push(['blockedDelete']); };
  const runner = new TurnRunner(f.adapter);
  await assert.rejects(runner.run(), /Stand was attempted but Prone is still active/);
  assert.equal((await f.adapter.readLedger(f.adapter.turnKey())).actionsRemaining, 2);
  await assert.rejects(runner.run(), /previous action was interrupted/);
  assert.equal(f.calls.filter(c => c[0] === 'blockedDelete').length, 1);
});

test('Stand checks the current synthetic actor after the deletion completes', async () => {
  const f = fixture();
  f.conditions.add('prone');
  f.actor.deleteEmbeddedDocuments = async () => {
    f.conditions.delete('prone');
    f.wolf.actor = { ...f.actor, hasCondition: (...slugs) => slugs.includes('prone') };
  };
  await assert.rejects(new TurnRunner(f.adapter).run(), /Prone is still active/);
  assert.equal((await f.adapter.readLedger(f.adapter.turnKey())).actionsRemaining, 2);
});

test('Stand waits for the embedded condition update before the next decision', async () => {
  const f = fixture();
  f.conditions.add('prone');
  const remove = f.actor.deleteEmbeddedDocuments;
  let release;
  f.actor.deleteEmbeddedDocuments = (...args) => new Promise(resolve => { release = async () => { await remove(...args); resolve(); }; });
  const pending = new TurnRunner(f.adapter).run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(c => ['move', 'strike'].includes(c[0])), false);
  assert.equal((await f.adapter.readLedger(f.adapter.turnKey())).actionsRemaining, 2);
  await release();
  const ledger = await pending;
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(f.calls.filter(c => c[0] === 'selfDelete').length, 1);
});

test('a newly prone wolf with only one action left can bite without spending another Stand', async () => {
  const f = fixture({ hit: 1 });
  f.wolf.document.x = 100;
  f.conditions.add('prone');
  const roll = f.strike.variants[0].roll;
  f.strike.variants[0].roll = async options => {
    const result = await roll(options);
    f.conditions.add('prone'); // A separate effect after the first Stand resolved.
    return result;
  };
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 0);
  assert.deepEqual(f.calls.filter(c => ['selfDelete', 'strike'].includes(c[0])).map(c => c[0]), ['selfDelete', 'strike', 'strike']);
});

test('an empty Region does not prevent the wolf from approaching its assigned target', async () => {
  const f = fixture();
  canvas.scene.regions = { size: 1, contents: [{ name: 'Empty Region', behaviors: { contents: [] } }] };
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.ok(state.moves.length > 0);
  assert.equal(f.adapter.decide(state).chosen.kind, 'step');
});

test('a Define Surface region uses native movement constraints and does not block the whole AI turn',async()=>{
  const f=fixture();
  canvas.scene.regions.contents=[{name:'Floor',behaviors:{contents:[{type:'defineSurface',disabled:false}]}}];
  let constraints=0;
  f.wolf.constrainMovementPath=path=>{constraints++;return [path,false];};
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.ok(state.moves.length>0);assert.ok(constraints>0);
  const ledger=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(ledger.actionsRemaining,2);assert.equal(f.wolf.document.elevation,0);
  assert.equal(f.calls.filter(call=>call[0]==='move').length,1);
});

test('a surface that native movement cannot cross still prevents movement',async()=>{
  const f=fixture();
  canvas.scene.regions.contents=[{name:'Ceiling',behaviors:{contents:[{type:'defineSurface',disabled:false}]}}];
  f.wolf.constrainMovementPath=path=>[path,true];
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining,3);assert.equal(ledger.done,false);
  assert.equal(f.calls.some(call=>call[0]==='move'),false);
});

test('the Stadium grid spacing and saved positions produce movement through an empty Region scene', async () => {
  const f = fixture({ gridSize: 70, sceneSize: 80 });
  Object.assign(f.wolf.document, { x: 2590, y: 1120 });
  Object.assign(f.target.document, { x: 2450, y: 1330 });
  canvas.scene.regions = { size: 1, contents: [{ name: 'Region', behaviors: { contents: [] } }] };
  const result = await new TurnRunner(f.adapter).run({ oneAction: true });
  assert.equal(result.actionsRemaining, 2);
  assert.equal(f.calls.filter(call => call[0] === 'move').length, 1);
});

test('a fractional offset below a grid boundary does not reject a normally snapped wolf', async () => {
  const f = fixture({ gridSize: 70, sceneSize: 80 });
  Object.assign(f.wolf.document, { x: 2590 - 0.001, y: 1120 + 0.001 });
  await f.adapter.assertReady();
  assert.deepEqual(f.adapter.originCell(), { x: 37, y: 16 });
});

test('an off-grid wolf is measured from its actual position without a free snap during planning', async () => {
  const f = fixture({ gridSize: 70, sceneSize: 80 });
  const actual = { x: 2590 - 12, y: 1120 + 8 };
  Object.assign(f.wolf.document, actual);
  Object.assign(f.target.document, { x: 2450, y: 1330 });
  const measured = [], constrained = [];
  const measure = f.wolf.measureMovementPath;
  f.wolf.measureMovementPath = path => { measured.push(path); return measure(path); };
  f.wolf.constrainMovementPath = path => { constrained.push(path); return [path, false]; };
  await f.adapter.assertReady();
  const state = await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(f.adapter.decide(state).chosen.kind, 'stride');
  assert.equal(f.wolf.document.x, actual.x);
  assert.equal(f.wolf.document.y, actual.y);
  assert.ok(measured.length > 0);
  assert.ok(measured.every(path => path[0].x === actual.x && path[0].y === actual.y && path[0].snapped === false));
  assert.ok(constrained.some(path => path[0].x === actual.x && path[0].y === actual.y));
});

test('movement from an off-grid origin uses snapped destinations and permits the next action', async () => {
  const f = fixture({ gridSize: 70, sceneSize: 80 });
  Object.assign(f.wolf.document, { x: 2590 - 12, y: 1120 + 8 });
  Object.assign(f.target.document, { x: 2450, y: 1330 });
  const runner = new TurnRunner(f.adapter);
  const first = await runner.run({ oneAction: true });
  assert.equal(first.actionsRemaining, 2);
  const path = f.calls.find(call => call[0] === 'move')[1];
  assert.ok(path.every(point => point.snapped === true && point.x % 70 === 0 && point.y % 70 === 0));
  await f.adapter.assertReady();
  const second = await runner.run({ oneAction: true });
  assert.equal(second.actionsRemaining, 1);
});

test('a new Stride gets its own Speed budget after earlier movement history', async () => {
  const f = fixture({ sceneSize: 30 });
  f.wolf.document.x = 700;
  f.wolf.document.movementHistory = Array.from({ length: 8 }, (_, i) => ({ x: i * 100, y: 0, cost: i ? 5 : 0 }));
  const move = f.wolf.document.move;
  f.wolf.document.move = async (path, options) => {
    const historyCost = f.wolf.measureMovementPath(f.wolf.document.movementHistory).cost;
    const strideCost = f.wolf.measureMovementPath([{ x: 700, y: 0 }, ...path]).cost;
    assert.ok(historyCost + strideCost <= options.constrainOptions.maxCost, 'native history must not consume the next Stride budget');
    assert.equal(options.constrainOptions.ignoreWalls, false);
    assert.equal(options.constrainOptions.ignoreCost, false);
    return move(path, options);
  };
  await f.adapter.execute({ kind: 'stride', path: [{ x: 7, y: 0 }, { x: 8, y: 0 }], destination: { x: 8, y: 0 } },
    { turn: f.adapter.turnKey() });
});

test('movement execution waits for the visual animation before completing the action', async () => {
  const f = fixture();
  let finishAnimation;
  const move = f.wolf.document.move;
  f.wolf.document.move = async (path, options) => {
    const completed = await move(path, options);
    f.wolf.movementAnimationPromise = new Promise(resolve => { finishAnimation = resolve; });
    return completed;
  };
  let actionFinished = false;
  const execution = f.adapter.execute({ kind: 'stride', path: [{ x: 0, y: 0 }, { x: 1, y: 0 }], destination: { x: 1, y: 0 } },
    { turn: f.adapter.turnKey() }).then(() => { actionFinished = true; });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(actionFinished, false);
  } finally {
    finishAnimation();
    await execution;
  }
});

test('a normal animated approach produces one Stride, a bite, and Knockdown rather than extra movement', async () => {
  const f = fixture();
  const move = f.wolf.document.move;
  f.wolf.document.move = async (path, options) => {
    const from = { x: f.wolf.document.x, y: f.wolf.document.y };
    const completed = await move(path, options), to = path.at(-1);
    f.wolf.document._source = { ...to };
    Object.assign(f.wolf.document, from);
    f.wolf.movementAnimationPromise = new Promise(resolve => setImmediate(() => {
      Object.assign(f.wolf.document, to);
      f.wolf.movementAnimationPromise = null;
      resolve();
    }));
    return completed;
  };
  const ledger = await new TurnRunner(f.adapter).run();
  assert.deepEqual(f.calls.filter(call => ['move', 'strike', 'trip'].includes(call[0])).map(call => call[0]), ['move', 'strike', 'trip']);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 1);
});

test('a genuine partial movement continues the turn from the reached position with its action spent', async () => {
  const f = fixture();
  f.wolf.document.move = async () => { f.wolf.document.x = 50; return false; };
  const result = await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0,'repeated native stops cannot create free retries');
  assert.equal(result.uncertain, false);
  assert.equal(result.done, true);
  assert.equal(f.calls.some(call => call[0] === 'strike'), false);
  assert.match(f.calls.find(call => call[0] === 'chat')[1].content, /reassessing the turn from the actual position/);
});

test('a stopped Stride is followed by a Strike from the actual position and can auto-advance normally',async()=>{
  const f=fixture();enableAdvancement(f);
  let moves=0;
  f.wolf.document.move=async()=>{moves++;f.wolf.document.x=100;return false;};
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(moves,1);assert.equal(ledger.actionsRemaining,0);assert.equal(ledger.uncertain,false);
  assert.equal(f.calls.filter(call=>call[0]==='strike').length,1);
  assert.equal(f.calls.filter(call=>call[0]==='trip').length,1);
  assert.equal(f.calls.filter(call=>call[0]==='nextTurn').length,1);
  assert.equal(f.wolf.document.x,100,'no teleport to the originally selected destination');
});

test('One action and explicit cancellation still hold after a native stopped Stride',async()=>{
  for(const mode of ['oneAction','cancel','paused']){
    const f=fixture();enableAdvancement(f);const runner=new TurnRunner(f.adapter);let moves=0;
    f.wolf.document.move=async()=>{
      moves++;if(mode==='cancel')runner.cancel();if(mode==='paused')game.paused=true;
      return false;
    };
    const ledger=await runner.run({oneAction:mode==='oneAction'});
    assert.equal(moves,1,mode);assert.equal(ledger.actionsRemaining,2,mode);assert.equal(ledger.uncertain,false,mode);
    assert.equal(f.calls.some(call=>call[0]==='nextTurn'),false,mode);
  }
});

test('a distant target can be reached by two Strides in one turn without the cumulative cap rejecting the second', async () => {
  const f = fixture({ sceneSize: 30 });
  f.target.document.x = 1200;
  f.wolf.document.movementHistory = [{ x: 0, y: 0, cost: 0 }];
  const move = f.wolf.document.move;
  f.wolf.document.move = async (path, options) => {
    const history = f.wolf.document.movementHistory;
    const fullCost = f.wolf.measureMovementPath([...history, ...path]).cost;
    assert.ok(fullCost <= options.constrainOptions.maxCost);
    const completed = await move(path, options);
    history.push(...path);
    return completed;
  };
  const ledger = await new TurnRunner(f.adapter).run();
  assert.deepEqual(f.calls.filter(call => ['move', 'strike'].includes(call[0])).map(call => call[0]), ['move', 'move', 'strike']);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 1);
});

test('active Region behaviors explain a blocked turn and disabling them allows a retry', async () => {
  const f = fixture();
  const behavior = { disabled: false };
  canvas.scene.regions = { size: 1, contents: [{ name: 'Hazard', behaviors: { contents: [behavior] } }] };
  const runner = new TurnRunner(f.adapter);
  const blocked = await runner.run();
  assert.equal(blocked.actionsRemaining, 3);
  assert.equal(blocked.done, false);
  assert.match(f.calls.find(call => call[0] === 'chat')[1].content, /Region behaviors require manual movement: Hazard/);
  behavior.disabled = true;
  const retried = await runner.run({ oneAction: true });
  assert.equal(retried.actionsRemaining, 2);
  assert.equal(f.calls.filter(call => call[0] === 'move').length, 1);
});

test('an excluded target is explained in the GM report instead of silently ending with three actions', async () => {
  const f = fixture();
  f.target.document.hidden = true;
  const result = await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining, 3);
  assert.equal(result.done, false);
  assert.match(f.calls.find(call => call[0] === 'chat')[1].content, /target: token is hidden/);
});

test('adapter uses the correct MAP variant and critical damage function', async () => {
  const f = fixture({ hit: 3 });
  const turn = f.adapter.turnKey();
  await f.adapter.execute({ kind: 'strike', strikeId: 'jaws', targetId: 'target' }, { turn, attacksMade: 3 });
  assert.equal(f.calls.find(c => c[0] === 'strike')[1].index, 2);
  assert.equal(f.calls.filter(c => c[0] === 'critical').length, 1);
  assert.equal(f.calls.find(c => c[0] === 'applyDamage')[1].outcome, 'criticalSuccess');
});

test('Pack Attack is recalculated per target and the pre-existing toggle is restored', async () => {
  const f = fixture();
  f.adapter.allies = () => [{}, {}];
  await f.adapter.execute({ kind: 'strike', strikeId: 'jaws', targetId: 'target' }, { turn: f.adapter.turnKey(), attacksMade: 1 });
  assert.deepEqual(f.calls.filter(c => c[0] === 'pack').map(c => c[1]), [true, false]);
  assert.equal(f.pack(), false);
  assert.equal(f.calls.find(c => c[0] === 'strike')[1].packActive, true);
  const g = fixture(); g.setPack(true); g.adapter.allies = () => [];
  await g.adapter.execute({ kind: 'strike', strikeId: 'jaws', targetId: 'target' }, { turn: g.adapter.turnKey(), attacksMade: 1 });
  assert.equal(g.calls.find(c => c[0] === 'strike')[1].packActive, false);
  assert.equal(g.pack(), true);
});

test('wolf detection accepts source strings and PF2e prepared array selectors for Pack Attack', () => {
  for (const selector of ['strike-damage', ['strike-damage'], ['strike-damage', 'damage']]) {
    const f = fixture();
    const pack = f.actor.itemTypes.action[0];
    pack.system.rules[1].selector = selector;
    assert.equal(wolfParts(f.actor).pack.id, 'pack');
  }
});

test('wolf detection still rejects an unrelated damage selector and unsupported dice', () => {
  const f = fixture();
  const dice = f.actor.itemTypes.action[0].system.rules[1];
  dice.selector = ['spell-damage'];
  assert.throws(() => wolfParts(f.actor), /Pack Attack damage rule not found/);
  dice.selector = ['strike-damage']; dice.dieSize = 'd6';
  assert.throws(() => wolfParts(f.actor), /requires 1d4/);
});

test('wolf detection retains the one-action Knockdown requirement', () => {
  const f = fixture();
  f.actor.itemTypes.action[1].actionCost.value = 0;
  assert.throws(() => wolfParts(f.actor), /Unsupported Knockdown action cost/);
});

test('wolf detection identifies the missing ability instead of rejecting the whole profile generically', () => {
  const f = fixture();
  f.actor.itemTypes.action = f.actor.itemTypes.action.filter(i => i.slug !== 'knockdown');
  assert.throws(() => wolfParts(f.actor), /Knockdown ability not found/);
});

test('legacy Knockdown applies prone directly; failed remaster Trip does not', async () => {
  const f = fixture({ remaster: false });
  await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: f.adapter.turnKey() });
  assert.equal(f.targetConditions.has('prone'), true);
  assert.equal(f.calls.some(c => c[0] === 'trip'), false);
  const g = fixture({ outcome: 'failure' });
  await g.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: g.adapter.turnKey() });
  assert.equal(g.targetConditions.has('prone'), false);
});

test('an already-prone enemy receives bites without any Knockdown attempts', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  f.targetConditions.add('prone');
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(ledger.attacksMade, 3);
  assert.equal(f.calls.filter(c => c[0] === 'strike').length, 3);
  assert.equal(f.calls.some(c => c[0] === 'trip' || c[0] === 'targetCondition'), false);
});

test('Knockdown execution skips an already-prone target for both legacy and remaster wolves', async () => {
  for (const remaster of [true, false]) {
    const f = fixture({ remaster });
    f.targetConditions.add('prone');
    const result = await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: f.adapter.turnKey() });
    assert.equal(result.skipped, true);
    assert.match(result.skipReason, /No action was spent/);
    assert.equal(f.calls.some(c => ['trip', 'targetCondition', 'applyDamage'].includes(c[0])), false);
  }
});

test('a target becoming prone during the reservation skips Knockdown without spending the action', async () => {
  const f = fixture();
  f.wolf.document.x = 100;
  const previous = { ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 2, attacksMade: 1,
    lastAction: { kind: 'strike', hit: true, targetId: 'target', strikeId: 'jaws' } };
  await f.adapter.saveLedger(previous);
  const save = f.adapter.saveLedger.bind(f.adapter);
  f.adapter.saveLedger = async value => {
    await save(value);
    if (value.uncertain) f.targetConditions.add('prone');
  };
  const runner = new TurnRunner(f.adapter);
  const ledger = await runner.run({ oneAction: true });
  assert.deepEqual(ledger, previous);
  assert.equal(f.calls.some(c => c[0] === 'trip'), false);
  assert.match(f.calls.find(c => c[0] === 'chat')[1].content, /Knockdown skipped/);
  await runner.run();
  assert.equal(f.calls.filter(c => c[0] === 'strike').length, 2);
  assert.equal(f.calls.some(c => c[0] === 'trip'), false);
});

test('critical Trip failure makes the wolf prone; misses never roll or apply damage', async () => {
  const f = fixture({ outcome: 'criticalFailure' });
  await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: f.adapter.turnKey() });
  assert.equal(f.conditions.has('prone'), true);
  const g = fixture({ hit: 1 });
  const result = await g.adapter.execute({ kind: 'strike', strikeId: 'jaws', targetId: 'target' }, { turn: g.adapter.turnKey(), attacksMade: 1 });
  assert.equal(result.lastAction.hit, false);
  assert.equal(g.calls.some(c => c[0] === 'damage' || c[0] === 'applyDamage'), false);
});

test('rolls-only pauses after hit without changing target HP', async () => {
  const f = fixture({ applyDamage: false });
  const result = await f.adapter.execute({ kind: 'strike', strikeId: 'jaws', targetId: 'target' }, { turn: f.adapter.turnKey(), attacksMade: 1 });
  assert.equal(result.pause, true);
  assert.equal(f.target.actor.hitPoints.value, 40);
});

test('hidden, unconscious, defeated, wrong-floor, and unassigned targets are not available', async () => {
  const f = fixture();
  f.target.document.hidden = true;
  assert.equal(f.adapter.liveTarget('target'), null);
  f.target.document.hidden = false; f.targetConditions.add('unconscious');
  assert.equal(f.adapter.liveTarget('target'), null);
  f.targetConditions.clear(); game.combat.combatants[1].defeated = true;
  assert.equal(f.adapter.liveTarget('target'), null);
  game.combat.combatants[1].defeated = false; f.target.document.level = 'upstairs';
  assert.equal(f.adapter.liveTarget('target'), null);
  assert.equal(f.adapter.liveTarget('missing'), null);
  f.target.document.level = 'ground';
  f.flags.set('wolf:foundry-creature-ai:config', { targetIds: [] });
  assert.equal(f.adapter.liveTarget('target'), null);
});

test('critical Trip success rolls and applies its additional bludgeoning damage', async () => {
  const f = fixture({ outcome: 'criticalSuccess' });
  class DamageRoll {
    constructor(formula) { this.formula = formula; this.total = 6; }
    async evaluate() { return this; }
    async toMessage(data) { f.calls.push(['tripDamageMessage', data]); }
  }
  globalThis.CONFIG = { Dice: { rolls: [DamageRoll] } };
  await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: f.adapter.turnKey() });
  assert.equal(f.targetConditions.has('prone'), true);
  assert.equal(f.calls.find(c => c[0] === 'applyDamage')[1].damage.formula, '1d6[bludgeoning]');
  assert.equal(f.calls.find(c => c[0] === 'tripDamageMessage')[1].flags.pf2e.suppressDamageButtons, true);
});

test('AI Trip opts out of PF2e Automations outcome rules without changing ordinary Strike options', async () => {
  const f = fixture();
  await new TurnRunner(f.adapter).run();
  const trip = f.calls.find(c => c[0] === 'trip')[1];
  assert.equal(trip.rollOptions.includes(MANAGED_OPTION), true);
  assert.equal(trip.rollOptions.includes(MANAGED_TRIP_OPTION), true);
  assert.equal(trip.rollOptions.includes(SKIP_RULE_AUTOMATION), true);
  assert.equal(f.calls.find(c => c[0] === 'strike')[1].options.includes(SKIP_RULE_AUTOMATION), false);
});

test('asynchronous PF2e Automations Trip rules cannot add a second Prone or critical damage', async () => {
  for (const outcome of ['success', 'criticalSuccess', 'criticalFailure']) {
    const f = fixture({ outcome });
    let pendingAutomation = Promise.resolve();
    game.pf2e.actions.get('trip').use = async params => {
      f.calls.push(['trip', params]);
      // Match the installed module: its createChatMessage rules start async
      // work without awaiting it, unless skip-handling-message is present.
      if (!params.rollOptions.includes('skip-handling-message')) {
        pendingAutomation = new Promise(resolve => setImmediate(async () => {
          if (outcome === 'criticalFailure') await f.actor.increaseCondition('prone');
          else await f.target.actor.increaseCondition('prone');
          if (outcome === 'criticalSuccess') {
            f.calls.push(['externalTripDamage']);
            f.target.actor.hitPoints.value -= 6;
          }
          resolve();
        }));
      }
      return [{ outcome }];
    };
    class DamageRoll {
      constructor(formula) { this.formula = formula; this.total = 6; }
      async evaluate() { return this; }
      async toMessage(data) { f.calls.push(['tripDamageMessage', data]); }
    }
    globalThis.CONFIG = { Dice: { rolls: [DamageRoll] } };
    await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: f.adapter.turnKey() });
    await pendingAutomation;
    assert.equal(f.calls.filter(c => c[0] === (outcome === 'criticalFailure' ? 'selfCondition' : 'targetCondition')).length, 1, outcome);
    assert.equal(f.calls.some(c => c[0] === 'externalTripDamage'), false);
    assert.equal(f.target.actor.hitPoints.value, outcome === 'criticalSuccess' ? 34 : 40);
    if (outcome === 'criticalSuccess') {
      assert.equal(f.calls.filter(c => c[0] === 'tripDamageMessage').length, 1);
      assert.equal(f.calls.find(c => c[0] === 'tripDamageMessage')[1].flags.pf2e.context.options.includes(SKIP_RULE_AUTOMATION), true);
    }
  }
});

test('a Prone applied before Trip returns is respected without creating another entry', async () => {
  const f = fixture();
  game.pf2e.actions.get('trip').use = async () => {
    await f.target.actor.increaseCondition('prone');
    return [{ outcome: 'success' }];
  };
  await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: f.adapter.turnKey() });
  assert.equal(f.calls.filter(c => c[0] === 'targetCondition').length, 1);
});

test('critical Trip failure checks the current synthetic wolf actor before applying Prone', async () => {
  const f = fixture({ outcome: 'criticalFailure' });
  game.pf2e.actions.get('trip').use = async () => {
    f.wolf.actor = { ...f.actor, hasCondition: (...names) => names.includes('prone') };
    return [{ outcome: 'criticalFailure' }];
  };
  await f.adapter.execute({ kind: 'knockdown', targetId: 'target' }, { turn: f.adapter.turnKey() });
  assert.equal(f.calls.some(c => c[0] === 'selfCondition'), false);
});

test('Pack Attack toggle is restored when a native roll throws', async () => {
  const f = fixture();
  f.adapter.allies = () => [{}, {}];
  f.strike.variants[0].roll = async () => { throw new Error('native roll failed'); };
  await assert.rejects(f.adapter.execute({ kind: 'strike', strikeId: 'jaws', targetId: 'target' },
    { turn: f.adapter.turnKey(), attacksMade: 1 }), /native roll failed/);
  assert.equal(f.pack(), false);
});

test('unresolved stunned, linked tokens, wrong turn, and secondary GM stop before execution', async () => {
  const f = fixture();
  f.conditions.add('stunned'); await assert.rejects(f.adapter.assertReady(), /stunned/);
  f.conditions.clear(); f.wolf.document.actorLink = true; await assert.rejects(f.adapter.assertReady(), /unlinked/);
  f.wolf.document.actorLink = false; game.combat.combatant.tokenId = 'target'; await assert.rejects(f.adapter.assertReady(), /active combat turn/);
  game.combat.combatant.tokenId = 'wolf'; game.users.activeGM.id = 'other'; await assert.rejects(f.adapter.assertReady(), /active GM/);
});

test('a global combat uses the active combatant scene rather than requiring a linked combat scene', async () => {
  const f = fixture();
  assert.equal(game.combat.scene, null);
  await f.adapter.assertReady();
  assert.ok(f.adapter.liveTarget('target'));
});

test('scene guard still rejects a different viewed scene or a combatant in another scene', async () => {
  const f = fixture();
  const viewedScene = canvas.scene;
  canvas.scene = { ...viewedScene, id: 'another-scene' };
  await assert.rejects(f.adapter.assertReady(), /View the combat scene/);
  canvas.scene = viewedScene;
  game.combat.combatant.sceneId = 'another-scene';
  await assert.rejects(f.adapter.assertReady(), /View the combat scene/);
});

test('managed messages suppress Workbench duplicate damage and leave ordinary messages unchanged', async () => {
  fixture();
  const hooks = new Map();
  globalThis.Hooks = { once: (name, fn) => hooks.set(name, fn), on: (name, fn) => hooks.set(name, fn) };
  await import('../src/foundry/main.mjs');
  const handler = hooks.get('preCreateChatMessage');
  let changes;
  handler({ flags: { pf2e: { context: { options: [MANAGED_OPTION] } } }, speaker: { token: 'wolf' }, updateSource: value => { changes = value; } });
  assert.equal(changes['flags.xdy-pf2e-workbench.noAutoDamageRoll'], true);
  assert.equal(changes['flags.pf2e.suppressDamageButtons'], true);
  handler({flags:{[MODULE_ID]:{damageAutoApplied:true},pf2e:{context:{options:[MANAGED_OPTION]}}},
    speaker:{token:'target'},updateSource:value=>{changes=value;}});
  assert.equal(changes['flags.pf2e.suppressDamageButtons'],true,'auto-applied poison uses the victim as speaker, without requiring victim AI controls');
  handler({flags:{[MODULE_ID]:{damageAutoApplied:false},pf2e:{context:{options:[MANAGED_OPTION]}}},
    speaker:{token:'wolf'},updateSource:value=>{changes=value;}});
  assert.equal(changes['flags.pf2e.suppressDamageButtons'],false,'manual poison damage retains its buttons');
  changes = undefined;
  handler({ flags: { pf2e: { context: { options: [] } } }, updateSource: value => { changes = value; } });
  assert.equal(changes, undefined);
});

test('the chat creation hook skips Dice So Nice for AI NPC rolls without suppressing player reactions',async()=>{
  const f=fixture(),hooks=new Map();
  globalThis.Hooks={once:(name,fn)=>hooks.set(name,fn),on:(name,fn)=>hooks.set(name,fn)};
  game.settings={get:(_namespace,key)=>key==='suppressAI3DDice'?true:undefined};
  await import('../src/foundry/main.mjs?dice-suppression');const handler=hooks.get('preCreateChatMessage'),updates=[];
  const message={flags:{pf2e:{context:{options:[MANAGED_OPTION,REACTION_OPTION]}}},speaker:{scene:'scene',token:'wolf'},updateSource:change=>updates.push(change)};
  handler(message);assert.ok(updates.some(change=>change['flags.dice-so-nice.skip']===true));
  assert.ok(updates.some(change=>change['flags.xdy-pf2e-workbench.noAutoDamageRoll']===true));
  updates.length=0;message.speaker.token='target';handler(message);
  assert.equal(updates.some(change=>change['flags.dice-so-nice.skip']===true),false);
});

let controlsInstance = 0;
async function controlsFixture(action, { saved = false, autoRun = false, autoAdvance = false, alliance, targetMode } = {}) {
  const f = fixture();
  if (alliance !== undefined) {
    f.actor.alliance = alliance;
    f.target.actor.alliance = alliance === 'party' ? 'opposition' : 'party';
  }
  if (!saved) f.flags.delete('wolf:foundry-creature-ai:config');
  const hooks = new Map();
  globalThis.Hooks = { once: (name, fn) => hooks.set(name, fn), on: (name, fn) => hooks.set(name, fn) };
  game.system = { id: 'pf2e' }; game.release = { generation: 14 };
  game.modules = new Map([[MODULE_ID, { version: 'test' }]]);
  globalThis.libWrapper = { register: () => {} };
  game.user.targets = new Set([f.target]);
  globalThis.ui = { notifications: { info: () => {}, error: () => {} } };
  const rawProfiles = JSON.parse(await readFile(new URL('../profiles/creatures.json', import.meta.url)));
  globalThis.fetch = async () => ({ ok: true, json: async () => rawProfiles });
  let firstDialog = true;
  globalThis.foundry = { applications: { api: { DialogV2: { wait: async config => {
    if (!firstDialog) return null;
    firstDialog = false;
    const button = config.buttons.find(b => b.action === action);
    const form = { elements: { targetMode: { value: targetMode ?? (alliance ? 'alliance' : 'manual') }, autoRun: { checked: autoRun }, autoAdvance: { checked: autoAdvance }, applyDamage: { checked: true }, pauseForReactions: { checked: false } } };
    return button.callback({}, { form });
  } } } } };
  const main = await import(`../src/foundry/main.mjs?controls-test=${++controlsInstance}`);
  await hooks.get('ready')();
  return { ...f, main, hooks };
}

test('Run turn from controls configures a newly selected wolf before acting', async () => {
  const f = await controlsFixture('run');
  await f.main.openControls(f.wolf);
  assert.equal(f.adapter.config.enabled, true);
  assert.deepEqual(f.adapter.config.targetIds, ['target']);
  assert.equal(f.adapter.config.applyDamage, true);
  assert.deepEqual(f.calls.filter(c => ['move', 'strike', 'trip'].includes(c[0])).map(c => c[0]), ['move', 'strike', 'trip']);
});

test('controls calculate front line automatically while saving pacing, showcase strength and pack grouping', async () => {
  const f = await controlsFixture('save', { saved: true, alliance: 'opposition' });
  foundry.applications.api.DialogV2.wait = async config => {
    assert.match(config.content, /Entertainment preferences/);
    assert.match(config.content, /calculated automatically/);
    assert.ok(!config.content.includes('name="frontline_'));
    const elements = { targetMode: { value: 'alliance' }, autoRun: { checked: false }, autoAdvance: { checked: true },
      applyDamage: { checked: true }, pauseForReactions: { checked: true }, entertaining: { checked: true },
      packMorale: { checked: false }, showcaseBonus: { value: '6' }, packGroup: { value: 'west pack' } };
    return config.buttons.find(button => button.action === 'save').callback({}, { form: { elements } });
  };
  await f.main.openControls(f.wolf);
  const saved = f.adapter.config;
  assert.equal(saved.entertaining, true);
  assert.equal(saved.packMorale, false);
  assert.equal(saved.showcaseBonus, 6);
  assert.equal(saved.packGroup, 'west pack');
  assert.equal(saved.frontlineTargetIds, null);
  assert.equal(saved.autoAdvance, true);
  assert.equal(f.calls.some(call => call[0] === 'strike'), false);
});

test('saving before combat preserves automatic front-line suggestions for later combatants', async () => {
  const f = await controlsFixture('save', { alliance: 'opposition' });
  game.combat = null;
  await f.main.openControls(f.wolf);
  assert.equal(f.adapter.config.frontlineTargetIds, null);
  assert.equal(f.adapter.config.entertaining, true);
  assert.equal(f.adapter.config.packMorale, true);
});

test('correcting counts clears an old incapacity reason without changing the supplied budget', async () => {
  const f = await controlsFixture('save', { saved: true });
  await f.adapter.saveLedger({ ...await f.adapter.readLedger(f.adapter.turnKey()), done: true,
    completionReason: 'incapacitated', incapacitationReason: 'dead' });
  foundry.applications.api.DialogV2.input = async () => ({ actions: '1', attacks: '2' });
  await f.main.correctLedger(f.wolf);
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(ledger.actionsRemaining, 1);
  assert.equal(ledger.attacksMade, 2);
  assert.equal(ledger.done, false);
  assert.equal(ledger.completionReason, null);
  assert.equal(ledger.incapacitationReason, null);
});

test('One action saves the form and executes only one action for an unsaved wolf', async () => {
  const f = await controlsFixture('step');
  const ledger = await f.main.openControls(f.wolf);
  assert.equal(f.adapter.config.enabled, true);
  assert.equal(ledger.actionsRemaining, 2);
  assert.equal(f.calls.filter(c => c[0] === 'move').length, 1);
  assert.equal(f.calls.some(c => c[0] === 'strike'), false);
});

test('Preview uses unsaved form targets without enabling automation or writing a ledger', async () => {
  const f = await controlsFixture('preview', { autoRun: true });
  const decision = await f.main.openControls(f.wolf);
  assert.equal(decision.chosen.kind, 'step');
  assert.equal(f.wolf.document.getFlag(MODULE_ID, 'config'), undefined);
  assert.equal(f.wolf.document.getFlag(MODULE_ID, 'ledger'), undefined);
  assert.equal(f.calls.some(c => ['move', 'strike', 'trip'].includes(c[0])), false);
});

test('controls reject running without targets before saving or executing anything', async () => {
  const f = await controlsFixture('run', { autoRun: true });
  game.user.targets.clear();
  await assert.rejects(f.main.openControls(f.wolf), /Target at least one known enemy/);
  assert.equal(f.wolf.document.getFlag(MODULE_ID, 'config'), undefined);
  assert.equal(f.calls.length, 0);
});

test('opposition and Party wolves can save and run from controls without targeting anyone', async () => {
  for (const alliance of ['opposition', 'party']) {
    const f = await controlsFixture('run', { alliance });
    game.user.targets.clear();
    const ledger = await f.main.openControls(f.wolf);
    assert.equal(f.adapter.config.targetMode, 'alliance');
    assert.deepEqual(f.adapter.config.targetIds, []);
    assert.equal(ledger.actionsRemaining, 0);
    assert.equal(f.calls.filter(c => c[0] === 'strike').length, 1);
  }
});

test('death to Reactive Strike passes to the next automated wolf without stopping the AI chain', async () => {
  const f = await controlsFixture('save', { autoRun: true, autoAdvance: true });
  await f.main.openControls(f.wolf);
  f.actor.hitPoints.value = 4;
  f.conditions.add('prone');
  addReactions(f, { answer: 'strike-0-0', degree: 2 });
  f.target.actor.getReach = () => 10;
  const engine = game.modules.get(MODULE_ID).api.reactions;
  engine.prompts.ask = async () => 'strike-0-0';
  let pauses = 0;
  const pause = engine.onPause;
  engine.onPause = () => { pauses++; pause(); };
  const actor = { ...f.actor, uuid: 'Actor.second-wolf', hitPoints: { value: 24 } };
  const document = { ...f.wolf.document, id: 'second-wolf', x: 200, y: 100,
    getFlag: (namespace, key) => f.flags.get(`second-wolf:${namespace}:${key}`),
    setFlag: async (namespace, key, value) => f.flags.set(`second-wolf:${namespace}:${key}`, structuredClone(value)),
  };
  const secondWolf = { ...f.wolf, id: document.id, name: 'Second wolf', actor, document,
    get center() { return { x: document.x + 50, y: document.y + 50 }; },
    get mechanicalBounds() { return new PIXI.Rectangle(document.x, document.y, 100, 100); },
    distanceTo: other => Math.max(Math.abs(document.x - other.mechanicalBounds.x), Math.abs(document.y - other.mechanicalBounds.y)) / 100 * 5,
  };
  canvas.tokens.placeables.push(secondWolf);
  const secondCombatant = { id: 'second-combatant', tokenId: secondWolf.id, sceneId: 'scene' };
  game.combat.combatants.splice(1, 0, secondCombatant);
  game.combat.turn = 0;
  await document.setFlag(MODULE_ID, 'config', { enabled: true, autoRun: true, autoAdvance: false,
    targetIds: ['target'], targetMode: 'manual', pauseForReactions: true, applyDamage: true });
  let nextRun;
  game.combat.nextTurn = async () => {
    f.calls.push(['nextTurn']);
    game.combat.turn = 1;
    game.combat.combatant = secondCombatant;
    // Same automatic entry used by the PF2e start-turn hook, including its
    // global pause check. The next NPC starts before the old nextTurn resolves.
    nextRun = f.main.runTurn(secondWolf, { automatic: true, expectedTurn: 'combat:1:second-combatant' });
  };
  const ended = await f.main.runTurn(f.wolf);
  assert.equal(ended.completionReason, 'incapacitated');
  assert.equal(ended.advanced, true);
  assert.ok(nextRun);
  const nextLedger = await nextRun;
  assert.equal(nextLedger.done, true);
  assert.equal(nextLedger.actionsRemaining, 0);
  assert.equal(actor.hitPoints.value, 24);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
  assert.equal(pauses, 0);
});

test('neutral controls require manual targets, and an aligned wolf can explicitly choose manual mode', async () => {
  for (const alliance of [null, 'opposition']) {
    const f = await controlsFixture('save', { alliance, targetMode: 'manual' });
    game.user.targets.clear();
    await assert.rejects(f.main.openControls(f.wolf), /Target at least one known enemy/);
    assert.equal(f.wolf.document.getFlag(MODULE_ID, 'config'), undefined);
  }
  const f = await controlsFixture('save', { alliance: null });
  f.actor.isEnemyOf = () => false;
  await f.main.openControls(f.wolf);
  assert.equal(f.adapter.config.targetMode, 'manual');
  assert.deepEqual(f.adapter.config.targetIds, ['target']);
});

test('shared core installs the reaction query and AI exposes the same reaction controls', async () => {
  const f = await controlsFixture('save');
  game.keybindings = { register: () => {} };
  game.settings = { register: () => {} };
  f.hooks.get('init')();
  assert.equal(typeof CONFIG.queries[`${MODULE_ID}.reactionPrompt`], 'function');
  assert.equal(typeof game.modules.get(MODULE_ID).api.reactions.openControls, 'function');
  assert.equal(game.modules.get(MODULE_ID).api.version,'0.40.0');
  assert.equal(typeof game.modules.get(MODULE_ID).api.resetActors,'function');
});

test('actor reset waits for outstanding reaction resolution before changing any actor', async () => {
  const f = await controlsFixture('save');
  const engine = game.modules.get(MODULE_ID).api.reactions;
  let finish;
  const pending = engine.resolve(() => new Promise(resolve => { finish = resolve; }));
  try {
    await assert.rejects(f.main.resetActors(), /wait for current actions, movement and reaction prompts/);
    assert.equal(f.calls.some(call => ['strike', 'move', 'nextTurn'].includes(call[0])), false);
  } finally { finish(); await pending; }
});

test('completed movement records observed positions between NPC turns and preserves them after sight is lost',async()=>{
  const f=await controlsFixture('save',{saved:true,alliance:'opposition'});
  game.combat.combatant={id:'player-turn',tokenId:f.target.id,sceneId:'scene'};
  f.wolf.checkCollision=(destination,{type}={})=>type==='sight'&&destination.x>=350;
  f.target.document.x=100;
  f.hooks.get('moveToken')(f.target.document);
  for(let i=0;i<20&&!f.wolf.document.getFlag(MODULE_ID,'targetMemory');i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.wolf.document.getFlag(MODULE_ID,'targetMemory').entries[0].position.x,100);
  f.target.document.x=400;
  f.hooks.get('moveToken')(f.target.document);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.wolf.document.getFlag(MODULE_ID,'targetMemory').entries[0].position.x,100);
  assert.equal(f.calls.some(call=>call[0]==='strike'),false,'observation itself spends no actions or attacks');
  f.target.document.x=500;
  const movement={method:'dragging',passed:{waypoints:[{action:'walk'}]}};
  f.hooks.get('moveToken')(f.target.document,movement,{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.wolf.document.getFlag(MODULE_ID,'targetMemory').entries[0].position.x,500,'normal movement preserves a known square behind cover');
  f.targetConditions.add('undetected');f.target.document.x=600;
  f.hooks.get('moveToken')(f.target.document,movement,{});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.wolf.document.getFlag(MODULE_ID,'targetMemory').entries[0].position.x,500,'undetected movement does not report the new square');
});

test('player Reactive Strike messages prevent Workbench damage duplicates and reflect the damage mode', async () => {
  const f = await controlsFixture('save');
  const handler = f.hooks.get('preCreateChatMessage');
  for (const automatic of [true, false]) {
    let changes;
    handler({ flags: { pf2e: { context: { options: [MANAGED_OPTION, REACTION_OPTION, ...(automatic ? [REACTION_AUTO_DAMAGE] : [])] } } },
      speaker: { token: 'target' }, updateSource: value => { changes = value; } });
    assert.equal(changes['flags.xdy-pf2e-workbench.noAutoDamageRoll'], true);
    assert.equal(changes['flags.pf2e.suppressDamageButtons'], automatic);
  }
});

test('the supplied wolf export has the recognized one-action Knockdown and passive Pack Attack', async () => {
  // Mechanical subset of the supplied export; getters below model PF2e preparation.
  const data = JSON.parse(await readFile(new URL('./fixtures/wolf-mechanics.json', import.meta.url)));
  const actor = { type: data.type, system: { traits: { value: data.traits }, actions: [
    { type: 'strike', item: { name: data.jaws.name, isMelee: true,
      attackEffects: data.jaws.attackEffects, system: { damageRolls: data.jaws.damageRolls } } },
  ] }, itemTypes: { action: data.abilities.map(item => ({ ...item, slug: item.system.slug,
    actionCost: { type: item.system.actionType.value, value: item.system.actions.value } })) } };
  for (const prepared of [false, true]) {
    if (prepared) actor.itemTypes.action[0].system.rules[1].selector = ['strike-damage'];
    const parts = wolfParts(actor);
    assert.equal(parts.knockdown.name, 'Knockdown');
    assert.equal(parts.knockdown.actionCost.value, 1);
    assert.equal(parts.pack.name, 'Pack Attack');
    assert.equal(parts.pack.actionCost.type, 'passive');
    assert.equal(parts.averageDamage, 5.5);
    assert.equal(parts.remaster, true);
  }
});

function enableAdvancement(f) {
  f.flags.get('wolf:foundry-creature-ai:config').autoAdvance = true;
  game.combat.nextTurn = async () => {
    f.calls.push(['nextTurn']);
    game.combat.combatant = { id: 'next', tokenId: 'target', sceneId: 'scene' };
  };
}

test('full turn advances once, after jaws damage and one-action Knockdown', async () => {
  const f = fixture();
  enableAdvancement(f);
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.advanced, true);
  assert.deepEqual(f.calls.filter(c => ['move', 'strike', 'applyDamage', 'trip', 'nextTurn'].includes(c[0])).map(c => c[0]),
    ['move', 'strike', 'applyDamage', 'trip', 'nextTurn']);
  await f.adapter.finishTurn(ledger);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
});

test('defeating the last enemy stops AI with unused actions and holds the combat tracker', async () => {
  const f = fixture();
  enableAdvancement(f);
  f.target.actor.hitPoints.value = 5;
  const ledger = await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining, 1);
  assert.equal(ledger.completionReason, 'battle-over');
  assert.notEqual(ledger.advanced, true);
  assert.equal(f.calls.some(c => c[0] === 'trip'), false);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 0);
});

test('defeating only the manually assigned enemy still advances if other combatants are fighting',async()=>{
  const f=fixture();enableAdvancement(f);
  f.actor.alliance='opposition';f.target.actor.alliance='party';
  f.flags.get(`wolf:${MODULE_ID}:config`).targetMode='manual';
  addCombatTarget(f,'other-enemy',{alliance:'party',x:500,y:500});
  f.target.actor.hitPoints.value=5;
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.completionReason,'no-enemies');assert.equal(result.advanced,true);
});

test('the last NPC dying to a reaction stops the battle without passing the turn',async()=>{
  const f=fixture();enableAdvancement(f);f.actor.hitPoints.value=4;
  f.conditions.add('prone');addReactions(f,{answer:'strike-0-0',degree:2});f.target.actor.getReach=()=>10;
  const result=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(result.completionReason,'battle-over');assert.equal(result.actionsRemaining,2);
  assert.equal(f.calls.some(c=>c[0]==='nextTurn'),false);
});

test('victory while advancement is being reserved cancels the pending nextTurn request',async()=>{
  const f=fixture();enableAdvancement(f);const save=f.adapter.saveLedger.bind(f.adapter);
  f.adapter.saveLedger=async value=>{await save(value);if(value.advanceRequested)f.target.actor.hitPoints.value=0;};
  const result=await f.adapter.finishTurn({...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:0,done:true});
  assert.equal(result.advanceRequested,false);assert.equal(f.calls.some(c=>c[0]==='nextTurn'),false);
});

test('a missing roster token or physically unreachable living enemies hold automatic advancement', async () => {
  for (const mode of ['missing', 'sealed', 'region']) {
    const f = fixture();
    enableAdvancement(f);
    if (mode === 'missing') f.flags.get('wolf:foundry-creature-ai:config').targetIds = ['missing'];
    if (mode === 'sealed') {
      f.wolf.checkCollision = () => true;
      f.wolf.constrainMovementPath = path => [path, true];
    }
    if (mode === 'region') canvas.scene.regions.contents = [{ name: 'Hazard', behaviors: { contents: [{ disabled: false }] } }];
    const ledger = await new TurnRunner(f.adapter).run();
    assert.equal(ledger.done, false, mode);
    assert.equal(ledger.actionsRemaining, 3, mode);
    assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false, mode);
  }
});

test('auto advancement is opt-in and the controls save its checkbox', async () => {
  const f = await controlsFixture('run', { autoRun: true, autoAdvance: true });
  game.combat.nextTurn = async () => { f.calls.push(['nextTurn']); game.combat.combatant = null; };
  await f.main.openControls(f.wolf);
  assert.equal(f.adapter.config.autoAdvance, true);
  assert.equal(f.adapter.config.autoRun, true);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
  const g = fixture();
  game.combat.nextTurn = async () => assert.fail('unchecked option must not advance');
  await new TurnRunner(g.adapter).run();
});

test('One action, Preview, manual damage, and unresolved rolls do not advance', async () => {
  for (const mode of ['step', 'manualDamage', 'error', 'blocked']) {
    const f = fixture();
    enableAdvancement(f);
    if (mode === 'manualDamage') f.flags.get('wolf:foundry-creature-ai:config').applyDamage = false;
    if (mode === 'error') f.wolf.document.move = async () => { throw new Error('interrupted'); };
    if (mode === 'blocked') f.target.document.hidden = true;
    const pending = new TurnRunner(f.adapter).run({ oneAction: mode === 'step' });
    if (mode === 'error') await assert.rejects(pending, /interrupted/);
    else await pending;
    assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false, mode);
  }
  const f = await controlsFixture('preview', { autoAdvance: true });
  game.combat.nextTurn = async () => assert.fail('Preview must not advance');
  await f.main.openControls(f.wolf);
  assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false);
});

test('a single final action and a final damaging hit in rolls-only mode hold the turn', async () => {
  for (const mode of ['step', 'manualDamage']) {
    const f = fixture();
    enableAdvancement(f);
    f.wolf.document.x = 100;
    if (mode === 'manualDamage') f.flags.get('wolf:foundry-creature-ai:config').applyDamage = false;
    await f.adapter.saveLedger({ ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 1 });
    await new TurnRunner(f.adapter).run({ oneAction: mode === 'step' });
    assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false);
  }
});

test('stop, a turn change, pause, or GM change while reserving advancement prevents the request', async () => {
  for (const change of ['stop', 'turn', 'pause', 'gm']) {
    const f = fixture();
    enableAdvancement(f);
    let stopped = false;
    const ledger = { ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 0, done: true };
    const save = f.adapter.saveLedger.bind(f.adapter);
    f.adapter.saveLedger = async value => {
      await save(value);
      if (!value.advanceRequested) return;
      if (change === 'stop') stopped = true;
      if (change === 'turn') game.combat.combatant = null;
      if (change === 'pause') game.paused = true;
      if (change === 'gm') game.users.activeGM = { id: 'anotherGM' };
    };
    await f.adapter.finishTurn(ledger, { canAdvance: () => !stopped });
    assert.equal(f.calls.some(c => c[0] === 'nextTurn'), false, change);
  }
});

test('uncertain or unchanged nextTurn outcomes cannot be requested twice', async () => {
  for (const reject of [true, false]) {
    const f = fixture();
    enableAdvancement(f);
    game.combat.nextTurn = async () => { f.calls.push(['nextTurn']); if (reject) throw new Error('network'); };
    const ledger = { ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 0, done: true };
    await assert.rejects(f.adapter.finishTurn(ledger), reject ? /network/ : /did not advance/);
    const saved = await f.adapter.readLedger(f.adapter.turnKey());
    await assert.rejects(f.adapter.finishTurn(saved), /already requested/);
    assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
  }
});

test('advancement never overwrites a ledger created by the next round', async () => {
  const f = fixture();
  enableAdvancement(f);
  const ledger = { ...await f.adapter.readLedger(f.adapter.turnKey()), actionsRemaining: 0, done: true };
  game.combat.nextTurn = async () => {
    game.combat.round++;
    await f.adapter.saveLedger(await f.adapter.readLedger(f.adapter.turnKey()));
  };
  await f.adapter.finishTurn(ledger);
  const next = await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(next.actionsRemaining, 3);
  assert.equal(next.turn, 'combat:2:combatant');
});

test('Stop all suppresses automatic starts until a manual run resumes them', async () => {
  const f = await controlsFixture('save', { autoRun: true, autoAdvance: true });
  await f.main.openControls(f.wolf);
  f.main.stop();
  f.hooks.get('pf2e.startTurn')(game.combat.combatant);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.some(c => c[0] === 'move'), false);
  await f.main.runTurn(f.wolf, { oneAction: true });
  assert.equal(f.calls.some(c => c[0] === 'move'), true);
});

test('bulk full-auto enabling resumes automatic starts after Stop without immediately running the selected creature',async()=>{
  const f=await controlsFixture('save',{autoRun:true,autoAdvance:true});
  await f.main.openControls(f.wolf);f.main.stop();
  const report=await f.main.enableFullAuto([f.wolf]);assert.equal(report.enabled.length,1);
  assert.equal(f.calls.some(c=>c[0]==='move'),false);
  await f.main.runTurn(f.wolf,{automatic:true,oneAction:true});
  assert.equal(f.calls.some(c=>c[0]==='move'),true);
});

test('an automatic next-round start waits for the same wolf runner to finish', async () => {
  const f = await controlsFixture('save', { autoRun: true, autoAdvance: true });
  await f.main.openControls(f.wolf);
  let nextRun;
  game.combat.nextTurn = async () => {
    f.calls.push(['nextTurn']);
    game.combat.round++;
    // Model the start-turn event arriving before nextTurn resolves.
    nextRun = f.main.runTurn(f.wolf, { automatic: true, expectedTurn: f.adapter.turnKey() });
    // End this test chain on its next action rather than playing an endless combat.
    f.flags.get('wolf:foundry-creature-ai:config').autoAdvance = false;
  };
  await f.main.runTurn(f.wolf);
  await nextRun;
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(ledger.turn, 'combat:2:combatant');
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(f.calls.filter(c => c[0] === 'nextTurn').length, 1);
});
