const ns = 'foundry-creature-ai';
export const SPELL_OPTIONS = [`${ns}:managed`, 'skip-handling-message', 'action:cast-a-spell'];

export async function spellDefenseCheck(token, { dc, statistic = 'reflex', origin, spell, label, cover = 0 } = {}) {
  const check = token.actor.getStatistic(statistic)?.check;
  if (!check?.roll) throw new Error(`${token.name} has no ${statistic} check`);
  // Contextual circumstance modifiers stack through PF2e, without changing
  // the actor or learning its actual modifier during AI planning.
  const modifiers = cover > 0 ? [new game.pf2e.Modifier({ slug: 'spell-area-cover', label: 'Cover against area spell',
    type: 'circumstance', modifier: cover })] : [];
  const roll = await check.roll({ skipDialog: true, token: token.document, origin: origin?.actor, item: spell,
    dc: { value: dc }, label, modifiers, extraRollOptions: SPELL_OPTIONS });
  if (!Number.isInteger(roll?.degreeOfSuccess)) throw new Error(`${label ?? 'Spell defense'} was cancelled or unresolved`);
  return roll.degreeOfSuccess;
}

export function bestGreaseDefense(actor) {
  const choices = ['reflex', 'acrobatics'].map(slug => ({ slug, modifier: actor.getStatistic(slug)?.check?.mod }))
    .filter(entry => Number.isFinite(entry.modifier)).sort((a,b) => b.modifier-a.modifier);
  if (!choices.length) throw new Error('No Reflex or Acrobatics statistic is available for Grease');
  return choices[0].slug;
}
