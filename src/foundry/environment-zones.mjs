import { tokenRayPoint } from './attack-path.mjs';
import { terrainBehavior, environmentBehavior } from './terrain-contract.mjs';

const namespace = 'foundry-creature-ai';
export const COVER_BONUS = Object.freeze({ none: 0, lesser: 1, standard: 2, greater: 4 });
export const DEFAULT_FIRING_RADIUS = 10;
const coverModes = ['occupants', 'intervening'];
const concealmentModes = ['none', 'occupants', 'through'];

export function zoneConfig(region, { includeDisabled = false } = {}) {
  const owned = (region.behaviors?.contents ?? []).find(behavior=>terrainBehavior(behavior,'environment'));
  const raw = owned ? { ...owned.flags[namespace].environment, enabled: !owned.disabled && !region.hidden } :
    region.getFlag?.(namespace, 'environment') ?? region.flags?.[namespace]?.environment;
  if (!raw || !raw.enabled && !includeDisabled) return null;
  if (!Object.hasOwn(COVER_BONUS, raw.cover) || !coverModes.includes(raw.coverMode) || !concealmentModes.includes(raw.concealment)) return null;
  const firingRadius = Number.isFinite(raw.firingRadius) && raw.firingRadius >= 0 ? raw.firingRadius : DEFAULT_FIRING_RADIUS;
  return { enabled: Boolean(raw.enabled), cover: raw.cover, coverMode: raw.coverMode, concealment: raw.concealment, firingRadius };
}

// Foundry's signed polygon tolerance expands the actual footprint, including
// rotated shapes, holes and separate components. It is not a bounding-box aura.
export function withinFiringRadius(region, point, radius, scene = region.parent) {
  if (!(radius > 0)) return false;
  const { bottom = -Infinity, top = Infinity, topInclusive = false } = region.elevation ?? {};
  if (point.elevation < bottom || (point.elevation !== bottom && (topInclusive ? point.elevation > top : point.elevation >= top))) return false;
  if (region.testPoint(point)) return true;
  const grid = scene?.grid ?? globalThis.canvas?.grid;
  const pixelsPerFoot = scene?.dimensions?.distancePixels ?? grid?.size / grid?.distance;
  if (!(pixelsPerFoot > 0) || !Number.isFinite(pixelsPerFoot)) return false;
  return region.polygonTree?.testPoint(point, radius * pixelsPerFoot + 1e-6) ?? false;
}

function relevantLevel(region, level) {
  const levels = region.levels;
  return !levels || levels.size === 0 || levels.length === 0 || (levels.has ? levels.has(level) : levels.includes(level));
}

// Native region geometry respects holes, rotated/polygonal shapes and elevation.
// Environment scripts refresh derived state only; they do not redefine surfaces.
function crosses(region, origin, destination) {
  if (region.testPoint(origin) || region.testPoint(destination)) return true;
  const segments = region.segmentizeMovementPath([origin, destination], [{ x: 0, y: 0 }]);
  return segments.some(segment => Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y,
    (segment.to.elevation ?? 0) - (segment.from.elevation ?? 0)) > 0);
}

export function environmentBetween(observer, target, { origin, destination, scene = observer.document.parent ?? globalThis.canvas?.scene } = {}) {
  const from = tokenRayPoint(observer, 'sight', origin), to = tokenRayPoint(target, 'sight', destination);
  let coverBonus = 0, concealed = false;
  const sources = [];
  for (const region of scene?.regions?.contents ?? []) {
    const config = zoneConfig(region);
    if (region.hidden || !config || !relevantLevel(region, observer.document.level) || !relevantLevel(region, target.document.level)) continue;
    const insideTarget = region.testPoint(to), insideObserver = region.testPoint(from);
    const crossing = (config.coverMode === 'intervening' || config.concealment === 'through') && crosses(region, from, to);
    // Occupant cover is a GM-declared defensive area (behind a barricade, among
    // crates). Sharing that area does not grant cover from one another. An
    // intervening obstacle protects across its footprint, not against someone
    // occupying that same obstacle. Walls still decide physical line of effect.
    const grantsCover = config.coverMode === 'occupants' ? insideTarget && !insideObserver : crossing && !insideObserver && !insideTarget;
    const firingBypass = grantsCover && COVER_BONUS[config.cover] > 0 &&
      withinFiringRadius(region, from, config.firingRadius, scene) && !withinFiringRadius(region, to, config.firingRadius, scene);
    const bonus = grantsCover && !firingBypass ? COVER_BONUS[config.cover] : 0;
    const obscures = config.concealment === 'through' ? crossing : config.concealment === 'occupants' && insideTarget;
    if (bonus || obscures || firingBypass) sources.push({ id: region.id, name: region.name, coverBonus: bonus, concealed: Boolean(obscures),
      ...(firingBypass ? { firingBypass: true, firingRadius: config.firingRadius } : {}) });
    coverBonus = Math.max(coverBonus, bonus); concealed ||= Boolean(obscures);
  }
  return { coverBonus, concealed, flatCheckDC: concealed ? 5 : null, canHide: coverBonus >= 2 || concealed,
    stealthBonus: coverBonus >= 2 ? coverBonus : 0, sources };
}

// Grant a Sneak cover bonus only when one declared protected area contains the
// complete native path. Checking endpoints alone would incorrectly bridge holes
// or a gap between two pieces of cover. Other continuous-cover cases stay at a
// conservative zero bonus until the GM adjudicates their geometry.
export function coverAlongPath(observer, subject, centers) {
  const scene=subject.document.parent,points=centers.map(center=>tokenRayPoint(subject,'sight',center));
  const from=tokenRayPoint(observer,'sight');let best=0;
  for(const region of scene.regions?.contents??[]){
    const config=zoneConfig(region);
    if(!config||config.coverMode!=='occupants'||COVER_BONUS[config.cover]<2||!relevantLevel(region,subject.document.level)||!relevantLevel(region,observer.document.level)||region.testPoint(from))continue;
    if(!points.every(point=>region.testPoint(point)))continue;
    if(points.slice(1).some((to,i)=>region.segmentizeMovementPath([points[i],to],[{x:0,y:0}]).some(segment=>segment.type!==0)))continue;
    best=Math.max(best,COVER_BONUS[config.cover]);
  }
  return best;
}

export async function configureZone(region, config) {
  if (!game.user.isGM) throw new Error('Only the GM can configure cover and concealment regions');
  if (!region || region.parent?.id !== canvas.scene?.id) throw new Error('Choose a region in the viewed scene');
  const value = { enabled: Boolean(config.enabled), cover: config.cover ?? 'none', coverMode: config.coverMode ?? 'occupants', concealment: config.concealment ?? 'none',
    firingRadius: config.firingRadius ?? zoneConfig(region, { includeDisabled: true })?.firingRadius ?? DEFAULT_FIRING_RADIUS };
  if (!Object.hasOwn(COVER_BONUS, value.cover) || !coverModes.includes(value.coverMode) || !concealmentModes.includes(value.concealment)) throw new Error('Invalid cover or concealment zone settings');
  if (!Number.isFinite(value.firingRadius) || value.firingRadius < 0) throw new Error('Firing radius must be a finite, non-negative distance in feet');
  const owned=(region.behaviors?.contents??[]).find(behavior=>terrainBehavior(behavior,'environment'));
  if(owned)await owned.update({disabled:!value.enabled,[`flags.${namespace}.environment`]:value});
  else if(region.createEmbeddedDocuments)await region.createEmbeddedDocuments('RegionBehavior',[environmentBehavior(value)]);
  await region.setFlag(namespace, 'environment', value);
  game.modules?.get?.(namespace)?.api?.zones?.refresh?.();
  return value;
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function openZones(regionId) {
  if (!game.user.isGM || !canvas.ready) throw new Error('Open a scene as GM first');
  const regions = canvas.scene.regions.contents;
  if (!regions.length) {
    ui.notifications.info('Draw a Scene Region around fog, foliage, an obstacle or a protected area, then open Cover / concealment zones. No Region Behaviors are needed.');
    return;
  }
  const selected = regions.find(region => region.id === regionId) ?? canvas.regions?.controlled?.[0]?.document ?? regions[0];
  const config = zoneConfig(selected, { includeDisabled: true }) ?? { enabled: true, cover: 'none', coverMode: 'occupants', concealment: 'none', firingRadius: DEFAULT_FIRING_RADIUS };
  const options = (values, current) => Object.entries(values).map(([value, label]) => `<option value="${escape(value)}" ${value === current ? 'selected' : ''}>${escape(label)}</option>`).join('');
  const read = action => (event, button) => ({ action, ...Object.fromEntries(['region', 'cover', 'coverMode', 'concealment'].map(name => [name, button.form.elements[name].value]).concat([
    ['enabled', button.form.elements.enabled.checked], ['firingRadius', button.form.elements.firingRadius.value.trim() === '' ? NaN : Number(button.form.elements.firingRadius.value)],
  ])) });
  const answer = await foundry.applications.api.DialogV2.wait({ window: { title: 'Creature AI — Cover / concealment zones' },
    content: `<p>Draw regions with Foundry's Scene Region tools. These settings use their shapes, holes, elevation and scene levels. Saving attaches a named cover/concealment behavior. Disabling it in the Region sheet also disables its effect. No floor surfaces are added.</p>
      <div class="form-group"><label>Region</label><select name="region">${options(Object.fromEntries(regions.map(region => [region.id, `${region.name}${zoneConfig(region) ? ' (configured)' : ''}`])), selected.id)}</select></div>
      <p>To edit a different region's existing values, select it and click <strong>Load region</strong> first.</p>
      <div class="form-group"><label>Enabled</label><input name="enabled" type="checkbox" ${config.enabled ? 'checked' : ''}></div>
      <div class="form-group"><label>Cover</label><select name="cover">${options({ none: 'None', lesser: 'Lesser (+1 AC; cannot Hide)', standard: 'Standard (+2 AC and Stealth)', greater: 'Greater (+4 AC and Stealth)' }, config.cover)}</select></div>
      <div class="form-group"><label>Cover geometry</label><select name="coverMode">${options({ occupants: 'Protected area: target inside, attacker outside', intervening: 'Obstacle: crosses region, both creatures outside' }, config.coverMode)}</select></div>
      <div class="form-group"><label>Firing radius (ft)</label><input name="firingRadius" type="number" min="0" step="any" required value="${config.firingRadius}"></div>
      <p>Within this distance of the cover footprint, a shooter ignores this zone's cover against targets outside the radius. Return attacks still use normal cover. If both creatures are within the radius, normal cover applies. Set 0 to disable. Concealment is unchanged.</p>
      <div class="form-group"><label>Concealment</label><select name="concealment">${options({ none: 'None', occupants: 'Foliage: target inside', through: 'Fog / smoke: sight line enters or crosses region' }, config.concealment)}</select></div>
      <p>Overlap uses the highest cover bonus and a single DC 5 concealment flat check. Concealment does not itself make a creature Hidden. Solid obstacles still need walls to block passage and attacks.</p>
      <p>Cover applies to native targeted attacks using PF2e circumstance stacking. Manual attacks, spell attacks and targeted attack-trait skill actions also resolve concealment before rolling. Select a single observer token to see directional defenses above other tokens. Area effects and special senses remain manual.</p>`,
    buttons: [{ action: 'load', label: 'Load region', callback: read('load') }, { action: 'save', label: 'Save zone', default: true, callback: read('save') }], rejectClose: false });
  if (!answer) return;
  if (answer.action === 'load') return openZones(answer.region);
  await configureZone(regions.find(region => region.id === answer.region), answer);
  ui.notifications.info('Cover / concealment zone saved');
}
