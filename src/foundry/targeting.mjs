import {effectiveAlliance} from './domination.mjs';
// PF2e's prepared alliance is party, opposition, or null (neutral). Token
// disposition colors are separate from this creature relationship.
export function allianceSide(actor) {
  const alliance=effectiveAlliance(actor);return ['party', 'opposition'].includes(alliance) ? alliance : null;
}

export function targetingMode(actor, config = {}) {
  if(actor?.hasCondition?.('confused'))return 'confused';
  return allianceSide(actor) && config.targetMode !== 'manual' ? 'alliance' : 'manual';
}

export function canAssignTarget(actor, other) {
  if (!actor || !other || actor === other) return false;
  if(actor.hasCondition?.('confused'))return true;
  const self = allianceSide(actor), target = allianceSide(other);
  // Neutral hostility is explicit: only a saved manual roster can select it.
  return !self || !target || self !== target;
}

export function combatantSceneId(combatant, combat = game.combat) {
  const linked = combat?.scene;
  return combatant?.sceneId ?? combatant?.token?.parent?.id ??
    (typeof linked === 'string' ? linked : linked?.id) ?? null;
}

export function targetRoster(token, config = {}, combat = game.combat, scene = canvas.scene, tokens = canvas.tokens) {
  if(targetingMode(token.actor,config)==='confused')return [...new Set(Array.from(combat?.combatants??[]).filter(combatant=>
    combatant.tokenId!==token.id&&combatantSceneId(combatant,combat)===scene?.id&&tokens.get(combatant.tokenId)?.actor?.isOfType?.('creature')).map(c=>c.tokenId))];
  if (targetingMode(token.actor, config) === 'manual') return [...new Set(config.targetIds ?? [])].filter(id => id !== token.id);
  const side = allianceSide(token.actor), opposite = side === 'party' ? 'opposition' : 'party';
  return [...new Set(Array.from(combat?.combatants ?? []).filter(combatant =>
    combatant.tokenId !== token.id && combatantSceneId(combatant, combat) === scene?.id &&
    allianceSide(tokens.get(combatant.tokenId)?.actor) === opposite).map(combatant => combatant.tokenId))];
}
