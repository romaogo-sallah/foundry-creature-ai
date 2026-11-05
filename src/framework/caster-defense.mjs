export function waitingCaster(state) {
  if (!state.casterDefense?.enabled || (state.casterDefense.holdTurns ?? 0) >= 2 || state.enemies.some(enemy => enemy.awareness?.searchRequired)) return false;
  const visible = state.enemies.filter(enemy => enemy.lineOfSight !== false && enemy.lineOfEffect !== false);
  return visible.length > 0 && visible.every(enemy => enemy.tactics?.role === 'melee' &&
    enemy.distance > (state.casterDefense.engagementRange ?? 30));
}

export function casterProtection(state) {
  if (!state.casterDefense?.enabled || !state.enemies.length) return 0;
  // Normalize across opponents: adding more distant spectators must not make
  // shopping for a different protected square outweigh every useful spell.
  const values = state.enemies.map(enemy => Math.min(4, enemy.incoming?.coverBonus ?? 0) * 0.4 +
    (enemy.incoming?.concealed ? 1.2 : 0) + (enemy.stealthChance ?? 0) * 1.5);
  return Math.min(3.5, values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function casterHideCandidates(state) {
  if (!state.casterDefense?.canHide || state.casterDefense.hideAttempted || state.actionsRemaining < 1 || state.self.restrained) return [];
  const enemies = state.enemies.map(enemy => ({ ...enemy, stealthChance: enemy.incoming?.canHide ?
    Math.max(enemy.stealthChance ?? 0, enemy.hideChance ?? 0) : enemy.stealthChance ?? 0 }));
  const value = casterProtection({ ...state, enemies }) - casterProtection(state);
  if (value <= 0.01) return [];
  return [{ id: 'caster:hide', kind: 'hide', legal: true, actionCost: 1,
    assessment: { value }, features: { casterDefense: true },
    scoringTerms: [{ label: 'Estimated defensive benefit of Hide', contribution: value }] }];
}
