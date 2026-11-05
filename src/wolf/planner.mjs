import { recoveryCandidates } from '../framework/recovery.mjs';
import { seekCandidates } from '../framework/perception.mjs';
import { checkDegree, expectedDamage, checkProbabilities } from '../framework/math.mjs';
export { checkDegree, expectedDamage, checkProbabilities, averageFormula } from '../framework/math.mjs';
export { reachableCells, enemyDistances } from '../framework/navigation.mjs';
import { attackValue, PRIORITY, tileDistance } from '../dawnsbury/chooser.mjs';
import { chooseTacticalAction } from '../framework/tactical-behaviors.mjs';
import { sightGain, movementSight, investigationCandidates } from '../framework/pursuit.mjs';
import { showcaseBonus, strikeStyleTerms, retreatCandidates } from './playstyle.mjs';

// Remaster adaptation, not DD's legacy automatic-Knockdown sentinel. Predict
// outcomes against a benchmark Reflex DC, not an opponent's undiscovered base DC.
export function knockdownEstimate(state, enemy, { automatic = false } = {}) {
  const { self, actionsRemaining, attacksMade } = state;
  const dc = enemy.referenceReflexDC ?? self.referenceAC;
  const odds = automatic ? { criticalFailure: 0, failure: 0, success: 1, criticalSuccess: 0 } : checkProbabilities(self.athleticsBonus, dc);
  const damage = self.averageDamage + (enemy.alliesInReach >= 2 ? self.packDamage : 0);
  let followUps = 0;
  if (!enemy.offGuard && !enemy.flanked) {
    for (let i = 0; i < Math.max(0, actionsRemaining - 1); i++) {
      const bonus = self.attackBonus + self.mapPenalties[Math.min(attacksMade + i, 2)];
      followUps += expectedDamage(bonus, self.referenceAC - 2, damage) - expectedDamage(bonus, self.referenceAC, damage);
    }
    // One possible follow-up from each nearby ally, estimated using this wolf's
    // damage/accuracy. This does not assume every ally gets a full turn of attacks.
    followUps += enemy.alliesInReach * (expectedDamage(self.attackBonus, self.referenceAC - 2, damage) -
      expectedDamage(self.attackBonus, self.referenceAC, damage));
  }
  const controlBenefit = self.averageDamage + followUps;
  const failureCost = self.prone ? 0 : self.averageDamage + (self.reactionRisk ?? 0);
  const targetingChance = enemy.concealmentDC ? (21 - enemy.concealmentDC) / 20 : 1;
  const value = targetingChance * ((odds.success + odds.criticalSuccess) * controlBenefit + odds.criticalSuccess * 3.5 -
    odds.criticalFailure * failureCost) + (enemy.alliesInReach >= 2 ? 3.5 : 2);
  return { value: Math.fround(value), dc, odds, controlBenefit, failureCost };
}

function knockdownUnavailable(state, enemy, { afterHit = false } = {}) {
  if (!state.self.knockdown) return 'no supported Knockdown ability';
  if (state.self.restrained) return 'the wolf is restrained';
  if (enemy.awareness?.searchRequired&&!enemy.awareness.allowAttackEstimate) return 'Seek the remembered area before targeting an undetected enemy';
  if (enemy.lineOfSight === false) return 'line of sight is blocked from the attack position; pursue a clear position';
  if (!enemy.inReach || !enemy.lineOfEffect) return 'target is outside physical melee reach';
  if (enemy.prone) return 'target is already prone';
  if (!enemy.trippable) return 'target cannot be tripped by this wolf';
  if (state.actionsRemaining < state.self.knockdownCost) return 'insufficient actions for Knockdown';
  if (state.self.remaster !== false && !Number.isFinite(state.self.athleticsBonus)) return 'Athletics modifier is unavailable';
  const previous = state.lastAction;
  if (!afterHit && !(previous?.kind === 'strike' && previous.hit && previous.targetId === enemy.id && previous.strikeId === state.self.strikeId)) {
    return 'requires the immediately preceding successful jaws Strike against this target';
  }
  return null;
}

function strikeValue(state, enemy) {
  const { self, attacksMade } = state;
  return attackValue({ bonus: self.attackBonus + self.mapPenalties[Math.min(attacksMade, 2)], referenceAC: self.referenceAC,
    damage: self.averageDamage, defenseAdjustment: (enemy.coverBonus ?? 0) - (enemy.offGuard || enemy.prone || enemy.flanked ? 2 : 0),
    concealmentDC: enemy.concealmentDC, alliesInReach: enemy.alliesInReach, packTactic: true });
}

// DD's Grab/Rend hooks reward the attack that can enable a follow-up. For the
// Foundry wolf, estimate only the extra value over its next available bite;
// never copy legacy Grab's fixed +8 or automatic Knockdown's priority sentinel.
export function strikeFollowUpEstimate(state, enemy) {
  if (!knockdownUnavailable(state, enemy)) return { value: 0, reason: 'Knockdown is already available; another bite creates no new opening' };
  const after = { ...state, actionsRemaining: state.actionsRemaining - 1, attacksMade: state.attacksMade + 1,
    frontlineEngaged: state.frontlineEngaged || enemy.frontline,
    style: state.style ? { ...state.style, packShown: state.style.packShown || enemy.alliesInReach >= 2 } : undefined };
  const unavailable = knockdownUnavailable(after, enemy, { afterHit: true });
  if (unavailable) return { value: 0, reason: unavailable };
  const trip = knockdownEstimate(after, enemy, { automatic: state.self.remaster === false });
  const alternative = Math.max(0, ...state.enemies.filter(target => target.inReach && target.lineOfEffect)
    .map(target => strikeValue(after, target) + strikeStyleTerms(after, target).reduce((sum, term) => sum + term.contribution, 0)));
  const odds = checkProbabilities(state.self.attackBonus + state.self.mapPenalties[Math.min(state.attacksMade, 2)],
    state.self.referenceAC + (enemy.coverBonus??0) - (enemy.offGuard || enemy.prone || enemy.flanked ? 2 : 0));
  const hitChance = (odds.success + odds.criticalSuccess) * (enemy.concealmentDC ? (21-enemy.concealmentDC)/20 : 1);
  const followUpValue = trip.value + showcaseBonus(state);
  return { value: Math.fround(hitChance * Math.max(0, followUpValue - alternative)), hitChance,
    followUpValue, alternativeValue: alternative, reason: 'possible Knockdown after a hit; includes showcase preference when enabled' };
}

export function buildWolfCandidates(state) {
  const { self, enemies, actionsRemaining, attacksMade } = state;
  const candidates = [{ id: 'end', kind: 'endTurn', actionCost: 0, legal: true, fallback: true, features: {}, assessment: { value: 0 } }];
  if ((actionsRemaining < 1 && !state.freeEscapeStride) || self.unable || state.retreatComplete) return candidates;
  candidates.push(...seekCandidates(state));
  const map = self.mapPenalties[Math.min(attacksMade, 2)];
  const valueOfStrike = (enemy, context = state) => {
    const base = strikeValue(context, enemy), followUp = strikeFollowUpEstimate(context, enemy);
    return { value: Math.fround(base + followUp.value), base, followUp };
  };
  for (const enemy of enemies) {
    if (state.morale?.broken || self.restrained || !enemy.inReach || !enemy.lineOfEffect || enemy.lineOfSight===false) continue;
    const pack = enemy.alliesInReach >= 2;
    const average = self.averageDamage + (pack ? self.packDamage : 0);
    const strike = valueOfStrike(enemy);
    const styleTerms = strikeStyleTerms(state, enemy);
    candidates.push({
      id: `strike:${enemy.id}`, kind: 'strike', targetId: enemy.id, strikeId: self.strikeId,
      actionCost: 1, legal: true, packAttack: pack,
      assessment: { value: Math.fround(strike.value + styleTerms.reduce((sum, term) => sum + term.contribution, 0)) },
      scoringTerms: [{ label: 'Dawnsbury attack value (includes pack preference)', contribution: strike.base },
        { label: 'Knockdown setup beyond the next bite', contribution: strike.followUp.value }, ...styleTerms],
      features: {
        // Informational PF2e damage estimate. Ranking uses the recovered DD score above.
        expectedDamage: expectedDamage(self.attackBonus + map, self.referenceAC + (enemy.coverBonus??0) - (enemy.offGuard || enemy.prone || enemy.flanked ? 2 : 0), average) *
          (enemy.concealmentDC ? (21-enemy.concealmentDC)/20 : 1),
        followUp: strike.followUp, packAllies: enemy.alliesInReach, frontline: Boolean(enemy.frontline),
      },
    });
    const followUp = !knockdownUnavailable(state, enemy);
    const tripEstimate = followUp && self.remaster !== false && Number.isFinite(self.athleticsBonus) ? knockdownEstimate(state, enemy) : null;
    if (followUp && (self.remaster === false || tripEstimate)) candidates.push({
      id: `knockdown:${enemy.id}`, kind: 'knockdown', targetId: enemy.id, actionCost: self.knockdownCost,
      legal: true, features: { followUpAvailable: 1 },
      assessment: { value: self.remaster === false ? PRIORITY : Math.fround(tripEstimate.value + showcaseBonus(state)) }, estimate: tripEstimate,
      scoringTerms: [{ label: self.remaster === false ? 'Legacy automatic Knockdown priority' : 'Expected Knockdown control and consequences',
        contribution: self.remaster === false ? PRIORITY : tripEstimate.value },
        { label: 'Show Knockdown (once this combat)', contribution: self.remaster === false ? 0 : showcaseBonus(state) }],
    });
  }
  candidates.push(...recoveryCandidates(state, { canStrike: candidates.some(candidate => candidate.kind === 'strike') }));
  if (state.morale?.broken) return [...candidates, ...retreatCandidates(state)];
  if (self.immobile || !enemies.length) return candidates;
  const nearest = state.nearestEnemy ?? Math.min(...enemies.map(enemy => enemy.distance / 5));
  for (const move of state.moves ?? []) {
    if (move.cost <= 0 || state.visited?.includes(`${move.x},${move.y}`)) continue;
    let bestValue = 0, targetId, intent = 'approach', bestStrike;
    const context = { ...state, actionsRemaining: actionsRemaining - (move.kind === 'escapeStride' ? 0 : 1), lastAction: null,
      enemies: enemies.map(target => ({ ...target, ...move.targets[target.id] })) };
    for (const enemy of enemies) {
      const after = move.targets[enemy.id];
      if (!after?.inReach || after.lineOfEffect === false || after.lineOfSight===false || context.actionsRemaining < 1 || self.restrained) continue;
      // CalculateTileGoodness evaluates usable non-movement actions after paying
      // for ONE move. A move interrupts Knockdown eligibility and does not add MAP.
      const enemyAfter = { ...enemy, ...after };
      const strike = valueOfStrike(enemyAfter, context);
      strike.value += strikeStyleTerms(context, enemyAfter).reduce((sum, term) => sum + term.contribution, 0);
      if (strike.value > bestValue) {
        bestValue = strike.value; bestStrike = strike; targetId = enemy.id;
        intent = after.flanked && !enemy.flanked ? 'flank' : after.alliesInReach >= 2 ? 'join pack' : 'approach';
      }
    }
    const regain = sightGain(state, move), sight = movementSight(state, move);
    if (regain.value) { bestValue += regain.value; targetId ??= regain.targetId; intent = 'regain sight of known square'; }
    const distances = Object.values(move.targets).map(target => target.distance / 5).filter(Number.isFinite);
    const nearestEnemy = move.nearestEnemy ?? (distances.length ? Math.min(...distances) : nearest);
    const improvesPosition = nearestEnemy < nearest || enemies.some(enemy => {
        const after = move.targets[enemy.id];
        return after?.inReach && (after.flanked && !enemy.flanked || after.alliesInReach >= 2 && enemy.alliesInReach < 2);
      });
    const routeRisk=(move.reactionRisk??0)+(move.terrainRisk??0);
    if (move.kind === 'escapeStride' && (!improvesPosition || routeRisk>0&&routeRisk >= bestValue)) continue;
    candidates.push({
      id: `${move.kind ?? 'stride'}:${move.x},${move.y}`, kind: move.kind ?? 'stride', actionCost: move.kind === 'escapeStride' ? 0 : 1, legal: true,
      targetId, destination: { x: move.x, y: move.y }, path: move.path, movementCost: move.cost, intent,
      provokes: move.kind !== 'step' && Boolean(move.provokes ?? self.threatened), destinationThreatened: move.destinationThreatened,
      features: { routeRisk: move.risk, followUp: bestStrike?.followUp, visibility:sight, destinationSightTargets:sight.after },
      scoringTerms: [{ label: 'Best attack after moving (includes available follow-up)', contribution: bestValue - regain.value },
        ...(regain.value ? [{ label: 'Regain sight of known enemy square', contribution: regain.value }] : []),
        { label: 'Known movement reaction exposure', contribution: -(move.reactionRisk ?? 0) },
        { label: 'Known hazardous terrain exposure', contribution: -(move.terrainRisk??0) },
        { label: 'Losing sight of every known target', contribution: -sight.penalty },
        { label: 'Returning to the turn starting square', contribution: -sight.returnPenalty },
        { label: 'Minimum movement value', contribution: Math.max(0, routeRisk+sight.penalty+sight.returnPenalty - bestValue) }],
      assessment: { value: Math.max(0, bestValue - routeRisk-sight.penalty-sight.returnPenalty), movement: true, step: move.kind === 'step',
        goodAttacksLeft: move.kind === 'escapeStride' || actionsRemaining === 3 || (actionsRemaining === 2 && attacksMade > 0),
        nearestEnemy, currentNearestEnemy: nearest,
        distanceMoved: self.cell ? tileDistance(move, self.cell) : move.cost / 5,
        reachSquares: self.reachSquares ?? 1 },
    });
  }
  return [...candidates,...investigationCandidates(state,candidates)];
}

export function chooseWolfAction(state, profile, { random = Math.random } = {}) {
  const decision = chooseTacticalAction(buildWolfCandidates(state), state, { actionsRemaining: state.actionsRemaining, threatened: state.self.threatened, random });
  for (const enemy of state.enemies) {
    const strikeReason = state.morale?.broken ? 'the pack has broken and is retreating' : state.actionsRemaining < 1 ? 'insufficient actions' : state.self.restrained ? 'the wolf is restrained' :
      enemy.awareness?.searchRequired&&!enemy.awareness.allowAttackEstimate ? 'Seek the remembered area before targeting an undetected enemy' :
      enemy.lineOfSight === false ? 'line of sight is blocked from the attack position; pursue a clear position' :
      !enemy.inReach || !enemy.lineOfEffect ? 'target is outside physical melee reach' : null;
    if (strikeReason) decision.rejected.push({ id: `strike:${enemy.id}`, kind: 'strike', targetId: enemy.id, reason: strikeReason });
    const tripReason = state.morale?.broken ? 'the pack has broken and is retreating' : knockdownUnavailable(state, enemy);
    if (tripReason) decision.rejected.push({ id: `knockdown:${enemy.id}`, kind: 'knockdown', targetId: enemy.id, reason: tripReason });
  }
  return decision;
}

