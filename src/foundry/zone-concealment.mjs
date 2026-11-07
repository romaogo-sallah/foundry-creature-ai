import { zoneConfig } from './environment-zones.mjs';
import { tokenRayPoint } from './attack-path.mjs';
import {pointInVolume} from '../shared/area-volume.mjs';

const namespace = 'foundry-creature-ai';
const marker = 'zone-concealment';

export function isZoneConcealment(condition) {
  return condition?.type === 'condition' && (condition.slug ?? condition.system?.slug) === 'concealed' &&
    condition.flags?.[namespace]?.zoneConcealment?.source === marker;
}

function concealedConditions(actor) {
  return actor.conditions?.bySlug?.('concealed') ?? actor.getCondition?.('concealed', { all: true }) ?? [];
}

// A zone icon must not turn an observed target into a remembered square or
// disable reactions. Geometry still decides its concealment against each viewer.
export function hasUnmanagedConcealment(actor) {
  if (!actor.hasCondition('concealed')) return false;
  const conditions = concealedConditions(actor);
  return !conditions.length || conditions.some(condition => !isZoneConcealment(condition) || condition.isLocked || condition.readonly);
}
export function hasStealthConcealment(actor){
 if(!hasUnmanagedConcealment(actor))return false;
 const conditions=concealedConditions(actor);
 return !conditions.length||conditions.some(c=>!isZoneConcealment(c)&&c.appliedBy?.flags?.[namespace]?.supportSpell?.slug!=='blur'&&c.appliedBy?.slug!=='spell-effect-blur');
}

export function occupantConcealment(document, scene = document.parent) {
  const source = document._source ?? document, size = scene.grid?.size ?? globalThis.canvas?.grid?.size ?? 1;
  const token = { document, center: { x: source.x + source.width * size / 2, y: source.y + source.height * size / 2 } };
  const point = tokenRayPoint(token, 'sight');
  return (scene.regions?.contents ?? []).filter(region => {
    const config = zoneConfig(region), levels = region.levels;
    const sameLevel = !levels || (levels.size ?? levels.length) === 0 ||
      (levels.has ? levels.has(source.level) : levels.includes(source.level));
    const volume=region.flags?.[namespace]?.obscuring?.volume,scale=(scene.grid?.distance??5)/size;
    return !region.hidden && config && config.concealment !== 'none' && sameLevel && (volume?pointInVolume({x:point.x*scale,y:point.y*scale,z:point.elevation},volume):region.testPoint(point));
  }).map(region => region.id).sort();
}

export async function syncZoneConcealment(scene, { actors = [] } = {}) {
  const result = { created: 0, removed: 0, updated: 0, sharedActorSkipped: 0 };
  if (!scene || !game.user.isGM || game.users.activeGM?.id !== game.user.id) return result;
  const groups = new Map();
  const groupFor = actor => {
    const key = actor.uuid ?? actor;
    if (!groups.has(key)) groups.set(key, { actor, tokens: [] });
    return groups.get(key);
  };
  for (const actor of actors) groupFor(actor);
  for (const document of scene.tokens?.contents ?? []) {
    if (document.actor?.isOfType('creature')) groupFor(document.actor).tokens.push({ document, regions: occupantConcealment(document, scene) });
  }
  for (const { actor, tokens } of groups.values()) {
    if (game.users.activeGM?.id !== game.user.id || canvas.scene?.id !== scene.id) break;
    // Deleted synthetic actors disappeared with their token; do not write to them.
    if (actor.isToken && actor.token && !actor.token.parent.tokens.has(actor.token.id)) continue;
    const conditions = concealedConditions(actor);
    const owned = conditions.filter(isZoneConcealment).filter(item => !item.isLocked && !item.readonly);
    const external = conditions.some(item => !isZoneConcealment(item) || item.isLocked || item.readonly);
    const inside = tokens.filter(token => token.regions.length);
    // Native PF2e conditions belong to actors. Avoid giving an outside linked
    // duplicate a false condition; its inside counterpart still uses zone rolls.
    const wanted = inside.length > 0 && inside.length === tokens.length && !external;
    if (inside.length && inside.length !== tokens.length) result.sharedActorSkipped++;
    const remove = wanted ? owned.slice(1) : owned;
    if (remove.length) {
      await actor.deleteEmbeddedDocuments('Item', remove.map(item => item.id));
      result.removed += remove.length;
    }
    if (!wanted) continue;
    const data = { source: marker, sceneId: scene.id,
      tokenIds: inside.map(token => token.document.id).sort(), regionIds: [...new Set(inside.flatMap(token => token.regions))].sort() };
    const existing = owned[0];
    if (existing) {
      if (JSON.stringify(existing.flags[namespace].zoneConcealment) !== JSON.stringify(data)) {
        await existing.update({ [`flags.${namespace}.zoneConcealment`]: data }); result.updated++;
      }
    } else {
      const source = game.pf2e.ConditionManager.getCondition('concealed').toObject();
      delete source._id;
      source.flags ??= {}; source.flags[namespace] = { ...source.flags[namespace], zoneConcealment: data };
      await actor.createEmbeddedDocuments('Item', [source]); result.created++;
    }
  }
  return result;
}

export class ZoneConcealment {
  constructor() { this.actors = new Map(); this.pending = null; this.requested = false; this.initialized = false; }
  refresh() {
    this.requested = true;
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(async () => {
      while (this.requested) {
        this.requested = false;
        if (!canvas.ready || !game.user.isGM || game.users.activeGM?.id !== game.user.id) continue;
        if (!this.initialized) {
          // Recover tagged sources after a reload, including unlinked tokens in
          // the previous scene. Inactive scenes must not leave an actor concealed.
          const actors = [...(game.actors?.contents ?? []), ...(game.scenes?.contents ?? []).flatMap(scene =>
            (scene.tokens?.contents ?? []).map(token => token.actor).filter(Boolean))];
          for (const actor of actors) if (concealedConditions(actor).some(isZoneConcealment)) this.actors.set(actor.uuid ?? actor, actor);
          this.initialized = true;
        }
        for (const token of canvas.scene.tokens?.contents ?? []) if (token.actor?.isOfType('creature')) this.actors.set(token.actor.uuid ?? token.actor, token.actor);
        await syncZoneConcealment(canvas.scene, { actors: [...this.actors.values()] });
        for (const [key, actor] of this.actors) if (!concealedConditions(actor).some(isZoneConcealment)) this.actors.delete(key);
      }
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
}
