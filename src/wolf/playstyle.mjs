// Encounter pacing preferences are explicit Foundry additions, not PF2e rules
// or extracted Dawnsbury formulas. They never generate an otherwise illegal action.
export function showcaseBonus(state) {
  return state.style?.enabled && !state.style.knockdownShown ? state.style.showcaseBonus ?? 4 : 0;
}

export function strikeStyleTerms(state, enemy) {
  if (!state.style?.enabled) return [];
  return [
    { label: 'Let the front line hold attention (once this turn)', contribution: enemy.frontline && !state.frontlineEngaged ? 1.5 : 0 },
    { label: 'Show Pack Attack (once this combat)', contribution: enemy.alliesInReach >= 2 && !state.style.packShown ? 1 : 0 },
  ];
}

export function assessPackMorale(previous, members) {
  const roster = [...(previous?.members ?? [])];
  for (const member of members) if (!roster.some(entry => entry.id === member.id)) {
    roster.push({ id: member.id, hp: Math.max(1, member.maxHP ?? member.hp) });
  }
  const current = new Map(members.map(member => [member.id, member]));
  const alive = roster.filter(entry => current.get(entry.id)?.alive);
  const lost = roster.length - alive.length;
  const capacity = roster.reduce((sum, entry) => sum + entry.hp, 0);
  const remaining = alive.reduce((sum, entry) => sum + Math.min(entry.hp, Math.max(0, current.get(entry.id).hp)), 0);
  let reason = previous?.broken ? previous.reason : null;
  if (!reason && roster.length >= 2 && lost >= Math.ceil(roster.length / 2)) reason = 'at least half the pack is down';
  if (!reason && roster.length >= 2 && capacity > 0 && remaining / capacity <= 0.35) reason = 'the pack has 35% or less of its starting HP capacity';
  if (!reason && roster.length === 1 && remaining / capacity <= 0.25) reason = 'the lone wolf has 25% or less HP';
  return { members: roster, broken: Boolean(previous?.broken || reason), reason,
    alive: alive.length, lost, hpFraction: capacity > 0 ? remaining / capacity : 1 };
}

export function retreatCandidates(state) {
  if (!state.morale?.broken || state.self.immobile) return [];
  const candidates = [];
  for (const move of state.moves ?? []) {
    if (move.cost <= 0 || state.visited?.includes(`${move.x},${move.y}`)) continue;
    const exitProgress = Number.isFinite(state.retreatDistance) && Number.isFinite(move.retreatDistance)
      ? state.retreatDistance - move.retreatDistance : null;
    const separation = Object.values(move.targets).map(target => target.distance / 5).filter(Number.isFinite);
    const currentSeparation = state.enemies.length ? Math.min(...state.enemies.map(enemy => enemy.distance / 5)) : 0;
    const awayProgress = separation.length ? Math.min(...separation) - currentSeparation : 0;
    const progress = exitProgress ?? awayProgress;
    if (!(progress > 0)) continue;
    const risk = move.kind === 'step' ? 0 : move.reactionRisk ?? 0;
    const benefit = 20 + progress * 5, value = Math.max(0.01, benefit - risk);
    candidates.push({ id: `${move.kind ?? 'stride'}:${move.x},${move.y}`, kind: move.kind ?? 'stride',
      actionCost: move.kind === 'escapeStride' ? 0 : 1, legal: true,
      destination: { x: move.x, y: move.y }, path: move.path, movementCost: move.cost, intent: 'retreat',
      provokes: move.kind !== 'step' && Boolean(move.provokes), destinationThreatened: move.destinationThreatened,
      features: { routeRisk: move.risk, retreat: true },
      scoringTerms: [{ label: exitProgress == null ? 'Retreat away from known enemies' : 'Progress toward a safe scene edge', contribution: benefit },
        { label: 'Known movement reaction exposure', contribution: -risk },
        { label: 'Retreat minimum', contribution: value - (benefit - risk) }],
      assessment: { value, movement: true, goodAttacksLeft: true, step: move.kind === 'step', distanceMoved: move.cost / 5 },
    });
  }
  return candidates;
}
