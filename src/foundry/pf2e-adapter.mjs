import { chooseWolfAction, buildWolfCandidates } from '../wolf/planner.mjs';
import { averageFormula } from '../framework/math.mjs';
import { reachableCells, enemyDistances, reachableCellsAsync, enemyDistancesAsync } from '../framework/navigation.mjs';
import { standardArmorClass } from '../dawnsbury/chooser.mjs';
import { canAssignTarget, combatantSceneId, targetingMode, targetRoster } from './targeting.mjs';
import { incapacitationReason, encounterOutcome, occupiesMovementSpace } from './combat-state.mjs';
import {actionRestriction} from './action-restrictions.mjs';
import {captureAppliedDamage} from './resolved-damage.mjs';
import { clearAttackPath, clearSightPath } from './attack-path.mjs';
import {sharesVerticalSpace} from './vertical-space.mjs';
import { unsupportedMovementRegions, terrainMovementPath } from './movement-regions.mjs';
import { escapeBindings, escapeOptions, configureEscapes, executeEscape } from './escape.mjs';
import { decisionExplanation } from '../wolf/decision-explanation.mjs';
import { packAssessment, persistPackAssessment } from './pack-morale.mjs';
import { frontlineAssessments } from './frontline.mjs';
import { MANAGED_MOVEMENT } from './movement-options.mjs';
import { targetKnowledge, rememberTargets } from './target-memory.mjs';
import { approachNavigation, approachNavigationAsync } from './approach-navigation.mjs';
import { greaseExtraCost, prepareGreaseMove, withGreaseMode, inGrease } from './spell-zones.mjs';
import { settleGreaseSlip, finishGreaseFall } from './grease-landing.mjs';
import { sameSurfaceElevation } from './surface-terrain.mjs';
import {pitWalkable} from './pit-geometry.mjs';
import {iceBlocksMovement} from './ice-wall-geometry.mjs';
import { distanceToPosition, rayAt, tokenAt,tokenHeight } from './vertical-geometry.mjs';
import { nonvisualSense } from './perception-senses.mjs';
import {conditionFacts,resolveConditionChecks,nativeRuleAction,manualConditionViolation} from './condition-actions.mjs';
import {initialActionBudget,settleStunned,valuedStunned} from './action-economy.mjs';
import {withConditionActivity} from './condition-activity.mjs';
import {retchSource,executeRetch} from './manual-condition-actions.mjs';
import {breakFascination} from './fascination.mjs';
import { RUNTIME_VERSION } from './runtime-version.mjs';
import {directiveOverrides} from '../framework/condition-directives.mjs';
import { environmentBetween } from './environment-zones.mjs';
import { concealmentCheck, concealmentDC } from './environment-rolls.mjs';
import { executeSeek, seekScope } from './npc-perception.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { hazardousAt, terrainRiskForPath, beginTerrainAction, endTerrainAction } from './hazardous-terrain.mjs';

import {MODULE_ID,MANAGED_OPTION,MANAGED_TRIP_OPTION,SKIP_RULE_AUTOMATION,rollEvent,escapeHTML} from './rules-context.mjs';
export {MODULE_ID,MANAGED_OPTION,MANAGED_TRIP_OPTION,SKIP_RULE_AUTOMATION,rollEvent,escapeHTML};
const blocked = ['unconscious', 'dying', 'dead', 'paralyzed', 'petrified', 'controlled', 'confused', 'fleeing', 'stunned'];
const sizeOrder = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'];

export function renderDecisionExplanation(record, nameOf = id => canvas.tokens.get(id)?.name ?? id) {
  const number = value => Number.isFinite(value) ? Number(value.toFixed(2)) : '?';
  const describe = option => `${option.spellName ?? option.kind}${option.targetId ? ` → ${nameOf(option.targetId)}` : ''}${option.destination ? ` (${option.destination.x}, ${option.destination.y})` : ''}`;
  const rows = record.options.map(option => `<tr><td>${option.selected ? '<strong>Chosen</strong> ' : ''}${escapeHTML(describe(option))}</td><td>${option.layer}</td><td>${number(option.value)}</td><td>${option.terms.map(term => `${escapeHTML(term.label)}: ${number(term.contribution)}`).join('<br>')}${option.packAllies != null ? `<br>Nearby supporting allies: ${option.packAllies}` : ''}${option.movement ? `<br>${option.provokes ? 'Can provoke a reaction' : 'No known movement reaction'}; ${option.goodAttacksLeft ? 'attacks remain useful' : 'limited attacks after movement'}; distance ${number(option.distanceMoved)} squares` : ''}</td></tr>`).join('');
  const rejected = record.rejected.slice(0, 12).map(option => `<li>${escapeHTML(option.name ?? describe(option))}: ${escapeHTML(option.reason)}</li>`).join('');
  const plan=record.options.find(option=>option.selected)?.plan;
  return `<p>${escapeHTML(record.reason)}. Layers rank before values. ${record.tiedIds.length > 1 ? `${record.tiedIds.length} equal choices; selected randomly.` : ''}</p>
    ${record.tactic ? `<p><strong>Tactic: ${escapeHTML(record.tactic.label)}</strong> — ${escapeHTML(record.tactic.reason)}. ${escapeHTML(record.tactic.goal?.label??'')}.</p><p>Active behaviors: ${record.tactic.activeComponents.map(escapeHTML).join(', ')}.</p>` : ''}
    ${record.tactic?.scores?.length?`<details><summary>Why this tactic?</summary><p>${record.tactic.context.knownEnemies} known opponents; ${record.tactic.context.allies} visible allies; own HP ${Math.round(record.tactic.context.health*100)}%.</p><table><thead><tr><th>Tactic</th><th>Value</th><th>Reason</th></tr></thead><tbody>${record.tactic.scores.map(plan=>`<tr><td>${escapeHTML(plan.label)}</td><td>${number(plan.value)}</td><td>${escapeHTML(plan.reason)}${plan.continuity?'; continuity preference':''}${plan.preference?'; configured preference':''}</td></tr>`).join('')}</tbody></table></details>`:''}
    ${record.frontlineAnalysis?.length ? `<p>Calculated front line: ${record.frontlineAnalysis.filter(entry => entry.frontline).map(entry => `${escapeHTML(entry.name)} (max HP ${entry.maxHP}, AC ${entry.ac})`).join(', ') || 'none'}. Both maximum HP and AC must be at least the respective party medians (${record.frontlineAnalysis[0].hpThreshold} HP, AC ${record.frontlineAnalysis[0].acThreshold}).</p>` : ''}
    ${record.pursuitTargets?.length ? `<p>Remembered enemy positions: ${record.pursuitTargets.map(target => `${escapeHTML(target.name)}${target.detection==='hidden'&&target.allowAttackEstimate ? ' (Hidden; automatic DC 11 targeting check)' : target.searchRequired ? ' (investigate with automatic Seek)' : target.round != null ? ` (remembered from round ${target.round})` : ''}`).join(', ')}. Undetected enemies must be located before a targeted attack.</p>` : ''}
    ${record.environmentTargets?.length ? `<p>Scene environment: ${record.environmentTargets.map(target => `${escapeHTML(target.name)}: ${target.coverBonus ? `cover +${target.coverBonus} AC` : 'no cover'}${target.concealmentDC ? `; concealment DC ${target.concealmentDC}` : ''}`).join('; ')}. These affect attack ranking; AI targeting flat checks resolve before the attack.</p>` : ''}
    <table><thead><tr><th>Option</th><th>Layer</th><th>Value</th><th>Factors</th></tr></thead><tbody>${rows}</tbody></table>
    ${plan?.length ? `<p>Estimated remaining sequence: ${plan.map(action=>escapeHTML(describe(action))).join(' → ')}. Re-evaluated after each action.</p>` : ''}
    ${plan?.steps?.length ? `<p>Planned sequence (${plan.actionCost} actions): ${plan.steps.map(action=>`${escapeHTML(describe(action))} [${action.actionCost}]`).join(' → ')}. Re-evaluated after each action.</p>` : ''}
    ${record.totalOptions > record.options.length ? '<p>Other movement alternatives omitted.</p>' : ''}
    ${rejected ? `<p>Unavailable options:</p><ul>${rejected}</ul>${record.rejected.length > 12 ? '<p>Further unavailable options omitted.</p>' : ''}` : ''}
    ${record.movementBlocked ? `<p>Movement unavailable: ${escapeHTML(record.movementBlocked)}.</p>` : ''}
    ${record.manualAbilities?.length ? `<p>Additional abilities need manual handling: ${record.manualAbilities.map(escapeHTML).join(', ')}.</p>` : ''}`;
}

export function wolfParts(actor) {
  if (actor?.type !== 'npc' || !actor.system.traits.value.includes('animal')) throw new Error('Select an animal NPC using the standard wolf abilities');
  const strike = actor.system.actions.find(s => s.type === 'strike' && s.item.isMelee && s.item.attackEffects.includes('knockdown'));
  const pack = actor.itemTypes.action.find(i => i.system.rules.some(r => r.key === 'RollOption' && r.option === 'pack-attack'));
  const knockdown = actor.itemTypes.action.find(i => i.slug === 'knockdown');
  if (!strike) throw new Error('Wolf jaws Strike not found: a prepared melee Strike must list the knockdown attack effect');
  if (!pack) throw new Error('Wolf Pack Attack not found: its ability needs a pack-attack RollOption rule');
  if (!knockdown) throw new Error('Wolf Knockdown ability not found: its action item needs the knockdown slug');
  // DamageDice selectors are strings in compendium source and arrays after PF2e data preparation.
  const packDice = pack.system.rules.find(r => r.key === 'DamageDice' &&
    (Array.isArray(r.selector) ? r.selector : [r.selector]).includes('strike-damage') && r.predicate?.includes('pack-attack'));
  if (!packDice) throw new Error('Wolf Pack Attack damage rule not found: expected strike-damage dice gated by pack-attack');
  if (packDice.diceNumber !== 1 || packDice.dieSize !== 'd4') throw new Error('Unsupported Pack Attack damage: this wolf profile requires 1d4');
  if (knockdown.actionCost?.value !== 1 || knockdown.actionCost?.type !== 'action') throw new Error('Unsupported Knockdown action cost');
  const remaster = knockdown.system.publication.remaster;
  if (typeof remaster !== 'boolean') throw new Error('Knockdown needs an explicit legacy/remaster publication marker');
  const damage = Object.values(strike.item.system.damageRolls);
  if (!damage.length) throw new Error('The wolf has no damage formula');
  const averageDamage = damage.reduce((sum, d) => sum + averageFormula(d.damage), 0);
  return { strike, pack, knockdown, remaster, averageDamage };
}

export class PF2eCreatureAdapter {
  constructor(token, profile, { config, reactions } = {}) {
    this.token = token; this.profile = profile; this.configOverride = config; this.reactions = reactions;
  }
  get config() { return this.configOverride ?? this.token.document.getFlag(MODULE_ID, 'config') ?? {}; }
  get actor() { return this.token.actor; }
  parts() { throw new Error('No creature capability profile is configured'); }
  get profileId() { return 'creature'; }
  movementBonusAvailable() { return false; }
  async configure() {}
  validateFootprint() {
    const { width, height } = this.token.document;
    if (!Number.isInteger(width) || width < 1 || width > 4 || height !== width) throw new Error('Creature AI supports square footprints from 1 to 4 grid cells');
  }
  turnEndReason() { return incapacitationReason(this.token)??(actionRestriction(this.actor)?.kind==='noActions'?'actions denied by an active effect':null); }
  encounterOutcome() { return encounterOutcome(); }
  get targetMode() { return targetingMode(this.actor, this.config); }
  targetIds() { return targetRoster(this.token, this.config); }
  async waitForReactions(options) { return await this.reactions?.barrier.wait(options) ?? true; }
  groundSpeed() { return this.actor.system.movement?.speeds.land?.value ?? this.actor.system.attributes.speed.total ?? this.actor.system.attributes.speed.value; }
  planningSpeed() { return this.groundSpeed(); }
  planningReach() { return this.actor.getReach({action:'attack'}); }
  groundSpeedFor() { return this.groundSpeed(); }
  movementOptions() { return {}; }
  safeRetreatExit() {
    const rect = canvas.dimensions.sceneRect, p = this.actualWaypoint(), size = canvas.grid.size * this.token.document.width;
    if (!rect.contains(p.x, p.y) || !rect.contains(p.x + size - 1, p.y + size - 1)) return false;
    const boundary = Math.abs(p.x - rect.x) < 1 || Math.abs(p.y - rect.y) < 1 ||
      Math.abs(p.x + size - rect.x - rect.width) < 1 || Math.abs(p.y + size - rect.y - rect.height) < 1;
    return boundary && this.targetIds().map(id => this.liveTarget(id)).filter(target => target && this.sight(this.token.center, target))
      .every(target => this.token.distanceTo(target, { reach: this.actor.getReach({ action: 'attack' }) }) >= 30);
  }
  async prepareTurn({ canContinue = () => true, ledger } = {}) {
    await this.assertTurnContext();
    if (!canContinue()) return false;
    await rememberTargets(this, canContinue);
    if (!canContinue()) return false;
    await persistPackAssessment(this);
    if (!canContinue()) return false;
    if (this.config.packMorale !== false && this.token.document.getFlag(MODULE_ID, 'retreated')?.combatId === game.combat.id) return true;
    if (ledger?.escapeBlocked || !escapeBindings(this.actor).length) return true;
    return configureEscapes(this, { valid: () => canContinue() && !this.turnEndReason() && !game.paused && game.users.activeGM?.id === game.user.id });
  }
  encounterLevel() {
    // DD supplies one encounter CharacterLevel. Foundry has no equivalent field:
    // use the rounded mean of character combatants, then the NPC's level as fallback.
    const actors = new Map();
    for (const combatant of game.combat.combatants) {
      const actor = combatant.actor ?? canvas.tokens.get(combatant.tokenId)?.actor;
      if (actor?.type === 'character' && Number.isInteger(actor.level)) actors.set(actor.uuid ?? actor, actor);
    }
    const levels = [...actors.values()].map(actor => actor.level);
    return levels.length ? Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length) : this.actor.level;
  }
  async waitForMovement() {
    const tokens = canvas.tokens.placeables ?? [this.token];
    await Promise.all(tokens.map(token => token.movementAnimationPromise ?? token.document.movement?.animation?.ended).filter(Boolean));
  }
  turnKey() {
    const combat = game.combat;
    return combat?.started && combat.combatant?.tokenId === this.token.id
      ? `${combat.id}:${combat.round}:${combat.combatant.id}` : null;
  }

  async assertTurnContext() {
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) throw new Error('Run Wolf AI from the active GM client');
    if (!canvas.ready || !this.turnKey()) throw new Error('It must be this wolf’s active combat turn in the viewed scene');
    if (game.paused) throw new Error('Unpause Foundry before running Wolf AI');
    await this.waitForMovement();
    if (combatantSceneId(game.combat.combatant) !== canvas.scene.id || this.token.document.parent.id !== canvas.scene.id) throw new Error('View the combat scene first');
  }

  async assertReady() {
    await this.assertTurnContext();
    if (canvas.grid.type !== CONST.GRID_TYPES.SQUARE || canvas.grid.distance !== 5) throw new Error('Creature AI requires a 5-foot square grid');
    this.validateFootprint();
    if (![this.token.document.x, this.token.document.y].every(Number.isFinite)) throw new Error('The wolf has an invalid canvas position');
    if (typeof this.token.document.getSnappedPosition !== 'function') throw new Error('Foundry’s native token snapping API is required');
    if (this.token.document.locked || this.token.document.hidden) throw new Error('Unlock and reveal the wolf before running it');
    if (this.token.document.actorLink) throw new Error('Use an unlinked wolf token so each wolf has its own actor state');
    if (this.targetMode === 'manual' && !this.config.targetIds?.length) throw new Error('Assign known enemy targets in the Wolf AI controls for manual targeting');
    const condition = blocked.find(c => this.actor.hasCondition(c)&&!directiveOverrides(this.actor,c)&&
      !(c==='stunned'&&valuedStunned(this.actor))&&!(c==='controlled'&&this.actor.getFlag(MODULE_ID,'domination'))&&!(c==='confused'&&this.handlesConfusion)&&!(c==='fleeing'&&this.handlesFleeing));
    if (condition || this.actor.hitPoints.value <= 0) throw new Error(`Wolf requires manual handling: ${condition ?? '0 HP'}`);
    if (this.actor.hasCondition('slowed') && !Number.isFinite(this.actor.getCondition('slowed')?.value)) throw new Error('Cannot determine slowed action loss');
    this.parts();
    if (typeof this.token.document.move !== 'function') throw new Error('Foundry 14 movement API is required');
    if(this.actor.hasCondition('prone'))await settleGreaseSlip(this.token);
  }

  async readLedger(turn) {
    if (!turn) throw new Error('No active wolf turn');
    const current = this.token.document.getFlag(MODULE_ID, 'ledger');
    if (current?.turn === turn) return structuredClone(current);
    const budget=await initialActionBudget(this.actor,{extra:this.movementBonusAvailable()?1:0});
    return { turn, ...budget, attacksMade: 0, lastAction: null, visited: [], startCell:this.originCell(),
      done: false, uncertain: false, completionReason: null, incapacitationReason: null,
      advanceRequested: false, advanced: false, escapeBlocked: false, freeEscapeStride: false, frontlineEngaged: false,
      pendingSweep: null, commandedThisTurn: false,rejectedActionIds:[] };
  }
  settleActionEconomy(ledger){return settleStunned(this,ledger);}
  executeReservedAction(choice,ledger,options){return withConditionActivity(this.actor,()=>this.execute(choice,ledger,options));}
  async saveLedger(ledger) {
    // setFlag merges nested objects. Omitted optional keys would keep an earlier
    // turn's death reason even when the new in-memory ledger is healthy.
    await this.token.document.setFlag(MODULE_ID, 'ledger', { completionReason: null, incapacitationReason: null,
      escapeBlocked: false, freeEscapeStride: false, ...ledger });
  }
  async finishTurn(ledger, { canAdvance = () => true, signal } = {}) {
    if (this.encounterOutcome()) return ledger;
    if (!this.config.enabled || !this.config.autoAdvance || !ledger.done ||
      (ledger.actionsRemaining !== 0 && !['no-enemies', 'incapacitated', 'escape-blocked', 'retreated', 'no-useful-actions'].includes(ledger.completionReason)) ||
      ledger.uncertain || ledger.advanced || !canAdvance()) return ledger;
    if (!await this.waitForReactions({ signal }) || !canAdvance()) return ledger;
    if (game.users.activeGM?.id !== game.user.id || game.paused || this.turnKey() !== ledger.turn) return ledger;
    if (ledger.advanceRequested) throw new Error('Turn advancement was already requested. Use the combat tracker to advance manually if needed.');
    const combat = game.combat;
    const pending = { ...ledger, advanceRequested: true };
    await this.saveLedger(pending);
    const reactionsResolved = await this.waitForReactions({ signal });
    // The user can stop the runner or change turns while the flag update is in flight.
    if (!reactionsResolved || !canAdvance() || this.encounterOutcome() || game.paused || game.users.activeGM?.id !== game.user.id || this.turnKey() !== ledger.turn) {
      const cancelled = { ...ledger, advanceRequested: false };
      await this.saveLedger(cancelled);
      return cancelled;
    }
    await combat.nextTurn();
    if (this.turnKey() === ledger.turn) throw new Error('Foundry did not advance combat. Use the combat tracker to advance manually.');
    // Do not write an old ledger after changing turns: the next start-turn hook may
    // already be creating this token's next-round ledger. The pending marker is
    // retained on the old turn to prevent a second request after an uncertain result.
    return { ...ledger, advanceRequested: false, advanced: true };
  }
  cell(point) { const offset = canvas.grid.getOffset(point); return { x: offset.j, y: offset.i }; }
  originCell() {
    const snapped = this.token.document.getSnappedPosition(this.actualWaypoint());
    // Read the center of the nearest square, avoiding floor-rounding at its boundary.
    return this.cell({ x: snapped.x + canvas.grid.size / 2, y: snapped.y + canvas.grid.size / 2 });
  }
  topLeft(cell) { return canvas.grid.getTopLeftPoint({ i: cell.y, j: cell.x }); }
  waypoint(cell, action = 'walk') { return { ...this.topLeft(cell), elevation: this.token.document.elevation, level: this.token.document.level, action, snapped: true }; }
  actualWaypoint() {
    const document = this.token.document, source = document._source ?? document;
    // Foundry temporarily interpolates document coordinates while animating the mesh.
    const x = source.x ?? document.x, y = source.y ?? document.y;
    const elevation = source.elevation ?? document.elevation, level = source.level ?? document.level;
    return { x, y, elevation, level, action: 'walk', snapped: false };
  }
  movementWaypoints(path, action = 'walk') { return [this.actualWaypoint(), ...path.slice(1).map(cell => this.waypoint(cell, action))]; }
  movementContext() {
    const history = [...(this.token.document.movementHistory ?? [])];
    const historyCost = history.length ? this.token.measureMovementPath(history).cost : 0;
    if (!Number.isFinite(historyCost) || historyCost < 0) throw new Error('Could not measure the wolf’s recorded movement history');
    return { history, historyCost };
  }
  nativeStrideCost(path, context = this.movementContext(), action = 'walk') {
    const movement = terrainMovementPath(this.token, this.movementWaypoints(path, action));
    const cost = this.token.measureMovementPath([...context.history, ...movement]).cost - context.historyCost;
    return Math.max(0, cost);
  }
  strideCost(path, context = this.movementContext(), action = 'walk', kind = 'stride') {
    return withGreaseMode(this.token,action==='crawl'?'crawl':kind,()=>this.nativeStrideCost(path,context,action) +
      greaseExtraCost(this.token,this.movementWaypoints(path,action),action==='crawl'?'crawl':kind));
  }
  center(cell) { const p = this.topLeft(cell); return { x: p.x + canvas.grid.size * this.token.document.width / 2, y: p.y + canvas.grid.size * this.token.document.height / 2 }; }
  sight(from, target) { return clearSightPath(this.token, target, from); }
  assessTarget(id, { pursuit = false } = {}) {
    const target = canvas.tokens.get(id);
    const reject = reason => ({ id, name: target?.name ?? id, target: null, reason });
    if (!this.targetIds().includes(id)) return reject(this.targetMode === 'alliance' ? 'not an opposing-alliance combatant in this scene' : 'not assigned to this wolf');
    if (!target) return reject('token is not in the viewed scene');
    const inCombat = game.combat.combatants.some(c => c.tokenId === id && combatantSceneId(c) === canvas.scene.id && !c.defeated);
    if (!inCombat) return reject('not an undefeated combatant in this scene');
    if (!target.actor?.isOfType('creature')) return reject('not a creature');
    if (!canAssignTarget(this.actor, target.actor)) return reject('this creature belongs to the same alliance');
    if (!pursuit && target.document.hidden) return reject('token is hidden');
    if (!(target.actor.hitPoints?.value > 0)) return reject('no remaining HP');
    if (target.actor.hasCondition('unconscious', 'dying')) return reject('unconscious or dying');
    if (!pursuit && detectionFor(this.token, target).state === 'undetected') return reject('enemy is undetected to this observer; Seek is needed to locate it');
    if (!pursuit && !sharesVerticalSpace(this.token,target)) return reject('on another scene level');
    if (!pursuit && !this.sight(this.token.center, target)) return reject('target is not currently observed');
    return { id, name: target.name, target, reason: null };
  }
  liveTarget(id) { return this.assessTarget(id).target; }
  liveSpellTarget(id){const target=canvas.tokens.get(id);return target===this.token||target?.actor&&this.actor.isAllyOf(target.actor)&&!target.document.hidden&&this.sight(this.token.center,target)?target:this.liveTarget(id);}
  activeMovementRegions() {
    return unsupportedMovementRegions(canvas.scene);
  }
  allies(target) {
    return canvas.tokens.placeables.filter(ally => ally !== this.token && ally !== target && ally.actor&&this.actor.isAllyOf(ally.actor) &&
      !ally.document.hidden && ally.actor.canAttack &&
      ally.document.level === target.document.level && !ally.actor.hasCondition('unconscious', 'dying', 'paralyzed') &&
      !incapacitationReason(ally) && ally.actor.hitPoints?.value > 0 && ally.distanceTo(target, { reach: ally.actor.getReach({ action: 'attack' }) }) <= ally.actor.getReach({ action: 'attack' }) &&
      clearSightPath(ally, target) && clearAttackPath(ally, target));
  }
  targetAt(cell, target, allies, position, weapon) {
    const p = {...this.topLeft(cell),...position,elevation:position?.elevation??cell.elevation??this.token.document.elevation}, reach = weapon?.aiGeometryOnly?this.planningReach():this.actor.getReach({ action: 'attack', weapon });
    const proxy = tokenAt(this.token,p);
    const distance = distanceToPosition(this.token,target,p,reach);
    if (!Number.isFinite(distance)) throw new Error(`Could not measure distance to ${target.name}`);
    const attackOrigin = rayAt(this.token,p,'sight');
    const lineOfSight = this.sight(attackOrigin, target);
    const physicalPath = clearAttackPath(this.token, target, rayAt(this.token,p,'move'));
    const knownHiddenSquare = target.memoryView?.attackOnSight&&!target.memoryView.searchRequired;
    const lineOfEffect = physicalPath && lineOfSight && (!target.memoryView || target.memoryView.allowAttackEstimate || knownHiddenSquare);
    const inReach = distance <= reach && lineOfEffect;
    const flanked = Boolean(game.pf2e.settings.automation.flanking && inReach && target.actor.attributes.flanking.flankable &&
      this.actor.attributes.flanking.canFlank && allies.some(ally => ally.canFlank(target) && this.token.onOppositeSides(proxy, ally, target)));
    const environment = environmentBetween(this.token, target, { origin: attackOrigin });
    return { distance, lineOfEffect, lineOfSight, physicalPath, inReach, flanked, alliesInReach: allies.length,
      coverBonus: environment.coverBonus, concealmentDC: target.memoryView?.detection==='hidden'?11:concealmentDC(this.token,target,environment), environment };
  }
  movementThreats(cell, position = this.topLeft(cell)) {
    if (!this.reactions?.reactors) return [];
    const proxy = tokenAt(this.token,{...position,elevation:position.elevation??this.token.document.elevation});
    // Planning uses known creatures. Actual reaction execution remains separate;
    // an unseen enemy can still react when its trigger occurs.
    return this.reactions.reactors(proxy,{planning:true}).filter(token => !token.document.hidden &&
      !token.actor.hasCondition('hidden', 'undetected', 'unnoticed', 'invisible'));
  }

  async snapshot(ledger, { movement = true, movementRequired = false, budget:workBudget } = {}) {
    await this.waitForMovement();
    const { strike, remaster, averageDamage, pack, knockdown } = this.parts(), origin = this.originCell();
    const roster = this.targetIds();
    // Preview projects observations without writing. Actual turns persist them
    // in prepareTurn so loss of sight preserves each observer's last known square.
    const targetChecks = targetKnowledge(this).checks;
    const targets = targetChecks.map(check => check.target).filter(Boolean);
    const awareness = new Map(targetChecks.map(check => [check.id, check.awareness]));
    // A suspected square is also a legal movement goal. Getting closer or
    // changing the viewpoint grants no automatic detection of its occupant.
    const movementGoals = targets;
    const morale = packAssessment(this);
    const previousStyle = this.token.document.getFlag(MODULE_ID, 'playState');
    const play = previousStyle?.combatId === game.combat.id ? previousStyle : {};
    const style = { enabled: this.config.entertaining !== false,
      showcaseBonus: this.config.showcaseBonus ?? 4, knockdownShown: Boolean(play.knockdownShown), packShown: Boolean(play.packShown) };
    const frontLine = style.enabled ? frontlineAssessments(targets) : new Map();
    const allyMap = new Map(targets.map(t => [t.id, t.memoryView ? [] : this.allies(t)]));
    const enemies = targets.map(target => ({
      id: target.id, name: target.name, awareness: awareness.get(target.id), ...this.targetAt(origin, target, allyMap.get(target.id), this.actualWaypoint()),
      prone: target.actor.hasCondition('prone'), offGuard: target.actor.hasCondition('off-guard'),
      frontline: frontLine.get(target.id)?.frontline ?? false,
      trippable: target.document.movementAction !== 'swim' && (!remaster || (sizeOrder.indexOf(target.actor.size) >= 0 && sizeOrder.indexOf(target.actor.size) <= sizeOrder.indexOf(this.actor.size) + 1)) &&
        !target.actor.system.traits.value.includes('swarm') && !target.actor.attributes.immunities.some(i => i.type === 'prone'),
    }));
    const currentThreats = this.movementThreats(origin, this.actualWaypoint());
    const self = {
      prone: this.actor.hasCondition('prone'), immobile: this.actor.hasCondition('immobilized', 'grabbed', 'restrained'),
      restrained: this.actor.hasCondition('restrained'),
      canStand: (this.actor.getCondition('prone', { all: true }) ?? []).every(condition => condition.id && !condition.isLocked && !condition.readonly && !condition.inMemoryOnly),
      strikeId: strike.item.id, attackBonus: strike.totalModifier, averageDamage, packDamage: pack ? 2.5 : 0,
      athleticsBonus: this.actor.getStatistic?.('athletics')?.check?.mod ?? this.actor.system.skills?.athletics?.base,
      // Recovered DD benchmark table; never inspect a target's base AC for ranking.
      referenceAC: standardArmorClass(this.encounterLevel()), encounterLevel: this.encounterLevel(),
      cell: origin, reachSquares: this.planningReach() / 5,
      threatened: currentThreats.length > 0,
      reactionRisk: currentThreats.length * averageDamage,
      mapPenalties: [0, strike.variants[1]?.penalty ?? -5, strike.variants[2]?.penalty ?? -10],
      knockdown: Boolean(knockdown), knockdownCost: 1, remaster,
    };
    const moves = [];
    let nearestEnemy, retreatDistance;
    let retreatComplete = this.token.document.getFlag(MODULE_ID, 'retreated')?.combatId === game.combat.id && morale.enabled;
    const speed = this.planningSpeed();
    const freeStride = ledger.freeEscapeStride && !self.prone;
    const budget = self.prone || freeStride ? 5 : speed;
    const activeRegions = this.activeMovementRegions();
    let movementBlocked = !movement ? 'movement was not requested' : self.immobile ? 'the wolf is immobilized' : !movementGoals.length && !morale.broken && !movementRequired ? targets.length ? 'investigate the remembered area with Seek' : 'no known eligible enemies in the target roster' :
      activeRegions.length ? `Region behaviors require manual movement: ${activeRegions.map(region => region.name).join(', ')}` :
      !Number.isFinite(speed) || speed <= 0 || speed > 100 ? 'ground Speed is unavailable or outside the supported range' : null;
    // Empty Regions have no movement effects. Active Region behaviors still need explicit handlers.
    if (!movementBlocked) {
      const movementContext = this.movementContext();
      const occupied = canvas.tokens.placeables.filter(t => t !== this.token && occupiesMovementSpace(t) &&
        t.document.elevation === this.token.document.elevation && t.document.level === this.token.document.level);
      const onMap = cell => {
        const p = this.topLeft(cell), rect = canvas.dimensions.sceneRect;
        return rect.contains(p.x, p.y) && rect.contains(p.x + canvas.grid.size * this.token.document.width - 1, p.y + canvas.grid.size * this.token.document.height - 1);
      };
      const overlaps = (cell, token) => {
        const p = this.topLeft(cell);
        return p.x < token.document.x + token.w && p.x + canvas.grid.size * this.token.document.width > token.document.x &&
          p.y < token.document.y + token.h && p.y + canvas.grid.size * this.token.document.height > token.document.y;
      };
      // Same-alliance creatures are willing to let this NPC pass. Do not treat
      // them as walls or difficult terrain. Objects and other creatures still block.
      const blocksPassage = occupied.filter(token => !(token.actor?.isOfType?.('creature') && !this.actor.hasCondition('confused') && this.actor.isAllyOf(token.actor)));
      const canEnter = cell => onMap(cell) && pitWalkable(this.token.document,this.topLeft(cell)) && !blocksPassage.some(token => overlaps(cell, token));
      // The AI plans each Stride to a clear endpoint; it does not plan the special
      // case of ending atop an ally and immediately spending another move to leave.
      const canStop = cell => onMap(cell) && !occupied.some(token => overlaps(cell, token));
      const threats = new Map();
      const at = cell => {
        const key = `${cell.x},${cell.y}`;
        if (!threats.has(key)) threats.set(key, this.movementThreats(cell, cell.x === origin.x && cell.y === origin.y ? this.actualWaypoint() : this.topLeft(cell)));
        return threats.get(key);
      };
      const canTraverse = (from, to) => {
        const start = from.path?.length === 1 ? this.actualWaypoint() : this.waypoint(from);
        if(iceBlocksMovement(this.token,start,this.waypoint(to),tokenHeight(this.token)))return false;
        // Shared vertical route planning is taught separately. A ground-only
        // plan must not unexpectedly change elevation during execution.
        try{if(!sameSurfaceElevation(this.token.document,[start,this.waypoint(to)]))return false;}catch{return false;}
        const [, constrained] = this.token.constrainMovementPath([start, this.waypoint(to)], { ignoreWalls: false, ignoreCost: false });
        return !constrained;
      };
      await workBudget?.checkpoint();
      const cells = await (workBudget?reachableCellsAsync:reachableCells)(origin, budget, {
        canEnter, canStop, canTraverse,
        pathCost: path => this.strideCost(path, movementContext),
        edgeRisk: (from,to) => ({ reactionIds: at(from).map(token => token.id), hazardous: hazardousAt(this.token,this.topLeft(to)).length>0 }),
      },workBudget);
      const approach=await (workBudget?approachNavigationAsync:approachNavigation)(this,{targets:movementGoals,awareness,origin,reachable:cells,canEnter,canStop,reachSquares:self.reachSquares},workBudget);
      nearestEnemy=approach.nearestEnemy;
      let exitDistances;
      if (morale.broken) {
        const rect = canvas.dimensions.sceneRect, size = canvas.grid.size;
        const first = this.cell({ x: rect.x + size / 2, y: rect.y + size / 2 });
        const last = this.cell({ x: rect.x + rect.width - size * this.token.document.width + size / 2, y: rect.y + rect.height - size * this.token.document.height + size / 2 });
        const boundary = new Map();
        const consider = cell => {
          if (canStop(cell) && targets.every(target => this.targetAt(cell, target, []).distance >= 30)) boundary.set(`${cell.x},${cell.y}`, cell);
        };
        for (let x = first.x; x <= last.x; x++) { consider({ x, y: first.y }); consider({ x, y: last.y }); }
        for (let y = first.y; y <= last.y; y++) { consider({ x: first.x, y }); consider({ x: last.x, y }); }
        const isExit = boundary.has(`${origin.x},${origin.y}`) ||
          (origin.x === first.x || origin.x === last.x || origin.y === first.y || origin.y === last.y) &&
          targets.every(target => this.targetAt(origin, target, []).distance >= 30);
        retreatComplete ||= Boolean(isExit);
        exitDistances = enemyDistances([...boundary.values(), ...(isExit ? [origin] : [])], {
          needed: [origin, ...cells], canVisit: cell => canEnter(cell) || cell.x === origin.x && cell.y === origin.y,
          canCross: (from, to) => canTraverse(from, to) &&
            (from.x === to.x || from.y === to.y || canEnter({ x: from.x, y: to.y }) && canEnter({ x: to.x, y: from.y })),
        });
        retreatDistance = exitDistances.get(`${origin.x},${origin.y}`);
      }
      for (const cell of cells) {
        await workBudget?.checkpoint();
        if (!cell.cost) continue;
        const reactors = new Set(cell.risk.reactionIds);
        const destinationThreats=at(cell).length;
        const move = { ...cell, kind: self.prone ? 'crawl' : freeStride ? 'escapeStride' : 'stride',
          retreatDistance: exitDistances?.get(`${cell.x},${cell.y}`),
          nearestEnemy: approach.distanceAt(cell),
          provokes: reactors.size > 0, reactionRisk: reactors.size * averageDamage, destinationThreatened: destinationThreats > 0,
          destinationReactionRisk: destinationThreats * averageDamage,
          terrainRisk: terrainRiskForPath(this.token,cell.path,node=>this.waypoint(node)),
          targets: Object.fromEntries(targets.map(t => [t.id, this.targetAt(cell, t, allyMap.get(t.id))])) };
        moves.push(move);
        // Stride may prefer a longer safe route to an adjacent square. Evaluate
        // direct Step independently so that route preference cannot hide it.
        const dx = Math.abs(cell.x - origin.x), dy = Math.abs(cell.y - origin.y);
        const directPath = [origin, { x: cell.x, y: cell.y }];
        if (!self.prone && !freeStride && speed >= 10 && dx <= 1 && dy <= 1 &&
          canTraverse({ ...origin, path: [origin] }, cell) &&
          (!(dx && dy) || canEnter({ x: cell.x, y: origin.y }) && canEnter({ x: origin.x, y: cell.y })) &&
          this.strideCost(directPath, movementContext,'walk','step') <= 5 && this.strideCost(directPath, { history: [], historyCost: 0 },'walk','step') <= 5) {
          moves.push({ ...move, kind: 'step', path: directPath, cost: this.strideCost(directPath, movementContext,'walk','step'), provokes: false, reactionRisk: 0,
            risk: { state: 0, provokes: false, hazardous: false, tumbles: false, reactionIds: [] } });
        }
      }
      if (!moves.length) movementBlocked = 'no reachable unoccupied destination within the wolf’s Speed';
    }
    const rejectedTargets = targetChecks.filter(check => check.reason).map(({ id, name, reason }) => ({ id, name, reason }));
    // An exhausted roster is a completed turn. Missing/hidden/unreachable targets
    // and movement restrictions need review and must not silently end combat turns.
    const encounterComplete = !enemies.length && targetChecks.length > 0 && targetChecks.every(check => {
      const target = canvas.tokens.get(check.id);
      if (!target?.actor || !canAssignTarget(this.actor, target.actor)) return false;
      const combatant = game.combat.combatants.find(c => c.tokenId === check.id && combatantSceneId(c) === canvas.scene.id);
      return Boolean(combatant && (combatant.defeated || target.actor.hitPoints?.value <= 0 || target.actor.hasCondition('unconscious', 'dying')));
    });
    const noActionReason = !enemies.length ? `${this.targetMode === 'alliance' ? 'No eligible opposing-alliance enemies in this combat scene.' : 'No eligible assigned enemies.'}${rejectedTargets.length ? ' ' + rejectedTargets.map(check => `${check.name}: ${check.reason}`).join('; ') : ''}` :
      movementBlocked ? `No useful supported action from this position. Movement unavailable: ${movementBlocked}.` :
      'No useful supported action from this position.';
    const bindings = escapeBindings(this.actor), escapes = escapeOptions(this);
    const perception=this.actor.getStatistic('perception');
    const seek={available:Boolean(perception?.check?.roll)&&!this.actor.hasCondition('paralyzed')&&
      (!this.actor.hasCondition('blinded')||Boolean(nonvisualSense(this.token))),imprecise:this.actor.hasCondition('blinded'),bonus:perception?.check?.mod??0,scope:this.actor.hasCondition('fascinated')?'area':seekScope(),
      origin:Object.fromEntries(['x','y','elevation','level','width','height','depth'].map(key=>[key,this.token.document[key]])),
      suspectedOpponents:targetChecks.filter(check=>!check.target&&check.reason?.includes('no known square')&&!canvas.tokens.get(check.id)?.document.hidden).length};
    const actionTraits=Object.fromEntries([...this.actor.items?.values?.()??[]].map(item=>[item.id,[...item.traits??item.system?.traits?.value??[]]]));
    return { self, enemies, moves, style, morale, retreatComplete, retreatDistance, seek,conditionRules:{...conditionFacts(this.actor),actionTraits},sickenedRecovery:retchSource(this.actor),
      escapes: escapes.map(({ id, dc, statistic, bonus }) => ({ id, dc, statistic, bonus })), nearestEnemy, ...ledger,
      diagnostics: { policy: 'dawnsbury-4.44-pack', referenceAC: self.referenceAC, encounterLevel: self.encounterLevel,
      morale, retreatComplete, style,
      frontlineAnalysis: [...frontLine.values()],
      pursuitTargets: enemies.filter(enemy => enemy.awareness.state !== 'observed').map(({ id, name, awareness }) => ({ id, name, ...awareness })),
      environmentTargets: enemies.filter(enemy => enemy.coverBonus || enemy.concealmentDC).map(({ id, name, coverBonus, concealmentDC }) => ({ id, name, coverBonus, concealmentDC })),
      runtimeVersion: RUNTIME_VERSION,
      escapeSources: bindings.map(group => {
        const option = escapes.find(option => option.id === group.id);
        return { id: group.id, name: group.root.name ?? group.root.slug, configured: Boolean(option), removable: group.removable,
          kind: group.kind, blockedReason: group.blockedReason, recordedSource: option?.recordedSource ?? false,
          sourceName: option?.target?.name ?? null, dc: option?.dc, statistic: option?.statistic };
      }),
      usableTargets: enemies.length, rejectedTargets, encounterComplete, targetMode: this.targetMode, roster,
      position: this.actualWaypoint(), enemies: enemies.map(({ id, distance, inReach, flanked, lineOfSight, physicalPath }) => ({ id, distance, inReach, flanked, lineOfSight, physicalPath })),
      movementBlocked, reachableDestinations: moves.length,
      noActionReason: self.restrained && !escapes.length && bindings.length ?
        bindings.some(group => group.removable) ? 'Escape is unavailable. Use Escape sources to check its source/DC and the wolf\'s available Escape statistic.' :
          `Escape needs manual handling: ${bindings.map(group => group.blockedReason ?? group.root.name ?? group.root.slug).join('; ')}. No action was spent.` : noActionReason } };
  }
  decide() { throw new Error('No decision policy is registered'); }
  candidates() { throw new Error('No capability providers are registered'); }

  async revalidate(choice, ledger,options={}) {
    await this.assertReady();
    if (ledger.turn !== this.turnKey()) throw new Error('The combat turn changed');
    const conditionReason=manualConditionViolation(this.actor,nativeRuleAction(this.actor.items?.get?.(choice.spellId??choice.strikeId),
      {kind:choice.kind,targetId:choice.targetId}));
    if(conditionReason)throw new Error(conditionReason);
    const current = await this.snapshot(ledger,options);
    // Revalidate legality without making a new random decision.
    const available = (await (this.planningCandidates?.(current,options)??this.candidates(current))).find(candidate => candidate.id === choice.id && candidate.legal);
    if (!available || available.actionCost > ledger.actionsRemaining || (available.bonusActionCost ?? 0) > (ledger.bonusMovementActions ?? 0)) throw new Error('The chosen action is no longer available');
    if (choice.kind === 'stand') this.removableProneConditions();
    if (choice.path && JSON.stringify(available.path) !== JSON.stringify(choice.path)) throw new Error('The movement path changed; preview again');
    const plannedSight=choice.features?.destinationSightTargets??[];
    const requiredSight=plannedSight.includes(choice.targetId)?[choice.targetId]:plannedSight;
    if(requiredSight.length&&!requiredSight.some(id=>available.features?.destinationSightTargets?.includes(id)))
      throw new Error('Sight from the planned destination changed; preview again');
    if (choice.kind==='seek'&&(available.searchScope!==choice.searchScope||JSON.stringify(available.searchPosition)!==JSON.stringify(choice.searchPosition))) throw new Error('The search scope or remembered area changed; preview again');
    if (choice.kind === 'escape' && (available.statistic !== choice.statistic || available.estimate.dc !== choice.estimate.dc)) throw new Error('The Escape statistic or DC changed; preview again');
  }

  removableProneConditions() {
    const conditions = this.actor.getCondition('prone', { all: true });
    if (!conditions.length || conditions.some(condition => !condition.id || condition.isLocked || condition.readonly || condition.inMemoryOnly)) {
      throw new Error('Prone has a locked, granted, or unavailable source. Resolve it manually before Stand; no additional Stand action will be spent.');
    }
    return conditions;
  }

  async execute(choice, ledger, { canContinue = () => true, signal } = {}) {
    const valid = () => canContinue() && this.turnKey() === ledger.turn && !game.paused &&
      game.users.activeGM?.id === game.user.id;
    if (!await this.waitForReactions({ signal }) || !valid()) {
      return { skipped: true, pause: true, skipReason: 'Automation stopped while waiting for a reaction. No additional action was spent.' };
    }
    const actor = this.actor;
    if(choice.kind==='retch')return executeRetch(this.token,{valid});
    if(['strike','trip','knockdown','sweepingHook','spikeVolley','eagleDive','castSpell','gaze'].includes(choice.kind)&&choice.targetId)
      await breakFascination(canvas.tokens.get(choice.targetId)?.actor);
    if(choice.kind!=='castSpell'&&!await resolveConditionChecks(actor,choice,{token:this.token,valid}))return {resolved:true,note:'Condition flat check failed; the reserved action remains spent.'};
    if(choice.kind==='seek')return executeSeek(this,choice,ledger,{canContinue});
    const reactions = this.config.pauseForReactions !== false ? this.reactions : null;
    if (['stride', 'step', 'crawl', 'escapeStride'].includes(choice.kind)) {
      await this.waitForMovement();
      const from = this.actualWaypoint(), context = this.movementContext(), speed = this.groundSpeedFor(choice);
      const grease = await prepareGreaseMove(this.token,this.movementWaypoints(choice.path),{kind:choice.kind,valid,speed:choice.kind==='stride'?speed:5,
        baseCost:points=>Math.max(0,this.token.measureMovementPath([...context.history,...terrainMovementPath(this.token,points)]).cost-context.historyCost)});
      if (grease.blocked) return {resolved:true,destination:null,forfeitActions:grease.forfeitActions,pause:grease.pause,note:grease.note,
        movement:{from,to:from,completed:false,arrived:false,cost:0}};
      if (grease.path.length < 2) {
        const fallen=grease.fallOnArrival&&await finishGreaseFall(this.token,{valid});
        return {resolved:true,destination:null,forfeitActions:Boolean(fallen),note:grease.note??'No movement remains after the Balance check.'};
      }
      if (grease.path.length < choice.path.length) choice={...choice,path:choice.path.slice(0,grease.path.length),destination:choice.path[grease.path.length-1]};
      return withGreaseMode(this.token,grease.mode??choice.kind,async()=>{
      const cost = this.strideCost(choice.path, context,'walk',choice.kind);
      const limit = choice.kind === 'stride' ? speed : 5;
      if (this.actor.hasCondition('immobilized', 'grabbed', 'restrained') ||
        (this.actor.hasCondition('prone') !== (choice.kind === 'crawl'))) throw new Error('The wolf can no longer use this movement action; inspect the reserved action');
      if (!Number.isFinite(cost) || cost > limit + 1e-8 || (choice.kind === 'step' && (speed < 10 || choice.path.length !== 2 ||
        this.strideCost(choice.path, { history: [], historyCost: 0 },'walk',choice.kind) > 5))) throw new Error('The path exceeds this movement action or enters unsupported terrain; inspect the reserved action');
      const nativeAction = choice.kind === 'crawl' ? 'crawl' : 'walk';
      const nativeCost = this.strideCost(choice.path, context, nativeAction,choice.kind);
      const moveOptions = {
        ...this.movementOptions(choice),
        [MANAGED_MOVEMENT]: true,
        showRuler: this.movementOptions(choice).showRuler ?? true, constrainOptions: { ignoreWalls: false, ignoreCost: false,
          // Foundry always includes recorded history in this cap, even with history:false.
          maxCost: context.historyCost + (choice.kind === 'stride' ? speed : nativeCost) },
      };
      beginTerrainAction(this.token,`${ledger.turn}:${ledger.actionsRemaining}:${ledger.attacksMade}:${ledger.bonusMovementActions??0}:${choice.kind}`);
      try {
      let completed = true, pauseReason, attemptedPath=[];
      const crossesHazard=choice.path.some(cell=>hazardousAt(this.token,this.topLeft(cell)).length>0);
      if ((choice.kind !== 'step' && reactions?.hasMovementReactors(this.token)) || crossesHazard) {
        const seen = new Set();
        for (const cell of choice.path.slice(1)) {
          const before = this.actualWaypoint();
          const unchanged = () => {
            const current = this.actualWaypoint();
            return valid() && ['x', 'y', 'elevation', 'level'].every(key => current[key] === before[key]);
          };
          const result = choice.kind==='step'?{}:await reactions?.movement({ mover: this.token, seen, valid: unchanged, applyDamage: this.config.applyDamage, allowProne: choice.kind === 'crawl' })??{};
          if (result.endTurn) { completed = false; break; }
          if (result.pause || !unchanged()) {
            completed = false;
            pauseReason = result.pauseReason ?? 'Movement or the combat turn changed during a reaction. Inspect the spent move action before resuming.';
            break;
          }
          attemptedPath=[before,this.waypoint(cell,nativeAction)];
          completed = await this.token.document.move([this.waypoint(cell, nativeAction)], moveOptions);
          await this.waitForMovement();
          if(!await this.waitForReactions({signal})||!valid()||this.turnEndReason()){completed=false;break;}
          const actual = this.actualWaypoint(), expected = this.topLeft(cell);
          if (!completed || Math.abs(actual.x - expected.x) > 1 || Math.abs(actual.y - expected.y) > 1) { completed = false; break; }
        }
      } else {
        attemptedPath=this.movementWaypoints(choice.path,nativeAction);
        completed = await this.token.document.move(choice.path.slice(1).map(cell => this.waypoint(cell, nativeAction)), moveOptions);
      }
      await this.waitForMovement();
      const wasProne=choice.kind==='crawl';
      const slipped=Boolean(grease.fallOnArrival||!wasProne&&this.actor.hasCondition('prone'));
      const pendingFall=Boolean(grease.fallOnArrival&&attemptedPath.at(-1)&&
        inGrease(this.token,attemptedPath.at(-1)).length);
      const landing=slipped&&attemptedPath.length&&valid()&&!this.turnEndReason()?await settleGreaseSlip(this.token,{
        path:attemptedPath,fall:pendingFall,valid}):null;
      const fell=Boolean(landing?.settled&&(grease.fallOnArrival?await finishGreaseFall(this.token,{valid}):this.actor.hasCondition('prone')));
      const to = this.actualWaypoint(), destination = choice.destination ?? choice.path.at(-1), expected = this.topLeft(destination);
      const arrived = Math.abs(to.x - expected.x) <= 1 && Math.abs(to.y - expected.y) <= 1;
      const moved = Math.hypot(to.x - from.x, to.y - from.y) > 0.5;
      const ended = this.turnEndReason();
      const interrupted = !ended && !fell && (!completed || !arrived);
      // A constrained native move is a resolved, spent action. Rebuild choices
      // from the actual position; only an explicit stop or unresolved reaction
      // pauses the runner, rather than every shortened Stride.
      const paused = !ended && (Boolean(pauseReason) || !valid());
      const landingIndex=fell?choice.path.findIndex(cell=>Math.abs(this.topLeft(cell).x-to.x)<=1&&Math.abs(this.topLeft(cell).y-to.y)<=1):-1;
      const movementCost=fell&&landingIndex>=0?this.strideCost(choice.path.slice(0,landingIndex+1),context,'walk',choice.kind):
        completed&&arrived?cost:this.token.document.movement?.passed?.cost??null;
      return { destination: moved ? this.originCell() : null,
        retreatComplete: completed && arrived && !ended && packAssessment(this).broken && this.safeRetreatExit(),
        endTurn: Boolean(ended), incapacitationReason: ended,
        note: fell?grease.note??'The creature fell prone and settled on its Grease square. The movement action is complete.':
          interrupted&&!paused?[grease.note,'Foundry stopped or constrained the movement. The action remains spent; reassessing the turn from the actual position.'].filter(Boolean).join(' '):grease.note,
        forfeitActions:fell&&Boolean(grease.forfeitActions),
        movement: { from, to, completed:completed||fell, arrived, cost:movementCost },
        pause: paused,
        pauseReason: paused ? pauseReason ?? 'Automation stopped or the combat context changed. The movement action remains spent.' : null };
      } finally { endTerrainAction(this.token); }
      });
    }
    if (choice.kind === 'escape') return executeEscape(this, choice, ledger, valid);
    if (choice.kind === 'stand') {
      // PF2e decreaseCondition("prone") deletes only one entry. Duplicate Prone
      // entries represent the same posture, so clearing them costs one Stand.
      const conditions = this.removableProneConditions();
      await actor.deleteEmbeddedDocuments('Item', conditions.map(condition => condition.id));
      // Re-read the token's current actor: synthetic actor documents can change
      // during an embedded update. Never spend another Stand on an unchanged state.
      if (this.actor.hasCondition('prone')) {
        throw new Error('Stand was attempted but Prone is still active. Automation stopped before another Stand. Check the condition sources and correct the spent-action counts before resuming.');
      }
      // A move action that does not leave a square triggers after it resolves.
      return await reactions?.movement({ mover: this.token, seen: new Set(), trigger: 'finishes Standing',
        valid, applyDamage: this.config.applyDamage }) ?? {};
    }
    return this.executeProfileAction(choice, ledger, { canContinue, signal });
  }

  async executeProfileAction(choice) { throw new Error(`Unsupported capability action: ${choice.kind}`); }
  async recordOutcome() {}

  async applyDamage(target, damage, item, outcome, { valid = () => true, captureDamage = false } = {}) {
    const apply = () => this.applyResolvedDamage(target, damage, item, outcome, { valid, captureDamage });
    // Keep the shared barrier through native HP/shield updates and confirmation,
    // rather than releasing it as soon as the owner clicks a dialog button.
    return this.config.pauseForReactions !== false && this.reactions ? this.reactions.resolve(apply) : apply();
  }
  async applyResolvedDamage(target, damage, item, outcome, { valid, captureDamage = false }) {
    const relationship = this.actor.isAllyOf(target.actor) ? 'origin:ally' : this.actor.isEnemyOf(target.actor) ? 'origin:enemy' : 'origin:neutral';
    const flags = [...this.actor.getSelfRollOptions('origin'), ...target.actor.getSelfRollOptions(), relationship,
      ...this.actor.getRollOptions(['all', 'damage']).filter(option => !/^(self|target):/.test(option)),
      ...(item?.getRollOptions('item') ?? []), MANAGED_OPTION, `outcome:${outcome}`];
    const damageValid = () => valid() && canvas.tokens.get(target.id) === target;
      const block = this.config.pauseForReactions !== false && this.reactions
        ? await this.reactions.shieldBlock({ origin: this.token, target, damage,item, valid: damageValid }) : false;
    if (!damageValid()) throw new Error('Automation stopped before damage application. Resolve the rolled damage and correct action counts before resuming.');
    const apply=()=>target.actor.applyDamage({ damage, token: target.document, item, rollOptions: new Set(flags), outcome, shieldBlockRequest: Boolean(block) });
    const result=captureDamage?await captureAppliedDamage(target.actor,apply):await apply();
    if (block) await this.reactions.confirm(block.token, block.reservation);
    return result;
  }
  async report(decision, ledger, result = {}) {
    const choice = decision.chosen;
    if (ledger.completionReason === 'retreated') {
      await this.token.document.setFlag(MODULE_ID, 'retreated', { combatId: game.combat.id });
    }
    await this.recordOutcome(choice, ledger, result);
    const decisionLog = decisionExplanation(decision);
    this.lastDecision = decisionLog;
    const target = choice?.targetId ? canvas.tokens.get(choice.targetId)?.name : '';
    const explanation = (!choice || choice.kind === 'endTurn') && ledger.actionsRemaining > 0 && !ledger.done
      ? decision.diagnostics?.noActionReason ?? 'No useful supported action is currently available.' : null;
    const movementCost = result.movement ? result.movement.cost : choice?.movementCost;
    const measured = Number.isFinite(movementCost) ? `${Number(movementCost.toFixed(2))} ft, ` : '';
    const purpose = ['stride', 'step', 'crawl', 'escapeStride','fly','eagleDive'].includes(choice?.kind) ? ` (${measured}${choice.kind === 'escapeStride' ? 'free Escape movement' : choice.intent ?? 'approach'})` : '';
    const skipped = result.skipped ? ' (skipped)' : '';
    const currentEndReason = ledger.completionReason === 'incapacitated' ? this.turnEndReason() : null;
    const endNote = currentEndReason
      ? `<p>${escapeHTML(this.token.name)} can no longer act (${escapeHTML(currentEndReason)}). Its turn is complete.</p>`
      : ledger.completionReason === 'battle-over' ? `<p>${escapeHTML(decision.diagnostics?.noActionReason ?? 'Battle over. Creature AI stopped.')}</p>` :
        ledger.completionReason === 'no-enemies' ? '<p>All enemies in the current target roster are defeated or unconscious.</p>' :
        ledger.completionReason === 'escape-blocked' ? '<p>Escape critically failed and cannot be attempted again this turn. No other supported action is available; unused actions are forfeited.</p>' :
        ledger.completionReason === 'retreated' ? (this.actor.getFlag?.(MODULE_ID,'vampire')?.escaped?'<p>The vampire escaped as mist toward its coffin. Its token stays at the scene border; coffin arrival is not assumed.</p>':'<p>The creature escaped to a scene edge, at least 30 feet from known enemies. It will sit out this combat; its token remains for the GM.</p>') :
        decision.diagnostics?.holdForApproach ? '<p>Holding a casting position and letting the melee enemies come closer.</p>' : '';
    await ChatMessage.create({
      content: `<p><strong>${escapeHTML(this.token.name)}</strong>: ${escapeHTML(choice?.kind ?? 'endTurn')}${skipped}${target ? ` → ${escapeHTML(target)}` : ''}${escapeHTML(purpose)} · ${ledger.actionsRemaining} actions left.${ledger.bonusMovementActions ? ` Plus ${ledger.bonusMovementActions} ${ledger.hasteBonus?'Strike/Stride':'Step/Stride'}-only action.` : ''}</p><p><small>Creature AI ${RUNTIME_VERSION}</small></p>${endNote}${explanation ? `<p>${escapeHTML(explanation)} Remaining actions are preserved; you can retry.</p>` : ''}${result.skipReason ? `<p>${escapeHTML(result.skipReason)}</p>` : ''}${result.pauseReason ? `<p>${escapeHTML(result.pauseReason)}</p>` : ''}
        ${result.note ? `<p>${escapeHTML(result.note)}</p>` : ''}
        ${decisionLog.options.length ? `<details><summary>Why this decision?</summary>${renderDecisionExplanation(decisionLog)}</details>` : ''}`,
      whisper: ChatMessage.getWhisperRecipients('GM').map(user => user.id),
        flags: { [MODULE_ID]: { turn: ledger.turn, reason: decision.reason, choiceId: choice?.id,
          tokenId: this.token.id, sceneId: canvas.scene.id, runtimeVersion: RUNTIME_VERSION, decisionLog,
          assessment: choice?.assessment, estimate: choice?.estimate, tiedIds: decision.tiedIds, diagnostics: decision.diagnostics, movement: result.movement } },
    });
  }
}

export class PF2eWolfAdapter extends PF2eCreatureAdapter {
  decide(state) {
    const decision = chooseWolfAction(state, this.profile);
    const escapeExhausted = state.escapeBlocked && decision.chosen?.kind === 'endTurn' && escapeBindings(this.actor).length > 0;
    return { ...decision, reason: `${decision.reason}${state.morale?.broken ? `; pack retreat: ${state.morale.reason}` : ''}`,
      diagnostics: { ...state.diagnostics, ...decision.diagnostics, escapeExhausted } };
  }

  async executeProfileAction(choice, ledger, { canContinue = () => true } = {}) {
    const actor = this.actor;
    const valid = () => canContinue() && this.turnKey() === ledger.turn && !game.paused && game.users.activeGM?.id === game.user.id;
    const target = this.liveTarget(choice.targetId);
    if (!target) throw new Error(`Target unavailable before execution: ${this.assessTarget(choice.targetId).reason ?? 'target changed'}`);
    if (ledger.turn !== this.turnKey()) throw new Error('Target or turn changed before execution');
    if (actor.hasCondition('restrained')) throw new Error('A restrained wolf must Escape before it can attack');
    if (!clearAttackPath(this.token, target)) throw new Error('A physical barrier now blocks the attack; inspect the reserved action');
    if (!this.sight(this.token.center, target)) throw new Error('Line of sight now blocks the attack; inspect the reserved action');
    if (choice.kind === 'strike') {
      if (!await concealmentCheck(this.token, target, { valid })) return { resolved: true,
        lastAction: { kind: 'strike', hit: false, targetId: target.id, strikeId: choice.strikeId }, note: 'Concealment flat check failed. The action remains spent.' };
      const parts = this.parts();
      const previousPack = actor.getRollOptions(['damage']).includes('pack-attack');
      const packAttack = this.allies(target).length >= 2;
      try {
        if (previousPack !== packAttack) await actor.toggleRollOption('damage', 'pack-attack', parts.pack.id, packAttack);
        const strike = actor.system.actions.find(s => s.item.id === choice.strikeId);
        const variant = Math.min(ledger.attacksMade - 1, 2);
        const roll = await strike.variants[variant].roll({ target, options: [MANAGED_OPTION], event: rollEvent('check') });
        if (!roll || !Number.isInteger(roll.degreeOfSuccess)) throw new Error('Attack roll was cancelled or has no resolved outcome');
        if (ledger.turn !== this.turnKey()) throw new Error('Turn changed while the attack resolved');
        const hit = roll.degreeOfSuccess >= 2;
        if (hit) {
          const damage = await strike[roll.degreeOfSuccess === 3 ? 'critical' : 'damage']({
            target, mapIncreases: variant, options: [MANAGED_OPTION], event: rollEvent('damage'),
          });
          if (!damage) throw new Error('Damage roll was cancelled');
          if (this.config.applyDamage) await this.applyDamage(target, damage, strike.item, roll.degreeOfSuccess === 3 ? 'criticalSuccess' : 'success', { valid });
        }
        return { lastAction: { kind: 'strike', hit, targetId: target.id, strikeId: choice.strikeId },
          packShown: hit && packAttack, pause: hit && !this.config.applyDamage };
      } finally {
        if (previousPack !== packAttack) await actor.toggleRollOption('damage', 'pack-attack', parts.pack.id, previousPack);
      }
    }
    if (choice.kind === 'knockdown') {
      if (target.document.movementAction === 'swim') return { skipped: true, skipReason: 'A swimming creature cannot be knocked prone. Knockdown was not spent.' };
      // The target can become prone while the reservation is being saved.
      // No roll or mutation has happened here, so this action costs nothing.
      if (target.actor.hasCondition('prone')) {
        return { skipped: true, skipReason: 'Knockdown skipped: the target is already prone. No action was spent.' };
      }
      if (!await concealmentCheck(this.token, target, { valid })) return { resolved: true, note: 'Concealment flat check failed; Knockdown remains spent.' };
      if (!this.parts().remaster) {
        if (!target.actor.hasCondition('prone')) await target.actor.increaseCondition('prone');
        return { resolved: true };
      }
      const tripOptions = [MANAGED_OPTION, MANAGED_TRIP_OPTION, SKIP_RULE_AUTOMATION];
      const results = await game.pf2e.actions.get('trip').use({ actors: [actor], target, multipleAttackPenalty: 0, rollOptions: tripOptions, event: rollEvent('check') });
      const outcome = results?.[0]?.outcome;
      if (!outcome) throw new Error('Knockdown Trip was cancelled');
      if (ledger.turn !== this.turnKey()) throw new Error('Turn changed while Knockdown resolved');
      if (['success', 'criticalSuccess'].includes(outcome) && !target.actor.hasCondition('prone')) await target.actor.increaseCondition('prone');
      if (outcome === 'criticalFailure' && !this.actor.hasCondition('prone')) await this.actor.increaseCondition('prone');
      if (outcome === 'criticalSuccess') {
        const DamageRoll = CONFIG.Dice.rolls.find(cls => cls.name === 'DamageRoll');
        if (!DamageRoll) throw new Error('PF2e DamageRoll is unavailable');
        const damage = await new DamageRoll('1d6[bludgeoning]').evaluate();
        await damage.toMessage({ speaker: ChatMessage.getSpeaker({ token: this.token.document }),
          flavor: 'Wolf Knockdown — critical Trip', flags: { pf2e: { suppressDamageButtons: Boolean(this.config.applyDamage),
            context: { options: tripOptions } } } });
        if (this.config.applyDamage) await this.applyDamage(target, damage, null, outcome, { valid });
      }
      return { resolved: true, pause: outcome === 'criticalSuccess' && !this.config.applyDamage };
    }
    throw new Error(`Unsupported wolf action: ${choice.kind}`);
  }
  async recordOutcome(choice, ledger, result) {
    if (!result.skipped && (result.lastAction?.kind === 'strike' || choice?.kind === 'knockdown' && result.resolved)) {
      const old = this.token.document.getFlag(MODULE_ID, 'playState');
      const play = old?.combatId === game.combat.id ? old : {};
      await this.token.document.setFlag(MODULE_ID, 'playState', { combatId: game.combat.id,
        knockdownShown: Boolean(play.knockdownShown || choice.kind === 'knockdown'),
        packShown: Boolean(play.packShown || result.packShown) });
    }
  }
  get profileId() { return 'wolf'; }
  parts() { return wolfParts(this.actor); }
  candidates(state) { return buildWolfCandidates(state); }
  validateFootprint() {
    if (this.token.document.width !== 1 || this.token.document.height !== 1) throw new Error('The wolf profile requires a 1×1 token');
  }
}
