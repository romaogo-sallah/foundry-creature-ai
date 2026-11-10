import { targetKnowledge } from './target-memory.mjs';
import {witnessedThreat} from './spell-observations.mjs';

const namespace = 'foundry-creature-ai';

// Infer a working role from visible weapons, not a hidden spell list, defenses,
// remaining ammunition, HP or secret rolls. A ranged weapon is evidence of an
// alternative to closing; it is not a promise about the opponent's next turn.
export function apparentCombatRole(actor) {
  const strikes = (actor.system.actions ?? []).filter(action => action.type === 'strike' &&
    (!action.item?.system?.equipped || action.item.system.equipped.carryType === 'held'));
  const ranged = strikes.some(action => action.item?.isRanged);
  const melee = strikes.some(action => action.item?.isMelee);
  const reach = Math.max(5, ...strikes.filter(action => action.item?.isMelee).map(action => action.item.reach ?? 5));
  const increments=strikes.filter(action=>action.item?.isRanged).map(action=>action.item.system?.range?.increment).filter(value=>Number.isFinite(value)&&value>0);
  return { role: ranged ? 'ranged' : melee ? 'melee' : 'unknown', reach, speed: 25,...increments.length?{rangeIncrement:Math.max(...increments)}:{},
    source: ranged || melee ? 'visible weapons; benchmark movement' : 'unknown; benchmark movement' };
}

export function casterTargetKnowledge(adapter) {
  const combatId = game.combat.id, sceneId = canvas.scene.id;
  const saved = adapter.token.document.getFlag(namespace, 'casterTargets');
  const entries = { ...(saved?.combatId === combatId && saved.sceneId === sceneId ? saved.entries : {}) };
  for (const check of targetKnowledge(adapter).checks) {
    if (check.awareness?.state === 'observed' && check.target) {
      const actor=check.target.actor,traits=actor.system.traits?.value??[];
      // Table policy: an observed undead/construct body is recognizable as
      // nonliving. This supplies target categories, never its hidden defenses.
      const knownModeOfBeing=traits.includes('undead')?'undead':traits.includes('construct')?'construct':undefined;
      entries[check.id] = {...apparentCombatRole(actor),...witnessedThreat(adapter.token,check.id),knownModeOfBeing};
    }
  }
  return { combatId, sceneId, entries };
}
