import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveProfile } from '../src/decision-engine.mjs';
import { checkDegree, expectedDamage, averageFormula, reachableCells, chooseWolfAction, buildWolfCandidates, knockdownEstimate, strikeFollowUpEstimate } from '../src/wolf/planner.mjs';

const profile = resolveProfile(JSON.parse(await readFile(new URL('../profiles/creatures.json', import.meta.url))), 'wolf');
function state(extra = {}) {
  return { actionsRemaining: 3, attacksMade: 0, lastAction: null, moves: [], visited: [],
    self: { prone: false, immobile: false, strikeId: 'jaws', attackBonus: 9, averageDamage: 5.5, packDamage: 2.5,
      referenceAC: 15, mapPenalties: [0, -5, -10], knockdown: true, knockdownCost: 1, remaster: true, athleticsBonus: 6 },
    enemies: [{ id: 'fighter', inReach: true, lineOfEffect: true, distance: 5, flanked: false, alliesInReach: 0, prone: false, trippable: true }],
    ...extra };
}
const choose = s => chooseWolfAction(s, profile).chosen;

test('wolf movement cannot value a blocked destination as a Pack Attack or flanking position',()=>{
  const s=state();s.enemies[0].inReach=false;s.enemies[0].distance=15;
  s.moves=[{x:1,y:0,kind:'stride',cost:5,targets:{fighter:{inReach:true,lineOfEffect:true,lineOfSight:false,flanked:true,alliesInReach:3,distance:5}}},
    {x:0,y:1,kind:'stride',cost:5,targets:{fighter:{inReach:true,lineOfEffect:true,lineOfSight:true,flanked:false,alliesInReach:0,distance:5}}}];
  assert.deepEqual(choose(s).destination,{x:0,y:1});
  assert.equal(buildWolfCandidates(s).find(c=>c.id==='stride:1,0').assessment.value,0);
});

test('wolf target choice and Knockdown setup account for cover and concealment',()=>{
  const s=state(),clear=s.enemies[0];
  s.enemies.push({...clear,id:'covered',coverBonus:4,concealmentDC:5});
  assert.equal(choose(s).targetId,'fighter');
  const clearSetup=strikeFollowUpEstimate(s,clear),coveredSetup=strikeFollowUpEstimate(s,s.enemies[1]);
  assert.ok(coveredSetup.hitChance<clearSetup.hitChance);
  const options=buildWolfCandidates(s).filter(c=>c.kind==='strike');
  assert.ok(options.find(c=>c.targetId==='covered').assessment.value<options.find(c=>c.targetId==='fighter').assessment.value);
});

test('PF2e check degrees include ±10 thresholds and natural 1/20 shifts', () => {
  assert.equal(checkDegree(20, 0, 30), 1);
  assert.equal(checkDegree(1, 30, 15), 2);
  assert.equal(checkDegree(15, 10, 15), 3);
  assert.equal(checkDegree(5, 0, 15), 0);
  assert.ok(expectedDamage(9, 15, 5.5) > expectedDamage(4, 15, 5.5));
  assert.ok(expectedDamage(4, 15, 5.5) > expectedDamage(-1, 15, 5.5));
});

test('damage averages reject unsupported expressions instead of evaluating arbitrary text', () => {
  assert.equal(averageFormula('1d6 + 2'), 5.5);
  assert.equal(averageFormula('2d6+1d4-2'), 7.5);
  assert.throws(() => averageFormula('1d6*2'), /Unsupported/);
});

test('two OTHER allies are required for Pack Attack damage', () => {
  const s = state();
  const base = buildWolfCandidates(s).find(c => c.kind === 'strike');
  s.enemies[0].alliesInReach = 1;
  const one = buildWolfCandidates(s).find(c => c.kind === 'strike');
  assert.equal(one.packAttack, false);
  assert.equal(one.features.expectedDamage, base.features.expectedDamage);
  s.enemies[0].alliesInReach = 2;
  const two = buildWolfCandidates(s).find(c => c.kind === 'strike');
  assert.equal(two.packAttack, true);
  assert.ok(two.features.expectedDamage > one.features.expectedDamage);
});

test('wolf selects a pack-supported target over an otherwise equal isolated enemy', () => {
  const s = state();
  s.enemies.push({ ...s.enemies[0], id: 'wizard', alliesInReach: 2 });
  assert.equal(choose(s).targetId, 'wizard');
});

test('Knockdown requires the immediately preceding successful jaws Strike on the same target', () => {
  const s = state({ attacksMade: 1, lastAction: { kind: 'strike', hit: true, targetId: 'fighter', strikeId: 'jaws' } });
  assert.equal(choose(s).kind, 'knockdown');
  for (const previous of [null, { kind: 'stride' }, { kind: 'strike', hit: false, targetId: 'fighter', strikeId: 'jaws' },
    { kind: 'strike', hit: true, targetId: 'other', strikeId: 'jaws' }, { kind: 'strike', hit: true, targetId: 'fighter', strikeId: 'claw' }]) {
    s.lastAction = previous;
    assert.equal(choose(s).kind, 'strike');
  }
});

test('wolf does not Knockdown prone, out-of-reach, or ineligible targets', () => {
  for (const change of [{ prone: true }, { trippable: false }, { inReach: false }, { lineOfEffect: false }]) {
    const s = state({ lastAction: { kind: 'strike', hit: true, targetId: 'fighter', strikeId: 'jaws' } });
    Object.assign(s.enemies[0], change);
    assert.notEqual(choose(s).kind, 'knockdown');
  }
});

test('remaster Knockdown competes with a bite using estimated Reflex and critical-failure consequences', () => {
  const s = state({ actionsRemaining: 2, attacksMade: 1, lastAction: { kind: 'strike', hit: true, targetId: 'fighter', strikeId: 'jaws' } });
  s.enemies[0].referenceReflexDC = 12;
  const favorable = knockdownEstimate(s, s.enemies[0]);
  assert.equal(choose(s).kind, 'knockdown');
  s.enemies[0].referenceReflexDC = 26;
  const difficult = knockdownEstimate(s, s.enemies[0]);
  assert.ok(difficult.value < favorable.value);
  assert.ok(difficult.odds.criticalFailure > favorable.odds.criticalFailure);
  assert.equal(choose(s).kind, 'strike');
  s.self.remaster = false;
  assert.equal(choose(s).kind, 'knockdown', 'legacy automatic Knockdown keeps its separate valuation');
});

test('Knockdown valuation includes nearby allies and the risk of having to Stand within reaction reach', () => {
  const s = state({ actionsRemaining: 2, attacksMade: 1 });
  const base = knockdownEstimate(s, s.enemies[0]);
  s.enemies[0].alliesInReach = 1;
  assert.ok(knockdownEstimate(s, s.enemies[0]).controlBenefit > base.controlBenefit);
  s.self.reactionRisk = 20;
  assert.ok(knockdownEstimate(s, s.enemies[0]).failureCost > base.failureCost);
  s.self.prone = true;
  assert.equal(knockdownEstimate(s, s.enemies[0]).failureCost, 0, 'already prone is not charged another fall');
});

test('being immobilized forbids Stand and movement but permits a bite unless also restrained', () => {
  const s = state();
  Object.assign(s.self, { prone: true, immobile: true });
  assert.equal(choose(s).kind, 'strike');
  assert.ok(!buildWolfCandidates(s).some(candidate => ['stand', 'step', 'stride', 'crawl'].includes(candidate.kind)));
  s.self.restrained = true;
  assert.equal(choose(s).kind, 'endTurn');
});

test('Stand precedes attacks; no attacks are generated with no actions or no targets', () => {
  const s = state(); s.self.prone = true;
  assert.equal(choose(s).kind, 'stand');
  assert.equal(choose(state({ actionsRemaining: 0 })).kind, 'endTurn');
  assert.equal(choose(state({ enemies: [] })).kind, 'endTurn');
});

test('wolf approaches out-of-reach enemies but does not stride repeatedly when in reach', () => {
  const s = state();
  s.enemies[0].distance = 25; s.enemies[0].inReach = false;
  s.moves = [{ x: 4, y: 0, cost: 20, path: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
    targets: { fighter: { distance: 5, inReach: true, flanked: false, alliesInReach: 0 } } }];
  assert.equal(choose(s).kind, 'stride');
  s.visited = ['4,0'];
  assert.equal(choose(s).kind, 'endTurn');
  s.visited = []; s.enemies[0].inReach = true;
  assert.equal(choose(s).kind, 'strike');
});

test('recovered DD lookahead may reposition for a stronger attack with three actions', () => {
  const s = state();
  s.enemies.push({ ...s.enemies[0], id: 'farther', distance: 35, inReach: false });
  s.moves = [{ x: 4, y: 0, cost: 20, path: [{ x: 0, y: 0 }, { x: 4, y: 0 }],
    targets: { fighter: { distance: 5, inReach: true, flanked: true, alliesInReach: 2 },
      farther: { distance: 5, inReach: true, flanked: true, alliesInReach: 2 } } }];
  assert.equal(choose(s).kind, 'stride');
  // With two fresh actions DD preserves immediate attacks in a higher layer.
  s.actionsRemaining = 2;
  assert.equal(choose(s).kind, 'strike');
  // After the first attack, the remaining MAP attack is considered worth setting up.
  s.attacksMade = 1;
  assert.equal(choose(s).kind, 'stride');
  s.actionsRemaining = 1;
  assert.equal(choose(s).kind, 'strike');
});

test('equal attacks beat movement, avoiding needless circling without a scoring improvement', () => {
  const s = state();
  s.moves = [{ x: 0, y: 1, cost: 5, path: [{ x: 0, y: 0 }, { x: 0, y: 1 }], targets: { fighter: { ...s.enemies[0] } } }];
  assert.equal(choose(s).kind, 'strike');
});

test('equal opponents can both be selected, independently of saved roster order', () => {
  const s = state();
  s.enemies.push({ ...s.enemies[0], id: 'magus' });
  assert.equal(chooseWolfAction(s, profile, { random: () => 0 }).chosen.targetId, 'fighter');
  assert.equal(chooseWolfAction(s, profile, { random: () => 0.99 }).chosen.targetId, 'magus');
});

test('movement values a future Strike at the existing MAP, with no borrowed Knockdown follow-up', () => {
  const s = state({ lastAction: { kind: 'strike', hit: true, targetId: 'fighter', strikeId: 'jaws' } });
  s.moves = [{ x: 1, y: 1, cost: 5, targets: { fighter: { ...s.enemies[0], flanked: true } } }];
  const movement = () => buildWolfCandidates(s).find(candidate => candidate.kind === 'stride');
  assert.ok(movement().assessment.value < 100);
  const firstAttackValue = movement().assessment.value;
  s.attacksMade = 2;
  assert.ok(movement().assessment.value < firstAttackValue);
  assert.equal(choose(s).kind, 'knockdown');
});

test('path search respects walls, occupied corners, cost budget, and detours', () => {
  const occupied = new Set(['1,0']);
  const paths = reachableCells({ x: 0, y: 0 }, 25, {
    canEnter: p => p.x >= 0 && p.y >= 0 && p.x <= 3 && p.y <= 3 && !occupied.has(`${p.x},${p.y}`),
    canTraverse: (a, b) => !(a.x === 0 && a.y === 1 && b.x === 1 && b.y === 1),
    pathCost: path => (path.length - 1) * 5,
  });
  assert.ok(!paths.some(p => p.x === 1 && p.y === 0));
  const around = paths.find(p => p.x === 2 && p.y === 0);
  assert.ok(around);
  assert.ok(around.cost <= 25);
  assert.ok(around.path.length > 3);
  assert.ok(!around.path.some(p => p.x === 1 && p.y === 0));
});

test('path search crosses passable ally squares without offering them as Stride destinations', () => {
  const search = (budget, wall = false) => reachableCells({ x: 0, y: 0 }, budget, {
    canEnter: cell => cell.x >= 0 && cell.x <= 3 && cell.y === 0,
    canStop: cell => cell.x !== 1,
    canTraverse: (from, to) => !(wall && from.x === 1 && to.x === 2),
    pathCost: path => (path.length - 1) * 5,
  });
  assert.deepEqual(search(5).map(cell => cell.x), [0], 'cannot spend a Stride ending on the ally');
  const beyond = search(10).find(cell => cell.x === 2);
  assert.equal(beyond.cost, 10, 'a willing ally adds no movement surcharge');
  assert.deepEqual(beyond.path, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.ok(!search(15).some(cell => cell.x === 1));
  assert.deepEqual(search(15, true).map(cell => cell.x), [0], 'passing an ally never bypasses walls');
});

test('passable allies beside a diagonal do not force the path around their corners', () => {
  const allies = new Set(['1,0', '0,1']);
  const cells = reachableCells({ x: 0, y: 0 }, 5, {
    canEnter: cell => cell.x >= 0 && cell.x <= 1 && cell.y >= 0 && cell.y <= 1,
    canStop: cell => !allies.has(`${cell.x},${cell.y}`),
    canTraverse: () => true,
    pathCost: path => (path.length - 1) * 5,
  });
  assert.equal(cells.find(cell => cell.x === 1 && cell.y === 1).cost, 5);
  assert.equal(cells.length, 2);
});

test('a Strike values a possible Knockdown only when it opens a useful new follow-up', () => {
  const s = state();
  const estimate = strikeFollowUpEstimate(s, s.enemies[0]);
  assert.ok(estimate.value > 0);
  assert.ok(estimate.hitChance > 0 && estimate.hitChance <= 1);
  assert.ok(Math.abs(estimate.value - estimate.hitChance * (estimate.followUpValue - estimate.alternativeValue)) < 1e-6);
  s.lastAction = { kind: 'strike', hit: true, targetId: 'fighter', strikeId: 'jaws' };
  assert.equal(strikeFollowUpEstimate(s, s.enemies[0]).value, 0, 'do not reward recreating an already available opening');
});

test('follow-up scoring changes target selection while respecting the remaining action budget', () => {
  const s = state();
  s.enemies[0].prone = true;
  s.enemies.push({ ...s.enemies[0], id: 'standing', prone: false, referenceReflexDC: 12 });
  assert.equal(choose(s).targetId, 'standing', 'a useful Knockdown opening can outweigh the easier prone target');
  s.actionsRemaining = 1;
  assert.equal(choose(s).targetId, 'fighter', 'with no follow-up action left, prefer the easier bite');
});

test('setup value excludes prone, untrippable, unreachable and improbable Knockdowns', () => {
  for (const change of [{ prone: true }, { trippable: false }, { inReach: false }, { lineOfEffect: false }, { referenceReflexDC: 40 }]) {
    const s = state();
    Object.assign(s.enemies[0], change);
    assert.equal(strikeFollowUpEstimate(s, s.enemies[0]).value, 0, JSON.stringify(change));
  }
  const s = state({ actionsRemaining: 1 });
  assert.equal(strikeFollowUpEstimate(s, s.enemies[0]).value, 0);
});

test('legacy automatic Knockdown provides a bounded setup value rather than its execution priority sentinel', () => {
  const s = state(); s.self.remaster = false;
  const estimate = strikeFollowUpEstimate(s, s.enemies[0]);
  assert.ok(estimate.value > 0 && estimate.value < 100);
  const strike = buildWolfCandidates(s).find(candidate => candidate.kind === 'strike');
  assert.ok(strike.assessment.value < 100);
});

test('moving pays its action before estimating a new Strike-Knockdown sequence', () => {
  const s = state();
  s.enemies[0].inReach = false;
  s.enemies[0].distance = 15;
  s.moves = [{ x: 1, y: 0, cost: 5, targets: { fighter: { ...s.enemies[0], inReach: true, distance: 5 } } }];
  const move = () => buildWolfCandidates(s).find(candidate => candidate.kind === 'stride');
  assert.ok(move().features.followUp.value > 0);
  s.actionsRemaining = 2;
  assert.equal(move().features.followUp.value, 0);
  s.actionsRemaining = 1;
  s.moves[0].kind = 'escapeStride';
  assert.ok(move() === undefined);
  const free = buildWolfCandidates(s).find(candidate => candidate.kind === 'escapeStride');
  assert.ok(free.assessment.value > 0, 'a zero-action Escape Stride leaves the final bite available');
});

function riskRoutes(budget, edgeRisk) {
  return reachableCells({ x: 0, y: 1 }, budget, {
    canEnter: p => p.x >= 0 && p.x <= 2 && p.y >= 0 && p.y <= 2,
    canTraverse: (a, b) => a.x === b.x || a.y === b.y,
    pathCost: path => (path.length - 1) * 5,
    edgeRisk,
  });
}

test('route search keeps a longer safe path instead of discarding it for a shorter provoking path', () => {
  const risk = from => ({ reactionIds: from.x === 1 && from.y === 1 ? ['fighter'] : [] });
  const safe = riskRoutes(20, risk).find(p => p.x === 2 && p.y === 1);
  assert.equal(safe.cost, 20);
  assert.equal(safe.risk.state, 0);
  assert.ok(!safe.path.some(p => p.x === 1 && p.y === 1));
  const necessary = riskRoutes(10, risk).find(p => p.x === 2 && p.y === 1);
  assert.equal(necessary.cost, 10);
  assert.deepEqual(necessary.risk.reactionIds, ['fighter']);
  assert.equal(necessary.risk.state, 1);
});

test('route choices refresh when a known reaction is no longer available', () => {
  let available = true;
  const risk = from => ({ reactionIds: available && from.x === 1 && from.y === 1 ? ['fighter'] : [] });
  assert.equal(riskRoutes(20, risk).find(p => p.x === 2 && p.y === 1).cost, 20);
  available = false;
  assert.equal(riskRoutes(20, risk).find(p => p.x === 2 && p.y === 1).cost, 10);
});

test('route states distinguish hazards and Tumble Through and count each reactor only once', () => {
  const cells = reachableCells({ x: 0, y: 0 }, 10, {
    canEnter: p => p.y === 0 && p.x >= 0 && p.x <= 2, canTraverse: () => true,
    pathCost: path => (path.length - 1) * 5,
    edgeRisk: () => ({ hazardous: true, tumbles: true, reactionIds: ['fighter', 'fighter'] }),
  });
  const end = cells.find(p => p.x === 2);
  assert.equal(end.risk.state, 7);
  assert.deepEqual(end.risk.reactionIds, ['fighter']);
});
