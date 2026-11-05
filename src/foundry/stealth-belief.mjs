import { checkProbabilities } from '../framework/math.mjs';

const namespace = 'foundry-creature-ai';
const context = () => ({ combatId: game.combat?.started ? game.combat.id : null, sceneId: canvas.scene?.id });
const chance = value => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const entry = value => ({ observerId: value.observerId, unseenChance: chance(value.unseenChance),
  undetectedChance: Math.min(chance(value.unseenChance), chance(value.undetectedChance)) });

// This is the subject's estimate, deliberately separate from the GM's secret
// results. Never accept a die, rolled total, actual Perception DC or degree.
export function stealthBelief(subject) {
  const saved = subject.document.getFlag?.(namespace, 'stealthBelief'), current = context();
  return saved?.sceneId === current.sceneId && (saved.combatId ?? null) === current.combatId
    ? (saved.entries ?? []).map(entry) : [];
}
export async function saveStealthBelief(subject, entries) {
  await subject.document.setFlag(namespace, 'stealthBelief', { ...context(), entries: entries.map(entry) });
}
export async function clearStealthBelief(subject) {
  if (stealthBelief(subject).length) await saveStealthBelief(subject, []);
}
export function projectStealth(kind, prior, { bonus, referenceDC, canHide, coverBonus = 0 }) {
  const previous = entry(prior);
  if (!canHide) return { ...previous, unseenChance: 0, undetectedChance: 0 };
  // Without sensory feedback, another Hide does not provide independent
  // evidence of success. Retain the belief until a revealing action clears it.
  if(kind==='hide'&&previous.unseenChance>0)return previous;
  const odds = checkProbabilities(bonus + coverBonus, referenceDC), success = odds.success + odds.criticalSuccess;
  return entry({ observerId: prior.observerId,
    unseenChance: kind === 'hide' ? previous.unseenChance + (1 - previous.unseenChance) * success
      : previous.unseenChance * (1 - odds.criticalFailure),
    undetectedChance: kind === 'hide' ? previous.undetectedChance : previous.unseenChance * success });
}
