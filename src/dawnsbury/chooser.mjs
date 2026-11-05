// Behavioral reconstruction from the installed Dawnsbury Days 4.44 AI classes.
// Provenance, adaptations, and unsupported branches: docs/dawnsbury-ai-behavior.md.
// Rules adapters supply legal options; this module ranks those options only.
export const PRIORITY = 2 ** 30;

const standardACs = [15, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 30, 31, 34, 35, 36, 37, 38, 40, 43, 44];
export function standardArmorClass(level) { return standardACs[level + 1] ?? 15; }

// Tile.DistanceTo uses alternating diagonal distance, distinct from the enemy
// flood's one-step diagonal edges and from terrain-adjusted movement cost.
export function tileDistance(a, b) {
  const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
  return Math.max(dx, dy) + Math.floor(Math.min(dx, dy) / 2);
}

// This is a decision score, NOT a PF2e roll/damage resolver. In particular,
// Dawnsbury's evaluator uses a bounded hit chance without explicit critical damage.
export function attackValue({ bonus, referenceAC, damage, defenseAdjustment = 0, alliesInReach = 0,
  packTactic = false, mindless = false, concealmentDC = null }) {
  if (mindless) return Math.fround(damage * 0.5);
  const chance = Math.min(20, Math.max(1, 21 + bonus - referenceAC - defenseAdjustment));
  let value = Math.fround(Math.fround(damage * chance) / 20);
  if (concealmentDC != null) value = Math.fround(value * Math.fround((21 - concealmentDC) / 20));
  // The game's count includes the attacker. The Foundry snapshot counts OTHER allies.
  if (packTactic) value = Math.fround(value + (alliesInReach >= 2 ? 3.5 : 2));
  return value;
}

export function priorityLayer(option) {
  const { value = 0, movement = false, goodAttacksLeft = false,
    nearestEnemy = 0, currentNearestEnemy } = option;
  let layer = 1;
  // Foundry scout/caster plans compare the remaining turn, including survival;
  // their retreats must be comparable with attacks over the same action budget.
  if (value > 0) layer = !movement || goodAttacksLeft || option.fullTurnPlan ? 6 : 5;
  else if ((value === 0 && movement && currentNearestEnemy != null && nearestEnemy < currentNearestEnemy) ||
    Math.abs(value + 1337) < 1) layer = 4;
  else if (value === 0) layer = movement ? 3 : 2;
  return layer + Number(value >= 5000);
}

/** Positive means a is preferred. Distances use grid squares, rather than feet. */
export function compareOptions(a, b) {
  const layer = priorityLayer(a), otherLayer = priorityLayer(b);
  const primary = layer - otherLayer || a.value - b.value || Number(Boolean(b.movement)) - Number(Boolean(a.movement));
  if (primary) return primary;
  if (layer <= 4) {
    const reach = a.reachSquares ?? b.reachSquares ?? 1;
    const distance = reach >= 2
      ? Math.abs((b.nearestEnemy ?? 0) - 2) - Math.abs((a.nearestEnemy ?? 0) - 2)
      : (b.nearestEnemy ?? 0) - (a.nearestEnemy ?? 0);
    if (distance) return distance;
  }
  return (b.distanceMoved ?? 0) - (a.distanceMoved ?? 0) || Number(Boolean(a.step)) - Number(Boolean(b.step));
}

/** Shared chooser, including the game's threat/tie/Step/door branches when supplied. */
export function chooseOption(candidates, { actionsRemaining, bonusMovementActions = 0, threatened = false, random = Math.random, override } = {}) {
  if (!Number.isInteger(actionsRemaining) || actionsRemaining < 0) throw new Error('Invalid action budget');
  const ranked = [], rejected = [], ids = new Set();
  for (const candidate of candidates) {
    if (!candidate.id || ids.has(candidate.id)) throw new Error('Candidates require unique IDs');
    ids.add(candidate.id);
    let reason;
    if (candidate.legal !== true) reason = 'legality not confirmed by adapter';
    else if (!Number.isInteger(candidate.actionCost) || candidate.actionCost < 0) reason = 'invalid action cost';
    else if (candidate.actionCost > actionsRemaining) reason = 'insufficient actions';
    else if ((candidate.bonusActionCost ?? 0) > bonusMovementActions || !Number.isInteger(candidate.bonusActionCost ?? 0) || (candidate.bonusActionCost ?? 0) < 0) reason = 'restricted movement action unavailable';
    else if (candidate.bonusActionCost && !['stride', 'step'].includes(candidate.kind)) reason = 'restricted action can only Step or Stride';
    else if (!Number.isFinite(candidate.assessment?.value)) reason = 'invalid assessment';
    if (reason) rejected.push({ id: candidate.id, reason });
    else ranked.push({ candidate, utility: candidate.assessment.value, layer: priorityLayer(candidate.assessment), terms: candidate.scoringTerms ?? [] });
  }
  const legal = ranked.map(entry => entry.candidate);
  ranked.sort((a, b) => compareOptions(b.candidate.assessment, a.candidate.assessment));
  if (!ranked.length) return { chosen: null, ranked, rejected, reason: 'no legal options', tiedIds: [] };
  const forced = override?.(legal);
  if (forced != null) {
    if (!ranked.some(entry => entry.candidate === forced)) throw new Error('Creature override must return a supplied legal option');
    return { chosen: forced, ranked, rejected, reason: 'creature override', tiedIds: [forced.id] };
  }
  const best = ranked[0].candidate;
  let pool = ranked.filter(entry => compareOptions(entry.candidate.assessment, best.assessment) === 0).map(entry => entry.candidate);
  let reason = 'dawnsbury ranking';
  if (threatened) {
    const safe = pool.filter(candidate => !candidate.provokes);
    if (safe.length) { pool = safe; reason = 'dawnsbury ranking; nonprovoking tie'; }
    else if (actionsRemaining >= 3) {
      const steps = legal.filter(candidate => candidate.assessment.step &&
        candidate.assessment.value === best.assessment.value && priorityLayer(candidate.assessment) === priorityLayer(best.assessment) &&
        candidate.destinationThreatened === false);
      if (steps.length) { pool = steps; reason = 'dawnsbury safe Step'; }
    }
  }
  // The original returns immediately from either threat branch, ahead of the door branch.
  if (reason === 'dawnsbury ranking' && priorityLayer(best.assessment) <= 4 &&
    best.assessment.nearestEnemy >= best.assessment.currentNearestEnemy) {
    const door = legal.find(candidate => candidate.kind === 'openDoor');
    if (door) { pool = [door]; reason = 'dawnsbury open door'; }
  }
  const roll = pool.length > 1 ? random() : 0;
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1) throw new Error('Random source must return a number in [0, 1)');
  return { chosen: pool[Math.floor(roll * pool.length)], ranked, rejected,
    reason: `${reason}${pool.length > 1 ? '; random tie' : ''}`, tiedIds: pool.map(candidate => candidate.id) };
}
