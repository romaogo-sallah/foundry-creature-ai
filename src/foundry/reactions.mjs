import { MODULE_ID, MANAGED_OPTION, escapeHTML, rollEvent } from './pf2e-adapter.mjs';
import { ReactionPrompts } from './reaction-prompts.mjs';
import { ReactionBarrier } from '../wolf/reaction-barrier.mjs';
import {distanceToPosition} from './vertical-geometry.mjs';
import { incapacitationReason } from './combat-state.mjs';
import { clearAttackPath, clearSightPath } from './attack-path.mjs';
import { concealmentCheck } from './environment-rolls.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import {sharesVerticalSpace} from './vertical-space.mjs';
import {reactionRestriction} from './action-restrictions.mjs';

export const REACTION_OPTION = `${MODULE_ID}:reaction`;
export const REACTION_AUTO_DAMAGE = `${MODULE_ID}:reaction-auto-damage`;
const incapacitated = ['unconscious', 'dying', 'dead', 'paralyzed', 'petrified', 'stunned'];
const physical = new Set(['bludgeoning', 'piercing', 'slashing']);
const abilitySources = {
  'shield-block': new Set(['Compendium.pf2e.feats-srd.Item.jM72TjJ965jocBV8', 'Compendium.pf2e.feats-srd.jM72TjJ965jocBV8']),
};

function ability(actor, slugs) {
  return [...(actor.itemTypes?.feat ?? []), ...(actor.itemTypes?.action ?? [])].some(item => {
    if (slugs.includes(item.slug ?? item.system?.slug)) return true;
    // PF2e preserves nullable source slugs. Its prepared item roll options still
    // identify these abilities, and source UUIDs survive translated/renamed names.
    const options = item.getRollOptions?.('item') ?? [];
    const sources = [item.sourceId, item._stats?.compendiumSource, item._stats?.duplicateSource, item.flags?.core?.sourceId];
    return slugs.some(slug => options.includes(`item:slug:${slug}`) || sources.some(source => abilitySources[slug]?.has(source)));
  });
}
export function canReact(actor) {
  return actor?.hitPoints?.value > 0 && !actor.hasCondition(...incapacitated) && !reactionRestriction(actor)&&!(actor.system.traits?.value ?? []).includes('minion');
}
export function reactionCycle(token) {
  const combat = game.combat;
  if (!combat?.started) return null;
  const turns = combat.turns ?? Array.from(combat.combatants);
  const index = turns.findIndex(turn => turn.tokenId === token.id && (!turn.sceneId || turn.sceneId === token.document.parent.id));
  if (index < 0 || turns[index].defeated || turns[index].isDefeated) return null;
  const round = combat.round - Number(index > (combat.turn ?? 0));
  return `${combat.id}:${round}:${turns[index].id ?? token.id}`;
}
export function shieldBlockEligible(token, damage) {
  return Boolean(damage) && !shieldBlockReadiness(token, damage);
}

function shieldBlockReadiness(token, damage) {
  const actor = token?.actor, shield = actor?.attributes.shield;
  const checks = [
    [canReact(actor), reactionRestriction(actor)?.reason??'The creature cannot currently take reactions.'],
    [actor && ability(actor, ['shield-block']), 'Shield Block ability was not found.'],
    [Boolean(shield?.itemId), 'No equipped physical shield was found.'],
    [Boolean(shield?.raised), 'The equipped shield is not raised.'],
    [Boolean(shield && !shield.broken && !shield.destroyed), 'The shield is broken or destroyed.'],
    [Number.isFinite(shield?.hardness), 'Shield Hardness is unavailable.'],
  ];
  if (damage) checks.push([Boolean(damage.instances?.some(instance =>
    physical.has(instance.type) && !instance.persistent && instance.total > 0)),
  'The damage roll has no positive immediate physical damage instance.']);
  return checks.find(([passed]) => !passed)?.[1] ?? null;
}

export class ReactionEngine {
  constructor({ prompts = new ReactionPrompts(), onPause = () => {}, automaticReactiveStrike = () => false, presentation = null } = {}) {
    this.prompts = prompts; this.locks = new Map(); this.barrier = new ReactionBarrier(); this.onPause = onPause;
    this.lastShieldChecks = new Map();
    this.automaticReactiveStrike = automaticReactiveStrike;
    this.presentation = presentation;
  }
  async resolve(operation) {
    return this.barrier.resolve(async () => {
      try { return await operation(); }
      catch (error) { this.onPause(); throw error; }
    });
  }
  install() { this.prompts.install(); }
  available(token) {
    if (!token?.actor) return false;
    const cycle = reactionCycle(token), state = token.actor.getFlag?.(MODULE_ID, 'reaction');
    return Boolean(cycle && canReact(token.actor) && !(state?.cycle === cycle && state.spent));
  }
  inspectShieldBlock(token, { damage } = {}) {
    if (!token?.actor) return { eligible: false, reason: 'No creature was selected.' };
    const state = token.actor.getFlag?.(MODULE_ID, 'reaction'), cycle = reactionCycle(token);
    const spent = Boolean(cycle && state?.cycle === cycle && state.spent);
    const kind = state?.kind === 'reactive-strike' ? 'Reactive Strike' : state?.kind === 'shield-block' ? 'Shield Block' : state?.kind === 'sweeping-hook' ? 'Sweeping Hook' : 'a reaction';
    const reason = !cycle ? 'The creature is not an undefeated combatant in the active combat.' :
      spent ? `The ordinary reaction was already spent on ${kind}. It refreshes at this creature's next turn.` :
        shieldBlockReadiness(token, damage);
    const shield = token.actor.attributes.shield;
    return { eligible: !reason, reason: reason ?? (damage ? 'Shield Block is eligible for this damage.' : 'Shield Block prerequisites are ready; incoming damage has not been checked.'),
      abilityFound: ability(token.actor, ['shield-block']), reactionAvailable: this.available(token),
      shieldRaised: Boolean(shield?.raised), shieldUsable: Boolean(shield?.itemId && !shield.broken && !shield.destroyed),
      damageChecked: Boolean(damage) };
  }
  meleeOptions(reactor) {
    return (reactor.actor.system.actions ?? []).flatMap((base, index) => [base, ...(base.altUsages ?? [])].flatMap((strike, usage) => {
      if (strike.type !== 'strike' || !strike.item.isMelee) return [];
      const linked = strike.item.linkedWeapon;
      const needsTwoHands = reactor.actor.type === 'npc' && reactor.document.getFlag?.(MODULE_ID, 'config')?.enabled && linked?.system.usage?.value === 'held-in-two-hands';
      const reason = needsTwoHands && (linked.system.equipped.carryType !== 'held' || linked.system.equipped.handsHeld < 2)
        ? `${linked.name} requires two hands; it is currently ${linked.system.equipped.carryType === 'held' ? `held in ${linked.system.equipped.handsHeld} hand(s)` : 'not held'}. Regrip costs one Interact action on the creature's turn.`
        : strike.ready === false || strike.canAttack === false ? `${strike.label ?? strike.item.name} is not ready.` : null;
      return [{ id: `strike-${index}-${usage}`, strike, reason }];
    }));
  }
  inspectReactiveStrike(token) {
    if (!token?.actor) return { eligible: false, reactionAvailable: false, abilityFound: false, reason: 'No creature was selected.' };
    const reactionAvailable = this.available(token), abilityFound = ability(token.actor, ['reactive-strike', 'attack-of-opportunity']);
    const options = this.meleeOptions(token), ready = options.filter(option => !option.reason);
    const reason = !reactionCycle(token) ? 'The creature is not an undefeated combatant in the active combat.' :
      !canReact(token.actor) ? reactionRestriction(token.actor)?.reason??'The creature cannot currently take reactions.' : !reactionAvailable ? 'The ordinary reaction is already spent until this creature’s next turn.' :
        !abilityFound ? 'Reactive Strike ability was not found.' : !ready.length ? options.map(option => option.reason).join(' ') || 'No ready melee Strike was found.' : null;
    return { eligible: !reason, reactionAvailable, abilityFound, reason: reason ?? 'Ready; a visible enemy must trigger within melee reach.',
      readyWeapons: ready.map(option => option.strike.label ?? option.strike.item.name) };
  }
  async setSpent(token, spent) {
    if (game.users.activeGM?.id !== game.user.id) throw new Error('Only the active GM can correct reaction counts');
    const cycle = reactionCycle(token);
    if (!cycle) throw new Error('Add this creature to the active combat first');
    await token.actor.setFlag(MODULE_ID, 'reaction', { cycle, spent, uncertain: false });
  }
  async exclusive(token, operation) {
    const key = token.actor.uuid, previous = this.locks.get(key);
    let release;
    const lock = new Promise(resolve => { release = resolve; });
    this.locks.set(key, lock);
    try { await previous; return await operation(); }
    finally { release(); if (this.locks.get(key) === lock) this.locks.delete(key); }
  }
  async reserve(token, kind, valid) {
    if (game.users.activeGM?.id !== game.user.id || !valid() || !this.available(token)) throw new Error('The reaction is no longer available; inspect the pending action before resuming');
    const state = { cycle: reactionCycle(token), spent: true, uncertain: true, kind };
    await token.actor.setFlag(MODULE_ID, 'reaction', state);
    if (!valid() || game.users.activeGM?.id !== game.user.id) throw new Error('The trigger changed while reserving the reaction; inspect its counts');
    return state;
  }
  async confirm(token, state) {
    if (token.actor.getFlag(MODULE_ID, 'reaction')?.cycle === state.cycle) {
      await token.actor.setFlag(MODULE_ID, 'reaction', { ...state, uncertain: false });
    }
  }
  async releaseUnexecuted(token, state) {
    const current = token.actor.getFlag(MODULE_ID, 'reaction');
    if (current?.cycle === state.cycle && current.kind === state.kind && current.uncertain) {
      await token.actor.setFlag(MODULE_ID, 'reaction', { ...current, spent: false, uncertain: false });
    }
  }
  async shieldBlock({ origin, target, damage, valid = () => true }) {
    return this.resolve(() => this.resolveShieldBlock({ origin, target, damage, valid }));
  }
  async resolveShieldBlock({ origin, target, damage, valid }) {
    const record = () => {
      const check = { ...this.inspectShieldBlock(target, { damage }), origin: origin.name, damageTotal: damage.total };
      this.lastShieldChecks.set(target.actor.uuid, check);
      return check;
    };
    if (!record().eligible) return false;
    return this.exclusive(target, async () => {
      if (!record().eligible) return false;
      const answer = await this.prompts.ask({ token: target, title: `Shield Block — ${target.name}`,
        description: `${origin.name} rolled ${damage.total} damage before resistance or immunity. ${target.name}'s raised shield has Hardness ${target.actor.attributes.shield.hardness}. Use Shield Block before damage is applied?`,
        choices: [{ id: 'block', label: 'Shield Block' }], valid });
      if (answer === 'pause' || !valid()) throw new Error('Shield Block decision paused. Damage has not been applied; resolve the damage and correct action counts before resuming.');
      if (answer === 'pass') {
        this.lastShieldChecks.set(target.actor.uuid, { ...record(), reason: 'The owner passed Shield Block.' });
        return false;
      }
      if (answer !== 'block' || !shieldBlockEligible(target, damage)) throw new Error('Shield Block eligibility changed. Resolve the pending damage manually.');
      // Native PF2e applies IWR, Hardness, shield HP, breakage and actor HP together.
      // Keep this reservation uncertain until the caller confirms damage application.
      const reservation = await this.reserve(target, 'shield-block', valid);
      this.lastShieldChecks.set(target.actor.uuid, { ...this.lastShieldChecks.get(target.actor.uuid), reason: 'Shield Block was accepted.' });
      return { token: target, reservation };
    });
  }
  meleeStrikes(reactor, mover, { planning = false } = {}) {
    if (!canReact(reactor.actor) || !reactor.actor.isEnemyOf(mover.actor) || reactor.document.hidden || mover.document.hidden ||
      !planning && detectionFor(reactor,mover).state === 'undetected' ||
      !sharesVerticalSpace(reactor,mover) ||
      mover.actor.hasCondition('invisible') ||
      reactor.actor.hasCondition('blinded') || !clearSightPath(reactor, mover) || !clearAttackPath(reactor, mover)) return [];
    return this.meleeOptions(reactor).filter(({ strike, reason }) => {
      const reach = reactor.actor.getReach({ action: 'attack', weapon: strike.item });
      return !reason && distanceToPosition(reactor,mover,reactor.document._source??reactor.document,reach) <= reach;
    }).map(({ id, strike }) => ({ id, strike }));
  }
  reactors(mover, options) {
    return canvas.tokens.placeables.filter(token => token !== mover && this.available(token) &&
      ability(token.actor, ['reactive-strike', 'attack-of-opportunity']) && this.meleeStrikes(token, mover, options).length > 0);
  }
  hasMovementReactors(mover) {
    return canvas.tokens.placeables.some(token => token !== mover && token.actor && this.available(token) &&
      ability(token.actor, ['reactive-strike', 'attack-of-opportunity']) && token.actor.isEnemyOf(mover.actor));
  }
  async movement({ mover, seen, trigger = 'leaves a threatened square', valid = () => true, applyDamage = true, allowProne = false }) {
    return this.resolve(async () => {
      const result = await this.resolveMovement({ mover, seen, trigger, valid, applyDamage, allowProne });
      if (result.pause) this.onPause();
      return result;
    });
  }
  async action({ mover, kind, valid = () => true, applyDamage = true }) {
    return this.resolve(async () => {
      const result = await this.resolveMovement({ mover, seen: new Set(), valid, applyDamage, allowProne: true,
        movementRequired: false, disruptOnCritical: kind === 'manipulate',
        trigger: kind === 'manipulate' ? 'uses a manipulate action' : 'makes a ranged attack' });
      if (result.pause) this.onPause();
      return result;
    });
  }
  async resolveMovement({ mover, seen, trigger, valid, applyDamage, allowProne = false, movementRequired = true, disruptOnCritical = false, reactorFilter = () => true }) {
    const ended = () => {
      const reason = incapacitationReason(mover);
      return reason ? { endTurn: true, incapacitationReason: reason } : null;
    };
    const alreadyEnded = ended();
    if (alreadyEnded) return alreadyEnded;
    for (const reactor of this.reactors(mover)) {
      if (!reactorFilter(reactor)) continue;
      const key = reactor.actor.uuid;
      if (seen.has(key)) continue;
      seen.add(key);
      const result = await this.exclusive(reactor, async () => {
        if (!this.available(reactor)) return {};
        const choices = this.meleeStrikes(reactor, mover);
        if (!choices.length) return {};
        // Automatic reactions are taught off-turn decisions. Own-turn reactions
        // need the creature's action ledger/MAP and remain manual here.
        const automatic = this.automaticReactiveStrike(reactor) && game.combat.combatant?.tokenId !== reactor.id;
        const damageAutomatically = applyDamage && (!automatic || reactor.document.getFlag?.(MODULE_ID, 'config')?.applyDamage !== false);
        const preferred = [...choices].sort((a, b) => (b.strike.totalModifier ?? 0) - (a.strike.totalModifier ?? 0))[0];
        const frame={adapter:{token:reactor,profileId:'ogre-boss'},decision:{chosen:{kind:'reactiveStrike',targetId:mover.id}},state:{},
          canContinue:()=>valid()&&this.available(reactor)&&this.meleeStrikes(reactor,mover).some(choice=>choice.id===preferred.id)};
        if(automatic&&this.presentation&&await this.presentation.beforeAction(frame)===false)return {pause:true,pauseReason:'The automated reaction stopped before its roll; no reaction was spent.'};
        const settled=async result=>{
          if(automatic&&this.presentation)await this.presentation.afterAction?.({...frame,canContinue:valid});
          return result;
        };
        const answer = automatic ? preferred.id : await this.prompts.ask({ token: reactor, title: `Reactive Strike — ${reactor.name}`,
          description: `${mover.name} ${trigger} within ${reactor.name}'s reach. Choose a melee Strike. This reaction uses no multiple attack penalty. You are asked once per ${movementRequired ? 'move' : 'triggering'} action.${applyDamage ? '' : ' Apply rolled damage manually before resuming.'}`,
          choices: choices.map(({ id, strike }) => ({ id, label: strike.label ?? strike.item.name })), valid });
        if (answer === 'pause' || !valid()) return { pause: true, pauseReason: 'Reaction decision paused; the move action remains spent.' };
        if (answer === 'pass') return {};
        const selected = this.meleeStrikes(reactor, mover).find(choice => choice.id === answer);
        if (!selected) throw new Error('Reactive Strike weapon or reach changed; inspect the pending action');
        const reservation = await this.reserve(reactor, 'reactive-strike', valid);
        const options = [MANAGED_OPTION, REACTION_OPTION, ...(damageAutomatically ? [REACTION_AUTO_DAMAGE] : [])];
        if (!await concealmentCheck(reactor, mover, { valid })) {
          await this.confirm(reactor, reservation);
          return settled({ resolved: true });
        }
        const roll = await selected.strike.variants[0].roll({ target: mover, options,
          event: automatic ? rollEvent('check') : { shiftKey: false, ctrlKey: false, metaKey: false } });
        if (!Number.isInteger(roll?.degreeOfSuccess)) throw new Error('Reactive Strike roll was cancelled. Check the reaction and pending move counts.');
        if (!valid()) throw new Error('The trigger changed during Reactive Strike; inspect its roll before continuing');
        if (roll.degreeOfSuccess >= 2) {
          const damage = await selected.strike[roll.degreeOfSuccess === 3 ? 'critical' : 'damage']({
            target: mover, mapIncreases: 0, options, event: automatic ? rollEvent('damage') : { shiftKey: false, ctrlKey: false, metaKey: false },
          });
          if (!damage) throw new Error('Reactive Strike damage was cancelled; inspect its counts');
          if (damageAutomatically) {
            const block = await this.shieldBlock({ origin: reactor, target: mover, damage, valid });
            if (!valid()) throw new Error('The trigger changed before reaction damage could be applied');
            await mover.actor.applyDamage({ damage, token: mover.document, item: selected.strike.item,
              outcome: roll.degreeOfSuccess === 3 ? 'criticalSuccess' : 'success', shieldBlockRequest: Boolean(block),
              rollOptions: new Set([...reactor.actor.getSelfRollOptions('origin'), ...mover.actor.getSelfRollOptions(),
                ...(reactor.actor.getRollOptions?.(['all', 'damage']) ?? []).filter(option => !/^(self|target):/.test(option)),
                ...selected.strike.item.getRollOptions('item'), ...options, 'origin:enemy', 'origin:action:trait:attack',
                `outcome:${roll.degreeOfSuccess === 3 ? 'criticalSuccess' : 'success'}`]) });
            if (block) await this.confirm(block.token, block.reservation);
          } else {
            await this.confirm(reactor, reservation);
            return { pause: true, pauseReason: 'Apply Reactive Strike damage manually before resuming. The reaction and move action are spent.' };
          }
        }
        await this.confirm(reactor, reservation);
        return settled({ disrupted: disruptOnCritical && roll.degreeOfSuccess === 3 });
      });
      if (result.pause) return result;
      const terminal = ended();
      if (terminal) return terminal;
      if (result.disrupted) return result;
      if (!valid() || !canReact(mover.actor) || movementRequired && mover.actor.hasCondition('immobilized', 'grabbed', 'restrained') ||
        (!allowProne && mover.actor.hasCondition('prone'))) {
        return { pause: true, pauseReason: 'The reaction changed the mover or stopped automation. Inspect its position before resuming.' };
      }
    }
    return {};
  }
  async openControls(token = canvas.tokens.controlled[0]) {
    if (!token?.actor || game.users.activeGM?.id !== game.user.id) throw new Error('Select one combatant as the active GM');
    const state = token.actor.getFlag(MODULE_ID, 'reaction');
    const shield = this.inspectShieldBlock(token), reactive = this.inspectReactiveStrike(token), last = this.lastShieldChecks.get(token.actor.uuid);
    const answer = await foundry.applications.api.DialogV2.wait({
      window: { title: `Reactions — ${token.name}` },
      content: `<p>${escapeHTML(token.name)}: ${this.available(token) ? 'reaction available' : 'reaction unavailable'}.</p>
        <p><strong>Current Reactive Strike check:</strong> ${escapeHTML(reactive.reason)}</p>
        <p>Automatic off-turn Reactive Strike: ${this.automaticReactiveStrike(token) ? 'enabled' : 'disabled or untaught'}. ${reactive.readyWeapons?.length ? `Ready melee attacks: ${reactive.readyWeapons.map(escapeHTML).join(', ')}.` : ''}</p>
        <p><strong>Current Shield Block check:</strong> ${escapeHTML(shield.reason)}</p>
        <p>Ability: ${shield.abilityFound ? 'found' : 'missing'}; shield: ${shield.shieldRaised ? 'raised' : 'not raised'}, ${shield.shieldUsable ? 'usable' : 'unavailable or damaged'}.</p>
        ${last ? `<p><strong>Last incoming damage:</strong> ${escapeHTML(last.origin)} rolled ${escapeHTML(last.damageTotal)}. ${escapeHTML(last.reason)}</p>` : ''}
        <p>This tracks one ordinary reaction, refreshing on the creature's turn. Mark reactions used manually here. Extra or restricted reactions require manual handling.</p>
        ${state?.uncertain ? '<p>A reaction was interrupted. Check its roll and effects before correcting the count.</p>' : ''}`,
      buttons: [{ action: 'spent', label: 'Mark spent' }, { action: 'available', label: 'Mark available' },
        { action: 'close', label: 'Close', default: true }], rejectClose: false,
    });
    if (['spent', 'available'].includes(answer)) await this.setSpent(token, answer === 'spent');
  }
}
