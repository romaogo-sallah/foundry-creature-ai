const namespace = 'foundry-creature-ai';
const quickenedUUID = 'Compendium.pf2e.conditionitems.Item.nlCjDvLMf2EkV2dl';
const bossSource = 'Compendium.pf2e.pathfinder-monster-core.Actor.oopxVowT2jnUQJiS';
const ogreSources = new Set([bossSource, 'Compendium.pf2e.pfs-season-1-bestiary.Actor.DsEg9sT7jCcsuEDI']);

export async function loadOgreFamily() {
  const pack = game.packs?.get('pf2e.pathfinder-monster-core');
  if (!pack) return;
  const index = await pack.getIndex({ fields: ['system.traits.value'] });
  for (const entry of index) if (/^Ogre (Boss|Warrior|Hurler|Glutton)$/i.test(entry.name) && entry.system?.traits?.value?.includes('giant')) {
    ogreSources.add(`Compendium.pf2e.pathfinder-monster-core.Actor.${entry._id}`);
  }
}
export function isOgre(actor) {
  return [actor.sourceId, actor._stats?.compendiumSource, actor._stats?.duplicateSource, actor.flags?.core?.sourceId]
    .filter(source => typeof source === 'string').some(source => ogreSources.has(source) ||
      ogreSources.has(source.replace('pathfinder-monster-core.', 'pathfinder-monster-core.Actor.')));
}
const turns = combat => combat.turns ?? Array.from(combat.combatants);
export function commandEffects(actor, combatId = game.combat?.id) {
  return (actor.itemTypes?.effect ?? []).filter(effect => effect.flags?.[namespace]?.command?.combatId === combatId);
}
export function movementQuickened(actor) {
  return actor.hasCondition('quickened') && commandEffects(actor).some(effect => effect.flags[namespace].command.expiryRound >= game.combat.round);
}
export async function cleanupOrphanCommands() {
  if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id || !game.combats) return;
  const actors = new Map((game.actors?.contents ?? []).map(actor => [actor.uuid, actor]));
  for (const scene of game.scenes?.contents ?? []) for (const token of scene.tokens.contents) if (token.actor) actors.set(token.actor.uuid, token.actor);
  for (const actor of actors.values()) {
    const expired = (actor.itemTypes?.effect ?? []).filter(effect => {
      const command = effect.flags?.[namespace]?.command;
      return command && !game.combats.has(command.combatId);
    });
    if (expired.length) await actor.deleteEmbeddedDocuments('Item', expired.map(effect => effect.id));
  }
}
export async function applyCommand(adapter, recipients, valid) {
  const combat = game.combat, order = turns(combat), issuerIndex = order.findIndex(turn => turn.tokenId === adapter.token.id);
  const applied = [];
  for (const target of recipients) {
    if (!valid()) throw new Error('Automation stopped during Bellowing Command; inspect its reserved action');
    if (target.actor.hasCondition('quickened')) continue;
    const index = order.findIndex(turn => turn.tokenId === target.id);
    if (index < 0) continue;
    const expiryRound = combat.round + Number(index <= issuerIndex);
    await target.actor.createEmbeddedDocuments('Item', [{ name: 'Bellowing Command — movement only', type: 'effect',
      img: 'icons/skills/social/intimidation-impressing.webp',
      system: { description: { value: '<p>Quickened until the end of your next turn. The extra action can only Step or Stride.</p>' },
        duration: { unit: 'unlimited', value: -1, expiry: null, sustained: false }, level: { value: adapter.actor.level },
        tokenIcon: { show: true }, traits: { value: [] }, rules: [{ key: 'GrantItem', uuid: quickenedUUID, flag: 'commandQuickened' }],
        context: { origin: { actor: adapter.actor.uuid, token: adapter.token.document.uuid, item: null, spellcasting: null, rollOptions: [] } } },
      flags: { [namespace]: { command: { combatId: combat.id, recipientId: target.id, expiryRound, movementOnly: true } } } }]);
    applied.push(target.id);
  }
  return applied;
}
let cleanup = Promise.resolve();
export function expireCommands(options = {}) {
  const combat = options.combat ?? game.combat;
  const captured = { ...options, combat, endedRound: options.endedRound ?? combat?.round };
  const pending = cleanup.then(() => expireNow(captured));
  cleanup = pending.catch(() => {});
  return pending;
}
async function expireNow({ combat, endedTokenId, endedRound, removeAll = false }) {
  if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id || !combat) return;
  const order = turns(combat), active = order.findIndex(turn => turn.id === combat.combatant?.id);
  const seen = new Set();
  for (const scene of game.scenes?.contents ?? [canvas.scene]) for (const document of scene.tokens?.contents ?? canvas.tokens.placeables.map(token => token.document)) {
    const actor = document.actor ?? canvas.tokens.get(document.id)?.actor;
    if (!actor || seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    const expired = commandEffects(actor, combat.id).filter(effect => {
      const data = effect.flags[namespace].command, index = order.findIndex(turn => turn.tokenId === data.recipientId);
      return removeAll || index < 0 || combat.round > data.expiryRound ||
        endedTokenId === data.recipientId && endedRound >= data.expiryRound ||
        combat.round === data.expiryRound && active > index;
    });
    if (expired.length) await actor.deleteEmbeddedDocuments('Item', expired.map(effect => effect.id));
  }
}
