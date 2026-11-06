import {clearSightPath} from './attack-path.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {spellDefinition} from '../framework/spell-definitions.mjs';
const ns='foundry-creature-ai',jobs=new WeakMap();
const now=()=>game.time?.worldTime??0;
const turnIndex=id=>(game.combat?.turns??game.combat?.combatants??[]).findIndex(c=>c.tokenId===id);
const sees=(observer,subject)=>observer===subject||Boolean(subject&&!observer.actor.hasCondition('blinded')&&!subject.document.hidden&&
 detectionFor(observer,subject).state==='observed'&&clearSightPath(observer,subject));
function memory(token){const saved=token.document.getFlag(ns,'spellObservations');return saved?.combatId===game.combat?.id&&saved.sceneId===canvas.scene?.id?saved:{combatId:game.combat?.id,sceneId:canvas.scene?.id,entries:[],threats:{}};}
function current(entry){return entry.expiresAt>now()&&(entry.untilRound==null||game.combat.round<entry.untilRound||
 game.combat.round===entry.untilRound&&(turnIndex(entry.sourceTokenId)<0||game.combat.turn<=turnIndex(entry.sourceTokenId)));}
async function mutate(token,change){const doc=token.document,combatId=game.combat?.id,sceneId=canvas.scene?.id,
 task=(jobs.get(doc)??Promise.resolve()).catch(()=>{}).then(async()=>{
 if(!game.combat?.started||game.combat.id!==combatId||canvas.scene?.id!==sceneId)return;
 const saved=memory(token);await doc.setFlag(ns,'spellObservations',change({...saved,entries:saved.entries.filter(current)}));});
 jobs.set(doc,task);try{await task;}finally{if(jobs.get(doc)===task)jobs.delete(doc);}}
export const witnessedSpellCasts=token=>memory(token).entries.filter(current);
export const witnessedThreat= (token,id)=>memory(token).threats?.[id];
export async function observeSpellCast({source,target,spell,dc,castId,observationId}){
 if(!game.combat?.started||!source.token||!target)return;
 const definition=spellDefinition(spell),control=definition?.kind==='condition-save'&&!definition.damage||definition?.persistent||
  definition?.outcomes?.some(o=>o.conditions?.length||o.noActions||o.noReactions||o.noAllies);
 if(!control)return;
 const duration=spell.slug==='blindness'?60:definition.sustained?600:definition.duration??6;
 const entry={id:observationId??castId??foundry.utils.randomID(),slug:spell.slug,targetId:target.id,sourceTokenId:source.token.id,
  dc,castRank:spell.rank,traits:[...spell.traits??[]],castId:castId??null,immunity:spell.slug==='blindness',expiresAt:now()+duration,
  ...definition.sustained?{untilRound:game.combat.round+1}:{}};
 for(const observer of canvas.tokens.placeables){
  if(observer.actor?.type!=='npc'||observer!==source.token&&(!observer.actor.isAllyOf(source.actor)||!sees(observer,source.token)||!sees(observer,target)))continue;
  await mutate(observer,saved=>({...saved,entries:[...saved.entries.filter(e=>e.id!==entry.id),entry].slice(-128)}));
 }
}
export async function observeSustain(source,cast){
 if(!game.combat?.started)return;
 for(const observer of canvas.tokens.placeables){
  if(!observer.actor||!sees(observer,source))continue;
  const existing=memory(observer);if(!existing.entries.some(e=>e.castId===cast.id))continue;
  await mutate(observer,saved=>({...saved,entries:saved.entries.map(e=>e.castId===cast.id?{...e,untilRound:game.combat.round+1}:e)}));
 }
}
// Only witnessed PUBLIC Strikes provide relative-strength evidence. Never use
// a hidden save, a private/secret roll, or an actor's actual level/statistic.
export async function observePublicAttack(message){
 if(!game.combat?.started||message.blind||message.whisper?.length||message.flags?.pf2e?.context?.type!=='attack-roll'||
  message.flags.pf2e.context.action!=='strike'||message.speaker?.scene!==canvas.scene?.id)return;
 const attacker=canvas.tokens.get(message.speaker.token),bonus=message.rolls?.[0]?.options?.totalModifier;
 if(!attacker||!Number.isFinite(bonus))return;
 for(const observer of canvas.tokens.placeables){
  if(observer.actor?.type!=='npc'||observer===attacker||!sees(observer,attacker))continue;
  await mutate(observer,saved=>{const attackBonus=Math.max(saved.threats?.[attacker.id]?.attackBonus??-Infinity,bonus);
   return {...saved,threats:{...saved.threats,[attacker.id]:{attackBonus,estimatedLevel:Math.max(-1,attackBonus-10),levelUncertainty:2,source:'witnessed public Strike; uncertain NPC attack benchmark'}}};});
 }
}
export function installSpellObservations({reactions,onError}){
 Hooks.on('createChatMessage',message=>{if(game.users.activeGM?.id===game.user.id)void reactions.resolve(()=>observePublicAttack(message)).catch(onError);});
}
