import { CapabilityRegistry } from '../framework/registry.mjs';
import { attackValue, tileDistance, PRIORITY } from '../dawnsbury/chooser.mjs';
import { expectedDamage, checkProbabilities } from '../framework/math.mjs';
import { recoveryCandidates } from '../framework/recovery.mjs';
import { retreatCandidates } from '../wolf/playstyle.mjs';
import { sightGain, movementSight } from '../framework/pursuit.mjs';
import { seekCandidates } from '../framework/perception.mjs';

export const ogreBossProfile = { id: 'ogre-boss', label: 'Ogre Boss', roles: ['bruiser', 'leader'], encounterRole: 'boss',
  capabilities: ['recovery', 'perception', 'strikes', 'trip-follow-up', 'sweep', 'command', 'equipment', 'movement'] };

const suppressed = state => state.retreatComplete || state.self.unable || state.actionsRemaining < 1;
const style = (state, enemy) => state.style?.enabled && enemy.frontline && !state.frontlineEngaged ? 1.5 : 0;
const showcase = (state, id) => state.style?.enabled && !state.shownAbilities?.[id] ? state.style.showcaseBonus ?? 4 : 0;
export function strikeScore(state, strike, enemy, { prepared = false } = {}) {
  const position = enemy.strikes?.[strike.id];
  if (!position || enemy.lineOfSight===false || position.lineOfSight===false || position.lineOfEffect===false ||
    !(position.usable || prepared && position.inReach && position.lineOfEffect)) return null;
  const map = strike.mapPenalties[Math.min(state.attacksMade, 2)];
  const estimate = { bonus: strike.bonus + map - (position.rangePenalty ?? 0), referenceAC: state.self.referenceAC,
    damage: strike.damage, defenseAdjustment: (position.coverBonus ?? 0) - (enemy.prone || enemy.offGuard || position.flanked ? 2 : 0), concealmentDC: position.concealmentDC };
  const base = attackValue(estimate);
  // Range already lowers hit chance. Bruisers additionally conserve their
  // limited missiles when accuracy is poor instead of treating a remote throw
  // as an adequate substitute for closing to their much stronger melee attack.
  // This is a planning preference, never an extra modifier to the actual roll.
  const penalty = strike.ranged ? position.rangePenalty ?? 0 : 0;
  const accuracyLost = penalty > 0 ? Math.max(0, attackValue({ ...estimate, bonus: estimate.bonus + penalty }) - base) : 0;
  const rangeCost = Math.min(base * 0.9, accuracyLost * Math.min(1, penalty / 4));
  const sweep = position.sweepBonus ? attackValue({ ...estimate, bonus: estimate.bonus + position.sweepBonus }) - base : 0;
  const front = style(state, enemy);
  return { value: Math.fround(base + sweep + front - rangeCost), base, sweep, front, rangeCost, position };
}

// A bounded future-position value lets a bruiser advance even when spending
// this action leaves too few actions for Draw + Strike. It uses legal route
// progress and known target geometry, without inventing another move or attack.
export function ogreRangeApproach(state, move) {
  const none = { value: 0 };
  if (state.self.restrained || state.enemies.some(enemy => enemy.strikes?.[state.hookId]?.usable)) return none;
  const melee = state.strikes.find(strike => strike.id === state.hookId);
  if (!melee || !(state.groundSpeed > 0)) return none;
  const throws = state.strikes.filter(strike => strike.ranged && Number.isFinite(rangedPreparationCost(state, strike)))
    .flatMap(strike => state.enemies.flatMap(enemy => {
      const score = strikeScore(state, strike, enemy, { prepared: true });
      return score ? [{ enemy, score }] : [];
    }));
  // A useful nearby throwing target still supports normal ranged play.
  if (!throws.length || throws.some(({ score }) => (score.position.rangePenalty ?? 0) < 4)) return none;
  const oneGoal = new Set(throws.map(({ enemy }) => enemy.id)).size === 1;
  const progress = Number.isFinite(state.nearestEnemy) && Number.isFinite(move.nearestEnemy)
    ? Math.max(0, state.nearestEnemy - move.nearestEnemy) * 5 : 0;
  if (!progress) return none;
  let best = none;
  for (const { enemy, score } of throws) {
    const after = move.targets[enemy.id];
    if (!after || after.lineOfSight === false || after.lineOfEffect === false || enemy.awareness?.searchRequired) continue;
    // The route field leads to the nearest usable melee goal. With several
    // opponents, do not credit that progress to an opponent we are leaving.
    // A single goal can still need a temporarily sideways/backward detour.
    if (!oneGoal && !(after.distance < enemy.distance)) continue;
    const penalty = score.position.rangePenalty;
    const severity = Math.min(1, (penalty - 2) / 4);
    const futureMelee = attackValue({ bonus: melee.bonus, damage: melee.damage, referenceAC: state.self.referenceAC,
      defenseAdjustment: after.coverBonus ?? 0, concealmentDC: after.concealmentDC });
    const value = futureMelee * 0.75 * severity * Math.min(1, progress / state.groundSpeed);
    if (value > best.value) best = { value, targetId: enemy.id, rangePenalty: penalty, progress };
  }
  return best;
}

export function rangedPreparationCost(state, strike) {
  if (!strike.ranged) return Infinity;
  const refuse = strike.id === state.refuseId;
  if (!((refuse ? state.refuseCount : state.javelins) > 0)) return Infinity;
  if (refuse ? state.javelinHeld : state.refuseHeld) return Infinity;
  return (refuse ? state.refuseHeld : state.javelinHeld) ? 0 : 1;
}
export function rangedPreparationScore(state, strike, enemy) {
  if (!Number.isFinite(rangedPreparationCost(state, strike))) return 0;
  return (strikeScore(state, strike, enemy, { prepared: true })?.value ?? 0) * 0.75;
}

export const ogreCapabilities = new CapabilityRegistry()
  .registerCapability('perception',seekCandidates)
  .registerCapability('recovery', state => {
    const result = [{ id: 'end', kind: 'endTurn', actionCost: 0, legal: true, features: {}, assessment: { value: 0 } }];
    if (!suppressed(state)) result.push(...recoveryCandidates(state, { canStrike: !state.self.restrained &&
      state.enemies.some(enemy => state.strikes.some(strike => enemy.strikes?.[strike.id]?.usable)) }));
    return result;
  })
  .registerCapability('strikes', state => {
    if (suppressed(state) || state.morale?.broken || state.self.restrained) return [];
    return state.strikes.flatMap(strike => state.enemies.flatMap(enemy => {
      const score = strikeScore(state, strike, enemy);
      return score ? [{ id: `strike:${strike.id}:${enemy.id}`, kind: 'strike', strikeId: strike.id, targetId: enemy.id,
        actionCost: 1, mapIncreases: 1, legal: true, provokes: strike.ranged,
        features: { frontline: enemy.frontline, ranged: strike.ranged, ...(score.position.sweepBonus ? { sweepBonus: score.position.sweepBonus } : {}) }, assessment: { value: score.value },
        scoringTerms: [{ label: 'Dawnsbury attack value', contribution: score.base },
          ...(score.rangeCost ? [{ label: `Conserve ammunition at poor ranged accuracy (-${score.position.rangePenalty})`, contribution: -score.rangeCost }] : []),
          ...(score.position.sweepBonus ? [{ label: 'Sweep +1 against a different target', contribution: score.sweep }] : []),
          { label: 'Let the front line hold attention (once this turn)', contribution: score.front }] }] : [];
    }));
  })
  .registerCapability('trip-follow-up', state => {
    if (suppressed(state) || state.morale?.broken || state.self.restrained || !state.hookReady) return [];
    const hook = state.strikes.find(strike => strike.id === state.hookId);
    return state.enemies.flatMap(enemy => {
      if (enemy.prone || !enemy.trippable || !enemy.strikes?.[state.hookId]?.inReach || !enemy.lineOfEffect) return [];
      const odds = checkProbabilities(state.self.athleticsBonus - Math.min(state.attacksMade, 2) * 5, enemy.referenceReflexDC ?? state.self.referenceAC);
      const hit = odds.success + odds.criticalSuccess;
      const nextMap = hook.mapPenalties[Math.min(state.attacksMade + 1, 2)];
      const reaction = state.sweepingAvailable ? hit * expectedDamage(hook.bonus + nextMap, state.self.referenceAC - 2, hook.damage) : 0;
      const control = hit * (state.self.averageDamage * 0.75 + Math.max(0, state.actionsRemaining - 1) * 1.5);
      const fall = odds.criticalFailure * (state.self.prone ? 0 : state.self.averageDamage);
      const critical = odds.criticalSuccess * 3.5, show = showcase(state, 'trip');
      const targetingChance = enemy.concealmentDC ? (21 - enemy.concealmentDC) / 20 : 1;
      return [{ id: `trip:${enemy.id}`, kind: 'trip', targetId: enemy.id, strikeId: hook.id,
        actionCost: 1, mapIncreases: 1, legal: true, assessment: { value: (control + reaction + critical - fall) * targetingChance + show },
        estimate: { odds, dc: enemy.referenceReflexDC ?? state.self.referenceAC },
        scoringTerms: [{ label: 'Prone control', contribution: control }, { label: 'Sweeping Hook follow-up at next MAP', contribution: reaction },
          { label: 'Targeting flat check adjustment', contribution: (control + reaction + critical - fall) * (targetingChance - 1) },
          { label: 'Critical Trip damage', contribution: critical }, { label: 'Critical failure fall', contribution: -fall },
          { label: 'Show Trip and Sweeping Hook', contribution: show }] }];
    });
  })
  .registerCapability('command', state => {
    if (suppressed(state) || state.morale?.broken || !state.commandRecipients?.length || state.commandedThisTurn) return [];
    const benefit = state.commandRecipients.filter(ally => ally.needsMovement).length * 5 + state.commandRecipients.length;
    const show = showcase(state, 'bellow');
    return [{ id: 'bellow', kind: 'bellow', actionCost: 1, legal: true, recipientIds: state.commandRecipients.map(ally => ally.id),
      assessment: { value: benefit + show }, features: {},
      scoringTerms: [{ label: 'Extra movement for ogre allies', contribution: benefit }, { label: 'Show Bellowing Command', contribution: show }] }];
  })
  .registerCapability('sweep', state => {
    const trigger = state.pendingSweep;
    if (!trigger || !state.sweepingAvailable || !state.hookReady || state.self.restrained || state.morale?.broken) return [];
    const enemy = state.enemies.find(enemy => enemy.id === trigger.targetId);
    if (!enemy?.strikes?.[state.hookId]?.usable) return [];
    return [{ id: `sweep:${enemy.id}`, kind: 'sweepingHook', targetId: enemy.id, strikeId: state.hookId,
      actionCost: 0, mapIncreases: 1, legal: true, features: {}, assessment: { value: PRIORITY },
      scoringTerms: [{ label: 'Immediate Sweeping Hook reaction after successful hook Trip', contribution: PRIORITY }] }];
  })
  .registerCapability('equipment', state => {
    if (suppressed(state) || state.morale?.broken || state.self.restrained) return [];
    const hookTarget = state.enemies.some(enemy => enemy.strikes?.[state.hookId]?.inReach && enemy.lineOfEffect);
    const readyForReaction = state.reactiveStrikeAvailable && state.enemies.some(enemy => enemy.lineOfEffect &&
      enemy.distance <= state.hookReach + state.groundSpeed);
    const result = [];
    if (!state.hookReady && !state.javelinHeld && (hookTarget || readyForReaction)) result.push({ id: 'regrip', kind: 'regrip', actionCost: 1,
      legal: true, provokes: true, assessment: { value: state.self.averageDamage },
      scoringTerms: [{ label: hookTarget ? 'Restore two-handed hook use' : 'Ready the hook for Reactive Strike against nearby enemies', contribution: state.self.averageDamage }] });
    if (state.javelinHeld && hookTarget) result.push({ id: 'stow', kind: 'stow', actionCost: 1, legal: true, provokes: true,
      assessment: { value: state.actionsRemaining >= 2 ? state.self.averageDamage * 0.75 : 0.01 },
      scoringTerms: [{ label: 'Stow javelin to free the hook hand', contribution: state.actionsRemaining >= 2 ? state.self.averageDamage * 0.75 : 0.01 }] });
    if (!hookTarget && !state.javelinHeld && state.javelins > 0 && state.actionsRemaining >= 2 && state.enemies.some(enemy => enemy.distance <= state.throwRange && enemy.lineOfEffect)) {
      const value = Math.max(0,...state.strikes.filter(strike=>strike.ranged).flatMap(strike=>state.enemies.map(enemy=>rangedPreparationScore(state,strike,enemy))));
      result.push({ id: 'draw-javelin', kind: 'drawJavelin', actionCost: 1, legal: true, provokes: true,
        assessment: { value }, scoringTerms: [{ label: 'Prepare a legal thrown attack', contribution: value }] });
    }
    return result;
  })
  .registerCapability('movement', state => {
    if (state.retreatComplete || state.self.unable || state.self.immobile) return [];
    if (state.morale?.broken) return retreatCandidates(state).map(candidate => state.bonusMovementActions > 0 && ['step', 'stride'].includes(candidate.kind)
      ? { ...candidate, id: `quickened:${candidate.id}`, actionCost: 0, bonusActionCost: 1 } : candidate);
    if (state.actionsRemaining < 1 && !state.freeEscapeStride && !state.bonusMovementActions) return [];
    const nearest = state.nearestEnemy ?? Math.min(...state.enemies.map(enemy => enemy.distance / 5));
    return (state.moves ?? []).flatMap(move => {
      if (!move.cost || state.visited?.includes(`${move.x},${move.y}`)) return [];
      const useBonus = state.bonusMovementActions > 0 && ['step', 'stride'].includes(move.kind);
      const remaining = state.actionsRemaining - Number(move.kind !== 'escapeStride' && !useBonus);
      let value = 0, targetId, rangedFollowUp = false;
      if (remaining > 0 && !state.self.restrained) for (const enemy of state.enemies) {
        const after = { ...enemy, ...move.targets[enemy.id] };
        for (const strike of state.strikes) {
          const preparation = strike.ranged ? rangedPreparationCost(state,strike) : 0;
          if(remaining<=preparation)continue;
          const score = strikeScore(state, strike, after,{prepared:strike.ranged});
          const future = preparation ? rangedPreparationScore(state,strike,after) : score?.value??0;
          if (future > value) { value = future; targetId = enemy.id; rangedFollowUp = strike.ranged; }
        }
      }
      const approach = ogreRangeApproach(state, move);
      const pursue = approach.value > value;
      if (pursue) { value = approach.value; targetId = approach.targetId; rangedFollowUp = false; }
      const regain = sightGain(state, move), sight = movementSight(state, move);
      value += regain.value; targetId ??= regain.targetId;
      const risk = (move.kind === 'step' ? 0 : move.reactionRisk ?? 0)+(move.terrainRisk??0);
      const scored = Math.max(0, value - risk - sight.penalty-sight.returnPenalty);
      if (!value && (move.nearestEnemy ?? nearest) >= nearest) return [];
      return [{ id: `${useBonus ? 'quickened:' : ''}${move.kind}:${move.x},${move.y}`, kind: move.kind,
        actionCost: move.kind === 'escapeStride' || useBonus ? 0 : 1, ...(useBonus ? { bonusActionCost: 1 } : {}),
        legal: true, targetId, destination: { x: move.x, y: move.y }, path: move.path, movementCost: move.cost,
        intent: regain.value ? 'regain sight of known square' : pursue ? 'close distance before spending more ammunition' : rangedFollowUp ? 'improve throwing range and firing lane' : 'control reach', provokes: move.kind !== 'step' && move.provokes, destinationThreatened: move.destinationThreatened,
        features: { routeRisk: move.risk, rangedFollowUp, ...(pursue ? { rangeApproach: approach } : {}), visibility:sight, destinationSightTargets:sight.after }, assessment: { value: scored, movement: true, step: move.kind === 'step',
          ...(pursue ? { fullTurnPlan: true } : {}),
          goodAttacksLeft: rangedFollowUp || useBonus || move.kind === 'escapeStride' || state.actionsRemaining === 3 || state.actionsRemaining === 2 && state.attacksMade > 0,
          nearestEnemy: move.nearestEnemy ?? nearest, currentNearestEnemy: nearest,
          distanceMoved: state.self.cell ? tileDistance(move, state.self.cell) : move.cost / 5, reachSquares: state.self.reachSquares },
        scoringTerms: [{ label: pursue ? 'Advance toward effective melee range instead of a poor throw' : 'Best attack from destination', contribution: value - regain.value }, { label: 'Movement reaction exposure', contribution: -risk },
          { label: 'Losing sight of every known target', contribution: -sight.penalty },
          { label: 'Returning to the turn starting square', contribution: -sight.returnPenalty },
          ...(regain.value ? [{ label: 'Regain sight of known enemy square', contribution: regain.value }] : []),
          { label: 'Movement minimum', contribution: scored - value + risk + sight.penalty+sight.returnPenalty }] }];
    });
  })
  .registerProfile(ogreBossProfile);
