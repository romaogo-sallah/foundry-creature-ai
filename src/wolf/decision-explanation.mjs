// Compact, serializable record of the actual decision. Never reroll ties to
// explain an action that has already been selected or executed.
export function decisionExplanation(decision,{maxMovement=9}={}) {
  let movementRows = 0;
  const probabilities=new Map((decision.selection?.candidates??[]).map(candidate=>[candidate.id,candidate.probability]));
  const options = (decision.ranked ?? []).filter(entry => {
    if (!entry.candidate.assessment?.movement) return true;
    return entry.candidate.id === decision.chosen?.id || movementRows++ < maxMovement;
  }).map(({ candidate, layer, utility, terms }) => ({
    id: candidate.id, kind: candidate.kind, targetId: candidate.targetId ?? null,
    ...(candidate.spellName?{spellName:candidate.spellName,spellSlug:candidate.spellSlug,
      area:candidate.area?{shapes:candidate.area.shapes,targetIds:candidate.area.enemies.map(enemy=>enemy.id),bystanderIds:candidate.area.bystanders.map(token=>token.id)}:null}:{}),
    actionCost: candidate.actionCost ?? 0, bonusActionCost: candidate.bonusActionCost ?? 0,
    destination: candidate.destination ?? null, selected: candidate.id === decision.chosen?.id,
    selectionProbability:probabilities.get(candidate.id)??null,
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
    randomizedIds:decision.randomizedIds??[],selection:decision.selection??null,
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
