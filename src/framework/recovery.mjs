import { expectedDamage, checkProbabilities } from './math.mjs';
import { PRIORITY } from '../dawnsbury/chooser.mjs';

export function recoveryCandidates(state, { canStrike = false } = {}) {
  const { self, actionsRemaining, attacksMade } = state, candidates = [];
  const map = self.mapPenalties[Math.min(attacksMade, 2)];
  const sickened=state.sickenedRecovery;
  if(sickened?.available&&actionsRemaining>0){
    const odds=checkProbabilities(sickened.bonus,sickened.dc);
    const value=(odds.success+2*odds.criticalSuccess)*Math.min(2,sickened.value)*
      (2+Math.max(0,actionsRemaining-1)*self.averageDamage*0.08);
    candidates.push({id:'retch',kind:'retch',legal:true,actionCost:1,assessment:{value},
      scoringTerms:[{label:'Recover own Sickened penalties (source DC, Fortitude odds)',contribution:value}]});
  }
  if (self.prone && !self.immobile && self.canStand !== false) {
    const accuracyBenefit = expectedDamage(self.attackBonus + 2 + map, self.referenceAC, self.averageDamage) -
      expectedDamage(self.attackBonus + map, self.referenceAC, self.averageDamage);
    const value = !self.threatened && (actionsRemaining > 1 || !canStrike) ? PRIORITY :
      self.threatened ? Math.max(0, self.averageDamage + (actionsRemaining - 1) * accuracyBenefit - (self.reactionRisk ?? self.averageDamage)) : 0;
    candidates.push({ id: 'stand', kind: 'stand', actionCost: 1, legal: true, features: {}, provokes: true, assessment: { value },
      scoringTerms: [{ label: value === PRIORITY ? 'Safe recovery priority' : 'Stand benefit minus known reaction exposure', contribution: value }] });
  }
  if (!state.escapeBlocked) for (const escape of state.escapes ?? []) {
    const bonus = escape.bonus - Math.min(attacksMade, 2) * 5, odds = checkProbabilities(bonus, escape.dc);
    const benefit = self.averageDamage * (self.restrained || !canStrike ? 3 : 1);
    const value = Math.fround(Math.max(0.01, (odds.success + odds.criticalSuccess) * benefit - odds.criticalFailure * self.averageDamage));
    candidates.push({ id: `escape:${escape.id}`, kind: 'escape', escapeId: escape.id,
      statistic: escape.statistic, actionCost: 1, mapIncreases: 1, legal: true,
      assessment: { value }, estimate: { dc: escape.dc, bonus, odds },
      scoringTerms: [{ label: 'Escape success benefit minus critical-failure cost', contribution: value }] });
  }
  return candidates;
}
