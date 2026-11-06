import { environmentBetween } from './environment-zones.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { clearSightPath } from './attack-path.mjs';

const namespace = 'foundry-creature-ai';
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

// Client-local, observer-relative display. The native tooltip reads cached text
// only; all geometry work happens on document/selection events, never a ticker.
export class EnvironmentAwareness {
  constructor({ query = environmentBetween, enabled = () => true } = {}) {
    this.query = query; this.enabled = enabled; this.entries = new Map(); this.observer = null; this.sceneId = null;
    this.pending = null; this.all = false; this.moved = new Set();
    this.rendered = new WeakMap(); this.tooltips = new Set(); this.tooltipPending = null;
  }
  clear() {
    const tokens=[...this.entries.values()].map(entry=>entry.token);
    this.entries.clear(); this.observer = null; this.sceneId = null;
    for(const token of tokens)this.refreshLabel(token);
  }
  refreshLabel(token) {
    token.renderFlags?.set({ refreshTooltip: true });
    // Some canvas redraws leave the tooltip empty while the cached label stays
    // unchanged. Refresh the existing native text object on document/selection
    // events too; no extra geometry, render ticker, or persistent actor effect.
    if(token.tooltip&&token.tooltip.text!==token._getTooltipText?.())token._refreshTooltip?.();
    this.restoreTooltip(token);
  }
  restoreTooltip(token) {
    const tooltip=token.tooltip;if(!tooltip||tooltip.destroyed)return;
    // Other modules may replace the native tooltip with absolute elevation in
    // refreshToken, after _refreshTooltip has already appended our cached text.
    // Preserve that prefix and change only our own suffix, without geometry.
    const label=this.enabled()?this.label(token):'',previous=this.rendered.get(token)??'';
    let text=tooltip.text??'';
    if(previous&&previous!==label){
      if(text===previous)text='';
      else if(text.endsWith(`\n${previous}`))text=text.slice(0,-previous.length-1);
    }
    if(label&&text!==label&&!text.endsWith(`\n${label}`))text=[text,label].filter(Boolean).join('\n');
    if(tooltip.text!==text)tooltip.text=text;
    if(label)this.rendered.set(token,label);else this.rendered.delete(token);
  }
  scheduleTooltip(token) {
    if(!this.label(token)&&!this.rendered.has(token))return;
    this.tooltips.add(token);
    if(this.tooltipPending)return this.tooltipPending;
    // Finish after every synchronous refreshToken listener, regardless of their
    // registration order. Native render flags remain untouched: no render loop.
    this.tooltipPending=Promise.resolve().then(()=>{
      for(const token of this.tooltips)this.restoreTooltip(token);
      this.tooltips.clear();this.tooltipPending=null;
    });
    return this.tooltipPending;
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
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
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
      const previous = this.entries.get(token.id);
      this.entries.set(token.id, { token, environment, detection, label });
      if (previous?.label !== label||token.tooltip?.text!==token._getTooltipText?.())this.refreshLabel(token);
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
  install({packageId=namespace}={}) {
    const awareness = this;
    libWrapper.register(packageId, 'CONFIG.Token.objectClass.prototype._getTooltipText', function (wrapped, ...args) {
      return [wrapped(...args), awareness.label(this)].filter(Boolean).join('\n');
    }, 'WRAPPER');
    globalThis.Hooks?.on('refreshToken',token=>awareness.scheduleTooltip(token));
  }
}
