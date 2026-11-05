const clamp = value => Math.max(0, Math.min(1, value));

// These descriptors contain apparent/remembered roles, never opposing check
// results or defenses. Unknown opponents use the encounter's ordinary melee model.
export function controlRelevance(target, position = target) {
  const { role = 'unknown', reach = 5, speed = 25 } = target.tactics ?? {};
  if (role === 'ranged') return position.distance <= reach ? 0.6 : 0.2;
  if (role === 'melee') return position.distance <= reach + speed ? 1.25 : 0.5;
  return position.distance <= 30 ? 1 : 0.25;
}

export function casterPressure(enemies) {
  const pressures = enemies.map(enemy => {
    const { role = 'unknown', reach = 5, speed = 25 } = enemy.tactics ?? {};
    const weight = role === 'ranged' ? 0.25 : 1;
    // This is uncertain positional benefit, not damage automatically prevented:
    // the opponent can pursue or attack somebody else after the retreat.
    return weight * 3 * clamp((reach + speed - enemy.distance) / Math.max(5, speed));
  }).sort((a, b) => b - a);
  // One pursuer's pressure cannot grow merely because it remains within 25 ft.
  // Additional pursuers matter, with a bound on this positional preference.
  return Math.min(6, (pressures[0] ?? 0) + pressures.slice(1).reduce((sum, p) => sum + p * 0.25, 0));
}

export function spellReserveCost(state, spell) {
  if (spell.cantrip) return 0;
  const reserve = 2.5 + Math.max(0, 2 - state.spellSlots);
  // Only the caster's own HP is used. Losing the fight makes saving the last
  // slot less attractive, without awarding utility to an ineffective spell.
  const health = clamp(state.self.hpFraction ?? 1);
  return reserve * (0.35 + 0.65 * health);
}
