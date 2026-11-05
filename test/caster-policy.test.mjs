import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePyroAction, pyroCandidates } from '../src/profiles/goblin-pyro.mjs';
import { castingCandidates, spellTargetValue, spellAreaValue } from '../src/framework/spell-evaluation.mjs';
import { apparentCombatRole } from '../src/foundry/caster-target-knowledge.mjs';
import { casterPressure, spellReserveCost } from '../src/framework/caster-tactics.mjs';
import { fixture } from './helpers/pyro-fixture.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';

function enemy(id = 'wolf', distance = 10, role = 'melee') {
  return { id, distance, inReach: distance <= 5, lineOfSight: true, lineOfEffect: true,
    tactics: { role, reach: 5, speed: 25 }, awareness: { state: 'observed' } };
}
function state(overrides = {}) {
  const enemies = [enemy()];
  return { actionsRemaining: 3, attacksMade: 0, spellSlots: 3, torchReady: false,
    self: { cell: { x: 10, y: 10 }, referenceAC: 17, attackBonus: 7, averageDamage: 3.5,
      mapPenalties: [0, -5, -10], reachSquares: 1 },
    enemies, moves: [], spells: [], diagnostics: {}, nearestEnemy: 2, style: { enabled: false }, ...overrides };
}
const ignition = { id: 'ignition', name: 'Ignition', slug: 'ignition', kind: 'damage-attack', damage: 5,
  meleeDamage: 7, bonus: 6, range: 30, actionCost: 2, cantrip: true, available: true };
const vine = { ...ignition, id: 'vine', name: 'Tangle Vine', slug: 'tangle-vine', kind: 'control-attack' };
const areaSpell = (enemies, bystanders = [], kind = 'basic-save') => ({ id: kind, name: kind, slug: kind === 'basic-save' ? 'breathe-fire' : 'grease',
  kind, dc: 16, range: 30, damage: 7, actionCost: 2, cantrip: false, available: true,
  areas: [{ id: 'area', enemies, bystanders }] });
function move(s, distances, { kind = 'stride', spells = [], ...other } = {}) {
  return { x: 5, y: 10, kind, cost: 25, nearestEnemy: Math.min(...distances) / 5,
    path: [{ x: 10, y: 10 }, { x: 5, y: 10 }], spells,
    targets: Object.fromEntries(s.enemies.map((target, index) => [target.id,
      { distance: distances[index], inReach: distances[index] <= 5, lineOfSight: true, lineOfEffect: true }])), ...other };
}
function plansFit(s, options) {
  for (const candidate of options) {
    const plan = candidate.features?.turnPlan;
    if (plan) assert.ok(plan.reduce((sum, action) => sum + action.actionCost, 0) <= s.actionsRemaining);
    const sum = (candidate.scoringTerms ?? []).reduce((total, term) => total + term.contribution, 0);
    if (candidate.scoringTerms?.length) assert.ok(Math.abs(sum - candidate.assessment.value) < 1e-6, candidate.id);
  }
}

test('after Stand, an available cone beats retreat that would consume its casting budget', () => {
  const enemies = [enemy('a', 5), enemy('b', 10), enemy('c', 10)];
  const s = state({ actionsRemaining: 2, enemies, spells: [areaSpell(enemies)] });
  s.moves = [move(s, [35, 35, 35])];
  const choice = choosePyroAction(s).chosen;
  assert.equal(choice.kind, 'castSpell');
  assert.equal(choice.spellSlug, 'breathe-fire');
  assert.equal(choice.features.turnPlan.length, 1);
  plansFit(s, pyroCandidates(s));
});

test('three actions compare cast-then-retreat with move-then-cast on the same budget', () => {
  const enemies = [enemy('a', 5), enemy('b', 10), enemy('c', 10)];
  const s = state({ enemies, spells: [areaSpell(enemies)] });
  s.moves = [move(s, [30, 30, 30], { spells: [areaSpell([enemies[0]])] })];
  const before = structuredClone(s), choice = choosePyroAction(s).chosen;
  assert.equal(choice.kind, 'castSpell');
  assert.deepEqual(choice.features.turnPlan.map(action => action.kind), ['castSpell', 'stride']);
  assert.deepEqual(s, before, 'forecasting must not spend resources, move, or assume check outcomes');
  plansFit(s, pyroCandidates(s));
});

test('a caster outside range can move and cast, but never budgets a two-action spell after moving with two actions left', () => {
  const s = state({ enemies: [enemy('wolf', 45)], nearestEnemy: 9, spells: [ignition] });
  s.moves = [move(s, [30], { spells: [ignition] })];
  assert.deepEqual(choosePyroAction(s).chosen.features.turnPlan.map(action => action.kind), ['stride', 'castSpell']);
  const two = { ...s, actionsRemaining: 2 };
  plansFit(two, pyroCandidates(two));
  assert.ok(pyroCandidates(two).every(choice => !choice.features?.turnPlan?.some(action => action.kind === 'castSpell')));
});

test('a safe Step can precede casting to avoid known Reactive Strike exposure', () => {
  const s = state({ enemies: [enemy('wolf', 5)], spells: [ignition] });
  s.self.threatened = true; s.self.reactionRisk = 4;
  s.moves = [move(s, [10], { kind: 'step', spells: [ignition], cost: 5, destinationThreatened: false })];
  const choice = choosePyroAction(s).chosen;
  assert.equal(choice.kind, 'step');
  assert.equal(choice.features.turnPlan[1].spellSlug, 'ignition');
});

test('attack sequence forecasts apply MAP and prefer Ignition before a follow-up Torch Strike', () => {
  const s = state({ enemies: [enemy('wolf', 5)], spells: [ignition], torchReady: true });
  const choice = choosePyroAction(s).chosen;
  assert.equal(choice.spellSlug, 'ignition');
  assert.deepEqual(choice.features.turnPlan.map(action => action.kind), ['castSpell', 'strike']);
  plansFit(s, pyroCandidates(s));
});

test('Grease cannot forecast a retreat using paths calculated before its new terrain exists', () => {
  const enemies = [enemy('a', 10), enemy('b', 10), enemy('c', 10)];
  const s = state({ enemies, spells: [areaSpell(enemies, [], 'ground-control')] });
  s.moves = [move(s, [35, 35, 35])];
  const grease = pyroCandidates(s).find(choice => choice.spellSlug === 'grease');
  assert.ok(grease);
  assert.deepEqual(grease.features.turnPlan.map(action => action.kind), ['castSpell']);
});

test('Tangle Vine values an approaching melee opponent more than an archer at the same distance', () => {
  const s = state();
  const melee = spellTargetValue(s, vine, enemy('wolf', 20, 'melee'));
  const archer = spellTargetValue(s, vine, enemy('scout', 20, 'ranged'));
  assert.ok(melee > archer * 4);
  assert.equal(spellTargetValue(s, vine, { ...enemy(), tangled: true }), 0);
  assert.equal(spellTargetValue(s, vine, { ...enemy(), immobilized: true }), 0);
});

test('a prone ally still contributes persistent Grease movement cost', () => {
  const enemies = [enemy('a'), enemy('b'), enemy('c')], s = state({ enemies });
  const spell = areaSpell(enemies, [], 'ground-control'), area = spell.areas[0];
  const safe = spellAreaValue(s, spell, area);
  const crowded = spellAreaValue(s, spell, { ...area, bystanders: [{ id: 'ally', prone: true }] });
  assert.ok(crowded.allies >= 8);
  assert.ok(crowded.value < safe.value);
  assert.equal(spellAreaValue(s, spell, { ...area, bystanders: [{ airborne: true }] }).allies, 0);
});

test('Grease separates an already-prone enemy from an already-greased or airborne enemy', () => {
  const s = state(), spell = areaSpell([], [], 'ground-control');
  const value = target => spellAreaValue(s, spell, { enemies: [target], bystanders: [] }).value;
  assert.ok(value({ ...enemy(), prone: true }) > value({ ...enemy('archer', 10, 'ranged'), prone: true }));
  assert.equal(value({ ...enemy(), greased: true }), 0);
  assert.equal(value({ ...enemy(), airborne: true }), 0);
});

test('showcase preferences cannot rescue an ineffective or ally-harming area', () => {
  const enemies = [enemy()], spell = areaSpell(enemies, [enemy('ally')]);
  const s = state({ enemies, spells: [spell], style: { enabled: true, showcaseBonus: 5000 } });
  assert.equal(castingCandidates(s).length, 0);
  const greased = areaSpell([{ ...enemy(), greased: true }], [], 'ground-control');
  assert.equal(castingCandidates({ ...s, spells: [greased] }).length, 0);
});

test('conservation becomes weaker as the caster loses its own HP, but remains nonnegative', () => {
  const s = state({ spellSlots: 1 }), spell = areaSpell(s.enemies);
  const healthy = spellReserveCost(s, spell), hurt = spellReserveCost({ ...s, self: { ...s.self, hpFraction: 0.25 } }, spell);
  assert.ok(hurt < healthy && hurt > 0);
  assert.equal(spellReserveCost(s, ignition), 0);
});

test('ranged weapons imply less closing pressure without inspecting ammunition or secret defenses', () => {
  const item = { isRanged: true, isMelee: false, system: { equipped: { carryType: 'held' } } };
  Object.defineProperty(item.system, 'quantity', { get() { throw new Error('ammo is not role knowledge'); } });
  const actor = { system: { actions: [{ type: 'strike', ready: false, item }] } };
  const role = apparentCombatRole(actor);
  assert.equal(role.role, 'ranged');
  assert.ok(casterPressure([{ ...enemy(), tactics: role }]) < casterPressure([enemy()]));
});

test('opposing hidden roll results and exact defensive statistics do not affect caster decisions', () => {
  const s = state({ spells: [ignition, vine] });
  const first = pyroCandidates(s);
  const changed = structuredClone(s);
  Object.assign(changed.enemies[0], { hiddenRoll: 'critical-failure', ac: 100, reflex: -99, hp: 10000 });
  assert.deepEqual(pyroCandidates(changed), first);
});

test('native caster turn casts its cone before retreat and spends exactly three actions', async () => {
  const f = fixture(); f.player.document.x = 300; f.player.document.y = 200;
  f.addEnemy('second', 300, 300);
  const ledger = await new TurnRunner(f.adapter).run();
  const castIndex = f.calls.findIndex(call => call[0] === 'consume-spell' && call[1] === 'breathe-fire');
  const moveIndex = f.calls.findIndex(call => call[0] === 'move');
  assert.ok(castIndex >= 0 && moveIndex > castIndex);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(f.adapter.parts().entry.system.slots.slot1.value, 2);
  assert.equal(ledger.uncertain, false);
});

test('native Stand leaves two actions for a cone instead of a retreat and an unused action', async () => {
  const f = fixture(); f.actor.conditionsSet.add('prone');
  f.player.document.x = 300; f.player.document.y = 200;
  f.addEnemy('second', 300, 300);
  const ledger = await new TurnRunner(f.adapter).run();
  const stand = f.calls.findIndex(call => call[0] === 'delete-items' && call[2].includes('prone'));
  const cast = f.calls.findIndex(call => call[0] === 'consume-spell' && call[1] === 'breathe-fire');
  assert.ok(stand >= 0 && cast > stand);
  assert.equal(f.calls.some(call => call[0] === 'move'), false);
  assert.equal(ledger.actionsRemaining, 0);
  assert.equal(f.actor.hasCondition('prone'), false);
});

test('native Grease area descriptions charge a prone allied Pyro for the persistent surface', async () => {
  const f = fixture(); f.player.document.x = 300; f.player.document.y = 200;
  f.addEnemy('second', 300, 300); f.addEnemy('third', 400, 200);
  const ally = f.addPyro('ally', 400, 300); ally.actor.conditionsSet.add('prone');
  const ledger = await f.adapter.readLedger(f.adapter.turnKey()), s = await f.adapter.snapshot(ledger);
  const spell = s.spells.find(spell => spell.slug === 'grease');
  const area = spell.areas.find(area => area.enemies.length === 3 && area.bystanders.some(target => target.id === 'ally'));
  assert.ok(area);
  assert.equal(area.bystanders.find(target => target.id === 'ally').prone, true);
  assert.ok(spellAreaValue(s, spell, area).allies >= 8);
  assert.equal(f.calls.length, 0, 'planning must not roll, move, spend slots or create terrain');
});

test('observed weapon roles persist when the target becomes Hidden and refresh when observed again', async () => {
  const f = fixture();
  f.player.actor.system.actions = [{ type: 'strike', item: { isMelee: true, reach: 10 } }];
  await f.adapter.prepareTurn();
  const ledger = await f.adapter.readLedger(f.adapter.turnKey());
  let s = await f.adapter.snapshot(ledger, { movement: false });
  assert.equal(s.enemies[0].tactics.role, 'melee');
  assert.equal(s.enemies[0].tactics.reach, 10);
  f.player.actor.conditionsSet.add('hidden');
  f.player.actor.system.actions = [{ type: 'strike', item: { isRanged: true } }];
  s = await f.adapter.snapshot(ledger, { movement: false });
  assert.equal(s.enemies[0].tactics.role, 'melee');
  f.player.actor.conditionsSet.delete('hidden');
  s = await f.adapter.snapshot(ledger, { movement: false });
  assert.equal(s.enemies[0].tactics.role, 'ranged');
  assert.ok(f.calls.every(call => !['spell-attack', 'spell-save', 'move'].includes(call[0])));
});
