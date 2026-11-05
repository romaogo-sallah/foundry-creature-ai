import { createCreatureAdapter, creatureProfile, supportedProfiles, registerCreatureProfile } from './creature-profiles.mjs';
import { loadOgreFamily, expireCommands, cleanupOrphanCommands } from './command-effects.mjs';
import { resolveProfile } from '../decision-engine.mjs';
import { TurnRunner } from '../framework/turn-runner.mjs';
import { MODULE_ID, MANAGED_OPTION, escapeHTML, renderDecisionExplanation } from './pf2e-adapter.mjs';
import { decisionExplanation } from '../wolf/decision-explanation.mjs';
import { ReactionEngine, REACTION_OPTION, REACTION_AUTO_DAMAGE } from './reactions.mjs';
import { allianceSide, canAssignTarget, targetingMode, targetRoster } from './targeting.mjs';
import { configureEscapes } from './escape.mjs';
import { ManualMovement } from './manual-movement.mjs';
import { rememberTargets, movementKnowledge } from './target-memory.mjs';
import { RUNTIME_VERSION } from './runtime-version.mjs';
import {planningWorker} from './planning-worker.mjs';
import {installPoisonHooks,advancePoisons,expirePoisons} from './poison-effects.mjs';
import { installGreaseLandingHooks } from './grease-landing.mjs';
import { behaviorAPI, behaviorConfiguration, behaviorCatalog, configureBehaviors } from './behavior-runtime.mjs';
import { configureZone, environmentBetween, openZones } from './environment-zones.mjs';
import { installEnvironmentRolls } from './environment-rolls.mjs';
import { installStealthVisibility, refreshStealthVisibility, openStealthControls, detectionFor } from './stealth-awareness.mjs';
import { createHazardHandler, installHazardMovement } from './hazardous-terrain.mjs';
import { applySceneSetup } from './scene-setup.mjs';
import { ZoneConcealment } from './zone-concealment.mjs';
import { EnvironmentAwareness, TOKEN_GEOMETRY_FIELDS } from './environment-awareness.mjs';
import { PlayerStealth } from './player-stealth.mjs';
import { AIPresentation, registerPresentationSettings, applyAIRollPrivacy, applyAIDiceSuppression } from './ai-presentation.mjs';
import { registerPerceptionSettings } from './npc-perception.mjs';
import {renderTacticalMap} from './tactical-map-view.mjs';
import { creatureControlsLayout, ensureCreatureControlsStyles } from './controls-layout.mjs';
import { resetActorsToPrototype } from './actor-reset.mjs';
import { refreshSpellZones, expireSpellZones, installGreaseTerrain } from './spell-zones.mjs';
import { GoblinScuttle } from './goblin-scuttle.mjs';
import {installFlightCosts} from './flight-costs.mjs';
import {installFlightFalls} from './flight-falling.mjs';

let profile;
const aiPresentation=new AIPresentation();
const reactions = new ReactionEngine({ presentation:aiPresentation,onPause: () => stop(), automaticReactiveStrike: token => {
  if (resettingActors) return false;
  const config = token.document.getFlag?.(MODULE_ID, 'config');
  if (token.actor?.type !== 'npc' || !config?.enabled || config.autoReactions === false) return false;
  try { return creatureProfile(token.actor).id === 'ogre-boss'; } catch { return false; }
} });
const playerStealth = new PlayerStealth({ enabled: () => game.settings?.get(MODULE_ID, 'playerStealth') ?? true, onError: showError });
const goblinScuttle = new GoblinScuttle(reactions,{presentation:aiPresentation});
reactions.afterMoveAction = (...args)=>goblinScuttle.afterMove(...args);
const manualMovement = new ManualMovement(reactions, {
  playerStealth,
  onMoveAction:(...args)=>goblinScuttle.afterMove(...args),
  enabled: () => !resettingActors && game.settings.get(MODULE_ID, 'manualMovementReactions'), onError: showError,
});
const onHazardMove=createHazardHandler({resolve:operation=>reactions.resolve(operation),onPause:()=>stop()});
const zoneConcealment = new ZoneConcealment();
const environmentAwareness = new EnvironmentAwareness({ enabled: () => game.settings.get(MODULE_ID, 'directionalZoneIndicators') });
const refreshConcealment = () => zoneConcealment.refresh().catch(showError);
const refreshEnvironmentView = id => environmentAwareness.schedule(id).catch(showError);
const refreshPlayerStealth = () => playerStealth.refresh().catch(showError);
function refreshActorCaptions(actor) {
  if (!canvas.ready || !actor) return;
  for (const token of canvas.tokens.placeables) if (token.actor === actor || actor.uuid && token.actor?.uuid === actor.uuid) void refreshEnvironmentView(token.id);
}
function refreshTerrain(){
  if(!canvas.ready)return;
  refreshStealthVisibility();
  canvas.tokens.recalculatePlannedMovementPaths?.();
  return Promise.all([refreshConcealment(), refreshEnvironmentView(), refreshPlayerStealth(),refreshSpellZones()]);
}
let automaticStartsPaused = false;
let resettingActors = false;
const runners = new Map();
const activeRuns = new Map();
const announcedOutcomes = new Set();
function stopCompletedEncounter(outcome) {
  stop();
  if (!announcedOutcomes.has(outcome.combatId)) {
    announcedOutcomes.add(outcome.combatId);
    ui.notifications.info(outcome.message);
  }
}
function selected() {
  const tokens = canvas.tokens.controlled;
  if (!game.user.isGM || tokens.length !== 1) throw new Error('Select exactly one taught NPC token as GM');
  createCreatureAdapter(tokens[0], profile).parts();
  return tokens[0];
}
function runnerFor(token) {
  if (!profile) throw new Error('Creature AI is still loading its profiles; try again in a moment');
  let runner = runners.get(token.id);
  if (!runner) { runner = new TurnRunner(createCreatureAdapter(token, profile, { reactions }),{presentation:aiPresentation,onEncounterComplete:stopCompletedEncounter}); runners.set(token.id, runner); }
  return runner;
}
async function showError(error) {
  console.error(`${MODULE_ID}:`, error);
  ui.notifications.error(`Creature AI: ${error.message}`);
}

export async function preview(token = selected(), config) {
  if (!profile) throw new Error('Creature AI is still loading its profiles; try again in a moment');
  const adapter = createCreatureAdapter(token, profile, { config, reactions });
  await adapter.assertReady();
  const ledger = await adapter.readLedger(adapter.turnKey());
  if (ledger.uncertain) throw new Error('Correct the interrupted action ledger first');
  const decision = adapter.decide(await adapter.snapshot(ledger));
  const estimate = decision.chosen?.estimate;
  await foundry.applications.api.DialogV2.wait({
    window: { title: `Creature AI — ${token.name}` },
    content: `<p>Next action: <strong>${escapeHTML(decision.chosen?.kind ?? 'endTurn')}</strong>. ${ledger.actionsRemaining} actions remain.${ledger.bonusMovementActions ? ` Plus ${ledger.bonusMovementActions} Step/Stride-only action.` : ''}</p>
      ${decision.chosen?.kind === 'endTurn' ? `<p>${escapeHTML(decision.diagnostics.noActionReason)}</p>` :
        decision.diagnostics.movementBlocked ? `<p>Movement unavailable: ${escapeHTML(decision.diagnostics.movementBlocked)}.</p>` : ''}
      ${renderDecisionExplanation(decisionExplanation(decision))}
      <p>Policy: Dawnsbury 4.44 ranking with ${escapeHTML(creatureProfile(token.actor).label)} capabilities. ${escapeHTML(decision.reason)}. ${decision.tiedIds.length > 1 ? `${decision.tiedIds.length} equal choices; previews can pick different ties.` : ''}</p>
      <p>Estimated AC ${decision.diagnostics.referenceAC}, encounter level ${decision.diagnostics.encounterLevel}. Layers rank before values. Movement values describe the best supported action after moving. Target selection: ${escapeHTML(adapter.targetMode === 'alliance' ? 'all opposing-alliance combatants' : 'saved manual enemies')}. Visibility and other eligibility checks still apply.</p>
      ${estimate?.odds ? `<p>Estimated maneuver success ${Math.round((estimate.odds.success + estimate.odds.criticalSuccess) * 100)}%; critical failure ${Math.round(estimate.odds.criticalFailure * 100)}%. ${decision.chosen.kind === 'knockdown' ? 'Uses an estimated Reflex DC.' : 'Uses the configured Escape DC.'}</p>` : ''}
      ${(decision.diagnostics.escapeSources ?? []).map(source => `<p>Escape: ${escapeHTML(source.name)} — ${source.removable ? source.configured ? `${escapeHTML(source.sourceName ?? 'Effect')}, DC ${source.dc}, ${escapeHTML(source.statistic)}${source.recordedSource ? ' (recorded attacker)' : ''}` : 'needs its source/DC (Escape sources button)' : escapeHTML(source.blockedReason ?? 'unsupported source; handle manually')}.</p>`).join('')}`,
    buttons: [{ action: 'close', label: 'Close', default: true }], rejectClose: false,
  });
  return decision;
}

export async function openBehaviorControls(token=selected()) {
  if(!game.user.isGM||game.users.activeGM?.id!==game.user.id)throw new Error('Configure behaviors as the active GM');
  const adapter=createCreatureAdapter(token,profile,{reactions}),configuration=behaviorConfiguration(adapter),catalog=behaviorCatalog();
  const last=token.document.getFlag(MODULE_ID,'behaviorState');
  const options=catalog.plans.filter(plan=>configuration.plans.includes(plan.id));
  const answer=await foundry.applications.api.DialogV2.wait({
    ...creatureControlsLayout(`Creature AI — Tactics — ${token.name}`),
    content:`<p>The creature selects a tactic from its known combat situation, then chooses legal actions through its attached behaviors.</p>
      <p>Last selected tactic: <strong>${escapeHTML(last?.label??'None yet')}</strong>${last?.reason?` — ${escapeHTML(last.reason)}`:''}.</p>
      <div class="form-group"><label>Preferred tactic</label><select name="preferredPlan"><option value="">Automatic</option>
        ${options.map(plan=>`<option value="${escapeHTML(plan.id)}" ${configuration.preferredPlan===plan.id?'selected':''}>${escapeHTML(plan.label)}</option>`).join('')}</select></div>
      <p>A preference influences selection when the tactic is useful. It does not override missing abilities, critical danger, or rules requirements.</p>
      <p>Attached behaviors: ${configuration.components.map(id=>escapeHTML(catalog.components.find(component=>component.id===id)?.label??id)).join(', ')}.</p>
      <p>Last active set: ${(last?.activeComponents??[]).map(escapeHTML).join(', ')||'Selected when the creature acts'}.</p>
      <p>Saving applies to this token. Actor behavior configuration is inherited unless overridden here.</p>`,
    buttons:[{action:'save',label:'Save preference',default:true,callback:(_event,button)=>({preferredPlan:button.form.elements.preferredPlan.value||null})}],rejectClose:false});
  if(answer)await configureBehaviors(token.document,{preferredPlan:answer.preferredPlan});
  return answer;
}

export async function explainLast(token = selected()) {
  const saved = [...(game.messages.contents ?? [])].reverse().find(message => {
    const flags = message.flags?.[MODULE_ID];
    return flags?.tokenId === token.id && flags.sceneId === canvas.scene.id && flags.decisionLog?.options.length;
  })?.flags[MODULE_ID].decisionLog;
  const record = saved ?? runners.get(token.id)?.adapter.lastDecision;
  if (!record) { ui.notifications.info('No recorded creature decision yet. Run One action or use Preview.'); return; }
  await foundry.applications.api.DialogV2.wait({ window: { title: `Creature AI — last decision: ${token.name}` },
    content: `<p>Recorded choice from the last run; current conditions may have changed.</p>${renderDecisionExplanation(record)}`,
    buttons: [{ action: 'close', label: 'Close', default: true }], rejectClose: false });
  return record;
}

export async function correctLedger(token = selected()) {
  const runner = runnerFor(token);
  if (runner.running) throw new Error('Stop the creature and wait for its current action before correcting counts');
  const adapter = runner.adapter;
  const ledger = await adapter.readLedger(adapter.turnKey());
  const answer = await foundry.applications.api.DialogV2.input({
    window: { title: 'Creature AI — correct spent actions' },
    content: `<p>Use this after manual actions or an interrupted roll. Check the chat and token position first. Correcting counts clears the Knockdown follow-up.</p>
      <div class="form-group"><label>Actions remaining</label><input name="actions" type="number" min="0" max="3" step="1" value="${ledger.actionsRemaining}"></div>
      <div class="form-group"><label>Attack actions already made (including own-turn reaction Strikes)</label><input name="attacks" type="number" min="0" max="20" step="1" value="${ledger.attacksMade}"></div>
      <div class="form-group"><label>Restricted movement actions remaining</label><input name="bonus" type="number" min="0" max="${adapter.movementBonusAvailable() ? 1 : 0}" step="1" value="${ledger.bonusMovementActions ?? 0}"></div>`,
    ok: { label: 'Save counts' }, rejectClose: false,
  });
  if (!answer) return;
  const actionsRemaining = Number(answer.actions), attacksMade = Number(answer.attacks);
  const bonusMovementActions = Number(answer.bonus ?? ledger.bonusMovementActions ?? 0);
  if (!Number.isInteger(actionsRemaining) || actionsRemaining < 0 || actionsRemaining > 3 || !Number.isInteger(attacksMade) || attacksMade < 0 || attacksMade > 20 ||
    !Number.isInteger(bonusMovementActions) || bonusMovementActions < 0 || bonusMovementActions > Math.max(ledger.bonusMovementActions ?? 0, Number(adapter.movementBonusAvailable()))) throw new Error('Invalid action, attack or restricted-movement count');
  if (ledger.turn !== adapter.turnKey()) throw new Error('The combat turn changed');
  await adapter.saveLedger({ ...ledger, actionsRemaining, attacksMade, bonusMovementActions, lastAction: null, uncertain: false,
    done: actionsRemaining === 0 && !bonusMovementActions, completionReason: null, incapacitationReason: null, freeEscapeStride: false, pendingSweep: null });
}

export async function openControls(token = selected()) {
  await ensureCreatureControlsStyles();
  const adapter = createCreatureAdapter(token, profile, { reactions });
  const abilities = adapter.parts();
  const config = adapter.config;
  const taught = creatureProfile(token.actor);
  const mode = targetingMode(token.actor, config), side = allianceSide(token.actor);
  const targets = [...game.user.targets].filter(t => t !== token && canAssignTarget(token.actor, t.actor));
  const targetNames = (config.targetIds ?? []).map(id => canvas.tokens.get(id)?.name).filter(Boolean);
  const opposingNames = side ? targetRoster(token, { targetMode: 'alliance' }).map(id => canvas.tokens.get(id)?.name).filter(Boolean) : [];
  const readSettings = action => (event, button) => ({ action,
    targetMode: button.form.elements.targetMode?.value ?? mode,
    autoRun: button.form.elements.autoRun.checked, applyDamage: button.form.elements.applyDamage.checked,
    autoAdvance: button.form.elements.autoAdvance.checked,
    pauseForReactions: button.form.elements.pauseForReactions.checked,
    autoReactions: button.form.elements.autoReactions?.checked ?? config.autoReactions !== false,
    refuseCount: Number(button.form.elements.refuseCount?.value ?? config.refuseCount ?? 0),
    crossbowLoaded: button.form.elements.crossbowLoaded?.checked ?? config.crossbowLoaded !== false,
    entertaining: button.form.elements.entertaining?.checked ?? config.entertaining !== false,
    packMorale: button.form.elements.packMorale?.checked ?? config.packMorale !== false,
    showcaseBonus: Number(button.form.elements.showcaseBonus?.value ?? config.showcaseBonus ?? 4),
    packGroup: button.form.elements.packGroup?.value.trim() ?? config.packGroup ?? 'default' });
  const answer = await foundry.applications.api.DialogV2.wait({
    ...creatureControlsLayout(`Creature AI — ${token.name}`),
    content: `<p><strong>Profile:</strong> ${escapeHTML(taught.label)} — ${escapeHTML(taught.roles.join(', '))}. <small>Running code ${RUNTIME_VERSION}</small></p>
      <p><strong>Recognized abilities:</strong> ${escapeHTML(abilities.strike.item.name ?? 'Melee Strike')},
      ${abilities.abilityNames ? abilities.abilityNames.slice(1).map(escapeHTML).join(', ') : abilities.knockdown ? `${escapeHTML(abilities.knockdown.name ?? 'Knockdown')} (1 action after a hit), ${escapeHTML(abilities.pack.name ?? 'Pack Attack')} (+1d4 with two allies in reach)` :
        `${escapeHTML(abilities.thrown.item.name)}, hook Trip, ${escapeHTML(abilities.command.name)}, ${escapeHTML(abilities.sweep.name)} and Reactive Strike`}.</p>
      ${taught.id === 'ogre' ? `<div class="form-group"><label>Refuse remaining (including any held piece)</label><input name="refuseCount" type="number" min="0" max="999" step="1" value="${escapeHTML(config.refuseCount ?? 0)}"></div><p>Refuse uses a limited supply. Picking up a piece costs one Interact action; throwing it costs a Strike action and consumes one piece. Zero disables this attack. This ogre has no boss command, Sweeping Hook reaction, or Reactive Strike.</p>` : ''}
      ${taught.id === 'kobold-scout' ? `<div class="form-group"><label>Crossbow currently loaded</label><input name="crossbowLoaded" type="checkbox" ${adapter.loaded ? 'checked' : ''}></div><p>Reload costs one Interact; each shot consumes one bolt. Hide and Sneak use scene cover/concealment zones and separate checks against each observer's Perception DC. Use the cloud toolbar button to configure zones and the eye button to inspect or correct detection. Construct Trap remains manual. Darkness, special senses and visual cover from walls alone need GM adjudication.</p>` : ''}
      ${taught.id === 'eagle' ? '<p>The Eagle gains a safe hunting altitude, approaches from above and commits only when an attack and escape fit the remaining actions. Upward flight adds difficult-terrain cost; straight downward flight costs half. Eagle Dive costs two actions, descends at least 10 feet in a straight line, then makes one native Talon Strike. Its return climb needs another Fly action.</p>' : ''}
      ${taught.id === 'manticore-scorpion' ? '<p>This scorpion-tail Manticore uses Fly 40 ft, reach-10 Stinger with DC 22 venom, Jaws and agile Claw. It plans an approach, Strike and escape. Venom stages, poison damage and stage Enfeebled resolve automatically using native saves and effects; ongoing saves occur at the poisoned creature’s turn end. This variant has no ranged spikes.</p>' : ''}
      ${abilities.unsupported?.length ? `<p>Additional abilities need manual handling: ${abilities.unsupported.map(escapeHTML).join(', ')}.</p>` : ''}
      <div class="form-group"><label>Target selection</label><select name="targetMode">
        ${side ? `<option value="alliance" ${mode === 'alliance' ? 'selected' : ''}>All opposing combatants (default)</option>` : ''}
        <option value="manual" ${mode === 'manual' ? 'selected' : ''}>Saved manual enemies</option></select></div>
      <p>${side ? `Alliance: ${escapeHTML(side)}. Opposing combatants: ${escapeHTML(opposingNames.join(', ') || 'none in the current scene')}.` : 'Neutral alliance: choose enemies manually.'}</p>
      <p>Saved manual enemies: ${escapeHTML(targetNames.join(', ') || 'none')}.</p>
      <p>Currently targeted for manual selection: ${escapeHTML(targets.map(t => t.name).join(', ') || 'none')}.</p>
      <p><strong>Run turn</strong> and <strong>One action</strong> save settings before acting. Automatic selection uses all opposing combatants, regardless of the target tool. Manual selection saves currently targeted enemies, or retains the saved list if none are targeted. Preview does not save changes.</p>
      <div class="form-group"><label>Act automatically at turn start</label><input name="autoRun" type="checkbox" ${config.autoRun ? 'checked' : ''}></div>
      <div class="form-group"><label>Advance to next combatant when finished</label><input name="autoAdvance" type="checkbox" ${config.autoAdvance ? 'checked' : ''}></div>
      <div class="form-group"><label>Apply damage automatically</label><input name="applyDamage" type="checkbox" ${config.applyDamage !== false ? 'checked' : ''}></div>
      <p>Action pauses, intent speech bubbles and private NPC rolls are configured for the world in <strong>Configure Settings → Foundry Creature AI</strong>.</p>
      <div class="form-group"><label>Entertainment preferences: showcase abilities and engage the front line</label><input name="entertaining" type="checkbox" ${config.entertaining !== false ? 'checked' : ''}></div>
      <div class="form-group"><label>First special ability showcase bonus (0–20)</label><input name="showcaseBonus" type="number" min="0" max="20" step="0.5" value="${escapeHTML(config.showcaseBonus ?? 4)}"></div>
      <p>Front-line characters are calculated automatically: maximum HP and current AC must both be in the upper half of eligible opposing characters. They receive a small engagement preference once per creature turn.</p>
      ${!['kobold-scout','goblin-pyro'].includes(taught.id) ? `<div class="form-group"><label>Pack morale: retreat when the fight is lost</label><input name="packMorale" type="checkbox" ${config.packMorale !== false ? 'checked' : ''}></div>
      <div class="form-group"><label>Pack group (same actor/alliance; use different names to separate packs)</label><input name="packGroup" value="${escapeHTML(config.packGroup ?? 'default')}"></div>
      <p>Group morale uses the existing loss thresholds and safe scene edges. It defaults off for the ogre profiles. With it enabled, escaped creatures sit out this combat and keep their tokens.</p>` : ''}
      <div class="form-group"><label>Prompt for Shield Block and Reactive Strike</label><input name="pauseForReactions" type="checkbox" ${config.pauseForReactions !== false ? 'checked' : ''}></div>
      ${taught.id === 'ogre-boss' ? `<div class="form-group"><label>Use Reactive Strike automatically off turn</label><input name="autoReactions" type="checkbox" ${config.autoReactions !== false ? 'checked' : ''}></div><p>Reactive Strike and Sweeping Hook share the ordinary reaction. Threatened manual walking asks the mover to choose Stride or a legal Step before movement resolves.</p>` : ''}
      ${taught.id === 'goblin-pyro' ? `<div class="form-group"><label>Use Goblin Scuttle automatically</label><input name="autoReactions" type="checkbox" ${config.autoReactions !== false ? 'checked' : ''}></div><p>Two-action spells spend native slots and resolve attacks/saves automatically. Grease uses a 2×2 area and remains for 1 minute. Goblin Scuttle uses the ordinary reaction after a completed allied goblin move.</p>` : ''}
      <p>Reaction prompts go to an active owner, or the GM when no owner is online. Shield Block prompts require automatic damage application. The shield icon in the token toolbar corrects reactions used manually.</p>
      <p>Automatic advancement follows a completed turn. One action holds the turn while the creature can still act. A defeated or incapacitated wolf finishes its turn and can advance automatically. Manual damage, stopped movement, and unresolved actions pause it. If the creature has already acted, correct its counts before running.</p>`,
    buttons: [
      { action: 'save', label: 'Save creature', callback: readSettings('save') },
      { action: 'preview', label: 'Preview', callback: readSettings('preview') },
      { action: 'decision', label: 'Last decision', callback: () => ({ action: 'decision' }) },
      { action: 'behaviors', label: 'Tactics / behaviors', callback: () => ({ action: 'behaviors' }) },
      { action: 'step', label: 'One action', callback: readSettings('step') },
      { action: 'run', label: 'Run turn', callback: readSettings('run') },
      { action: 'stop', label: 'Stop', callback: () => ({ action: 'stop' }) },
      { action: 'counts', label: 'Correct counts', callback: () => ({ action: 'counts' }) },
      { action: 'escapes', label: 'Escape sources', callback: () => ({ action: 'escapes' }) },
      { action: 'disable', label: 'Disable creature', callback: () => ({ action: 'disable' }) },
    ], rejectClose: false,
  });
  if (!answer) return;
  let nextConfig;
  if (['save', 'preview', 'step', 'run'].includes(answer.action)) {
    const currentTargets = [...game.user.targets].filter(t => t !== token && canAssignTarget(token.actor, t.actor));
    const targetIds = currentTargets.length ? currentTargets.map(t => t.id) : config.targetIds ?? [];
    const targetMode = targetingMode(token.actor, { targetMode: answer.targetMode });
    if (targetMode === 'manual' && !targetIds.length) throw new Error('Target at least one known enemy with Foundry’s target tool first for manual targeting');
    if (!Number.isFinite(answer.showcaseBonus) || answer.showcaseBonus < 0 || answer.showcaseBonus > 20) throw new Error('Showcase bonus must be between 0 and 20');
    if (!Number.isInteger(answer.refuseCount) || answer.refuseCount < 0 || answer.refuseCount > 999) throw new Error('Refuse remaining must be a whole number from 0 to 999');
    if (!/^[a-zA-Z0-9 _-]{0,40}$/.test(answer.packGroup)) throw new Error('Use up to 40 letters, numbers, spaces, underscores or hyphens for the pack group');
    nextConfig = { ...config, enabled: true, targetIds, targetMode, autoRun: answer.autoRun, autoAdvance: answer.autoAdvance, applyDamage: answer.applyDamage,
      entertaining: answer.entertaining, showcaseBonus: answer.showcaseBonus, frontlineTargetIds: null,
      packMorale: answer.packMorale, packGroup: answer.packGroup || 'default', pauseForReactions: answer.pauseForReactions, autoReactions: answer.autoReactions,
      ...(taught.id === 'ogre' ? { refuseCount: answer.refuseCount } : {}),
      ...(taught.id === 'kobold-scout' ? { crossbowLoaded: answer.crossbowLoaded, packMorale: false } : {}) };
    if (answer.action !== 'preview') {
      if (runners.get(token.id)?.running) throw new Error('Wait for the current creature action before changing its settings');
      await adapter.configure();
      await token.document.setFlag(MODULE_ID, 'config', nextConfig);
      if (taught.id === 'kobold-scout') await token.document.setFlag(MODULE_ID, 'scoutGear', { loaded: answer.crossbowLoaded });
      if (taught.id === 'ogre' && nextConfig.refuseCount === 0) await token.document.setFlag(MODULE_ID, 'ogreGear', { refuseHeld: false });
      if (nextConfig.autoRun) automaticStartsPaused = false;
    }
  }
  switch (answer.action) {
    case 'save': {
      ui.notifications.info(`Creature AI saved for ${token.name}`);
      break;
    }
    case 'preview': return preview(token, nextConfig);
    case 'decision': return explainLast(token);
    case 'behaviors': return openBehaviorControls(token);
    case 'step': return runTurn(token, { oneAction: true });
    case 'run': return runTurn(token);
    case 'stop': return stop(token);
    case 'counts': return correctLedger(token);
    case 'escapes': {
      const runner = runnerFor(token);
      if (runner.running) throw new Error('Stop the creature and wait for its current action before changing Escape sources');
      return configureEscapes(runner.adapter, { force: true,
        valid: () => canvas.ready && canvas.tokens.get(token.id) === token && game.users.activeGM?.id === game.user.id && !runner.running });
    }
    case 'disable':
      stop(token);
      await token.document.setFlag(MODULE_ID, 'config', { ...config, enabled: false, autoRun: false });
      break;
  }
}

export async function runTurn(token = selected(), options = {}) {
  if (resettingActors) throw new Error('Wait for the actor reset to finish');
  if (!token.document.getFlag(MODULE_ID, 'config')?.enabled) throw new Error('Save this creature in Creature AI controls first');
  if (options.automatic) await activeRuns.get(token.id)?.catch(() => {});
  if (options.automatic && automaticStartsPaused) return;
  if (!options.automatic) automaticStartsPaused = false;
  const runner = runnerFor(token);
  if (options.expectedTurn && runner.adapter.turnKey() !== options.expectedTurn) return;
  const pending = runner.run(options);
  // A rejected manual duplicate must not replace the active run's queue entry.
  if (activeRuns.has(token.id)) return pending;
  activeRuns.set(token.id, pending);
  try { return await pending; }
  finally { if (activeRuns.get(token.id) === pending) activeRuns.delete(token.id); }
}
export function stop(token) {
  if (token) runners.get(token.id)?.cancel();
  else {
    manualMovement.cancel();
    automaticStartsPaused = true;
    for (const runner of runners.values()) runner.cancel();
  }
  // Cancellation waits for a roll already resolving; native movement can be stopped separately.
}

export async function resetActors(options = {}) {
  if (resettingActors || activeRuns.size || reactions.barrier.pending || manualMovement.running || manualMovement.pending.size)
    throw new Error('Stop AI and wait for current actions, movement and reaction prompts to finish before resetting actors');
  resettingActors = true;
  try {
    return await resetActorsToPrototype({ tokens: options.tokens,
      beforeReset: async () => { stop(); },
      afterReset: async report => {
        for (const entry of [...report.restored, ...report.errors]) runners.delete(entry.id);
        await expireSpellZones({tokenIds:report.restored.map(entry=>entry.id)});
        announcedOutcomes.clear();
        await refreshTerrain();
      },
    });
  } finally { resettingActors = false; }
}

export async function tacticalMap(token=selected()){
  if(!game.user.isGM)throw new Error('Tactical maps are visible to the GM only');
  const field=runners.get(token.id)?.adapter.lastTacticalMap;
  if(!field||field.sceneId!==canvas.scene.id)throw new Error('Run a scout action after this reload to calculate its tactical map first');
  return foundry.applications.api.DialogV2.wait({window:{title:`Tactical map — ${token.name}`},
    content:renderTacticalMap(field,id=>canvas.tokens.get(id)?.name??id),
    buttons:[{action:'close',label:'Close'}],rejectClose:false});
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID,'flightPlanningBackend',{name:'Flight planning engine',scope:'world',config:true,type:String,default:'worker',
    choices:{worker:'Background Web Worker',native:'Native planner (compatibility fallback)'},
    hint:'The worker proposes routes and Dive setups; Foundry validates native geometry and costs. Unsupported or failed workers fall back automatically.'});
  registerPresentationSettings();
  registerPerceptionSettings();
  reactions.install();
  game.settings.register(MODULE_ID, 'playerStealth', {
    name: 'Player Hide and Sneak', scope: 'world', config: true, type: Boolean, default: true,
    hint: 'Resolve character Hide checks per enemy and offer Stride/Sneak/Step when moving near enemies. An active GM resolves secret checks; player action counts remain manual.',
  });
  playerStealth.install();
  game.settings.register(MODULE_ID, 'directionalZoneIndicators', {
    name: 'Show directional zone defenses', scope: 'client', config: true, type: Boolean, default: true,
    hint: 'Show cover and concealment above tokens relative to your single selected token (or assigned character). Updates on movement and selection, not each frame.',
    onChange: () => { void refreshEnvironmentView(); },
  });
  game.settings.register(MODULE_ID, 'manualMovementReactions', {
    name: 'Manual movement reactions', scope: 'world', config: true, type: Boolean, default: true,
    hint: 'Pause threatened ground movement during the mover’s turn to choose Stride or Step, then resolve taught NPC Reactive Strikes before each departure. Manual action counts remain the player’s responsibility.',
  });
  manualMovement.install();
  game.keybindings.register(MODULE_ID, 'controls', {
    name: 'Creature AI controls', hint: 'Select a taught NPC token, then open its automation controls.',
    restricted: true, editable: [{ key: 'KeyW', modifiers: ['Alt'] }],
    onDown: () => { openControls().catch(showError); return true; },
  });
  game.keybindings.register(MODULE_ID, 'stop', {
    name: 'Stop Creature AI', restricted: true, editable: [{ key: 'KeyW', modifiers: ['Alt', 'Shift'] }],
    onDown: () => { stop(); return true; },
  });
});

Hooks.on('getSceneControlButtons', controls => {
  if (!controls.tokens?.tools) return;
  controls.tokens.tools.playerStealth = { name: 'playerStealth', title: 'Player Hide / Sneak', icon: 'fa-solid fa-user-secret', order: 104,
    button: true, control: true, onChange: () => { playerStealth.open().catch(showError); } };
  if (!game.user?.isGM) return;
  controls.tokens.tools.wolfAI = {
    name: 'wolfAI', title: 'Creature AI controls', icon: 'fa-solid fa-paw', order: 100,
    button: true, control: true,
    onChange: () => { openControls().catch(showError); },
  };
  controls.tokens.tools.reactionControls = {
    name: 'reactionControls', title: 'Reaction controls', icon: 'fa-solid fa-shield-halved', order: 101,
    button: true, control: true,
    onChange: () => { reactions.openControls().catch(showError); },
  };
  controls.tokens.tools.environmentZones = {
    name: 'environmentZones', title: 'Cover / concealment zones', icon: 'fa-solid fa-cloud', order: 102,
    button: true, control: true, onChange: () => { openZones().catch(showError); },
  };
  controls.tokens.tools.stealthControls = { name:'stealthControls',title:'Detection controls',icon:'fa-solid fa-eye',order:103,
    button:true,control:true,onChange:()=>{openStealthControls().catch(showError);} };
});

// Mark only AI-managed messages. Workbench 7.7.5 honors this flag, preventing a second damage roll.
Hooks.on('preCreateChatMessage', message => {
  applyAIRollPrivacy(message);
  applyAIDiceSuppression(message);
  const options = message.flags.pf2e?.context?.options ?? [];
  if (!options.includes(MANAGED_OPTION)) return;
  const token = canvas.tokens?.get(message.speaker.token);
  message.updateSource({
    [`flags.${MODULE_ID}.managed`]: true,
    'flags.xdy-pf2e-workbench.noAutoDamageRoll': true,
    'flags.pf2e.suppressDamageButtons': typeof message.flags[MODULE_ID]?.damageAutoApplied==='boolean'
      ? message.flags[MODULE_ID].damageAutoApplied : options.includes(REACTION_OPTION)
      ? options.includes(REACTION_AUTO_DAMAGE) : Boolean(token?.document.getFlag(MODULE_ID, 'config')?.applyDamage),
  });
});

Hooks.once('ready', async () => {
  if (game.system.id !== 'pf2e' || Number(game.release.generation) !== 14) return;
  installPoisonHooks({reactions,onError:showError,onPause:stop});
  game.modules.get(MODULE_ID).api = { version: RUNTIME_VERSION, planning:{status:()=>planningWorker.status()}, open: openControls, preview, explainLast, runTurn, stop, resetActors, correctLedger, tacticalMap, reactions, manualMovement,
    zones: { open: openZones, configure: configureZone, between: environmentBetween, refresh:refreshTerrain,
      view: () => ({ observerId: environmentAwareness.observer?.id ?? null, defenses: [...environmentAwareness.entries].map(([tokenId, entry]) => ({ tokenId, ...entry.environment, detection: entry.detection })) }) },
    terrain:{onHazardMove,applySetup:applySceneSetup},supportedProfiles, registerCreatureProfile };
  game.modules.get(MODULE_ID).api.stealth = { open: openStealthControls, detection: detectionFor, player: playerStealth,
    hide: token => playerStealth.request('hide', token), sneak: token => playerStealth.request('arm-sneak', token),
    stopSneak: token => playerStealth.request('stop-sneak', token), revealAction: token => playerStealth.request('reveal-action', token),
    reveal: token => playerStealth.request('reveal', token) };
  game.modules.get(MODULE_ID).api.spells = { refresh: refreshSpellZones, expire: expireSpellZones };
  game.modules.get(MODULE_ID).api.poisons={advance:token=>reactions.resolve(()=>advancePoisons(token)),expire:expirePoisons};
  game.modules.get(MODULE_ID).api.behaviors = {...behaviorAPI,open:openBehaviorControls,
    inspect:(token=selected())=>({configuration:behaviorConfiguration(createCreatureAdapter(token,profile,{reactions})),
      lastPlan:token.document.getFlag(MODULE_ID,'behaviorState')??null})};
  try {
    installEnvironmentRolls({playerStealth});
    installHazardMovement();
    installGreaseTerrain();
    installFlightCosts();
    installFlightFalls({reactions,onError:showError});
    installGreaseLandingHooks({onError:showError});
    environmentAwareness.install();
    installStealthVisibility();
    playerStealth.installRolls();
    const response = await fetch(new URL('../../profiles/creatures.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load Creature AI profiles');
    profile = resolveProfile(await response.json(), 'wolf');
    await loadOgreFamily();
    await expireCommands();
    await cleanupOrphanCommands();
    await refreshTerrain();
  } catch (error) { await showError(error); }
});

// Observe completed movement on the active GM, including movement between an
// NPC's turns. Zone icons update separately; automatic Seek spends a turn action.
Hooks.on('moveToken', (document, movement, operation) => {
  refreshStealthVisibility();
  void refreshConcealment();
  void refreshEnvironmentView(document.id);
  void refreshPlayerStealth();
  void refreshSpellZones().catch(showError);
  if (!profile || !canvas.ready || !game.combat?.started || game.users.activeGM?.id !== game.user.id) return;
  const combatId = game.combat.id, sceneId = canvas.scene.id;
  const knownMovement = movementKnowledge(document, movement, operation);
  if (document.parent.id !== sceneId) return;
  for (const token of canvas.tokens.placeables) {
    if (!token.document.getFlag(MODULE_ID, 'config')?.enabled) continue;
    try {
      const adapter = createCreatureAdapter(token, profile, { reactions });
      void rememberTargets(adapter, () => canvas.ready && canvas.scene.id === sceneId && game.combat?.id === combatId, knownMovement)
        .catch(showError);
    } catch { /* Untaught actors do not gain an automatic perception policy. */ }
  }
});
Hooks.on('updateToken', (document, changed = {}) => {
  if (TOKEN_GEOMETRY_FIELDS.some(key => Object.hasOwn(changed, key))) {
    refreshStealthVisibility(); void refreshConcealment(); void refreshEnvironmentView(document.id);
    void refreshPlayerStealth();
  } else if (['stealth', '-=stealth'].some(key => Object.hasOwn(changed.flags?.[MODULE_ID] ?? {}, key)) ||
    Object.keys(changed).some(key => key.startsWith(`flags.${MODULE_ID}.stealth`) || key.startsWith(`flags.${MODULE_ID}.-=stealth`))) {
    refreshStealthVisibility(); void refreshEnvironmentView(document.id);
    void refreshPlayerStealth();
  }
});
Hooks.on('controlToken', () => { void refreshEnvironmentView(); });
Hooks.on('targetToken', user => { if (user.id === game.user.id) void refreshEnvironmentView(); });
Hooks.on('drawToken', token => { void refreshEnvironmentView(token.id); });
Hooks.on('createToken', () => refreshTerrain());
Hooks.on('deleteToken', () => refreshTerrain());
Hooks.on('createRegion', () => refreshTerrain());
Hooks.on('deleteRegion', () => refreshTerrain());
Hooks.on('updateRegion', () => refreshTerrain());
Hooks.on('createRegionBehavior', () => refreshTerrain());
Hooks.on('deleteRegionBehavior', () => refreshTerrain());
Hooks.on('updateRegionBehavior', () => refreshTerrain());
Hooks.on('canvasReady', () => refreshTerrain());
for (const hook of ['createItem', 'updateItem', 'deleteItem']) Hooks.on(hook, item => {
  if (item.type === 'condition' && item.slug === 'concealed') void refreshConcealment();
  if (['condition', 'effect'].includes(item.type)) { refreshStealthVisibility(); refreshActorCaptions(item.actor); void refreshPlayerStealth(); }
});
for (const hook of ['createWall', 'updateWall', 'deleteWall']) Hooks.on(hook, () => {
  refreshStealthVisibility(); void refreshEnvironmentView();
  void refreshPlayerStealth();
});
Hooks.on('updateUser', () => { void refreshConcealment(); void refreshEnvironmentView(); });

// PF2e emits this after its start-of-turn effect processing has completed.
Hooks.on('pf2e.startTurn', (combatant) => {
  if (!profile || automaticStartsPaused || game.users.activeGM?.id !== game.user.id || !canvas.ready) return;
  const token = canvas.tokens.get(combatant.tokenId), config = token?.document.getFlag(MODULE_ID, 'config');
  if (config?.enabled && config.autoRun) runTurn(token, {
    automatic: true, expectedTurn: `${game.combat.id}:${game.combat.round}:${combatant.id}`,
  }).catch(showError);
});
Hooks.on('canvasTearDown', () => { stop(); planningWorker.close('Scene changed'); runners.clear(); environmentAwareness.clear(); });
Hooks.on('deleteCombat', combat => { stop(); expireCommands({ combat, removeAll: true }).catch(showError); void expireSpellZones({combat,removeAll:true}).catch(showError); void refreshEnvironmentView(); });
Hooks.on('pf2e.endTurn', (combatant, combat) => { expireCommands({ combat, endedTokenId: combatant.tokenId,
  endedRound: combatant.flags?.pf2e?.roundOfLastTurnEnd ?? combat.round }).catch(showError); });
Hooks.on('updateCombat', (combat, changed = {}) => {
  void expireSpellZones({combat}).catch(showError);
  expireCommands({ combat }).catch(showError);
  if (['round', 'active'].some(key => Object.hasOwn(changed, key))) void refreshEnvironmentView();
});
Hooks.on('updateWorldTime',()=>{void expireSpellZones().catch(showError);});
