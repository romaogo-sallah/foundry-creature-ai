import { PF2eOgreAdapter } from './ogre-adapter.mjs';
import { MODULE_ID } from './pf2e-adapter.mjs';
import { averageFormula } from '../framework/math.mjs';
import { ogreCapabilities } from '../profiles/ogre-boss.mjs';
import '../profiles/ogre.mjs';

const held = item => item?.system.equipped?.carryType === 'held' && item.system.equipped.handsHeld >= 1;
const average = strike => Object.values(strike.item.system.damageRolls).filter(part => !part.category)
  .reduce((sum, part) => sum + averageFormula(part.damage), 0);

export function ogreBruteParts(actor) {
  if (actor?.type !== 'npc' || !actor.system.traits.value.includes('giant')) throw new Error('Ogre requires a giant NPC');
  const attacks = actor.system.actions.filter(action => action.type === 'strike');
  const strike = attacks.find(action => action.item.id === 'tPwrqa02BjnamNT9' ||
    action.item.system.traits.value.includes('sweep') && action.item.system.traits.value.includes('reach-10') && !action.item.system.traits.value.some(trait => trait.startsWith('thrown-')));
  const javelin = actor.itemTypes.weapon.find(item => (item.system.baseItem ?? item.baseType) === 'javelin');
  const thrown = attacks.find(action => (action.item.linkedWeapon?.id ?? action.item.flags?.pf2e?.linkedWeapon) === javelin?.id && javelin);
  const refuse = attacks.find(action => action.item.id === 'aj7Sw2b6ui4LbY1h' ||
    action.item.system.traits.value.includes('thrown-20') && Object.values(action.item.system.damageRolls).some(part => part.damageType === 'bludgeoning'));
  if (!strike || !javelin || !thrown || !refuse) throw new Error('This Ogre profile requires its reach-10 Sweep melee Strike, linked physical javelins and thrown-20 Refuse Strike');
  if (!strike.item.system.traits.value.includes('sweep') || !strike.item.system.traits.value.includes('reach-10') ||
    !thrown.item.system.traits.value.includes('thrown-30') || !refuse.item.system.traits.value.includes('thrown-20')) throw new Error('Unsupported changes to Ogre attack traits');
  return { strike, thrown, refuse, javelin, meleeWeapon: strike.item.linkedWeapon ?? null,
    averageDamage: average(strike), remaster: false, unsupported: [
      ...(actor.itemTypes.action ?? []).map(item => item.name),
      ...attacks.filter(action => ![strike, thrown, refuse].includes(action)).map(action => action.item.name),
    ], abilityNames: [strike.item.name, 'Sweep (+1 against a different target after an axe attack)', thrown.item.name, `${refuse.item.name} (configured supply)`] };
}

export class PF2eOgreBruteAdapter extends PF2eOgreAdapter {
  get profileId() { return 'ogre'; }
  parts() { return ogreBruteParts(this.actor); }
  primaryReady(parts = this.parts()) { return parts.strike.ready !== false && parts.strike.canAttack !== false && (!parts.meleeWeapon || held(parts.meleeWeapon)); }
  profileStrikes(parts = this.parts()) { return [parts.strike, parts.thrown, parts.refuse]; }
  strikeRange(strike, parts = this.parts()) { return strike.item.id === parts.strike.item.id ? 10 : strike.item.id === parts.refuse.item.id ? 120 : 180; }
  commandRecipients() { return []; }
  get refuseCount() { return this.config.refuseCount ?? 0; }
  get refuseHeld() { return this.refuseCount > 0 && Boolean(this.token.document.getFlag(MODULE_ID, 'ogreGear')?.refuseHeld); }
  async configure() {
    const { thrown, refuse } = this.parts();
    for (const [strike, increment] of [[thrown, 30], [refuse, 20]]) if (!strike.item.isRanged) await strike.item.update({ 'system.range': { increment, max: null } });
  }
  async assertReady() {
    await super.assertReady();
    if (!Number.isInteger(this.refuseCount) || this.refuseCount < 0 || this.refuseCount > 999) throw new Error('Set Refuse remaining to a whole number from 0 to 999 in Creature AI controls');
    const parts = this.parts();
    // The supplied NPC axe Strike has no physical item. Its declared melee
    // attack occupies one hand; the second hand can hold a javelin or Refuse.
    const other = this.actor.itemTypes.weapon.filter(item => held(item) && item !== parts.javelin && item !== parts.meleeWeapon);
    if (other.length) throw new Error(`Stow unused held weapons before running this Ogre: ${other.map(item => item.name).join(', ')}`);
    if (this.refuseHeld && held(parts.javelin)) throw new Error('The Ogre has both Refuse and a javelin in its throwing hand; resolve its equipment manually');
  }
  axeTargets(ledger) {
    const history = this.token.document.getFlag(MODULE_ID, 'ogreAttacks');
    return ledger.attacksMade > 0 && history?.turn === ledger.turn ? history.axeTargets ?? [] : [];
  }
  async snapshot(ledger, options) {
    const state = await super.snapshot(ledger, options), parts = this.parts();
    const refuseCount = this.refuseCount, refuseHeld = this.refuseHeld, targets = this.axeTargets(ledger);
    const descriptor = { id: parts.refuse.item.id, ranged: true, bonus: parts.refuse.totalModifier, damage: average(parts.refuse),
      mapPenalties: [0, parts.refuse.variants[1].penalty, parts.refuse.variants[2].penalty] };
    const update = enemy => {
      const positions = enemy.strikes;
      const ranged = positions[parts.thrown.item.id];
      positions[descriptor.id] = { ...ranged, inReach: ranged.distance <= 120, rangePenalty: Math.max(0, Math.ceil(ranged.distance / 20) - 1) * 2,
        usable: ranged.distance <= 120 && ranged.lineOfEffect && refuseCount > 0 && refuseHeld };
      positions[parts.strike.item.id].sweepBonus = targets.some(id => id !== enemy.id) ? 1 : 0;
    };
    state.enemies.forEach(update);
    for (const move of state.moves) for (const enemy of state.enemies) update({ ...move.targets[enemy.id], id: enemy.id });
    return { ...state, strikes: [...state.strikes, descriptor], refuseId: descriptor.id, refuseCount, refuseHeld,
      meleeHasItem: Boolean(parts.meleeWeapon), reactiveStrikeAvailable: false,
      diagnostics: { ...state.diagnostics, policy: 'dawnsbury-4.44-bruiser', profileId: this.profileId,
        refuseCount, refuseHeld, axeTargets: targets } };
  }
  decide(state) {
    const decision = ogreCapabilities.decide(this.profileId, state);
    decision.rejected.push(...this.unavailableStrikes(state));
    if (!state.refuseCount) decision.rejected.push({ id: 'refuse', kind: 'strike', reason: 'Refuse supply is empty; set Refuse remaining in controls' });
    return { ...decision, diagnostics: { ...state.diagnostics, ...decision.diagnostics, escapeExhausted: state.escapeBlocked && state.self.immobile && !state.moves.length } };
  }
  rangedReady(strike, parts = this.parts()) { return strike.item.id === parts.refuse.item.id ? this.refuseHeld && !held(parts.javelin) : super.rangedReady(strike, parts) && !this.refuseHeld; }
  async consumeRanged(strike, parts = this.parts()) {
    if (strike.item.id !== parts.refuse.item.id) return super.consumeRanged(strike, parts);
    await this.token.document.setFlag(MODULE_ID, 'config', { ...this.config, refuseCount: this.refuseCount - 1 });
    await this.token.document.setFlag(MODULE_ID, 'ogreGear', { refuseHeld: false });
  }
  strikeOptions(choice, ledger, strike) {
    return strike.item.id === this.parts().strike.item.id && ledger.attacksMade > 1 && this.axeTargets(ledger).some(id => id !== choice.targetId) ? ['sweep-bonus'] : [];
  }
  async recordStrikeAttempt(strike, target, ledger) {
    if (strike.item.id !== this.parts().strike.item.id) return;
    await this.token.document.setFlag(MODULE_ID, 'ogreAttacks', { turn: ledger.turn,
      axeTargets: [...new Set([...(ledger.attacksMade === 1 ? [] : this.axeTargets(ledger)), target.id])] });
  }
  async execute(choice, ledger, context = {}) {
    if (!['drawRefuse', 'drawMelee'].includes(choice.kind)) return super.execute(choice, ledger, context);
    const valid = () => (context.canContinue?.() ?? true) && this.turnKey() === ledger.turn && !game.paused && game.users.activeGM?.id === game.user.id;
    if (!await this.waitForReactions({ signal: context.signal }) || !valid()) return { skipped: true, pause: true, skipReason: 'Stopped before preparing the attack' };
    const parts = this.parts();
    if (choice.kind === 'drawRefuse' && (this.refuseCount < 1 || this.refuseHeld || held(parts.javelin))) return { skipped: true, skipReason: 'Refuse or the throwing hand is no longer available' };
    const interrupt = await this.actionReactions('manipulate', valid);
    if (interrupt.endTurn || interrupt.pause || interrupt.disrupted) return interrupt;
    if (!valid()) throw new Error('Stopped while preparing the attack');
    if (choice.kind === 'drawRefuse') await this.token.document.setFlag(MODULE_ID, 'ogreGear', { refuseHeld: true });
    else if (parts.meleeWeapon) await parts.meleeWeapon.update({ 'system.equipped.carryType': 'held', 'system.equipped.handsHeld': 1 });
    else throw new Error('No linked melee item can be drawn');
    return { resolved: true };
  }
  async recordOutcome(choice, ledger, result = {}) {
    if (result.skipped || choice.kind !== 'strike') return;
    const old = this.token.document.getFlag(MODULE_ID, 'playState');
    const abilities = old?.combatId === game.combat.id ? old.abilities ?? {} : {};
    await this.token.document.setFlag(MODULE_ID, 'playState', { combatId: game.combat.id,
      abilities: { ...abilities, refuse: Boolean(abilities.refuse || choice.strikeId === this.parts().refuse.item.id) } });
  }
}
