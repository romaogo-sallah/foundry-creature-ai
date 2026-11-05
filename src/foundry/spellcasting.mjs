import { concealmentCheck } from './environment-rolls.mjs';
import { clearAttackPath } from './attack-path.mjs';
import { environmentBetween } from './environment-zones.mjs';
import { spellDefenseCheck, SPELL_OPTIONS } from './spell-checks.mjs';
import { inSpellArea, sameSpellLevel, spellRegion } from './spell-areas.mjs';
import { createGreaseZone, applyTangleVine } from './spell-zones.mjs';
import {waitForPresentation} from './ai-presentation.mjs';
import {applyConditionSpell,beginSustainedCast} from './ongoing-spells.mjs';
import {conditionSpells} from '../framework/condition-spells.mjs';

const ns = 'foundry-creature-ai';
const outcomes = ['criticalFailure','failure','success','criticalSuccess'];

export async function spellMessage(spell,autoApply = true) {
  const message = await spell.toMessage(null, { actualCast: true, create: false, data: { castRank: spell.rank } });
  if (!message) throw new Error('Could not prepare the spell chat card');
  const options = message.flags?.pf2e?.context?.options ?? [];
  message.updateSource({ [`flags.${ns}.managed`]: true,
    'flags.pf2e.context.options': [...new Set([...options,...SPELL_OPTIONS])],
    'flags.xdy-pf2e-workbench.noAutoDamageRoll': true, 'flags.pf2e.suppressDamageButtons': autoApply });
  return ChatMessage.create(message.toObject());
}

export async function spellDamage(spell, caster, { target, outcome = 'success', map = 0, autoApply = true } = {}) {
  const data = await spell.getDamage({ target: target?.document, skipDialog: true });
  if (!data?.template?.damage?.roll) throw new Error(`No native damage roll for ${spell.name}`);
  const doubleDice=outcome==='criticalSuccess'&&game.settings.get('pf2e','critRule')==='doubledice';
  let roll=await (doubleDice?data.template.damage.roll.alter(2,0):data.template.damage.roll).evaluate();
  if (outcome === 'criticalSuccess'&&!doubleDice) roll = roll.alter(2,0);
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token: caster.document }), flavor: spell.name,
    flags: { [ns]: { managed: true }, 'xdy-pf2e-workbench': { noAutoDamageRoll: true },
      pf2e: { suppressDamageButtons: autoApply, origin: spell.getOriginData(),
        context: { type: 'damage-roll', sourceType: spell.isAttack ? 'attack' : 'save', outcome, mapIncreases: map,
          options: [...(data.context?.options ?? []),...SPELL_OPTIONS], target: target ? { actor: target.actor.uuid, token: target.document.uuid } : null } } } });
  return roll;
}

export async function executeSpell(adapter, choice, ledger, { canContinue = () => true,signal } = {}) {
  const origin=adapter.actualWaypoint();
  const valid = () => canContinue() && adapter.turnKey() === ledger.turn && !game.paused && game.users.activeGM?.id === game.user.id &&
    canvas.ready&&canvas.tokens.get(adapter.token.id)===adapter.token&&
    ['x','y','elevation','level'].every(key=>adapter.actualWaypoint()[key]===origin[key]);
  const parts = adapter.parts(), original = parts.spells.find(item => item.id === choice.spellId);
  if (!original) return { skipped: true, skipReason: 'The spell is no longer available' };
  const target = choice.area ? null : adapter.liveTarget(choice.targetId);
  if (!choice.area && (!target || !clearAttackPath(adapter.token,target))) return { skipped: true, skipReason: 'Spell target or attack path changed' };
  let spell = original;
  if (choice.melee) {
    const overlay = original.overlays?.contents?.find(entry => entry.system?.range?.value === 'touch');
    if (!overlay) throw new Error('The Ignition melee variant is unavailable');
    spell = original.loadVariant({ overlayIds: [overlay._id] });
  }
  // Committing Cast a Spell spends its native resource even if a subsequent
  // reaction disrupts it. The action ledger has already reserved its actions.
  if (!await parts.entry.consume(original, spell.rank)) throw new Error('The spell resource could not be spent; inspect the reserved action');
  await spellMessage(spell,Boolean(adapter.config.applyDamage));
  if (adapter.config.pauseForReactions !== false && adapter.reactions) {
    const interrupt = await adapter.reactions.action({ mover: adapter.token, kind: 'manipulate', valid, applyDamage: adapter.config.applyDamage });
    if (interrupt.endTurn || interrupt.pause) return interrupt;
    if (interrupt.disrupted) return { resolved: true, note: 'Reactive Strike disrupted the spell. Its actions and slot remain spent.' };
  }
  if (!valid() || adapter.turnEndReason()) return { resolved: true, endTurn: Boolean(adapter.turnEndReason()), incapacitationReason: adapter.turnEndReason() };
  const flatChecks = adapter.actor.hasCondition('grabbed') ? [{label:'Grabbed: manipulate',dc:5}] : [];
  if(adapter.actor.hasCondition('stupefied')){
    const value=adapter.actor.getCondition('stupefied')?.value;
    if(!Number.isFinite(value))throw new Error('Cannot determine the Stupefied spellcasting flat-check DC');
    flatChecks.push({label:'Stupefied: casting',dc:5+value});
  }
  for(const check of flatChecks) {
    const flat = await new Roll('1d20').evaluate();
    await flat.toMessage({ speaker: ChatMessage.getSpeaker({ token: adapter.token.document }), flavor: `${check.label}: DC ${check.dc} flat check`,
      flags: { pf2e: { context: { options: SPELL_OPTIONS } } } });
    if (!valid()) throw new Error('Casting stopped during the grabbed flat check');
    if (flat.total < check.dc) return { resolved: true, note: `${check.label} flat check failed; spell actions and resources remain spent.` };
  }
  if(choice.features?.conditionSpell){
    if(!valid()||adapter.liveTarget(choice.targetId)!==target)return {resolved:true,note:'The spell lost its target; its action and slot remain spent.'};
    if(!await concealmentCheck(adapter.token,target,{valid}))return {resolved:true,note:'Spell targeting flat check failed; actions and slot remain spent.'};
    const source={actor:adapter.actor,token:adapter.token};
    const commitment=spell.slug==='laughing-fit'?await beginSustainedCast(source,spell,target):null;
    if(target.actor.isImmuneTo?.(spell)||['laughing-fit','void-warp'].includes(spell.slug)&&target.actor.modeOfBeing&&target.actor.modeOfBeing!=='living')
      return {resolved:true,note:'This spell cannot affect the target.'};
    const spec=conditionSpells[spell.slug];if(!spec)throw new Error('Unsupported condition spell');
    const degree=await spellDefenseCheck(target,{dc:parts.entry.statistic.dc.value,statistic:spec.save,origin:adapter.token,spell,label:spell.name});
    if(!valid())throw new Error('Combat changed during the spell save');
    if(spec.damage&&degree<3){
      const damage=await spellDamage(spell,adapter.token,{target,autoApply:Boolean(adapter.config.applyDamage)});
      const scaled=degree===2?damage.alter(0.5,0):degree===0?damage.alter(2,0):damage;
      if(adapter.config.applyDamage)await adapter.applyDamage(target,scaled,spell,outcomes[degree],{valid});
    }
    await applyConditionSpell({source,target,spell,degree,castId:commitment?.id});
    return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id,targetId:target.id},pause:Boolean(spec.damage&&!adapter.config.applyDamage&&degree<3),
      note:`${spell.name}: native ${spec.save} save resolved; ongoing conditions track their source and duration.`};
  }
  if (!choice.area) {
    if (adapter.liveTarget(choice.targetId) !== target) return { resolved: true, note: 'The spell lost its target after a reaction. Its actions and resources remain spent.' };
    if (!await concealmentCheck(adapter.token,target,{valid})) return { resolved: true, note: 'Spell targeting flat check failed; actions and resources remain spent.' };
    const map = Math.min(2, ledger.attacksMade - 1);
    const roll = await spell.rollAttack(null,map+1,{ target: target.actor, token: adapter.token.document, skipDialog: true,
      extraRollOptions: SPELL_OPTIONS });
    if (!Number.isInteger(roll?.degreeOfSuccess)) throw new Error('The spell attack was cancelled or unresolved');
    if (!valid()) throw new Error('The turn changed during the spell attack');
    const hit = roll.degreeOfSuccess >= 2, outcome = outcomes[roll.degreeOfSuccess];
    if (hit && choice.spellSlug === 'ignition') {
      const damage = await spellDamage(spell,adapter.token,{target,outcome,map,autoApply:Boolean(adapter.config.applyDamage)});
      if (adapter.config.applyDamage) {
        await adapter.applyDamage(target,damage,spell,outcome,{valid});
        if (roll.degreeOfSuccess === 3) {
          const DamageRoll = CONFIG.Dice.rolls.find(type => type.name === 'DamageRoll');
          const persistent = await new DamageRoll(`${spell.rank}d${choice.melee ? 6 : 4}[persistent,fire]`).evaluate();
          await persistent.toMessage({ speaker: ChatMessage.getSpeaker({token:adapter.token.document}), flavor: 'Ignition: critical persistent fire',
            flags: { pf2e: { suppressDamageButtons: true, origin: spell.getOriginData(), context: { options: SPELL_OPTIONS } } } });
          if (!valid()) throw new Error('Casting stopped before persistent fire was applied');
          await adapter.applyDamage(target,persistent,spell,outcome,{valid});
        }
      }
    } else if (hit && choice.spellSlug === 'tangle-vine') await applyTangleVine(adapter,target,spell,roll.degreeOfSuccess);
    return { resolved: true, lastAction: { kind: 'castSpell', spellId: spell.id, hit, targetId: target.id },
      pause: hit && choice.spellSlug === 'ignition' && !adapter.config.applyDamage, note: spell.name };
  }
  // Areas affect everyone actually present, including undetected creatures.
  // Only the execution layer may inspect those real positions.
  const region = spellRegion(choice.area.shapes,adapter.token);
  const affected = canvas.tokens.placeables.filter(token => (choice.spellSlug==='grease'||token !== adapter.token) && token.actor?.isOfType?.('creature') &&
    sameSpellLevel(adapter.token,token) && inSpellArea(token,region) && clearAttackPath(adapter.token,token));
  if (choice.spellSlug === 'grease') {
    await createGreaseZone(adapter,spell,choice.area,affected,{valid});
    return { resolved: true, note: 'Grease covers four squares for 1 minute. Its initial checks and later ground movement are automated.' };
  }
  const visual=await adapter.token.document.parent.createEmbeddedDocuments('Region',[{
    name:`${spell.name} — ${adapter.token.name}`,shapes:choice.area.shapes,color:'#ed641c',
    elevation:{bottom:adapter.token.document.elevation,top:adapter.token.document.elevation+5},
    levels:adapter.token.document.level?[adapter.token.document.level]:[],visibility:CONST.REGION_VISIBILITY?.ALWAYS??0,
    flags:{[ns]:{spellVisual:true},pf2e:{areaShape:'cone',origin:spell.getOriginData()},'pf2e-toolbelt':{targetHelper:{skip:true}}}
  }],{renderSheet:false});
  try{
  const saved = [];
  for (const token of affected) {
    if (!valid()) throw new Error('Casting stopped during the area saves');
    const environment = environmentBetween(adapter.token,token);
    const degree = await spellDefenseCheck(token,{ dc: parts.entry.statistic.dc.value, origin: adapter.token, spell,
      label: `${spell.name}: Reflex save`, cover: environment.coverBonus >= 2 ? environment.coverBonus : 0 });
    saved.push({ token, degree });
  }
  const damage = await spellDamage(spell,adapter.token,{autoApply:Boolean(adapter.config.applyDamage)});
  if (adapter.config.applyDamage) for (const { token, degree } of saved) {
    if (degree === 3) continue;
    const scaled = degree === 2 ? damage.alter(0.5,0) : degree === 0 ? damage.alter(2,0) : damage;
    await adapter.applyDamage(token,scaled,spell,outcomes[degree],{valid});
  }
  return { resolved: true, pause: !adapter.config.applyDamage, note: `${spell.name}: ${affected.length} creature(s) in the cone.`,
    lastAction: { kind: 'castSpell', spellId: spell.id } };
  }finally{
    const delay=Math.min(5,Math.max(0,Number(game.settings.get(ns,'resultPause'))||0))*1000;
    await waitForPresentation(delay,{signal,valid});
    if(visual.length)await adapter.token.document.parent.deleteEmbeddedDocuments('Region',visual.map(region=>region.id));
  }
}
