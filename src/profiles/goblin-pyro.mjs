import { attackValue } from '../dawnsbury/chooser.mjs';
import { chooseTacticalAction } from '../framework/tactical-behaviors.mjs';
import { recoveryCandidates } from '../framework/recovery.mjs';
import { castingCandidates } from '../framework/spell-evaluation.mjs';
import { seekCandidates } from '../framework/perception.mjs';
import { investigationCandidates } from '../framework/pursuit.mjs';
import { casterTurnCandidates } from '../framework/caster-planning.mjs';
import { casterHideCandidates, waitingCaster } from '../framework/caster-defense.mjs';

export const PYRO_SOURCE = 'Compendium.pf2e.pathfinder-monster-core.Actor.Ky5eNRvN71O0tY9l';
function pyroActions(state) {
  const candidates = [...castingCandidates(state), ...casterHideCandidates(state)];
  if (state.actionsRemaining > 0 && !state.self.restrained && state.torchReady!==false) for (const enemy of state.enemies) {
    if (!enemy.inReach || !enemy.lineOfEffect || enemy.lineOfSight === false) continue;
    const parameters = { bonus: state.self.attackBonus + state.self.mapPenalties[Math.min(2, state.attacksMade)],
      damage: state.self.averageDamage, referenceAC: state.self.referenceAC,
      defenseAdjustment: (enemy.coverBonus ?? 0) - (enemy.prone || enemy.offGuard || enemy.flanked ? 2 : 0), concealmentDC: enemy.concealmentDC };
    const chance = enemy.stealthChance ?? 0, normal = attackValue(parameters);
    const hidden = enemy.prone || enemy.offGuard || enemy.flanked ? normal : attackValue({...parameters,defenseAdjustment:parameters.defenseAdjustment-2});
    const value = normal + chance * (hidden-normal);
    // Two-action spells need a fair comparison with one-action torch attacks.
    candidates.push({ id: `torch:${enemy.id}`, kind: 'strike', strikeId: state.self.strikeId, targetId: enemy.id,
      legal: true, actionCost: 1, mapIncreases: 1, assessment: { value }, scoringTerms: [{ label: 'Torch Strike', contribution: value }] });
  }
  return candidates;
}
export function pyroCandidates(state) {
  const candidates = [{ id: 'end', kind: 'endTurn', actionCost: 0, legal: true, assessment: { value: 0 } }];
  if (state.self.unable || state.retreatComplete) return candidates;
  if (state.actionsRemaining > 0) candidates.push(...recoveryCandidates(state, { canStrike: state.enemies.some(e => e.inReach) }));
  candidates.push(...seekCandidates(state), ...casterTurnCandidates(state, { actions: pyroActions }));
  return [...candidates, ...investigationCandidates(state, candidates)];
}
export function choosePyroAction(state) {
  const decision=chooseTacticalAction(pyroCandidates(state),state,{actionsRemaining:state.actionsRemaining,threatened:state.self.threatened});
  const holdForApproach = decision.chosen?.kind === 'endTurn' && waitingCaster(state);
  if (holdForApproach) decision.chosen.features = { ...decision.chosen.features, holdForApproach: true };
  const turnComplete=decision.chosen?.kind==='endTurn'&&(state.actionsRemaining===1||holdForApproach)&&!state.self.immobile&&!state.self.restrained&&
    !state.diagnostics.movementBlocked&&(holdForApproach||state.enemies.some(enemy=>enemy.lineOfSight!==false&&enemy.distance<=30));
  return {...decision,diagnostics:{...state.diagnostics,...decision.diagnostics,turnComplete,holdForApproach}};
}
