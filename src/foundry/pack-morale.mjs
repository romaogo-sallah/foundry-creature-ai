import { assessPackMorale } from '../wolf/playstyle.mjs';
import { combatantSceneId } from './targeting.mjs';
import { incapacitationReason } from './combat-state.mjs';

const namespace = 'foundry-creature-ai';
const baseActor = token => token.document.actorId ?? token.actor.uuid;
const side = token => token.actor.alliance ?? 'neutral';

export function packAssessment(adapter) {
  if (adapter.config.packMorale === false) return { broken: false, enabled: false };
  const key = encodeURIComponent(`${baseActor(adapter.token)}:${side(adapter.token)}:${adapter.config.packGroup ?? 'default'}`).replaceAll('.', '%2E');
  const members = [];
  for (const combatant of game.combat.combatants) {
    if (combatantSceneId(combatant) !== canvas.scene.id) continue;
    const token = canvas.tokens.get(combatant.tokenId);
    if (!token?.actor || baseActor(token) !== baseActor(adapter.token) || side(token) !== side(adapter.token)) continue;
    const config = token === adapter.token ? adapter.config : token.document.getFlag(namespace, 'config') ?? {};
    if ((config.packGroup ?? 'default') !== (adapter.config.packGroup ?? 'default')) continue;
    const hp = token.actor.hitPoints;
    if (!Number.isFinite(hp?.value)) continue;
    members.push({ id: token.id, hp: hp.value,
      maxHP: hp.max ?? token.actor.system.attributes.hp?.max ?? hp.value,
      alive: !incapacitationReason(token) });
  }
  const previous = game.combat.getFlag?.(namespace, 'packs')?.[key];
  return { ...assessPackMorale(previous, members), key, enabled: true };
}

export async function persistPackAssessment(adapter) {
  const assessment = packAssessment(adapter);
  if (!assessment.enabled) return assessment;
  const saved = game.combat.getFlag(namespace, 'packs') ?? {};
  const record = { members: assessment.members, broken: assessment.broken, reason: assessment.reason };
  if (JSON.stringify(saved[assessment.key]) !== JSON.stringify(record)) {
    await game.combat.setFlag(namespace, 'packs', { ...saved, [assessment.key]: record });
  }
  return assessment;
}

