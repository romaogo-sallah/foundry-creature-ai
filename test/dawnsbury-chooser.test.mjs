import test from 'node:test';
import assert from 'node:assert/strict';
import { attackValue, compareOptions, chooseOption, priorityLayer, standardArmorClass, tileDistance, PRIORITY } from '../src/dawnsbury/chooser.mjs';
import { enemyDistances } from '../src/wolf/planner.mjs';

const option = (id, assessment, extra = {}) => ({ id, kind: 'strike', actionCost: 1, legal: true, assessment, ...extra });

test('own tile distance counts every second diagonal twice, separately from flood distance', () => {
  assert.equal(tileDistance({ x: 0, y: 0 }, { x: 2, y: 2 }), 3);
  assert.equal(tileDistance({ x: 4, y: -2 }, { x: 1, y: -2 }), 3);
  assert.equal(tileDistance({ x: 0, y: 0 }, { x: 3, y: 3 }), 4);
});

test('recovered priority layers preserve action economy and the special fallback band', () => {
  const rows = [
    [{ value: -1 }, 1], [{ value: 0 }, 2], [{ value: 0, movement: true }, 3],
    [{ value: 0, movement: true, currentNearestEnemy: 8, nearestEnemy: 3 }, 4],
    [{ value: -1337 }, 4], [{ value: -1337.99 }, 4], [{ value: -1338 }, 1],
    [{ value: 1, movement: true }, 5], [{ value: 1 }, 6],
    [{ value: 1, movement: true, goodAttacksLeft: true }, 6],
    [{ value: 5000, movement: true }, 6], [{ value: PRIORITY }, 7],
  ];
  for (const [assessment, layer] of rows) assert.equal(priorityLayer(assessment), layer, JSON.stringify(assessment));
  assert.ok(compareOptions({ value: 0.01 }, { value: 100, movement: true }) > 0);
});

test('ranking compares layer, utility, movement, low-layer enemy distance, own distance, then Step', () => {
  assert.ok(compareOptions({ value: 2 }, { value: 1 }) > 0);
  assert.ok(compareOptions({ value: 2 }, { value: 2, movement: true, goodAttacksLeft: true }) > 0);
  assert.ok(compareOptions({ value: 0, movement: true, nearestEnemy: 2 }, { value: 0, movement: true, nearestEnemy: 3 }) > 0);
  assert.ok(compareOptions({ value: 0, movement: true, nearestEnemy: 2, reachSquares: 2 },
    { value: 0, movement: true, nearestEnemy: 1, reachSquares: 2 }) > 0);
  assert.ok(compareOptions({ value: 5, distanceMoved: 1 }, { value: 5, distanceMoved: 2 }) > 0);
  assert.ok(compareOptions({ value: 5, step: true }, { value: 5 }) > 0);
  assert.equal(compareOptions({ value: 5, nearestEnemy: 1 }, { value: 5, nearestEnemy: 20 }), 0);
});

test('attack utility uses the recovered hit chance and pack bonus, independently of real damage rolls', () => {
  const strike = { bonus: 9, referenceAC: 18, damage: 5.5 };
  assert.equal(attackValue(strike), Math.fround(3.3));
  assert.equal(attackValue({ ...strike, bonus: -100 }), Math.fround(0.275));
  assert.equal(attackValue({ ...strike, bonus: 100 }), 5.5);
  assert.equal(attackValue({ ...strike, mindless: true }), 2.75);
  assert.equal(attackValue({ ...strike, packTactic: true, alliesInReach: 1 }), Math.fround(5.3));
  assert.equal(attackValue({ ...strike, packTactic: true, alliesInReach: 2 }), Math.fround(6.8));
  assert.ok(attackValue({ ...strike, defenseAdjustment: -2 }) > attackValue(strike));
  assert.ok(attackValue({ ...strike, concealmentDC: 5 }) < attackValue(strike));
  assert.equal(standardArmorClass(1), 18);
  assert.equal(standardArmorClass(5), 23);
  assert.equal(standardArmorClass(20), 44);
  assert.equal(standardArmorClass(100), 15);
});

test('the chooser rejects illegal/unaffordable options before applying a creature override', () => {
  const candidates = [option('legal', { value: 1 }), option('illegal', { value: PRIORITY }, { legal: false }),
    option('expensive', { value: PRIORITY }, { actionCost: 3 })];
  const result = chooseOption(candidates, { actionsRemaining: 2, override: legal => legal.find(c => c.id === 'expensive') });
  assert.equal(result.chosen.id, 'legal');
  assert.equal(result.rejected.length, 2);
  assert.throws(() => chooseOption(candidates, { actionsRemaining: 2, override: () => candidates[1] }), /supplied legal/);
});

test('random ties select only equal maxima and known threats favor nonprovoking ties', () => {
  const candidates = [option('a', { value: 2 }, { provokes: true }), option('b', { value: 2 }), option('worse', { value: 1 })];
  assert.equal(chooseOption(candidates, { actionsRemaining: 3, random: () => 0 }).chosen.id, 'a');
  assert.equal(chooseOption(candidates, { actionsRemaining: 3, random: () => 0.999 }).chosen.id, 'b');
  assert.equal(chooseOption(candidates, { actionsRemaining: 3, threatened: true, random: () => 0 }).chosen.id, 'b');
});

test('a safe Step can replace a provoking maximum with equal layer/value when three actions remain', () => {
  const candidates = [option('stride', { value: 5, movement: true, goodAttacksLeft: true, distanceMoved: 1 }, { provokes: true }),
    option('step', { value: 5, movement: true, goodAttacksLeft: true, distanceMoved: 2, step: true },
      { kind: 'step', provokes: true, destinationThreatened: false })];
  assert.equal(chooseOption(candidates, { actionsRemaining: 3, threatened: true }).chosen.id, 'step');
  assert.equal(chooseOption(candidates, { actionsRemaining: 2, threatened: true }).chosen.id, 'stride');
});

test('stalled low-value choices permit opening a supplied legal door', () => {
  const candidates = [option('blocked', { value: 0, movement: true, nearestEnemy: 5, currentNearestEnemy: 5 }),
    option('door', { value: -1 }, { kind: 'openDoor' })];
  assert.equal(chooseOption(candidates, { actionsRemaining: 3 }).chosen.kind, 'openDoor');
  candidates.splice(1, 0, option('first-door', { value: -10 }, { kind: 'openDoor' }));
  assert.equal(chooseOption(candidates, { actionsRemaining: 3 }).chosen.id, 'first-door', 'door fallback preserves original option order');
  candidates[0].assessment.nearestEnemy = 4;
  assert.equal(chooseOption(candidates, { actionsRemaining: 3 }).chosen.id, 'blocked');
});

test('nearest-enemy flood distances guide an approach around walls rather than toward a dead end', () => {
  const distances = enemyDistances([{ x: 2, y: 0 }], {
    needed: [{ x: 0, y: 0 }, { x: 0, y: 2 }], canVisit: c => c.x >= 0 && c.x <= 2 && c.y >= 0 && c.y <= 2,
    canCross: (a, b) => a.x === b.x || a.y === 2 && b.y === 2,
  });
  assert.equal(distances.get('0,0'), 6);
  assert.equal(distances.get('0,2'), 4);
  const choice = chooseOption([
    option('stay', { value: 0 }, { kind: 'endTurn', actionCost: 0 }),
    option('around', { value: 0, movement: true, nearestEnemy: 4, currentNearestEnemy: 6 }, { kind: 'stride' }),
    option('dead-end', { value: 0, movement: true, nearestEnemy: 6, currentNearestEnemy: 6 }, { kind: 'stride' }),
  ], { actionsRemaining: 1 }).chosen;
  assert.equal(choice.id, 'around');
});
