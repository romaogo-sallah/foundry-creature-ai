import { PF2eCreatureAdapter, MODULE_ID } from './pf2e-adapter.mjs';
import { pyroCandidates, choosePyroAction } from '../profiles/goblin-pyro.mjs';
import { describeSpellAreas } from './spell-areas.mjs';
import { executeSpell } from './spellcasting.mjs';
import { detectionFor, reveal } from './stealth-awareness.mjs';
import { casterStealthKnowledge } from './caster-stealth.mjs';
import { executeSharedHide, retainStepStealth } from './shared-stealth.mjs';
import { executeNativeStrike } from './native-strikes.mjs';
import { rememberedToken } from './target-memory.mjs';
import { inGrease, greaseZones } from './spell-zones.mjs';
import { casterTargetKnowledge } from './caster-target-knowledge.mjs';

const kinds = { 'ignition': 'damage-attack', 'tangle-vine': 'control-attack', 'breathe-fire': 'basic-save', 'grease': 'ground-control' };
export function pyroParts(actor) {
  const entry = actor.itemTypes.spellcastingEntry?.find(item => item.system.tradition.value === 'arcane' && item.system.prepared.value === 'spontaneous');
  const spells = (actor.itemTypes.spell ?? []).filter(spell => spell.system.location.value === entry?.id && kinds[spell.slug]);
  const strike = actor.system.actions.find(action => action.type === 'strike' &&
    (action.item.slug === 'torch' || action.item.name?.toLowerCase().includes('torch')));
  if (!entry || !strike || Object.keys(kinds).some(slug => !spells.some(spell=>spell.slug===slug)))
    throw new Error('Goblin Pyro requires its torch, arcane spontaneous entry, Breathe Fire, Grease, Ignition and Tangle Vine');
  if (spells.some(spell => spell.rank !== 1 || spell.system.time.value !== '2') || actor.level !== 1)
    throw new Error('The first Goblin Pyro profile supports its level-1, two-action, rank-1 spell configuration');
  const torch=[...actor.items.values()].find(item=>item.type==='equipment'&&(item.slug??item.system.slug)==='torch');
  return { strike, entry, spells, averageDamage: actor.getRollOptions(['all']).includes('lit-torch')?3.5:2.5, remaster: true,
    torchReady:torch?.system.equipped.carryType==='held'&&torch.system.equipped.handsHeld>=1,
    abilityNames: ['Torch','Breathe Fire (cone)','Grease (four squares)','Ignition (ranged/melee)','Tangle Vine','Hide','Sneak','Goblin Scuttle'],
    unsupported: ['Light and Telekinetic Hand require manual out-of-combat use'] };
}

export class PF2eGoblinPyroAdapter extends PF2eCreatureAdapter {
  get profileId() { return 'goblin-pyro'; }
  get config() { return { ...super.config, packMorale: false }; }
  parts() { return pyroParts(this.actor); }
  planningReach() { return 5; }
  async prepareTurn(options = {}) {
    if (!await super.prepareTurn(options) || !(options.canContinue?.() ?? true)) return false;
    const knowledge = casterTargetKnowledge(this);
    if (JSON.stringify(this.token.document.getFlag(MODULE_ID, 'casterTargets')) !== JSON.stringify(knowledge))
      await this.token.document.setFlag(MODULE_ID, 'casterTargets', knowledge);
    return options.canContinue?.() ?? true;
  }
  perceivedSpellTarget(enemy) {
    const token = canvas.tokens.get(enemy.id);
    return enemy.awareness?.state === 'known-square' ? rememberedToken(token,enemy.awareness.position,enemy.awareness) : token;
  }
  async snapshot(ledger,options) {
    const state = await super.snapshot(ledger,options), {entry,spells} = this.parts();
    const knowledge = casterTargetKnowledge(this);
    state.self.hpFraction = Math.max(0, Math.min(1, this.actor.hitPoints.value / Math.max(1, this.actor.hitPoints.max)));
    for (const enemy of state.enemies) {
      const target = this.perceivedSpellTarget(enemy);
      enemy.immobilized = target.actor.hasCondition('immobilized');
      enemy.tangled = (target.actor.itemTypes.effect ?? []).some(effect => !effect.isExpired &&
        (effect.flags?.[MODULE_ID]?.spellEffect === 'tangle-vine'||effect.slug==='spell-effect-tangle-vine'||effect.sourceId?.endsWith('TwtUIEyenrtAbeiX')));
      enemy.greased = inGrease(target).length > 0;
      enemy.airborne = target.document.movementAction === 'fly';
      enemy.tactics = knowledge.entries[enemy.id] ?? { role: 'unknown', reach: 5, speed: 25, source: 'unknown; benchmark movement' };
    }
    const stealth = casterStealthKnowledge(this,state), currentDefense = stealth.at();
    for (const enemy of state.enemies) Object.assign(enemy,currentDefense[enemy.id]);
    for (const move of state.moves) {
      const defense = stealth.at(this.center(move));
      for (const enemy of state.enemies) Object.assign(move.targets[enemy.id],defense[enemy.id]);
    }
    const hideHistory = this.token.document.getFlag(MODULE_ID,'pyroActions');
    state.casterDefense = { enabled: true, engagementRange: 30,
      canHide: Boolean(this.actor.getStatistic('stealth')?.check?.roll),
      hideAttempted: hideHistory?.turn === ledger.turn && hideHistory.hideAttempted,
      holdTurns: hideHistory?.combatId === game.combat.id && hideHistory.sceneId === canvas.scene.id ? hideHistory.holdTurns ?? 0 : 0,
      preparedGrease: greaseZones(canvas.scene).some(region => region.flags[MODULE_ID].spellZone.casterId === this.token.id) };
    const descriptors = spells.map(spell => ({ id: spell.id, name: spell.name, slug: spell.slug, kind: kinds[spell.slug],
      actionCost: 2, cantrip: spell.isCantrip, available: spell.isCantrip || entry.system.slots.slot1.value > 0,
      range: spell.slug === 'breathe-fire' ? 15 : 30, bonus: entry.statistic.check.mod, dc: entry.statistic.dc.value,
      damage: spell.slug === 'breathe-fire' ? 7 : 5, meleeDamage: 7, areas: [] }));
    const bystanders = canvas.tokens.placeables.filter(token => token !== this.token && !state.enemies.some(enemy=>enemy.id===token.id) &&
      token.actor?.isOfType?.('creature') && !token.document.hidden && token.actor.hitPoints?.value > 0 &&
      this.sight(this.token.center,token) && !['undetected','unnoticed'].includes(detectionFor(this.token,token).state));
    const bystanderGrease = Object.fromEntries(bystanders.map(token => [token.id, inGrease(token).length > 0]));
    const decorate = (descriptors,position,enemies = state.enemies) => descriptors.map(spell => spell.kind.endsWith('attack') || !spell.available ? spell :
      { ...spell, areas: describeSpellAreas(this,spell,{ ...state, enemies,
        bystanderGrease: { ...bystanderGrease, [this.token.id]: inGrease(this.token,position).length > 0 } },bystanders,position) });
    state.spells = decorate(descriptors);
    // All legal destinations get targeted-spell estimates. Area enumeration is
    // bounded to nearby tactically distinct destinations, avoiding a cone scan
    // at every reachable grid square on every preview/revalidation.
    for (const move of state.moves) move.spells = descriptors;
    const shortlist = [...state.moves].sort((a,b) => {
      const quality = move => Math.min(...state.enemies.map(enemy => {
        const after = move.targets[enemy.id];
        return after?.lineOfSight === false ? 1000 : Math.abs((after?.distance ?? 1000)-15);
      })) + (move.reactionRisk ?? 0) + (move.terrainRisk ?? 0);
      return quality(a)-quality(b) || a.cost-b.cost;
    }).slice(0,12);
    if (ledger.actionsRemaining >= 3) for (const move of shortlist) move.spells = decorate(descriptors,this.topLeft(move),
      state.enemies.map(enemy => ({ ...enemy, ...move.targets[enemy.id] })));
    const old = this.token.document.getFlag(MODULE_ID,'pyroShown');
    return { ...state, torchReady:this.parts().torchReady, spellSlots: entry.system.slots.slot1.value,
      shownSpells: old?.combatId === game.combat.id ? old.spells ?? {} : {},
      diagnostics: { ...state.diagnostics, profileId: this.profileId, policy: 'dawnsbury-caster-adaptation',
        casterTargets: state.enemies.map(({id, tactics}) => ({id, ...tactics})),
        resources: { rank1Slots: entry.system.slots.slot1.value }, manualAbilities: this.parts().unsupported } };
  }
  candidates(state) { return pyroCandidates(state); }
  decide(state) { return choosePyroAction(state); }
  async execute(choice,ledger,context = {}) {
    const valid = () => (context.canContinue?.() ?? true) && this.turnKey() === ledger.turn && !game.paused && game.users.activeGM?.id === game.user.id;
    if (!await this.waitForReactions({signal:context.signal}) || !valid()) return {skipped:true,pause:true,skipReason:'Stopped before the caster acted'};
    if (choice.kind === 'hide') {
      return executeSharedHide(this,choice,ledger,context);
    }
    if (choice.kind === 'step') {
      const before = await super.snapshot(ledger,{movement:false});
      const result = await super.execute(choice,ledger,context);
      if (!result.skipped) {
        await retainStepStealth(this,before);
      }
      return result;
    }
    if (choice.kind !== 'step' && choice.kind !== 'strike') await reveal(this.token);
    if (choice.kind === 'strike') {
      try { return await super.execute(choice,ledger,context); }
      finally { await reveal(this.token); }
    }
    return super.execute(choice,ledger,context);
  }
  async revalidate(choice,ledger) {
    await super.revalidate(choice,ledger);
    if (choice.kind !== 'castSpell' || !choice.area) return;
    const current = this.candidates(await this.snapshot(ledger)).find(candidate=>candidate.id===choice.id);
    if (!current || JSON.stringify(current.area.shapes) !== JSON.stringify(choice.area.shapes) ||
      JSON.stringify(current.area.bystanders.map(token=>token.id).sort()) !== JSON.stringify(choice.area.bystanders.map(token=>token.id).sort()))
      throw new Error('The spell area or its bystanders changed before casting');
  }
  async executeProfileAction(choice,ledger,context = {}) {
    if (choice.kind === 'castSpell') return executeSpell(this,choice,ledger,context);
    if (choice.kind !== 'strike') throw new Error(`Unsupported Goblin Pyro action: ${choice.kind}`);
    const target = this.liveTarget(choice.targetId),strike = this.parts().strike;
    if (!target || !this.parts().torchReady || !this.targetAt(this.originCell(),target,[]).inReach) return {skipped:true,skipReason:'Torch target or held torch is unavailable'};
    return executeNativeStrike(this,strike,target,ledger,context);
  }
  async recordOutcome(choice,ledger,result) {
    if (!result.skipped && (['hide','castSpell','strike'].includes(choice.kind) || choice.features?.holdForApproach)) {
      const old = this.token.document.getFlag(MODULE_ID,'pyroActions');
      const history = old?.combatId === game.combat.id && old.sceneId === canvas.scene.id ? old : {};
      const holding = choice.features?.holdForApproach;
      await this.token.document.setFlag(MODULE_ID,'pyroActions',{ ...history,combatId:game.combat.id,sceneId:canvas.scene.id,
        turn:ledger.turn,hideAttempted:choice.kind === 'hide' || history.turn === ledger.turn && history.hideAttempted,
        holdTurns:holding ? history.holdRound === game.combat.round ? history.holdTurns :
          history.holdRound === game.combat.round-1 ? (history.holdTurns ?? 0)+1 : 1 :
          ['castSpell','strike'].includes(choice.kind) ? 0 : history.holdTurns ?? 0,
        ...(holding?{holdRound:game.combat.round}:{}) });
    }
    if (choice.kind !== 'castSpell' || result.skipped) return;
    const old = this.token.document.getFlag(MODULE_ID,'pyroShown');
    await this.token.document.setFlag(MODULE_ID,'pyroShown',{combatId:game.combat.id,
      spells:{...(old?.combatId===game.combat.id?old.spells:{}),[choice.spellSlug]:true}});
  }
}
