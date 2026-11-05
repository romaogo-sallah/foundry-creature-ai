// Compact, serializable record of the actual decision. Never reroll ties to
// explain an action that has already been selected or executed.
export function decisionExplanation(decision) {
  let movementRows = 0;
  const options = (decision.ranked ?? []).filter(entry => {
    if (!entry.candidate.assessment?.movement) return true;
    return entry.candidate.id === decision.chosen?.id || movementRows++ < 9;
  }).map(({ candidate, layer, utility, terms }) => ({
    id: candidate.id, kind: candidate.kind, targetId: candidate.targetId ?? null,
    ...(candidate.spellName?{spellName:candidate.spellName,spellSlug:candidate.spellSlug,
      area:candidate.area?{shapes:candidate.area.shapes,targetIds:candidate.area.enemies.map(enemy=>enemy.id),bystanderIds:candidate.area.bystanders.map(token=>token.id)}:null}:{}),
    actionCost: candidate.actionCost ?? 0, bonusActionCost: candidate.bonusActionCost ?? 0,
    destination: candidate.destination ?? null, selected: candidate.id === decision.chosen?.id,
    layer, value: utility, movement: Boolean(candidate.assessment?.movement),
    goodAttacksLeft: candidate.assessment?.goodAttacksLeft ?? null,
    nearestEnemy: candidate.assessment?.nearestEnemy ?? null, distanceMoved: candidate.assessment?.distanceMoved ?? null,
    provokes: Boolean(candidate.provokes), packAllies: candidate.features?.packAllies ?? null,
    routeRisk: candidate.features?.routeRisk ?? null,
    visibility: candidate.features?.visibility ?? null,
    terms: (terms ?? []).map(term => ({ label: term.label, contribution: term.contribution })),
    followUp: candidate.features?.followUp ?? null,
    plan: candidate.features?.plan ?? candidate.features?.turnPlan ?? null,
    groupGoal: candidate.features?.groupGoal ?? null,
    tactical: candidate.features?.tactical ?? null,
  }));
  return { chosenId: decision.chosen?.id ?? null, reason: decision.reason ?? '', tiedIds: decision.tiedIds ?? [],
    options, totalOptions: decision.ranked?.length ?? 0,
    rejected: [...(decision.rejected ?? []), ...(decision.diagnostics?.rejectedTargets ?? []).map(target => ({
      id: target.id, kind: 'target', name: target.name, reason: target.reason,
    }))], movementBlocked: decision.diagnostics?.movementBlocked ?? null,
    manualAbilities: decision.diagnostics?.manualAbilities ?? [],
    pursuitTargets: decision.diagnostics?.pursuitTargets ?? [],
    environmentTargets: decision.diagnostics?.environmentTargets ?? [],
    frontlineAnalysis: decision.diagnostics?.frontlineAnalysis ?? [],
    tactic: decision.diagnostics?.tactic ?? null };
}
