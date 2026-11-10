import { concealmentCheck } from './environment-rolls.mjs';
import { clearAttackPath } from './attack-path.mjs';
import { environmentBetween } from './environment-zones.mjs';
import { spellDefenseCheck, SPELL_OPTIONS } from './spell-checks.mjs';
import { inSpellArea, sameSpellLevel, spellRegion,areaContains } from './spell-areas.mjs';
import { createGreaseZone, applyTangleVine } from './spell-zones.mjs';
import {waitForPresentation} from './ai-presentation.mjs';
import {applyConditionSpell,beginSustainedCast,grantVampiricTempHP,temporarySpellImmunity} from './ongoing-spells.mjs';
import {conditionSpells} from '../framework/condition-spells.mjs';
import {nativeRuleAction,resolveConditionChecks,automationOwnsFlatChecks} from './condition-actions.mjs';
import {resolveSpellBinding,spellDescriptor} from './spell-catalog.mjs';
import {executeSpellOutcomes} from './spell-outcomes.mjs';
import {observeSpellCast,witnessedSpellCasts} from './spell-observations.mjs';
import {vampireForm,isTrueVampire} from './vampire-state.mjs';
import {consumeSureStrike} from './spell-attack-buffs.mjs';
import {resistSpellDisruption} from './spell-disruption.mjs';
import {liveDispelTarget} from './counteract-spells.mjs';

const ns = 'foundry-creature-ai';
const outcomes = ['criticalFailure','failure','success','criticalSuccess'];

import {spellMessage,spellDamage} from './spell-native-rolls.mjs';
export {spellMessage,spellDamage};
export async function executeSpell(adapter, choice, ledger, { canContinue = () => true,signal } = {}) {
  const origin=adapter.actualWaypoint();
  const valid = () => canContinue() && adapter.turnKey() === ledger.turn && !game.paused && game.users.activeGM?.id === game.user.id &&
    canvas.ready&&canvas.tokens.get(adapter.token.id)===adapter.token&&
    ['x','y','elevation','level'].every(key=>adapter.actualWaypoint()[key]===origin[key]);
  const parts = adapter.parts(),binding=resolveSpellBinding(adapter.actor,choice),original = binding?.spell??parts.spells.find(item => item.id === choice.spellId);
  if (!original) return { skipped: true, skipReason: 'The spell is no longer available' };
  if(choice.bindingId&&!binding)return {skipped:true,skipReason:'The selected casting entry or resource is no longer available'};
  const entry=binding?.entry??parts.entry,definition=binding?.definition;
  const targetRange=choice.melee?Math.max(5,adapter.actor.getReach({action:'attack'})):binding?spellDescriptor(binding,choice.actionCost).range:Infinity;
  const target = choice.area ? null : definition?.kind==='counteract'?liveDispelTarget(adapter,choice.targetId,choice.effectUuid):['heal','ward','buff'].includes(definition?.kind)?adapter.liveSpellTarget?.(choice.targetId):adapter.liveTarget(choice.targetId);
  if(['heal','ward'].includes(definition?.kind)&&(target?.actor.isDead||target?.actor.hasCondition('dead')))
    return {skipped:true,skipReason:'A dead creature cannot receive this healing or ward'};
  if (!choice.area && (!target || !clearAttackPath(adapter.token,target))) return { skipped: true, skipReason: 'Spell target or attack path changed' };
  if(target&&witnessedSpellCasts(adapter.token).some(c=>c.immunity&&c.slug===choice.spellSlug&&c.targetId===target.id))
    return {skipped:true,skipReason:'A witnessed casting already established temporary immunity to this spell'};
  if(!choice.area&&binding&&adapter.targetAt(adapter.originCell(),target,[],origin).distance>targetRange)
    return {skipped:true,skipReason:'Spell target left the selected spell range'};
  if(choice.spellSlug==='vampiric-feast'&&adapter.targetAt(adapter.originCell(),target,[],origin).distance>targetRange)
    return {skipped:true,skipReason:'Vampiric Feast target left touch range'};
  let spell = original;
  if(binding&&binding.castRank!==original.rank){spell=original.loadVariant?.({castRank:binding.castRank})??original;
    if(spell.rank!==binding.castRank)throw new Error('Native heightened spell variant could not be prepared');}
  if (choice.melee) {
    const overlay = original.overlays?.contents?.find(entry => entry.system?.range?.value === 'touch');
    if (!overlay) throw new Error('The Ignition melee variant is unavailable');
    spell = original.loadVariant({ overlayIds: [overlay._id] });
  }
  if(choice.spellSlug==='howling-blizzard'&&choice.actionCost===3){
    const overlay=original.overlays?.contents?.find(o=>o.system?.time?.value==='3');
    if(overlay)spell=original.loadVariant({castRank:binding.castRank,overlayIds:[overlay._id]});
  }
  if(definition?.domination&&isTrueVampire(adapter.actor)&&!spell.traits.has('visual')&&spell.clone)
    spell=spell.clone({'system.traits.value':[...spell.traits,'visual']},{keepId:true});
  // Committing Cast a Spell spends its native resource even if a subsequent
  // reaction disrupts it. The action ledger has already reserved its actions.
  if(binding?.bonded)await binding.bonded.update({'system.frequency.value':0});
  else if(binding?.soulCage)await binding.soulCage.update({'system.frequency.value':0});
  else if (!original.atWill&&!binding?.atWill&&!await entry.consume(original, spell.rank,binding?.slotId)) throw new Error('The spell resource could not be spent; inspect the reserved action');
  await spellMessage(spell,Boolean(adapter.config.applyDamage),{targetIds:choice.targetIds??[choice.targetId].filter(Boolean)});
  if(await adapter.reactions?.beforeSpell?.({source:adapter.token,spell,valid})&&!await resistSpellDisruption(adapter.actor,adapter.token))return {resolved:true,note:'Counterspell disrupted the casting; its actions and resource remain spent.'};
  if ((spell.traits?.has?.('manipulate')??true)&&adapter.config.pauseForReactions !== false && adapter.reactions) {
    const interrupt = await adapter.reactions.action({ mover: adapter.token, kind: 'manipulate', valid, applyDamage: adapter.config.applyDamage });
    if (interrupt.endTurn || interrupt.pause) return interrupt;
    if(interrupt.disrupted&&!await resistSpellDisruption(adapter.actor,adapter.token))return {resolved:true,note:'Reactive Strike disrupted the spell. Its actions and slot remain spent.'};
  }
  if (!valid() || adapter.turnEndReason()) return { resolved: true, endTurn: Boolean(adapter.turnEndReason()), incapacitationReason: adapter.turnEndReason() };
  if(vampireForm(adapter.actor)==='mist')return {resolved:true,note:'Mist transformation prevented completion of the spell; its actions and resources remain spent.'};
  if(!await resolveConditionChecks(adapter.actor,nativeRuleAction(spell),{token:adapter.token,valid}))
    return {resolved:true,note:'Condition flat check failed; spell actions and resources remain spent.'};
  if(!choice.area&&(!target||!clearAttackPath(adapter.token,target)||adapter.targetAt(adapter.originCell(),target,[],adapter.actualWaypoint()).distance>targetRange))
    return {resolved:true,note:definition?.drain?'The target left touch range during the reaction; actions and slot remain spent.':'The spell lost its target or range during a reaction; actions and resources remain spent.'};
  if(definition?.resolver==='outcomes')return executeSpellOutcomes(adapter,spell,entry,choice,definition,{valid,attackNumber:Math.max(1,ledger.attacksMade)});
  if(choice.features?.conditionSpell){
    if(!valid()||adapter.liveTarget(choice.targetId)!==target)return {resolved:true,note:'The spell lost its target; its action and slot remain spent.'};
    const spec=conditionSpells[spell.slug];if(!spec)throw new Error('Unsupported condition spell');
    if(spec.drain&&adapter.targetAt(adapter.originCell(),target,[],adapter.actualWaypoint()).distance>targetRange)
      return {resolved:true,note:'The target left touch range during the reaction; actions and slot remain spent.'};
    if(!await concealmentCheck(adapter.token,target,{valid}))return {resolved:true,note:'Spell targeting flat check failed; actions and slot remain spent.'};
    const source={actor:adapter.actor,token:adapter.token};
    if(spell.slug==='blindness')await observeSpellCast({source,target,spell,dc:entry.statistic.dc.value});
    if(temporarySpellImmunity(target.actor,spell.slug))return {resolved:true,note:'Temporary immunity prevented the spell; committed actions and resources remain spent.'};
    if(target.actor.isImmuneTo?.(spell)||['laughing-fit','void-warp','vampiric-feast'].includes(spell.slug)&&target.actor.modeOfBeing&&target.actor.modeOfBeing!=='living')
      return {resolved:true,note:'This spell cannot affect the target.'};
    const commitment=spell.slug==='laughing-fit'?await beginSustainedCast(source,spell,target):null;
    if(spell.slug!=='blindness')await observeSpellCast({source,target,spell,dc:entry.statistic.dc.value,castId:commitment?.id});
    const degree=await spellDefenseCheck(target,{dc:entry.statistic.dc.value,statistic:spec.save,origin:adapter.token,spell,label:spell.name});
    if(!valid())throw new Error('Combat changed during the spell save');
    let drain=null;
    if(spec.damage&&degree<3){
      const damage=await spellDamage(spell,adapter.token,{target,autoApply:Boolean(adapter.config.applyDamage)});
      const scaled=degree===2?damage.alter(0.5,0):degree===0?damage.alter(2,0):damage;
      if(adapter.config.applyDamage){
        const applied=await adapter.applyDamage(target,scaled,spell,outcomes[degree],{valid,captureDamage:Boolean(spec.drain)});
        if(spec.drain&&valid())drain=await grantVampiricTempHP(source,spell,applied.damageTaken);
      }
    }
    if(!spec.drain)await applyConditionSpell({source,target,spell,degree,castId:commitment?.id});
    return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id,targetId:target.id},pause:Boolean(spec.damage&&!adapter.config.applyDamage&&degree<3),
      note:spec.drain?`${spell.name}: native Fortitude save resolved. ${drain?`Temporary HP pool: ${drain.temporaryHP}; expires after 1 minute.`:adapter.config.applyDamage?'No temporary HP gained.':'Resolve temporary HP from half the damage actually taken after applying damage.'}`:
        `${spell.name}: native ${spec.save} save resolved; ongoing conditions track their source and duration.`};
  }
  if (!choice.area) {
    if (adapter.liveTarget(choice.targetId) !== target) return { resolved: true, note: 'The spell lost its target after a reaction. Its actions and resources remain spent.' };
    if (!await concealmentCheck(adapter.token,target,{valid,attack:true})) return { resolved: true, note: 'Spell targeting flat check failed; actions and resources remain spent.' };
    const map = Math.min(2, ledger.attacksMade - 1);
    const roll = await spell.rollAttack(null,map+1,{ target: target.actor, token: adapter.token.document, skipDialog: true,
      extraRollOptions: SPELL_OPTIONS });
    if(roll)await consumeSureStrike(adapter.actor);
    if (!Number.isInteger(roll?.degreeOfSuccess)) throw new Error('The spell attack was cancelled or unresolved');
    if (!valid()) throw new Error('The turn changed during the spell attack');
    const hit = roll.degreeOfSuccess >= 2, outcome = outcomes[roll.degreeOfSuccess];
    if(choice.melee)await adapter.reactions?.afterStrike?.({source:adapter.token,target,strike:{item:{type:'spell',isMelee:true,traits:spell.traits}},degree:roll.degreeOfSuccess,stage:'hit',applyDamage:adapter.config.applyDamage,valid});
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
    areaContains(adapter.token,token,choice.area) && clearAttackPath(adapter.token,token));
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
    const degree = await spellDefenseCheck(token,{ dc: entry.statistic.dc.value, origin: adapter.token, spell,
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
