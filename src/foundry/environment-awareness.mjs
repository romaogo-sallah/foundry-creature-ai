import { environmentBetween } from './environment-zones.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { clearSightPath } from './attack-path.mjs';
import {TokenCaptions} from './token-captions.mjs';

export const TOKEN_GEOMETRY_FIELDS = ['x', 'y', 'elevation', 'level', 'width', 'height', 'depth', 'shape', 'hidden', 'actorId', 'actorLink'];

export function environmentObserver() {
  const controlled = (canvas.tokens?.controlled ?? []).filter(token => token.actor?.isOfType?.('creature'));
  if (controlled.length) return controlled.length === 1 ? controlled[0] : null;
  const character = game.user.character;
  const tokens = character ? (canvas.tokens?.placeables ?? []).filter(token => token.actor === character ||
    token.document.actorLink && token.document.actorId === character.id) : [];
  return tokens.length === 1 ? tokens[0] : null;
}

// This describes the selected observer's view; it never creates a condition,
// locates an unknown creature, or resolves Seek. LOS/invisibility without a
// recorded detection result is explicitly a visual diagnostic only.
export function captionDetection(observer, target) {
  const relative = detectionFor(observer, target), actor = target.actor;
  const invisible = actor.hasCondition('invisible'), blocked = !clearSightPath(observer, target);
  const undetected = relative.state === 'undetected';
  const explicit = relative.state !== 'observed'&&relative.source!=='invisibility';
  const hidden = explicit || invisible || blocked || target.document.hidden;
  const causes = [];
  if (relative.state !== 'observed'&&relative.source!=='invisibility'&&!relative.precisionBlocked) causes.push('stealth');
  if (invisible) causes.push('invisibility');
  if (relative.source==='blinded') {
    const index=causes.indexOf('stealth');if(index>=0)causes.splice(index,1);
    causes.push('observer blinded');
  }
  if (blocked) causes.push('LOS blocked');
  if (target.document.hidden) causes.push('GM hidden');
  if (explicit && !causes.length) causes.push('stealth');
  return { state: undetected ? 'undetected' : hidden ? 'hidden' : 'observed', causes, lineOfSight: !blocked, diagnosticOnly: hidden && !explicit };
}

export function defenseLabel(environment, detection) {
  const hidden = detection && detection.state !== 'observed';
  return [environment.coverBonus ? `Cover +${environment.coverBonus}` : '',
    environment.concealed ? hidden ? 'Concealed' : 'Concealed (DC 5)' : '',
    hidden ? `${detection.state === 'undetected' ? 'Undetected' : 'Hidden'} (${detection.causes.join('; ')})` : '',
  ].filter(Boolean).join('\n');
}

// Client-local, observer-relative display. The tactical text uses cached data
// only; all geometry work happens on document/selection events, never a ticker.
export class EnvironmentAwareness {
  constructor({ query = environmentBetween, enabled = () => true } = {}) {
    this.query = query; this.enabled = enabled; this.entries = new Map(); this.observer = null; this.sceneId = null;
    this.pending = null; this.all = false; this.moved = new Set();
    this.captions = new TokenCaptions(); this.layouts = new Set(); this.layoutPending = null;
  }
  clear() {
    this.entries.clear(); this.observer = null; this.sceneId = null;
    this.captions.clear();
  }
  refreshLabel(token) {
    this.captions.update(token,this.label(token));
  }
  scheduleLayout(token) {
    if(!this.captions.get(token))return;
    this.layouts.add(token);
    if(this.layoutPending)return this.layoutPending;
    // Only placement follows final native elevation text. Caption text stays
    // untouched through the entire render cycle; no geometry or render flags.
    this.layoutPending=Promise.resolve().then(()=>{
      for(const token of this.layouts)this.captions.layout(token);
      this.layouts.clear();this.layoutPending=null;
    });
    return this.layoutPending;
  }
  label(token) { return this.entries.get(token.id)?.label ?? ''; }
  refresh({ moved = [], all = true } = {}) {
    if (!canvas.ready || !this.enabled()) { this.clear(); return; }
    const observer = environmentObserver(), sceneId = canvas.scene.id;
    if (observer !== this.observer || sceneId !== this.sceneId) { this.clear(); all = true; }
    this.observer = observer; this.sceneId = sceneId;
    if (!observer) { this.clear(); return; }
    const changed = new Set(moved);
    if (changed.has(observer.id)) all = true;
    const tokens = canvas.tokens.placeables, ids = new Set(tokens.map(token => token.id));
    for (const [id,entry] of this.entries) if (!ids.has(id)) {this.captions.remove(entry.token);this.entries.delete(id);}
    for (const token of tokens) {
      if (token === observer) continue;
      if (!all && !changed.has(token.id)) continue;
      let environment = token.actor?.isOfType?.('creature') && token.isVisible !== false &&
        (game.user.isGM || !token.document.hidden) ? this.query(observer, token) : null;
      let detection = environment ? captionDetection(observer, token) : null;
      // A player caption must not mark an undetected creature's actual square,
      // including when another owned observer lets the native token stay visible.
      if (!game.user.isGM && detection?.state === 'undetected') { environment = null; detection = null; }
      const label = environment ? defenseLabel(environment, detection) : '';
      this.entries.set(token.id, { token, environment, detection, label });
      this.refreshLabel(token);
    }
  }
  schedule(tokenId) {
    if (tokenId) this.moved.add(tokenId); else this.all = true;
    if (this.pending) return this.pending;
    this.pending = Promise.resolve().then(() => {
      const all = this.all, moved = [...this.moved]; this.all = false; this.moved.clear();
      this.refresh({ all, moved });
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  install() {
    const awareness = this;
    globalThis.Hooks?.on('refreshToken',token=>awareness.scheduleLayout(token));
  }
}
