import {SPELL_OPTIONS} from './spell-checks.mjs';
import {automationOwnsFlatChecks} from './condition-actions.mjs';
const ns='foundry-creature-ai';
export async function spellMessage(spell,autoApply = true,{targetIds=[]}={}) {
  const message = await spell.toMessage(null, { actualCast: true, create: false,[`${ns}:targets`]:targetIds,data: { castRank: spell.rank } });
  if (!message) throw new Error('Could not prepare the spell chat card');
  const options = message.flags?.pf2e?.context?.options ?? [];
  message.updateSource({ [`flags.${ns}.managed`]: true,
    'flags.pf2e.context.options': [...new Set([...options,...SPELL_OPTIONS])],
    'flags.xdy-pf2e-workbench.noAutoDamageRoll': true, 'flags.pf2e.suppressDamageButtons': autoApply });
  // Automations 1.4.10's synchronous pre-create flat hook does not honor
  // skip-handling-message. Preserve the native spell origin/casting card, but
  // classify this managed presentation as OTHER; our awaited checks own it.
  if(automationOwnsFlatChecks())message.updateSource({'flags.pf2e.context.type':'other'});
  return ChatMessage.create(message.toObject());
}

export async function spellDamage(spell, caster, { target, outcome = 'success', map = 0, autoApply = true,formula } = {}) {
  const data = await spell.getDamage({ target: target?.document, skipDialog: true });
  if (!data?.template?.damage?.roll) throw new Error(`No native damage roll for ${spell.name}`);
  const doubleDice=outcome==='criticalSuccess'&&game.settings.get('pf2e','critRule')==='doubledice';
  const RollClass=formula?CONFIG.Dice.rolls.find(type=>type.name==='DamageRoll'):null;
  let roll=await (formula?new RollClass(formula):doubleDice?data.template.damage.roll.alter(2,0):data.template.damage.roll).evaluate();
  if (outcome === 'criticalSuccess'&&!doubleDice) roll = roll.alter(2,0);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: caster.document }), flavor: spell.name,
    flags: { [ns]: { managed: true }, 'xdy-pf2e-workbench': { noAutoDamageRoll: true },
      pf2e: { suppressDamageButtons: autoApply, origin: spell.getOriginData(),
        context: { type: 'damage-roll', sourceType: spell.isAttack ? 'attack' : 'save', outcome, mapIncreases: map,
          options: [...(data.context?.options ?? []),...SPELL_OPTIONS], target: target ? { actor: target.actor.uuid, token: target.document.uuid } : null } } } });
  return roll;
}

