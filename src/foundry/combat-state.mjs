import { allianceSide, canAssignTarget, combatantSceneId, targetingMode } from './targeting.mjs';

// These states end an NPC's ability to act. Temporary movement restrictions and
// unresolved reactions still require a pause rather than completing the turn.
export function incapacitationReason(token, combat = game.combat) {
  const actor = token?.actor;
  if (!actor) return null;
  if (actor.isDead || actor.hasCondition('dead')) return 'dead';
  if (actor.hitPoints?.value <= 0) return '0 HP';
  if (actor.hasCondition('dying')) return 'dying';
  if (actor.hasCondition('unconscious')) return 'unconscious';
  const combatant = Array.from(combat?.combatants ?? []).find(c => c.tokenId === token.id &&
    combatantSceneId(c, combat) === token.document.parent.id);
  return combatant?.defeated || combatant?.isDefeated ? 'defeated' : null;
}

// Corpse tokens remain on the canvas, but no longer occupy mechanical movement
// space. Use current actor/combat state, never an old AI ledger or cached death.
export function occupiesMovementSpace(token, combat = game.combat) {
  const actor=token?.actor;
  if(!actor?.isOfType?.('creature'))return true;
  if(actor.isDead||actor.hasCondition('dead')||actor.hitPoints?.value<=0)return false;
  const combatant=Array.from(combat?.combatants??[]).find(c=>c.tokenId===token.id&&
    combatantSceneId(c,combat)===token.document.parent.id);
  return !(combatant?.defeated||combatant?.isDefeated);
}

// Encounter administration uses the complete combat roster, never sensory
// knowledge. Hidden, invisible, distant and unreachable opponents remain alive.
// A single creature exhausting its manual target list is not a battle victory.
export function encounterOutcome({ combat = game.combat, scene = canvas.scene, tokens = canvas.tokens } = {}) {
  if (!combat?.started || !scene) return null;
  const roster = Array.from(combat.combatants ?? []).filter(c => combatantSceneId(c, combat) === scene.id);
  const entries = roster.map(c => ({ combatant: c, token: tokens.get(c.tokenId) }));
  // An unresolved document is not evidence of defeat.
  if (entries.some(e => !e.token?.actor)) return null;
  const hostile = (a, b) => {
    if (!canAssignTarget(a.actor, b.actor)) return false;
    const sideA = allianceSide(a.actor), sideB = allianceSide(b.actor);
    if (sideA && sideB && sideA !== sideB) return true;
    return [ [a, b], [b, a] ].some(([source, target]) => {
      const config = source.document.getFlag?.('foundry-creature-ai', 'config') ?? {};
      return targetingMode(source.actor, config) === 'manual' && config.targetIds?.includes(target.id);
    });
  };
  const participants = new Set();
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i].token, b = entries[j].token;
    if (!hostile(a, b)) continue;
    participants.add(a); participants.add(b);
    if (!incapacitationReason(a, combat) && !incapacitationReason(b, combat)) return null;
  }
  if (!participants.size) return null;
  const survivors = [...participants].filter(token => !incapacitationReason(token, combat));
  return { combatId: combat.id, reason: survivors.length ? 'victory' : 'draw',
    survivorIds: survivors.map(token => token.id),
    message: survivors.length ? 'Battle won: no opposing combatants remain able to fight. Creature AI stopped.' :
      'No combatants remain able to fight. Creature AI stopped.' };
}
