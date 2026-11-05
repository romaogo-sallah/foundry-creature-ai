import { targetKnowledge } from './target-memory.mjs';

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
  return { role: ranged ? 'ranged' : melee ? 'melee' : 'unknown', reach, speed: 25,
    source: ranged || melee ? 'visible weapons; benchmark movement' : 'unknown; benchmark movement' };
}

export function casterTargetKnowledge(adapter) {
  const combatId = game.combat.id, sceneId = canvas.scene.id;
  const saved = adapter.token.document.getFlag(namespace, 'casterTargets');
  const entries = { ...(saved?.combatId === combatId && saved.sceneId === sceneId ? saved.entries : {}) };
  for (const check of targetKnowledge(adapter).checks) {
    if (check.awareness?.state === 'observed' && check.target) entries[check.id] = apparentCombatRole(check.target.actor);
  }
  return { combatId, sceneId, entries };
}
