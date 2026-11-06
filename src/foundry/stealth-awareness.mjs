import { clearSightPath, tokenRayPoint } from './attack-path.mjs';
import { environmentBetween } from './environment-zones.mjs';
import { checkDegree } from '../framework/math.mjs';
import { hasStealthConcealment } from './zone-concealment.mjs';
import { clearStealthBelief } from './stealth-belief.mjs';
import { sensoryDetection } from './perception-senses.mjs';

const namespace = 'foundry-creature-ai';
export const STEALTH_MOVEMENT = `${namespace}:sneak`;
const square = token => Object.fromEntries(['x','y','elevation','level','width','height','depth'].map(key => [key, token.document[key] ?? (key === 'depth' ? 1 : null)]));
export const stealthContext = () => ({ combatId: game.combat?.started ? game.combat.id : null, sceneId: canvas.scene?.id });
const openStealth = subject => hasStealthConcealment(subject.actor) || subject.actor.hasCondition('invisible') || (subject.actor.itemTypes?.feat ?? []).some(item=>item.slug==='legendary-sneak');

export function stealthRecord(subject) {
  const saved = subject.document.getFlag?.(namespace, 'stealth');
  return saved && (saved.combatId ?? null) === stealthContext().combatId && saved.sceneId === canvas.scene?.id ? saved : null;
}

export function stealthConditionStamp(subject) {
  return JSON.stringify(['hidden','undetected','unnoticed','invisible'].filter(slug=>subject.actor.hasCondition(slug)).map(slug=>
    [slug,(subject.actor.getCondition?.(slug,{all:true})??[]).map(condition=>condition.id).sort()]));
}

const conditionDetection = subject => subject.actor.hasCondition('undetected','unnoticed') ? {state:'undetected'} :
  subject.actor.hasCondition('hidden') ? {state:'hidden'} : subject.actor.hasCondition('invisible') ? {state:'hidden',source:'invisibility'} : {state:'observed'};

export function detectionFor(observer, subject) {
  const record = stealthRecord(subject), saved = record?.entries.find(entry => entry.observerId === observer.id);
  let entry = saved?.source==='seek' && saved.conditionStamp!==stealthConditionStamp(subject) ? null : saved;
  // A hearing result cannot become Observed while vision is unavailable. Once
  // sight returns it may be improved by Seek again, without discarding the
  // located square or changing any other observer's detection result.
  if(entry?.sense&&!observer.actor.hasCondition('blinded'))entry={...entry,precisionBlocked:subject.actor.hasCondition('invisible')};
  if (!entry) return sensoryDetection(observer,subject,conditionDetection(subject));
  if(entry.state==='observed')return sensoryDetection(observer,subject,subject.actor.hasCondition('invisible')?{...entry,state:'hidden'}:entry);
  // Once cover is lost in a clear view, geometric observation can reveal the
  // subject. Successful Sneak is provisionally concealed during its native move;
  // its endpoint and check are resolved before the action releases the runner.
  const environment = environmentBetween(observer, subject);
  if (!record.moving && clearSightPath(observer, subject) && !environment.canHide && !openStealth(subject) && !observer.actor.hasCondition('blinded') &&
    !subject.actor.hasCondition('hidden','undetected','unnoticed')) return { state: 'observed' };
  return sensoryDetection(observer,subject,entry);
}

export function stealthObservers(subject) {
  const ids = game.combat?.started ? new Set(Array.from(game.combat.combatants).filter(c => !c.defeated &&
    (c.sceneId ?? c.token?.parent?.id ?? canvas.scene.id) === canvas.scene.id).map(c => c.tokenId)) : null;
  return canvas.tokens.placeables.filter(observer => observer !== subject && (!ids || ids.has(observer.id)) && observer.actor?.isOfType?.('creature') &&
    !observer.actor.isAllyOf(subject.actor) && observer.actor.hitPoints?.value > 0 && !observer.actor.hasCondition('unconscious','dying','dead'));
}

export function hidingFrom(observer, subject, destination) {
  const environment = environmentBetween(observer, subject, { destination });
  const target = destination ? { center:destination, document:{ parent:subject.document.parent,
    getVisionOrigin:()=>tokenRayPoint(subject,'sight',destination) } } : subject;
  const blocked = !clearSightPath(observer, target);
  const inherent = openStealth(subject) || observer.actor.hasCondition('blinded');
  return { ...environment, canHide: environment.canHide || blocked || inherent, blocked };
}

export async function reveal(subject) {
  await clearStealthBelief(subject);
  if (!stealthRecord(subject)) return;
  await subject.document.setFlag(namespace, 'stealth', { ...stealthContext(), moving: false, entries: [] });
}

export async function rollStealth(subject, kind, { observers = stealthObservers(subject), eligible, valid = () => true, coverThroughout, destination, moving = false,
  providedRoll, circumstanceBonus, starts: suppliedStarts, manual = false } = {}) {
  const statistic = subject.actor.getStatistic('stealth');
  if (!statistic?.check?.roll) throw new Error('This creature has no native Stealth roll');
  const starts = suppliedStarts ?? new Map(observers.map(observer => [observer.id, detectionFor(observer, subject)]));
  const roll = providedRoll ?? await statistic.check.roll({ skipDialog: true, action: kind, traits: ['secret'], extraRollOptions: [`${namespace}:managed`, 'secret', 'skip-handling-message', `action:${kind}`] });
  if (!roll || !Number.isFinite(roll.total)) throw new Error('Stealth was cancelled or unresolved; inspect the spent action');
  if (!valid()) throw new Error('Combat changed while Stealth resolved; inspect the spent action');
  const die = roll.dice?.find(die => die.faces === 20)?.total;
  if (!Number.isInteger(die)) throw new Error('Cannot determine the native Stealth d20 result');
  const existingCircumstance = circumstanceBonus ?? Math.max(0, ...(roll.options?.modifiers ?? statistic.check.modifiers ?? [])
    .filter(modifier => modifier.type === 'circumstance' && modifier.enabled !== false && !modifier.ignored).map(modifier => modifier.modifier ?? modifier.value ?? 0));
  const entries = observers.map(observer => {
    const environment = hidingFrom(observer, subject, destination), wasEligible = !eligible || eligible.includes(observer.id);
    const dc = observer.actor.perception?.dc?.value ?? observer.actor.getStatistic('perception')?.dc?.value;
    if (!Number.isFinite(dc)) throw new Error(`Cannot determine ${observer.name}'s Perception DC`);
    const cover = kind === 'sneak' ? coverThroughout?.get(observer.id) ?? 0 : environment.stealthBonus;
    const bonus = Math.max(0, cover - existingCircumstance);
    const degree = checkDegree(die, roll.total - die + bonus, dc);
    let state = !wasEligible ? 'observed' : degree >= 2 ? kind === 'sneak' ? 'undetected' : 'hidden' : kind === 'sneak' && degree === 1 ? 'hidden' : 'observed';
    if (kind === 'hide' && ['hidden','undetected'].includes(starts.get(observer.id)?.state)) state = starts.get(observer.id).state;
    if (!environment.canHide) state = 'observed';
    if (subject.actor.hasCondition('invisible') && state === 'observed') state = 'hidden';
    if (environment.blocked && state === 'observed' && !moving) state = 'hidden';
    return { observerId: observer.id, state, degree, total: roll.total + bonus, dc,
      knownPosition: state === 'undetected' ? starts.get(observer.id)?.knownPosition ?? square(subject) : square(subject) };
  });
  await subject.document.setFlag(namespace, 'stealth', { ...stealthContext(), moving, entries, ...(manual?{manual:true}:{}) });
  return entries;
}

export async function finishSneak(subject, entries) {
  await subject.document.setFlag(namespace,'stealth',{...stealthContext(),moving:false,
    entries:entries.map(entry=>({...entry,knownPosition:entry.state==='undetected'?entry.knownPosition:square(subject)}))});
}

export function refreshStealthVisibility() {
  for (const token of canvas.tokens?.placeables ?? []) token.renderFlags?.set({ refreshVisibility: true });
}

export function visibleToUser(subject, user = game.user) {
  const record = stealthRecord(subject);
  if (user.isGM || !record?.entries.some(entry => entry.state === 'undetected')) return true;
  if (subject.actor?.testUserPermission?.(user, 'OWNER')) return true;
  const combatants = game.combat?.started ? new Set(Array.from(game.combat.combatants).filter(c=>!c.defeated).map(c=>c.tokenId)) : null;
  const observers = canvas.tokens.placeables.filter(token => token !== subject && (!combatants || combatants.has(token.id)) && token.actor?.hitPoints?.value>0 &&
    !token.actor.hasCondition('unconscious','dying','dead') && token.actor.testUserPermission?.(user, 'OWNER'));
  return observers.some(observer => detectionFor(observer, subject).state !== 'undetected');
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export async function openStealthControls(subject = canvas.tokens.controlled[0]) {
  if (!game.user.isGM || !subject || !game.combat?.started) throw new Error('Select one creature in an active combat as GM');
  const observers = stealthObservers(subject),combatId=game.combat.id,sceneId=canvas.scene.id;
  const answer = await foundry.applications.api.DialogV2.wait({ window: { title: `Creature AI — Detection: ${subject.name}` },
    content: `<p>Detection is relative to each observer. Correct these states after manual Seek, Point Out, Sneak or other adjudication. This panel does not spend or refund actions.</p>
      <p>Hidden retains a known square. Undetected hides this creature from players who have no observing character able to locate it. GM visibility stays available. Global actor conditions remain separate.</p>
      ${observers.map(observer => `<div class="form-group"><label>${escape(observer.name)}</label><select name="${escape(observer.id)}">${['observed','hidden','undetected'].map(state=>`<option value="${state}" ${detectionFor(observer,subject).state===state?'selected':''}>${state}</option>`).join('')}</select></div>`).join('')}`,
    buttons: [{ action: 'save', label: 'Save detection', callback: (event,button) => observers.map(observer=>({observerId:observer.id,state:button.form.elements[observer.id].value})) }], rejectClose:false });
  if (!answer) return;
  if (game.combat?.id!==combatId || canvas.scene.id!==sceneId) throw new Error('Combat or scene changed before detection was saved');
  if (answer.some(entry=>!['observed','hidden','undetected'].includes(entry.state))) throw new Error('Invalid detection state');
  const previous=stealthRecord(subject);
  const entries=answer.map(entry=>({...entry,knownPosition:entry.state==='undetected'?previous?.entries.find(e=>e.observerId===entry.observerId)?.knownPosition??null:square(subject)}));
  await subject.document.setFlag(namespace,'stealth',{combatId,sceneId,moving:false,entries});
  refreshStealthVisibility();
}

export function installStealthVisibility({packageId=namespace}={}) {
  // Use the native visibility getter so Foundry also updates the primary-group
  // token mesh, hit testing, auras and other renderers that inspect visibility.
  libWrapper.register(packageId, 'CONFIG.Token.objectClass.prototype.isVisible', function (wrapped) {
    return wrapped() && visibleToUser(this);
  }, 'WRAPPER');
}
