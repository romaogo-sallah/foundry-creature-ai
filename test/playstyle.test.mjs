import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPackMorale } from '../src/wolf/playstyle.mjs';
import { chooseWolfAction, buildWolfCandidates } from '../src/wolf/planner.mjs';

function state(extra = {}) {
  return { actionsRemaining: 2, attacksMade: 1,
    lastAction: { kind: 'strike', hit: true, targetId: 'fighter', strikeId: 'jaws' },
    self: { strikeId: 'jaws', attackBonus: 9, athleticsBonus: 6, referenceAC: 23, averageDamage: 5.5,
      packDamage: 2.5, mapPenalties: [0, -5, -10], knockdown: true, knockdownCost: 1, remaster: true, reactionRisk: 5.5 },
    enemies: [{ id: 'fighter', inReach: true, lineOfEffect: true, trippable: true, prone: false, alliesInReach: 0, distance: 5 }],
    style: { enabled: true, showcaseBonus: 4 }, moves: [], visited: [], ...extra };
}

test('the first ability bonus showcases Knockdown in the reported negative-score scenario, then expires', () => {
  const s = state();
  assert.equal(chooseWolfAction(s).chosen.kind, 'knockdown');
  const terms = chooseWolfAction(s).ranked.find(entry => entry.candidate.kind === 'knockdown').terms;
  assert.ok(terms[0].contribution < 0);
  assert.equal(terms[1].contribution, 4);
  s.style.knockdownShown = true;
  assert.equal(chooseWolfAction(s).chosen.kind, 'strike');
  s.style = { enabled: false };
  assert.equal(chooseWolfAction(s).chosen.kind, 'strike');
});

test('showcasing cannot bypass prone, immunity, hit prerequisites, restraint or the action budget', () => {
  for (const change of ['prone', 'immune', 'miss', 'restrained', 'no-actions']) {
    const s = state(); s.style.showcaseBonus = 20;
    if (change === 'prone') s.enemies[0].prone = true;
    if (change === 'immune') s.enemies[0].trippable = false;
    if (change === 'miss') s.lastAction.hit = false;
    if (change === 'restrained') s.self.restrained = true;
    if (change === 'no-actions') s.actionsRemaining = 0;
    assert.ok(!buildWolfCandidates(s).some(candidate => candidate.kind === 'knockdown'), change);
  }
});

test('front-line engagement attracts one attack per turn without fixing all future targets', () => {
  const s = state({ actionsRemaining: 1, lastAction: null });
  s.enemies = [{ ...s.enemies[0], id: 'mage' }, { ...s.enemies[0], frontline: true }];
  assert.equal(chooseWolfAction(s, null, { random: () => 0 }).chosen.targetId, 'fighter');
  s.frontlineEngaged = true;
  assert.equal(chooseWolfAction(s, null, { random: () => 0 }).chosen.targetId, 'mage');
  s.enemies[1].inReach = false;
  s.frontlineEngaged = false;
  assert.equal(chooseWolfAction(s).chosen.targetId, 'mage');
});

const member = (id, hp = 24, alive = hp > 0) => ({ id, hp, maxHP: 24, alive });
test('half the pack falling triggers a shared, sticky retreat even after healing', () => {
  const first = assessPackMorale(null, [member('a'), member('b'), member('c'), member('d')]);
  assert.equal(first.broken, false);
  const one = assessPackMorale(first, [member('a', 0), member('b'), member('c'), member('d')]);
  assert.equal(one.broken, false);
  const two = assessPackMorale(one, [member('a', 0), member('b', 0), member('c'), member('d')]);
  assert.equal(two.broken, true);
  assert.match(two.reason, /half/);
  const healed = assessPackMorale(two, [member('a'), member('b'), member('c'), member('d')]);
  assert.equal(healed.broken, true);
  assert.equal(healed.reason, two.reason);
});

test('wounded packs break at 35% capacity, lone wolves at 25%, and new encounters start fresh', () => {
  assert.equal(assessPackMorale(null, [member('a', 8), member('b', 8)]).broken, true);
  assert.equal(assessPackMorale(null, [member('a', 9), member('b', 9)]).broken, false);
  assert.equal(assessPackMorale(null, [member('a', 6)]).broken, true);
  assert.equal(assessPackMorale(null, [member('a', 7)]).broken, false);
  assert.equal(assessPackMorale(null, [member('a'), member('b')]).broken, false);
});

test('retreat replaces attacks with exit progress while keeping legal Escape available', () => {
  const s = state({ morale: { broken: true }, retreatDistance: 8 });
  s.moves = [
    { x: 1, y: 0, cost: 5, retreatDistance: 9, targets: { fighter: { distance: 15 } } },
    { x: 0, y: 2, cost: 10, retreatDistance: 6, targets: { fighter: { distance: 15 } } },
    { x: 0, y: 4, cost: 20, retreatDistance: 4, targets: { fighter: { distance: 25 } } },
  ];
  const choice = chooseWolfAction(s).chosen;
  assert.equal(choice.intent, 'retreat');
  assert.deepEqual(choice.destination, { x: 0, y: 4 });
  assert.ok(!buildWolfCandidates(s).some(candidate => ['strike', 'knockdown'].includes(candidate.kind)));
  s.self.immobile = true; s.self.restrained = true;
  s.escapes = [{ id: 'hold', bonus: 9, dc: 18, statistic: 'unarmed' }];
  assert.equal(chooseWolfAction(s).chosen.kind, 'escape');
});

test('retreat can follow an exit detour, pauses when blocked, and respects exhausted actions', () => {
  const s = state({ morale: { broken: true }, retreatDistance: 5, visited: [] });
  s.moves = [{ x: 1, y: 0, cost: 5, retreatDistance: 4, targets: { fighter: { distance: 5 } } }];
  assert.equal(chooseWolfAction(s).chosen.intent, 'retreat');
  s.visited = ['1,0'];
  assert.equal(chooseWolfAction(s).chosen.kind, 'endTurn');
  s.visited = []; s.actionsRemaining = 0;
  assert.equal(chooseWolfAction(s).chosen.kind, 'endTurn');
});
