import { clearSightPath } from './attack-path.mjs';
import {sharesVerticalSpace} from './vertical-space.mjs';
import { incapacitationReason } from './combat-state.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { hasUnmanagedConcealment } from './zone-concealment.mjs';

const namespace = 'foundry-creature-ai';
const locks = new Map();
const spatialKeys = ['x', 'y', 'elevation', 'level', 'width', 'height', 'depth'];
const position = token => {
  const source = token.document._source ?? token.document;
  return Object.fromEntries(spatialKeys.map(key => [key, source[key] ?? (['width', 'height', 'depth'].includes(key) ? 1 : key === 'elevation' ? 0 : null)]));
};

// Until stealth actions are taught, ordinary movement preserves an already
// known square. Teleports/undo and explicit Undetected never broadcast it.
export function movementKnowledge(document, movement, operation = {}) {
  if (!movement || operation.isUndo || operation.isPaste || operation.teleport ||
    !['dragging', 'keyboard', 'api'].includes(movement.method)) return null;
  const waypoints = movement.passed?.waypoints ?? [];
  if (!waypoints.length || waypoints.some(point => !point.action || point.action === 'displace')) return null;
  return { tokenId: document.id, position: position({ document }) };
}

// A remembered token is geometry only. Never move the real document, reveal it,
// add global Hidden, or query its live coordinates for the pursuit destination.
export function rememberedToken(token, square, awareness) {
  const document = { ...square, id: token.id, parent: token.document.parent, actor: token.actor };
  for (const method of ['getMovementOrigin', 'getVisionOrigin']) if (typeof token.document[method] === 'function') {
    document[method] = () => token.document[method](square);
  }
  const width = square.width * canvas.grid.size, height = square.height * canvas.grid.size;
  const view = { id: token.id, name: token.name, actor: token.actor, document, memoryView: awareness, w: width, h: height,
    center: { x: square.x + width / 2, y: square.y + height / 2 },
    mechanicalBounds: new PIXI.Rectangle(square.x, square.y, width, height),
    distanceTo(other, options) { return token.distanceTo.call(this, other, options); } };
  return view;
}

export function targetKnowledge(adapter, knownMovement) {
  const combatId = game.combat.id, sceneId = canvas.scene.id;
  const saved = adapter.token.document.getFlag(namespace, 'targetMemory');
  const previous = saved?.combatId === combatId && saved.sceneId === sceneId ? saved.entries ?? [] : [];
  const entries = [], checks = [];
  for (const id of adapter.targetIds()) {
    const check = adapter.assessTarget(id, { pursuit: true });
    if (!check.target) { checks.push(check); continue; }
    const target = check.target, actor = target.actor;
    const sameLevel = sharesVerticalSpace(adapter.token,target);
    const relative = detectionFor(adapter.token, target);
    const stealth = relative.state !== 'observed';
    const concealed = hasUnmanagedConcealment(actor);
    const observerBlind = adapter.actor.hasCondition('blinded');
    const observed = !observerBlind && sameLevel && !target.document.hidden && !stealth && clearSightPath(adapter.token, target);
    let entry = previous.find(entry => entry.id === id);
    if(relative.state==='hidden'&&relative.source!=='invisibility'&&!observerBlind&&sameLevel&&!target.document.hidden){
      entry={id,position:position(target),round:game.combat.round,source:'located square'};
    }
    if (entry && knownMovement?.tokenId === id && !observerBlind && !adapter.actor.hasCondition('deafened') && sameLevel && !target.document.hidden &&
      relative.state !== 'undetected' && !actor.hasCondition('invisible')) {
      entry = { id, position: knownMovement.position, round: game.combat.round, source: 'known movement' };
    }
    if (observed) entry = { id, position: position(target), round: game.combat.round, source: 'observed' };
    // The GM's encounter roster establishes initial known squares. Explicitly
    // undetected/unnoticed/invisible or GM-hidden newcomers are never located.
    else if (!entry && !observerBlind && sameLevel && !target.document.hidden && !actor.hasCondition('invisible') &&
      (relative.state !== 'undetected' || relative.knownPosition)) {
      entry = { id, position: relative.state === 'undetected' ? relative.knownPosition : position(target), round: game.combat.round, source: 'known encounter square' };
    }
    if (!entry) {
      checks.push({ ...check, target: null, reason: target.document.hidden ? 'token is hidden; no known square' : 'undetected or invisible enemy has no known square' }); continue;
    }
    entries.push(entry);
    if (observed) {
      checks.push({ ...check, awareness: { state: 'observed', detection: 'observed', position: entry.position, source: entry.source, searchRequired: false,
        flatCheckRequired: concealed } }); continue;
    }
    if (!sharesVerticalSpace(adapter.token,rememberedToken(target,entry.position))) {
      checks.push({ ...check, target: null, reason: 'last known square is on another elevation or level' }); continue;
    }
    const awareness = { state: 'known-square', position: entry.position, source: entry.source, round: entry.round,
      detection: relative.state === 'undetected' || target.document.hidden ? 'undetected' : 'hidden',
      precisionBlocked:relative.precisionBlocked??false,
      flatCheckRequired: concealed || relative.state==='hidden', allowAttackEstimate: false, searchRequired: false };
    const view = rememberedToken(target, entry.position, awareness);
    awareness.searchRequired = clearSightPath(adapter.token, view);
    if(awareness.searchRequired&&relative.state==='observed')awareness.detection='undetected';
    awareness.attackOnSight=awareness.detection==='hidden'&&relative.source!=='invisibility'&&!target.document.hidden;
    // Hidden has a current known square and permits a DC 11 targeting check.
    // An old Undetected square never permits tracking the real creature.
    awareness.allowAttackEstimate = awareness.searchRequired && relative.state==='hidden' && relative.source!=='invisibility' && !target.document.hidden;
    checks.push({ ...check, target: view, awareness });
  }
  return { checks, memory: { combatId, sceneId, entries } };
}

export async function rememberTargets(adapter, valid = () => true, knownMovement) {
  const key = adapter.token.document.uuid ?? `${canvas.scene.id}:${adapter.token.id}`;
  const previous = locks.get(key);
  const task = Promise.resolve(previous).catch(() => {}).then(async () => {
    if (!valid() || !game.combat?.started || game.users.activeGM?.id !== game.user.id || incapacitationReason(adapter.token)) return;
    const { memory } = targetKnowledge(adapter, knownMovement);
    if (valid() && JSON.stringify(adapter.token.document.getFlag(namespace, 'targetMemory')) !== JSON.stringify(memory)) {
      await adapter.token.document.setFlag(namespace, 'targetMemory', memory);
    }
  });
  locks.set(key, task);
  try { await task; } finally { if (locks.get(key) === task) locks.delete(key); }
}
