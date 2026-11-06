import { PF2eCreatureAdapter, MODULE_ID, MANAGED_OPTION, SKIP_RULE_AUTOMATION, rollEvent } from './pf2e-adapter.mjs';
import { averageFormula } from '../framework/math.mjs';
import { ogreCapabilities } from '../profiles/ogre-boss.mjs';
import { isOgre, applyCommand, movementQuickened, expireCommands } from './command-effects.mjs';
import { incapacitationReason } from './combat-state.mjs';
import { clearAttackPath } from './attack-path.mjs';
import { rememberedToken } from './target-memory.mjs';
import { concealmentCheck } from './environment-rolls.mjs';

const slug = item => item.slug ?? item.name.toLowerCase().replaceAll(' ', '-');
const held = (item, hands = 1) => item?.system.equipped?.carryType === 'held' && item.system.equipped.handsHeld >= hands;
const damage = strike => Object.values(strike.item.system.damageRolls).filter(part => !part.category).reduce((sum, part) => sum + averageFormula(part.damage), 0);

export function ogreParts(actor) {
  if (actor?.type !== 'npc' || !actor.system.traits.value.includes('giant')) throw new Error('The ogre profile requires a giant NPC');
  const weapons = actor.itemTypes.weapon ?? [];
  const hook = weapons.find(item => (item.system.baseItem ?? item.baseType) === 'ogre-hook');
  const javelin = weapons.find(item => (item.system.baseItem ?? item.baseType) === 'javelin');
  const strikeFor = weapon => actor.system.actions.find(action => action.type === 'strike' &&
    (action.item.linkedWeapon?.id === weapon?.id || action.item.flags?.pf2e?.linkedWeapon === weapon?.id));
  const strike = strikeFor(hook), thrown = strikeFor(javelin);
  const command = actor.itemTypes.action.find(item => slug(item) === 'bellowing-command' || item.id === 'KxNiF9bYl6kA6FRd');
  const sweep = actor.itemTypes.action.find(item => slug(item) === 'sweeping-hook' || item.id === 'cg8c4dIdBFiff9le');
  if (!hook || !javelin || !strike || !thrown || !command || !sweep) throw new Error('Ogre Boss requires linked hook/javelin Strikes, physical weapons, Bellowing Command and Sweeping Hook');
  if (!strike.item.system.traits.value.includes('trip') || !strike.item.system.traits.value.includes('reach-10')) throw new Error('Unsupported ogre hook: expected Trip and reach 10 feet');
  if (command.actionCost?.value !== 1 || command.actionCost?.type !== 'action' || sweep.actionCost?.type !== 'reaction') throw new Error('Unsupported ogre ability action costs');
  const unsupported = actor.itemTypes.action.filter(item => item !== command && item !== sweep && !['reactive-strike', 'attack-of-opportunity'].includes(slug(item))).map(item => item.name);
  return { strike, thrown, hook, javelin, command, sweep, unsupported, averageDamage: damage(strike), remaster: true };
}

export class PF2eOgreAdapter extends PF2eCreatureAdapter {
  get profileId() { return 'ogre-boss'; }
  get config() { const config = super.config; return { ...config, packMorale: config.packMorale ?? false }; }
  parts() { return ogreParts(this.actor); }
  primaryReady(parts = this.parts()) { return held(parts.hook, 2); }
  profileStrikes(parts = this.parts()) { return [parts.strike, parts.thrown]; }
  strikeRange(strike, parts = this.parts()) { return strike.item.id === parts.strike.item.id ? 10 : 180; }
  rangedReady(_strike, parts = this.parts()) { return held(parts.javelin) && parts.javelin.system.quantity > 0; }
  async consumeRanged(_strike, parts = this.parts()) {
    await parts.javelin.update({ 'system.quantity': parts.javelin.system.quantity - 1,
      'system.equipped.carryType': 'worn', 'system.equipped.handsHeld': 0 });
  }
  strikeOptions() { return []; }
  async recordStrikeAttempt() {}
  perceivedTarget(enemy) {
    const target = canvas.tokens.get(enemy.id);
    return enemy.awareness?.state === 'known-square' ? rememberedToken(target, enemy.awareness.position, enemy.awareness) : target;
  }
  movementBonusAvailable() { return movementQuickened(this.actor); }
  targetAt(cell, target, allies, position) { return super.targetAt(cell, target, allies, position, this.parts().strike.item); }
  async configure() {
    const { thrown } = this.parts();
    if (!thrown.item.isRanged) await thrown.item.update({ 'system.range': { increment: 30, max: null } });
  }
  async prepareTurn(options = {}) {
    await expireCommands();
    if (!await super.prepareTurn(options)) return false;
    await this.configure();
    return options.canContinue?.() ?? true;
  }
  async assertReady() {
    await super.assertReady();
    if (this.actor.hasCondition('quickened') && !movementQuickened(this.actor)) throw new Error('This Quickened source has no supported action restriction; handle its extra action manually');
  }
  async readLedger(turn) {
    const current = this.token.document.getFlag(MODULE_ID, 'ledger');
    const ledger = await super.readLedger(turn);
    if (current?.turn === turn) return ledger;
    return ledger;
  }
  commandRecipients() {
    const ownLanguages = this.actor.system.details.languages.value;
    // Treat the command as audible across the encounter: no acoustic, wall,
    // elevation, level or silence-effect simulation, per the GM's preference.
    return canvas.tokens.placeables.filter(token => token !== this.token && token.actor&&this.actor.isAllyOf(token.actor) && isOgre(token.actor) &&
      !incapacitationReason(token) && !token.actor.hasCondition('deafened', 'quickened') &&
      !token.actor.attributes.immunities.some(immunity => ['mental', 'emotion', 'fear', 'auditory', 'linguistic'].includes(immunity.type)) &&
      token.actor.system.details.languages.value.some(language => ownLanguages.includes(language)) &&
      game.combat.combatants.some(combatant => combatant.tokenId === token.id));
  }
  async snapshot(ledger, options) {
    const state = await super.snapshot(ledger, options), parts = this.parts();
    const descriptors = [parts.strike, parts.thrown].map((strike, index) => ({ id: strike.item.id, ranged: index === 1,
      bonus: strike.totalModifier, damage: damage(strike), mapPenalties: [0, strike.variants[1].penalty, strike.variants[2].penalty] }));
    const hookReady = this.primaryReady(parts), javelinHeld = held(parts.javelin), javelins = parts.javelin.system.quantity;
    const ranges = (cell, enemy, position) => {
      const target = this.perceivedTarget(enemy), allies = target.memoryView ? [] : this.allies(target), geometry = this.targetAt(cell, target, allies, position);
      return { ...geometry, strikes: Object.fromEntries(descriptors.map(strike => {
        const inReach = strike.ranged ? geometry.distance <= 180 : geometry.inReach;
        return [strike.id, { ...geometry, inReach, rangePenalty: strike.ranged ? Math.max(0, Math.ceil(geometry.distance / 30) - 1) * 2 : 0,
          usable: inReach && geometry.lineOfEffect && (strike.ranged ? javelinHeld && javelins > 0 : hookReady) }];
      })) };
    };
    for (const enemy of state.enemies) Object.assign(enemy, ranges(state.self.cell, enemy, this.actualWaypoint()));
    for (const move of state.moves) for (const enemy of state.enemies) move.targets[enemy.id] = ranges(move, enemy);
    const saved = this.token.document.getFlag(MODULE_ID, 'playState');
    const reactive = this.reactions?.inspectReactiveStrike(this.token);
    return { ...state, strikes: descriptors, hookId: parts.strike.item.id, hookReady, javelinHeld, javelins,
      throwRange: 180, throwBonus: parts.thrown.totalModifier, throwDamage: damage(parts.thrown),
      sweepingAvailable: Boolean(this.reactions?.available(this.token)),
      reactiveStrikeAvailable: this.config.autoReactions !== false && Boolean(reactive?.reactionAvailable && reactive?.abilityFound),
      hookReach: this.actor.getReach({ action: 'attack', weapon: parts.strike.item }), groundSpeed: this.groundSpeed(),
      shownAbilities: saved?.combatId === game.combat.id ? saved.abilities ?? {} : {},
      commandRecipients: this.commandRecipients().map(token => ({ id: token.id,
        needsMovement: state.enemies.every(enemy => token.distanceTo(this.perceivedTarget(enemy), { reach: token.actor.getReach({ action: 'attack' }) }) > token.actor.getReach({ action: 'attack' })) })),
      diagnostics: { ...state.diagnostics, policy: 'dawnsbury-4.44-bruiser-leader', profileId: this.profileId,
        manualAbilities: parts.unsupported,
        handState: { hookReady, javelinHeld, javelins }, roles: ['bruiser', 'leader'] } };
  }
  candidates(state) { return ogreCapabilities.candidates(this.profileId, state); }
  unavailableStrikes(state){
    return this.profileStrikes().flatMap(strike=>{
      const id=strike.item.id,positions=state.enemies.map(enemy=>enemy.strikes?.[id]).filter(Boolean);
      if(!positions.length||positions.some(position=>position.usable)||id===state.refuseId)return [];
      const ranged=state.strikes.find(entry=>entry.id===id)?.ranged;
      const distance=Math.min(...positions.map(position=>position.distance));
      const reason=ranged&&!state.javelins?'no javelins remaining':ranged&&!state.javelinHeld?
        'a javelin must be drawn first; Draw uses an ordinary action, not the Step/Stride-only action':
        !positions.some(position=>position.lineOfEffect)?'no clear attack path':
        !positions.some(position=>position.inReach)?`nearest target is ${distance} ft away; ${ranged?'maximum range':'melee reach'} is ${this.strikeRange(strike)} ft`:
        'the weapon is not ready for this attack';
      return [{id:`unavailable:${id}`,kind:'strike',name:strike.item.name,reason}];
    });
  }
  decide(state) {
    const decision = ogreCapabilities.decide(this.profileId, state);
    decision.rejected.push(...this.unavailableStrikes(state));
    for (const enemy of state.enemies) {
      const reason = enemy.prone ? 'target is already prone' : !enemy.trippable ? 'target cannot be tripped' :
        !state.hookReady ? 'the ogre hook requires two hands' : !enemy.strikes?.[state.hookId]?.inReach ? 'outside hook reach' :
          !enemy.lineOfEffect ? 'physical attack path is blocked' : state.self.restrained ? 'the ogre is restrained' : null;
      if (reason) decision.rejected.push({ id: `trip:${enemy.id}`, kind: 'trip', targetId: enemy.id, reason });
    }
    if (!state.commandRecipients.length) decision.rejected.push({ id: 'bellow', kind: 'bellow', reason: 'no eligible ogre ally can hear, understand and benefit from the command' });
    if (!state.sweepingAvailable) decision.rejected.push({ id: 'sweep', kind: 'sweepingHook', reason: 'the ordinary reaction is unavailable' });
    return { ...decision, diagnostics: { ...state.diagnostics, ...decision.diagnostics,
      escapeExhausted: state.escapeBlocked && state.self.immobile && !state.moves.length } };
  }
  async actionReactions(kind, valid) {
    if (this.config.pauseForReactions === false || !this.reactions) return {};
    return this.reactions.action({ mover: this.token, kind, valid, applyDamage: this.config.applyDamage });
  }
  async nativeStrike(choice, ledger, valid, reaction = false) {
    const target = this.liveTarget(choice.targetId), parts = this.parts();
    const strike = this.profileStrikes(parts).find(strike => strike.item.id === choice.strikeId);
    if (!target || !strike || !clearAttackPath(this.token, target)) return { skipped: true, skipReason: 'Target or attack path changed before the Strike' };
    const ranged = strike.item.id !== parts.strike.item.id;
    const geometry = this.targetAt(this.originCell(), target, this.allies(target), this.actualWaypoint());
    if (!geometry.lineOfEffect || geometry.distance > this.strikeRange(strike, parts)) return { skipped: true, skipReason: 'The target moved out of attack reach' };
    if (ranged) {
      if (!this.rangedReady(strike, parts)) throw new Error('No held ammunition is available for this attack');
      const interrupt = await this.actionReactions('ranged', valid);
      if (interrupt.endTurn || interrupt.pause) return interrupt;
      if (!valid() || this.turnEndReason()) return { endTurn: true, incapacitationReason: this.turnEndReason() };
      if (this.liveTarget(target.id) !== target) return { resolved: true, note: 'The ranged action triggered a reaction, then lost its target. Its action remains spent; no javelin was thrown.' };
      await this.consumeRanged(strike, parts);
    } else if (!this.primaryReady(parts)) throw new Error('The melee weapon is not ready');
    if (!await concealmentCheck(this.token, target, { valid })) return { resolved: true,
      lastAction: { kind: reaction ? 'sweepingHook' : 'strike', hit: false, targetId: target.id, strikeId: strike.item.id },
      note: 'Concealment flat check failed. The attack action and any thrown ammunition remain spent.' };
    const variant = Math.min(ledger.attacksMade - 1, 2);
    const options = [MANAGED_OPTION, ...this.strikeOptions(choice, ledger, strike), ...(reaction ? [`${MODULE_ID}:reaction`, ...(this.config.applyDamage ? [`${MODULE_ID}:reaction-auto-damage`] : [])] : [])];
    const roll = await strike.variants[variant].roll({ target, options, event: rollEvent('check') });
    if (!Number.isInteger(roll?.degreeOfSuccess)) throw new Error('The Strike has no resolved result');
    if (!valid()) throw new Error('The turn changed while the Strike resolved');
    await this.recordStrikeAttempt(strike, target, ledger);
    const hit = roll.degreeOfSuccess >= 2;
    if (hit) {
      const rolledDamage = await strike[roll.degreeOfSuccess === 3 ? 'critical' : 'damage']({ target, mapIncreases: variant, options, event: rollEvent('damage') });
      if (!rolledDamage) throw new Error('Damage was cancelled');
      if (this.config.applyDamage) await this.applyDamage(target, rolledDamage, strike.item, roll.degreeOfSuccess === 3 ? 'criticalSuccess' : 'success', { valid });
    }
    return { lastAction: { kind: reaction ? 'sweepingHook' : 'strike', hit, targetId: target.id, strikeId: strike.item.id },
      pause: hit && !this.config.applyDamage };
  }
  async execute(choice, ledger, context = {}) {
    if (['stride', 'step', 'crawl', 'escapeStride', 'escape', 'stand', 'seek'].includes(choice.kind)) return super.execute(choice, ledger, context);
    const valid = () => (context.canContinue?.() ?? true) && this.turnKey() === ledger.turn && !game.paused && game.users.activeGM?.id === game.user.id;
    if (!await this.waitForReactions({ signal: context.signal }) || !valid()) return { skipped: true, pause: true, skipReason: 'Stopped before the action began' };
    const parts = this.parts();
    if (choice.kind === 'strike') return this.nativeStrike(choice, ledger, valid);
    if (choice.kind === 'sweepingHook') return this.reactions.resolve(() => this.reactions.exclusive(this.token, async () => {
      const reservation = await this.reactions.reserve(this.token, 'sweeping-hook', valid);
      const result = await this.nativeStrike(choice, ledger, valid, true);
      if (result.skipped) { await this.reactions.releaseUnexecuted(this.token, reservation); return result; }
      await this.reactions.confirm(this.token, reservation);
      return { ...result, ability: 'sweep' };
    }));
    if (['drawJavelin', 'regrip', 'stow'].includes(choice.kind)) {
      if (choice.kind === 'drawJavelin' && held(parts.hook, 2)) await parts.hook.update({ 'system.equipped.handsHeld': 1 });
      const interrupt = await this.actionReactions('manipulate', valid);
      if (interrupt.endTurn || interrupt.pause) return interrupt;
      if (interrupt.disrupted) return { resolved: true, pauseReason: 'Reactive Strike critically hit and disrupted the manipulate action. The action remains spent.' };
      if (!valid()) throw new Error('Stopped during the equipment action');
      if (choice.kind === 'drawJavelin') await parts.javelin.update({ 'system.equipped.carryType': 'held', 'system.equipped.handsHeld': 1 });
      if (choice.kind === 'stow') await parts.javelin.update({ 'system.equipped.carryType': 'worn', 'system.equipped.handsHeld': 0 });
      if (choice.kind === 'regrip') await parts.hook.update({ 'system.equipped.carryType': 'held', 'system.equipped.handsHeld': 2 });
      return { resolved: true };
    }
    if (choice.kind === 'bellow') {
      const recipients = this.commandRecipients();
      if (!recipients.length) return { skipped: true, skipReason: 'No ogre ally can benefit from this command' };
      const affected = await applyCommand(this, recipients, valid);
      return { resolved: true, ability: 'bellow', commandRecipients: affected,
        note: `Bellowing Command grants a Step/Stride-only extra action to: ${affected.map(id => canvas.tokens.get(id)?.name ?? id).join(', ')}.` };
    }
    if (choice.kind === 'trip') {
      const target = this.liveTarget(choice.targetId);
      if (!target || target.actor.hasCondition('prone')) return { skipped: true, skipReason: 'Trip target is absent or already prone' };
      if (!held(parts.hook, 2)) throw new Error('Trip with the hook requires two hands');
      if (!await concealmentCheck(this.token, target, { valid })) return { resolved: true, ability: 'trip', note: 'Concealment flat check failed; Trip remains spent.' };
      const rollOptions = [MANAGED_OPTION, SKIP_RULE_AUTOMATION];
      const outcome = (await game.pf2e.actions.get('trip').use({ actors: [this.actor], target,
        multipleAttackPenalty: ledger.attacksMade > 1 ? -5 * Math.min(ledger.attacksMade - 1, 2) : 0, rollOptions, event: rollEvent('check') }))?.[0]?.outcome;
      if (!['criticalSuccess', 'success', 'failure', 'criticalFailure'].includes(outcome)) throw new Error('Trip was cancelled or unresolved');
      if (!valid()) throw new Error('Turn changed while Trip resolved');
      const success = ['success', 'criticalSuccess'].includes(outcome);
      if (success && !target.actor.hasCondition('prone')) await target.actor.increaseCondition('prone');
      if (outcome === 'criticalFailure' && !this.actor.hasCondition('prone')) await this.actor.increaseCondition('prone');
      if (outcome === 'criticalSuccess') {
        const DamageRoll = CONFIG.Dice.rolls.find(cls => cls.name === 'DamageRoll');
        const rolledDamage = await new DamageRoll('1d6[bludgeoning]').evaluate();
        await rolledDamage.toMessage({ speaker: ChatMessage.getSpeaker({ token: this.token.document }), flavor: 'Ogre hook — critical Trip',
          flags: { pf2e: { suppressDamageButtons: Boolean(this.config.applyDamage), context: { options: rollOptions } } } });
        if (this.config.applyDamage) await this.applyDamage(target, rolledDamage, null, outcome, { valid });
      }
      const sweep = success && !this.turnEndReason() && this.reactions?.available(this.token);
      return { ability: 'trip', pendingSweep: sweep ? { targetId: target.id, strikeId: parts.strike.item.id } : null,
        lastAction: { kind: 'trip', outcome, freeFollowUp: Boolean(sweep) }, pause: outcome === 'criticalSuccess' && !this.config.applyDamage };
    }
    throw new Error(`Unsupported capability action: ${choice.kind}`);
  }
  async recordOutcome(choice, ledger, result = {}) {
    const old = this.token.document.getFlag(MODULE_ID, 'playState');
    const abilities = old?.combatId === game.combat.id ? old.abilities ?? {} : {};
    if (!result.skipped && (result.ability || result.lastAction?.kind === 'strike')) await this.token.document.setFlag(MODULE_ID, 'playState', {
      combatId: game.combat.id, abilities: Object.fromEntries(['trip', 'bellow', 'sweep'].map(id => [id, Boolean(abilities[id] || result.ability === id)])) });
  }
}
