import { tileDistance } from '../dawnsbury/chooser.mjs';
import { movementSight, sightGain } from './pursuit.mjs';
import { casterPressure } from './caster-tactics.mjs';
import { casterProtection, waitingCaster } from './caster-defense.mjs';

function afterAction(state, action) {
  const spell = state.spells.find(spell => spell.id === action.spellId);
  const spellSlots = state.spellSlots - (spell && !spell.cantrip ? 1 : 0);
  return { ...state, actionsRemaining: state.actionsRemaining - action.actionCost,
    plannedCapabilities:[...(state.plannedCapabilities??[]),...(action.features?.onceKey?[action.features.onceKey]:[]),...(action.features?.blocksForecast??[])],
    casterDefense: { ...state.casterDefense, hideAttempted: state.casterDefense?.hideAttempted || action.kind === 'hide',
      preparedGrease: state.casterDefense?.preparedGrease || spell?.kind === 'ground-control' },
    enemies: state.enemies.map(enemy => ({ ...enemy, stealthChance: action.kind === 'hide' ?
      enemy.incoming?.canHide ? Math.max(enemy.stealthChance ?? 0, enemy.hideChance ?? 0) : enemy.stealthChance ?? 0 :
      ['castSpell', 'strike'].includes(action.kind) ? 0 : enemy.stealthChance ?? 0,
      hideChance: ['castSpell', 'strike'].includes(action.kind) ? enemy.freshHideChance ?? enemy.hideChance : enemy.hideChance })),
    attacksMade: state.attacksMade + (action.mapIncreases ?? 0), spellSlots,
    shownSpells: spell ? { ...state.shownSpells, [spell.slug]: true } : state.shownSpells,
    spells: state.spells.map(spell => ({ ...spell, available: spell.available && (spell.cantrip || spellSlots > 0) })) };
}

function moveState(state, move) {
  return { ...state, actionsRemaining: state.actionsRemaining - 1,
    self: { ...state.self, cell: { x: move.x, y: move.y }, threatened: Boolean(move.destinationThreatened) },
    nearestEnemy: move.nearestEnemy, spells: (move.spells ?? state.spells).map(spell => ({ ...spell,
      available: spell.available && (spell.cantrip || state.spellSlots > 0) })),
    enemies: state.enemies.map(enemy => ({ ...enemy, ...move.targets[enemy.id],
      stealthChance: move.kind === 'step' && move.targets[enemy.id]?.incoming?.canHide ? enemy.stealthChance ?? 0 : 0,
      hideChance: move.kind === 'step' ? move.targets[enemy.id]?.hideChance : move.targets[enemy.id]?.freshHideChance })) };
}

function movementValue(state, move) {
  const after = moveState(state, move), sight = movementSight(state, move), regain = sightGain(state, move);
  const relief = Math.max(0, casterPressure(state.enemies) - casterPressure(after.enemies));
  // Ignore marginal distance shopping. A small shuffle should not keep the
  // caster circling whenever a pursuer moves one square closer.
  const escape = relief >= 1.5 ? relief : 0;
  const enter = Math.max(0, casterPressure(after.enemies) - casterPressure(state.enemies));
  const risk = (move.kind === 'step' ? 0 : move.reactionRisk ?? 0) + (move.terrainRisk ?? 0);
  const defense = casterProtection(after) - casterProtection(state);
  return { after, sight, regain, escape, enter, risk, defense,
    value: escape - enter + defense + regain.value - risk - sight.penalty - sight.returnPenalty };
}

const allowedMove = (state, move) => !state.self.immobile && move.cost > 0 &&
  !state.visited?.includes(`${move.x},${move.y}`);
const summary = action => ({ kind: action.kind, actionCost: action.actionCost,
  spellSlug: action.spellSlug, targetId: action.targetId, destination: action.destination });

// A small remaining-turn forecast, not a simulated roll. Effects, hits, deaths,
// saves and secret outcomes are never assumed. Execution commits ONE action and
// replans from the resulting live state, including reactions and spell terrain.
export function casterTurnCandidates(state, { actions }) {
  function rankedActions(current) {
    return actions(current).map(action => {
      const castingRisk = action.kind === 'castSpell' && current.self.threatened ? current.self.reactionRisk ?? 0 : 0;
      const reveal = ['castSpell', 'strike'].includes(action.kind) ?
        Math.max(0, casterProtection(current) - casterProtection(afterAction(current, action))) : 0;
      return { ...action, assessment: { ...action.assessment, value: action.assessment.value - castingRisk - reveal },
        scoringTerms: [...(action.scoringTerms ?? []), ...(castingRisk ? [{ label: 'Known reaction exposure while casting', contribution: -castingRisk }] : []),
          ...(reveal ? [{ label: 'Give up defensive hiding to act', contribution: -reveal }] : [])] };
    });
  }
  function stationaryPlan(current) {
    let best = { value: 0, sequence: [] };
    if (current.actionsRemaining <= 0) return best;
    for (const action of rankedActions(current)) {
      if (action.actionCost <= 0 || action.actionCost > current.actionsRemaining) continue;
      const next = stationaryPlan(afterAction(current, action));
      const value = action.assessment.value + next.value;
      if (value > best.value) best = { value, sequence: [summary(action), ...next.sequence] };
    }
    return best;
  }
  const immediate = rankedActions(state).map(action => {
    const after = afterAction(state, action);
    let follow = stationaryPlan(after);
    // A ground-control spell changes paths and Balance checks. Do not forecast
    // movement using stale pre-cast terrain; the next real snapshot handles it.
    const changesTerrain = state.spells.find(spell => spell.id === action.spellId)?.kind === 'ground-control';
    if (after.actionsRemaining > 0 && !changesTerrain) for (const move of state.moves) {
      if (!allowedMove(after, move)) continue;
      const position = movementValue(after, move);
      const next = stationaryPlan(position.after), value = position.value + next.value;
      if (value > follow.value) follow = { value, sequence: [summary({ ...move, actionCost: 1,
        destination: { x: move.x, y: move.y } }), ...next.sequence] };
    }
    return { ...action, assessment: { ...action.assessment, value: action.assessment.value + follow.value },
      features: { ...action.features, turnPlan: [summary(action), ...follow.sequence] },
      scoringTerms: [...action.scoringTerms, ...(follow.value > 0 ? [{
        label: `Affordable follow-up: ${follow.sequence.map(step => step.spellSlug ?? step.kind).join(' → ')}`,
        contribution: follow.value }] : [])] };
  });
  const moves = [];
  const canCastNextTurn = stationaryPlan({ ...state, actionsRemaining: 3 }).sequence.length > 0;
  if (state.actionsRemaining > 0) for (const move of state.moves) {
    if (!allowedMove(state, move)) continue;
    const position = movementValue(state, move), follow = stationaryPlan(position.after);
    if (waitingCaster(state) && position.defense <= 0.25 && !position.escape && !position.regain.value) continue;
    if (!follow.sequence.length && position.value <= 0 &&
      (canCastNextTurn || move.nearestEnemy >= state.nearestEnemy)) continue;
    const value = follow.value + position.value;
    // Never turn a dangerous route into a favorable zero-value approach.
    if (value < 0) continue;
    const first = follow.sequence[0];
    const choice = { id: `caster:${move.kind}:${move.x},${move.y}`, kind: move.kind, legal: true, actionCost: 1,
      destination: { x: move.x, y: move.y }, path: move.path, movementCost: move.cost,
      targetId: first?.targetId ?? position.regain.targetId,
      intent: position.escape ? 'make room to cast' : position.defense > 0.25 ? 'take a protected casting position' : first ? 'find a spellcasting angle' : 'approach spell range',
      provokes: move.kind !== 'step' && move.provokes, destinationThreatened: move.destinationThreatened,
      features: { casterPosition: true, defensiveSetup: position.defense > 0.25, destinationSightTargets: position.sight.after, visibility: position.sight },
      assessment: { value, movement: true, step: move.kind === 'step', fullTurnPlan: true,
        goodAttacksLeft: follow.sequence.length > 0, nearestEnemy: move.nearestEnemy, currentNearestEnemy: state.nearestEnemy,
        reachSquares: state.self.reachSquares, distanceMoved: tileDistance(move, state.self.cell) },
      scoringTerms: [{ label: 'Affordable actions after moving', contribution: follow.value },
        { label: 'Leave plausible melee pressure', contribution: position.escape },
        { label: 'Avoid entering melee pressure', contribution: -position.enter },
        { label: 'Cover, concealment and defensive hiding', contribution: position.defense },
        { label: 'Movement and sight risks', contribution: -position.risk - position.sight.penalty - position.sight.returnPenalty },
        { label: 'Regain sight', contribution: position.regain.value }] };
    choice.features.turnPlan = [summary(choice), ...follow.sequence];
    moves.push(choice);
  }
  return [...immediate, ...moves];
}
