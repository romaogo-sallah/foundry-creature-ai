import { checkProbabilities, expectedDamage } from './math.mjs';
import { controlRelevance, spellReserveCost } from './caster-tactics.mjs';
import {conditionCastingCandidates} from './condition-spells.mjs';

// Native adapters establish geometry and available resources. Evaluation uses
// the encounter benchmark, never a target's hidden saves, AC or secret rolls.
export function basicSaveValue(dc, referenceSave, damage) {
  const odds = checkProbabilities(referenceSave, dc);
  return damage * (odds.criticalFailure * 2 + odds.failure + odds.success * 0.5);
}

export function spellTargetValue(state, spell, target, position = target) {
  if (position.lineOfSight === false || position.lineOfEffect === false || position.distance > spell.range ||
    (target.awareness?.searchRequired && !target.awareness.allowAttackEstimate && !target.awareness.attackOnSight) || state.self.restrained) return 0;
  const flat = position.concealmentDC ? (21 - position.concealmentDC) / 20 : 1;
  const defense = (position.coverBonus ?? 0) - (target.prone || target.offGuard ? 2 : 0);
  const bonus = spell.bonus - 5 * Math.min(2, state.attacksMade);
  if (spell.kind === 'damage-attack') return expectedDamage(bonus, state.self.referenceAC + defense, spell.damage) * flat;
  if (spell.kind === 'control-attack') {
    if (target.tangled || target.immobilized) return 0;
    const odds = checkProbabilities(bonus, state.self.referenceAC + defense);
    // Control matters when a known opponent can close on the caster or its
    // visible allies. A distant stationary opponent is a poor control target.
    const pressure = controlRelevance(target, position);
    return (odds.success * 4 + odds.criticalSuccess * 8) * pressure * flat;
  }
  return 0;
}

export function spellAreaValue(state, spell, area) {
  const referenceSave = state.self.referenceAC - 10;
  const value = (creature, ally = false) => {
    if (spell.kind === 'basic-save') return basicSaveValue(spell.dc, referenceSave + (creature.coverBonus ?? 0), spell.damage);
    if (spell.kind === 'ground-control') {
      if (creature.greased || creature.airborne) return 0;
      const odds = checkProbabilities(referenceSave, spell.dc);
      const fall = creature.prone ? 0 : (odds.failure + odds.criticalFailure) * 7;
      // Falling now and crossing the persistent surface later are distinct.
      // A prone ally must still Stand and leave; it is not a free spell target.
      const terrain = creature.immobilized ? 0 : ally ? 3 + Number(Boolean(creature.prone)) :
        1.5 * controlRelevance(creature);
      return fall + terrain;
    }
    return 0;
  };
  const enemies = area.enemies.reduce((sum, enemy) => sum + value(enemy), 0);
  const allies = area.bystanders.reduce((sum, ally) => sum + value(ally, true), 0) * 2;
  const approaches = new Map((area.approaches ?? []).map(enemy => [enemy.id,enemy]));
  const preparation = spell.kind !== 'ground-control' || !state.casterDefense?.enabled || state.casterDefense.preparedGrease ? 0 :
    Math.min(6,[...approaches.values()].filter(enemy => !area.enemies.some(inside => inside.id === enemy.id) &&
      enemy.tactics?.role === 'melee' && enemy.awareness?.state === 'observed' && !enemy.greased && !enemy.airborne && !enemy.immobilized)
      .reduce((sum,enemy) => sum + 3.8 * Math.min(1,30/Math.max(30,enemy.distance)),0));
  return { value: enemies + preparation - allies, enemies, allies, preparation };
}

export function castingCandidates(state, { showcase = true } = {}) {
  if (state.self.unable || state.self.restrained || state.retreatComplete || state.morale?.broken) return [];
  return [...conditionCastingCandidates({...state,spells:state.spells.filter(s=>s.kind==='condition-save')}),...state.spells.flatMap(spell => {
    if (spell.actionCost > state.actionsRemaining || !spell.available) return [];
    const reserve = spellReserveCost(state, spell);
    const show = showcase && state.style?.enabled && !state.shownSpells?.[spell.slug]
      ? Math.min(2, state.style.showcaseBonus ?? 0) : 0;
    const result = [];
    if (spell.kind.endsWith('attack')) for (const enemy of state.enemies) {
      const melee = spell.slug === 'ignition' && enemy.distance <= state.self.reachSquares * 5;
      const selected = melee ? { ...spell, damage: spell.meleeDamage } : spell;
      const value = spellTargetValue(state, selected, enemy);
      if (value > 0) result.push({ id: `cast:${spell.id}:${enemy.id}:${melee ? 'melee' : 'ranged'}`, kind: 'castSpell', spellId: spell.id,
        spellSlug: spell.slug, spellName: spell.name, melee, targetId: enemy.id, legal: true, actionCost: spell.actionCost,
        mapIncreases: 1, provokes: true, features: { spell: true }, assessment: { value: value - reserve + show },
        scoringTerms: [{ label: 'Spell attack or control value', contribution: value }, { label: 'Save limited spell slots', contribution: -reserve },
          { label: 'Show this spell once', contribution: show }] });
    }
    else for (const area of spell.areas ?? []) {
      if (!area.enemies.length && !area.approaches?.length) continue;
      const score = spellAreaValue(state, spell, area);
      // Signature preferences cannot turn an ineffective or harmful area into
      // a useful cast. They also never cancel the signed friendly-fire cost.
      if (score.value <= reserve) continue;
      result.push({ id: `cast:${spell.id}:${area.id}`, kind: 'castSpell', spellId: spell.id, spellSlug: spell.slug, spellName: spell.name,
        area, targetId: (area.enemies[0] ?? area.approaches[0]).id, legal: true, actionCost: spell.actionCost, mapIncreases: 0, provokes: true,
        features: { spell: true, preparation: !area.enemies.length }, assessment: { value: score.value - reserve + show },
        scoringTerms: [{ label: 'Area damage or ground control', contribution: score.enemies },
          { label: 'Prepare a slippery approach lane', contribution: score.preparation },
          { label: 'Friendly fire and bystander risk', contribution: -score.allies },
          { label: 'Save limited spell slots', contribution: -reserve }, { label: 'Show this spell once', contribution: show }] });
    }
    return result;
  })];
}
