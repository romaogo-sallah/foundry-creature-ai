import { environmentBetween } from './environment-zones.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { hasUnmanagedConcealment } from './zone-concealment.mjs';
import { tokenRayPoint } from './attack-path.mjs';
import {checkRestriction,notifyRestriction} from './action-restrictions.mjs';
import {wrapConditionSave} from './manual-condition-spells.mjs';
import {nativeRuleAction,resolveConditionChecks} from './condition-actions.mjs';
import {rulesAPI} from './rules-api.mjs';
import {sureStrike} from './spell-attack-buffs.mjs';

const namespace = 'foundry-creature-ai';
const managed = `${namespace}:managed`;
const ammoCallbacks = new WeakMap();
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hasOption = (options, option) => options?.has?.(option) ?? options?.includes?.(option) ?? false;

export function concealmentDC(observer, target, environment = environmentBetween(observer, target)) {
  if (['hidden','undetected'].includes(detectionFor(observer, target).state)) return 11;
  if(target.actor?.hasCondition('invisible')&&detectionFor(observer,target).source==='revealed-invisibility')return 5;
  if(target.actor?.flags?.[namespace]?.revealed)return null;
  return observer.actor?.hasCondition('dazzled')||environment.concealed || target.actor && hasUnmanagedConcealment(target.actor) ? 5 : null;
}

// The caller already reserved the triggering action (and MAP). Failure spends
// that action without an attack/maneuver roll or damage, and never grants a hit
// follow-up. This promise remains inside the runner/reaction barrier.
export async function concealmentCheck(observer, target, { valid = () => true, dc = concealmentDC(observer, target), manual = false,attack=false } = {}) {
  if(attack&&sureStrike(observer.actor))return true;
  if (!dc) return true;
  if (!valid()) throw new Error('The action stopped before its concealment check');
  const roll = await new Roll('1d20').evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: observer.document }),
    flavor: `${dc === 11 ? 'Hidden' : 'Concealment'} — ${escape(target.name)}: DC ${dc} (${roll.total >= dc ? 'success' : 'failure'})`,
    flags: { [namespace]: { managed: true, concealment: { observerId: observer.id, targetId: target.id, dc, success: roll.total >= dc, manual } },
      pf2e: { context: { type: 'flat-check', options: [managed] } } } });
  if (!valid()) throw new Error(manual ? 'The tokens or zones changed during the flat check. The attack was stopped; resolve the spent action before retrying.' : 'The action stopped while its concealment check resolved; inspect the reserved action');
  return roll.total >= dc;
}

// Apply the bonus to a contextual clone of PF2e's native AC statistic. Its
// existing modifiers, shield/cover circumstance stacking and roll options stay
// intact. No actor items/conditions are created, updated or deleted.
export function applyEnvironmentCover(context) {
  if (context?.type !== 'attack-roll' || context.isReroll || context.createMessage === false) return null;
  const observer = (context.origin?.token ?? context.token)?.object;
  const target = context.target?.token?.object;
  if (!observer || !target) return null;
  const environment = environmentBetween(observer, target);
  environment.flatCheckDC = concealmentDC(observer, target, environment);
  if (hasOption(context.options, `${namespace}:ignore-cover`)) environment.coverBonus = 0;
  const hiddenAttacker = ['hidden','undetected'].includes(detectionFor(target, observer).state);
  const offGuard = hiddenAttacker && (observer.actor?.type !== 'character' || context.action === 'strike' || hasOption(context.options, managed));
  if (offGuard) context.options = new Set([...(context.options ?? []), 'target:condition:off-guard', `${namespace}:hidden-strike`]);
  const options = context.options ?? [];
  const reaction = options.has?.(`${namespace}:reaction`) ?? options.includes?.(`${namespace}:reaction`);
  const scamper = Boolean(reaction && target.document.getFlag(namespace, 'scampering'));
  if (!environment.coverBonus && !offGuard && !scamper) return environment;
  const parent = context.dc?.statistic?.parent;
  if (!parent?.clone) throw new Error('PF2e did not supply a contextual AC statistic for region cover; resolve this attack manually');
  const modifiers = [environment.coverBonus ? { slug: 'creature-ai-zone-cover', label: 'Scene region cover', modifier: environment.coverBonus } : null,
    offGuard ? { slug: 'off-guard', label: 'Off-Guard to hidden attacker', modifier: -2 } : null,
    scamper ? { slug: 'scamper', label: 'Scamper vs movement reactions', modifier: 2 } : null].filter(Boolean)
    .map(data => new game.pf2e.Modifier({ ...data, type: 'circumstance' }));
  const statistic = parent.clone({ modifiers }).dc;
  context.dc = { ...context.dc, value: statistic.value, statistic };
  return environment;
}

export function installEnvironmentRolls({playerStealth=null,packageId=namespace,conditionsEnabled=()=>true,environmentEnabled=()=>true}={}) {
  if (!globalThis.libWrapper) throw new Error('Enable libWrapper to apply cover regions to native attack rolls');
  // The native character Strike installs its ammo consumption in a callback.
  // A failed flat check must spend that ammo without invoking hit/damage macros.
  if (globalThis.CONFIG?.PF2E?.Actor?.documentClasses?.character?.prototype?.consumeAmmo) {
    libWrapper.register(packageId, 'CONFIG.PF2E.Actor.documentClasses.character.prototype.consumeAmmo', function (wrapped, weapon, options) {
      const previous = options.callback, result = wrapped(weapon, options);
      if (result && weapon.ammo && typeof options.callback === 'function' && options.callback !== previous) {
        ammoCallbacks.set(options.callback, { weapon, spent: false });
      }
      return result;
    }, 'WRAPPER');
  }
  // Both the concealment gate and player Stealth handling can intentionally
  // suppress the native check. MIXED permits those returns without libWrapper
  // unregistering this hook after a failed flat check/cancelled action.
  libWrapper.register(packageId, 'game.pf2e.Check.roll', function (wrapped, ...args) {
    const restriction=conditionsEnabled()&&checkRestriction(args[0],args[1]);
    if(restriction){const context=args[1];notifyRestriction(context?.actor??context?.origin?.token?.actor??context?.origin?.token?.object?.actor,restriction);return null;}
    const terrainRoll = async (check, context, ...rest) => {
    const restriction=conditionsEnabled()&&checkRestriction(check,context);
    if(restriction){notifyRestriction(context?.actor??context?.origin?.token?.actor??context?.origin?.token?.object?.actor,restriction);return null;}
    const environment = environmentEnabled()?applyEnvironmentCover(context):null;
    const options = context?.options ?? [];
    const isManaged = hasOption(options, managed);
    const observer = (context?.origin?.token ?? context?.token)?.object, target = context?.target?.token?.object;
    if(conditionsEnabled()&&!isManaged&&context?.type==='skill-check'&&context.action&&observer&&
      !await resolveConditionChecks(observer.actor,nativeRuleAction(context.item,{kind:context.action,
        traits:(context.traits??[]).map(t=>typeof t==='string'?t:t.name)}),{token:observer,manual:true}))return null;
    const attackSkill = context?.type === 'skill-check' && (hasOption(options, 'attack') ||
      context.traits?.some(trait => (typeof trait === 'string' ? trait : trait.name) === 'attack'));
    if (environmentEnabled()&&!isManaged && !context?.isReroll && context?.createMessage !== false && observer && target &&
      (context.type === 'attack-roll' || attackSkill) && !hasOption(options, `${namespace}:ignore-concealment`)) {
      const current = environment ?? environmentBetween(observer, target), dc = concealmentDC(observer, target, current);
      if (dc) {
        const scene = canvas.scene;
        const signature = () => JSON.stringify([tokenRayPoint(observer, 'sight'), tokenRayPoint(target, 'sight'),
          observer.document.level, target.document.level, environmentBetween(observer, target), concealmentDC(observer, target)]);
        const snapshot = signature();
        const valid = () => canvas.ready && canvas.scene === scene &&
          canvas.tokens.get(observer.id) === observer && canvas.tokens.get(target.id) === target && signature() === snapshot;
        if (!await concealmentCheck(observer, target, { dc, valid, manual: true,attack:context.type==='attack-roll' })) {
          const ammunition = typeof rest[1] === 'function' ? ammoCallbacks.get(rest[1]) : null;
          if (ammunition && !ammunition.spent) { ammunition.spent = true; await ammunition.weapon.consumeAmmo(); }
          const item = context.item;
          if (item?.isOfType?.('weapon') && item.traits.has('consumable') && item.actor.items.has(item.id) && item.quantity > 0) {
            await item.update({ 'system.quantity': item.quantity - 1 });
          }
          const stealth = rulesAPI()?.stealth;
          if (stealth?.player?.supports(observer)) await (stealth.revealAction??stealth.reveal)(observer);
          ui.notifications.info('Concealment flat check failed: the action has no effect. The action and attack MAP still count; spell slots and other resources follow their normal controls.');
          return null;
        }
      }
    }
      return wrapped(check, context, ...rest);
    };
    // libWrapper permits only one registration per package and target. Run the
    // player action stage first so Hide adds its native roll metadata, other
    // actions reveal before terrain checks, and Strikes reveal after rolling.
    const actionRoll=(...input)=>playerStealth?playerStealth.wrapRoll(terrainRoll,...input):terrainRoll(...input);
    return conditionsEnabled()?wrapConditionSave(actionRoll,...args):actionRoll(...args);
  }, 'MIXED');
}
