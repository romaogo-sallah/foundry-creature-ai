const namespace = 'foundry-creature-ai';
const transientFlags = [
  'ledger', 'scoutGear', 'ogreGear', 'ogreAttacks', 'scoutActions', 'scoutShown', 'pyroShown', 'pyroActions','flight','eagleShown',
  'scoutThreats', 'casterTargets', 'behaviorState', 'behaviorActions', 'scoutFocus', 'scoutMotion', 'targetMemory', 'stealth',
  'stealthBelief', 'perception', 'playState', 'retreated', 'scampering', 'sneakNextMove',
];

/** Restore selected unlinked token actors to their current world-actor baseline.
 * ActorDelta.restore also restores deleted items, spell slots and item resources;
 * copying prepared HP or inventory quantities alone cannot do that reliably.
 */
export async function resetActorsToPrototype({ tokens = canvas.tokens.controlled, beforeReset = async () => {},
  afterReset = async () => {} } = {}) {
  if (!game.user?.isGM || game.users.activeGM?.id !== game.user.id)
    throw new Error('Reset actors as the active GM');
  if (!canvas.ready) throw new Error('View the scene containing the actors first');
  if (!tokens?.length) throw new Error('Select the tokens to reset first');
  const report = { restored: [], skipped: [], errors: [] }, candidates = [];
  for (const token of new Set(tokens)) {
    const document = token.document;
    const reason = document?.parent?.id !== canvas.scene.id ? 'not in the viewed scene' :
      document.isLinked || document.actorLink ? 'linked actor: no independent prototype state' :
      !document.baseActor ? 'the original world actor is missing' :
      !token.actor || typeof document.delta?.restore !== 'function' ? 'no restorable actor delta' : null;
    if (reason) report.skipped.push({ id: token.id, name: token.name, reason });
    else candidates.push(token);
  }
  if (!candidates.length) return report;
  await beforeReset(candidates);
  try {
    for (const token of candidates) {
      try {
        const document = token.document, base = document.baseActor;
        const config = document.getFlag(namespace, 'config');
        // This is the native persistent restore operation. delta.reset() only
        // re-prepares data and does not reset saved resources.
        await document.delta.restore();
        const restored = document.actor;
        if (restored.getFlag(namespace, 'reaction') !== undefined) await restored.unsetFlag(namespace, 'reaction');
        const changes = {};
        for (const key of transientFlags) if (document.getFlag(namespace, key) !== undefined)
          changes[`flags.${namespace}.-=${key}`] = null;
        if (config) {
          const prototype = base.prototypeToken?.getFlag(namespace, 'config') ?? {};
          const resources = {};
          if (Object.hasOwn(config, 'refuseCount')) resources.refuseCount = prototype.refuseCount ?? 0;
          if (Object.hasOwn(config, 'crossbowLoaded')) resources.crossbowLoaded = prototype.crossbowLoaded ?? true;
          for (const [key, value] of Object.entries(resources)) changes[`flags.${namespace}.config.${key}`] = value;
        }
        if (Object.keys(changes).length) await document.update(changes);
        // Defeated belongs to Combatant, rather than to the actor delta. Clear
        // it in every combat containing this particular scene token.
        for (const combat of game.combats ?? []) {
          const updates = Array.from(combat.combatants).filter(combatant => combatant.tokenId === token.id &&
            (combatant.sceneId ?? combatant.token?.parent?.id ?? combat.scene?.id) === document.parent.id)
            .map(combatant => ({ _id: combatant.id, defeated: Boolean(restored.isDead) }));
          if (updates.length) await combat.updateEmbeddedDocuments('Combatant', updates);
        }
        report.restored.push({ id: token.id, name: token.name, prototype: base.name });
      } catch (error) {
        // Keep going for independent tokens, but never report a partial reset
        // as success. Running the macro again safely retries the same baseline.
        report.errors.push({ id: token.id, name: token.name, reason: error.message });
      }
    }
    const ids = new Set(report.restored.map(entry => entry.id));
    if (ids.size) await forgetResetActors(ids);
    return report;
  } finally {
    await afterReset(report);
  }
}

async function forgetResetActors(ids) {
  // Other observers must not retain old secret checks or target/focus memory
  // about a freshly reset actor. Preserve their unrelated encounter knowledge.
  for (const token of canvas.tokens.placeables) {
    if (ids.has(token.id)) continue;
    const document = token.document;
    for (const [key, idKey] of [['targetMemory', 'id'], ['perception', 'subjectId'],
      ['stealth', 'observerId'], ['stealthBelief', 'observerId']]) {
      const saved = document.getFlag(namespace, key);
      if (!Array.isArray(saved?.entries)) continue;
      const entries = saved.entries.filter(entry => !ids.has(entry[idKey]));
      if (entries.length !== saved.entries.length) await document.setFlag(namespace, key, { ...saved, entries });
    }
    const focus = document.getFlag(namespace, 'scoutFocus');
    if (ids.has(focus?.targetId)) await document.unsetFlag(namespace, 'scoutFocus');
    const casterTargets = document.getFlag(namespace, 'casterTargets');
    if (casterTargets?.entries && Object.keys(casterTargets.entries).some(id => ids.has(id))) {
      const entries = Object.fromEntries(Object.entries(casterTargets.entries).filter(([id]) => !ids.has(id)));
      await document.setFlag(namespace, 'casterTargets', { ...casterTargets, entries });
    }
  }
  for (const combat of game.combats ?? []) {
    if (combat.scene?.id !== canvas.scene.id) continue;
    const packs = combat.getFlag(namespace, 'packs') ?? {}, changes = {};
    for (const [key, pack] of Object.entries(packs)) if (pack.members?.some(member => ids.has(member.id)))
      changes[`flags.${namespace}.packs.-=${key}`] = null;
    if (Object.keys(changes).length) await combat.update(changes);
  }
}
