import {actionRestriction} from './action-restrictions.mjs';
import {manualConditionViolation,resolveConditionChecks} from './condition-actions.mjs';
import {cleanupDefinedSpells} from './defined-spell-effects.mjs';
const ns='foundry-creature-ai',query=`${ns}.ongoingSpell`;
const statuses={slowed:'xYTAsEpcJE1Ccni3',stupefied:'e1XGnhKNSQIm5IXg',blinded:'XgEqL1kFApUbl5Z2',enfeebled:'MIRkyAjyBeXivMa7',dazzled:'TkIyaNPgTZFBCCuh',confused:'yblD8fOR1J8rDwEQ'};
const condition=(slug,value=1)=>({key:'GrantItem',uuid:`Compendium.pf2e.conditionitems.Item.${statuses[slug]}`,inMemoryOnly:true,
 ...['slowed','stupefied','enfeebled'].includes(slug)?{alterations:[{mode:'override',property:'badge-value',value}]}:{}});
const flag=key=>({key:'ActiveEffectLike',mode:'override',path:`flags.pf2e.${key}`,value:true});
const now=()=>game.time?.worldTime??0;
const casterCasts=actor=>actor.getFlag?.(ns,'ongoingCasts')??[];
const owned=actor=>(actor.itemTypes?.effect??[]).filter(e=>e.flags?.[ns]?.ongoingSpell);
const gm=()=>game.user?.isGM&&game.users.activeGM?.id===game.user.id;
const mutations=new WeakMap();
// The reaction barrier waits for concurrent jobs; it intentionally permits
// nesting and is not a mutex. Turn/time hooks and manual End/Reset must read
// fresh cast/effect collections after the preceding spell mutation finishes.
function serialize(operation){
 const owner=game,task=(mutations.get(owner)??Promise.resolve()).catch(()=>{}).then(operation);
 mutations.set(owner,task);
 void task.finally(()=>{if(mutations.get(owner)===task)mutations.delete(owner);}).catch(()=>{});
 return task;
}
export const beginSustainedCast=(...args)=>serialize(()=>beginCast(...args));
export const applyConditionSpell=(...args)=>serialize(()=>applySpell(...args));
export const sustainCast=(...args)=>serialize(()=>sustain(...args));
export const endSustainedCast=(...args)=>serialize(()=>endCast(...args));
export const resetOngoingSpells=(...args)=>serialize(()=>resetSpells(...args));
export const grantVampiricTempHP=(...args)=>serialize(()=>grantTempHP(...args));
export function advanceOngoingSpells({token,phase='time',round=game.combat?.round,combat=game.combat}={}){
 return serialize(()=>advanceSpells({token,phase,round,combat}));
}
let requestResolver;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function nextStart(token){
 const combat=game.combat,index=(combat?.turns??combat?.combatants??[]).findIndex(c=>c.tokenId===token?.id);
 return index<0||!combat?.started?null:{tokenId:token.id,round:combat.round+Number(index<=combat.turn)};
}
async function grantTempHP(source,spell,damageTaken){
 if(!Number.isFinite(damageTaken)||damageTaken<0)throw new Error('Vampiric Feast needs resolved post-resistance damage');
 const amount=Math.floor(damageTaken/2),current=source.actor.hitPoints.temp??source.actor.system.attributes.hp.temp??0;
 if(amount<=current)return {amount:0,temporaryHP:current};
 const data={slug:'vampiric-feast',sourceActor:source.actor.uuid,sourceTokenId:source.token.id,targetId:source.token.id,
  combatId:game.combat?.id??null,expiresAt:now()+60,startDeadline:null,phaseDeadline:null};
 await source.actor.createEmbeddedDocuments('Item',[{name:'Vampiric Feast — temporary HP',type:'effect',img:spell.img??'icons/svg/blood.svg',
  system:{slug:'creature-ai-vampiric-feast',duration:{unit:'unlimited',value:-1,expiry:null,sustained:false},
   level:{value:spell.rank},tokenIcon:{show:true},rules:[{key:'TempHP',value:amount}],
   context:{origin:{actor:source.actor.uuid,token:source.token.document.uuid,item:spell.uuid,spellcasting:null,rollOptions:[]}}},
  flags:{[ns]:{ongoingSpell:data}}}]);
 return {amount:amount-current,temporaryHP:amount};
}
export function conditionSpellRules(slug,degree){
 if(slug==='laughing-fit')return [flag('noUseReactions'),...(degree===0?[flag('noActions')]:degree===1?[condition('slowed')]:[])];
 if(slug==='stupefy')return [condition('stupefied',degree===2?1:degree===1?2:3)];
 if(slug==='blindness')return [condition('blinded')];
 if(slug==='void-warp')return [condition('enfeebled')];
 if(slug==='cytillesh-stare')return [condition('dazzled'),...(degree<2?[condition('confused')]:[])];
 return [];
}
async function beginCast(source,spell,target,castId=foundry.utils.randomID(),{maxDuration=600,enemyId=null}={}){
 const data={id:castId,slug:spell.slug,spellId:spell.id,sourceActor:source.actor.uuid,sourceTokenId:source.token?.id,targetId:target.id,
  combatId:game.combat?.id??null,sceneId:canvas.scene?.id,castRound:game.combat?.round??0,lastRound:game.combat?.round??0,lastTime:now(),expiresAt:now()+maxDuration,enemyId};
 await source.actor.setFlag(ns,'ongoingCasts',[...casterCasts(source.actor).filter(c=>c.id!==castId),data]);return data;
}
async function applySpell({source,target,spell,degree,castId}){
 if(!Number.isInteger(degree)||degree<0||degree>3)throw new Error('A resolved native save is required for spell conditions');
 if(['laughing-fit','void-warp'].includes(spell.slug)&&target.actor.modeOfBeing&&target.actor.modeOfBeing!=='living')return null;
 if(degree===3&&!['cytillesh-stare','blindness'].includes(spell.slug))return null;
 if(spell.slug==='void-warp'&&degree!==0)return null;
 if(spell.slug==='blindness'&&owned(target.actor).some(e=>e.flags[ns].ongoingSpell.slug==='blindness-immunity'&&e.flags[ns].ongoingSpell.expiresAt>now()))return null;
 const data={slug:spell.slug,sourceActor:source.actor.uuid,sourceTokenId:source.token?.id,targetId:target.id,combatId:game.combat?.id??null,
  castRound:game.combat?.round??0,castId:castId??null,expiresAt:null,startDeadline:null,phaseDeadline:null};
 if(spell.slug==='laughing-fit'){
  if(!castId)data.castId=(await beginCast(source,spell,target)).id;
  if(degree===0){data.phaseDeadline=nextStart(source.token);data.phaseExpiresAt=data.phaseDeadline?null:now()+6;if(!target.actor.hasCondition('prone'))await target.actor.increaseCondition('prone');}
 }else if(spell.slug==='stupefy'){
  if(degree===2){data.startDeadline=nextStart(source.token);data.expiresAt=data.startDeadline?null:now()+6;}else data.expiresAt=now()+60;
 }else if(spell.slug==='blindness'){
  if(degree===2){data.startDeadline=nextStart(target);data.expiresAt=data.startDeadline?null:now()+6;}
  else if(degree===1)data.expiresAt=now()+60;
 }else if(spell.slug==='void-warp'){data.startDeadline=nextStart(source.token);data.expiresAt=data.startDeadline?null:now()+6;}
 else if(spell.slug==='cytillesh-stare'){data.startDeadline=nextStart(source.token);data.expiresAt=data.startDeadline?null:now()+6;}
 if(spell.slug==='blindness'&&degree===3){data.slug='blindness-immunity';data.expiresAt=now()+60;}
 const rules=degree===3&&spell.slug==='blindness'?[]:conditionSpellRules(spell.slug,degree);
 const raw={name:`${spell.name} — ongoing effect`,type:'effect',img:spell.img??'icons/svg/aura.svg',
  system:{slug:`creature-ai-${spell.slug}`,description:{value:`<p>Managed ${spell.name}. Conditions end with this source effect; source timing and Sustain are tracked by Creature AI.</p>`},
   duration:{unit:'unlimited',value:-1,expiry:null,sustained:spell.slug==='laughing-fit'},level:{value:spell.rank??source.actor.level},tokenIcon:{show:true},rules,
   context:{origin:{actor:source.actor.uuid,token:source.token?.document.uuid??null,item:spell.uuid??null,spellcasting:null,rollOptions:[]}}},flags:{[ns]:{ongoingSpell:data}}};
 const [effect]=await target.actor.createEmbeddedDocuments('Item',[raw]);
 if(spell.slug==='blindness'&&degree!==3)await target.actor.createEmbeddedDocuments('Item',[{...raw,name:'Blindness — temporary immunity',
  system:{...raw.system,slug:'creature-ai-blindness-immunity',rules:[],tokenIcon:{show:false}},
  flags:{[ns]:{ongoingSpell:{...data,slug:'blindness-immunity',startDeadline:null,expiresAt:now()+60}}}}]);
 return effect;
}

async function sustain(actor,castId){
 const restriction=actionRestriction(actor,{purelyMental:true});if(restriction)throw new Error(restriction.reason);
 const current=game.combat?.combatant,token=canvas.tokens.get(current?.tokenId);
 if(!game.combat?.started||token?.actor.uuid!==actor.uuid)throw new Error('Sustain during the caster’s own active turn');
 const casts=casterCasts(actor),cast=casts.find(c=>c.id===castId);
 if(!cast||cast.combatId!==game.combat.id||cast.sceneId!==canvas.scene.id||now()>=cast.expiresAt)throw new Error('This sustained spell is no longer active');
 const reason=manualConditionViolation(actor,{kind:'sustainSpell',targetId:cast.targetId});if(reason)throw new Error(reason);
 if(cast.lastRound===game.combat.round)throw new Error('This spell is already sustained for this turn');
 if(!await resolveConditionChecks(actor,{kind:'sustainSpell',targetId:cast.targetId},{token,valid:()=>game.combat?.combatant?.id===current.id}))
  return {resolved:true,note:'Condition flat check failed; Sustain action spent without extending the spell.'};
 await actor.setFlag(ns,'ongoingCasts',casts.map(c=>c.id===castId?{...c,lastRound:game.combat.round,lastTime:now()}:c));
 return {resolved:true,note:'Sustain: the spell continues until the end of the caster’s next turn.'};
}
async function endCast(actor,castId){
 await cleanupDefinedSpells({castIds:[castId]});
 await actor.setFlag(ns,'ongoingCasts',casterCasts(actor).filter(c=>c.id!==castId));
 for(const token of canvas.tokens.placeables){const ids=owned(token.actor).filter(e=>e.flags[ns].ongoingSpell.castId===castId).map(e=>e.id);
  if(ids.length)await token.actor.deleteEmbeddedDocuments('Item',ids);}
}
async function advanceSpells({token,phase,round,combat}){
 if(!gm())return;
 for(const subject of canvas.tokens.placeables){
  for(const effect of owned(subject.actor)){
   const data=effect.flags[ns].ongoingSpell;
   const at=deadline=>phase==='start'&&data.combatId===combat?.id&&deadline?.tokenId===token?.id&&round>=deadline.round;
   if(data.expiresAt!=null&&now()>=data.expiresAt||at(data.startDeadline))await subject.actor.deleteEmbeddedDocuments('Item',[effect.id]);
   else if(at(data.phaseDeadline)||data.phaseExpiresAt!=null&&now()>=data.phaseExpiresAt)await effect.update({'system.rules':conditionSpellRules('laughing-fit',1),[`flags.${ns}.ongoingSpell.phaseDeadline`]:null,[`flags.${ns}.ongoingSpell.phaseExpiresAt`]:null});
  }
  for(const cast of casterCasts(subject.actor)){
   const index=(combat?.turns??combat?.combatants??[]).findIndex(c=>c.tokenId===cast.sourceTokenId);
   const missedEnd=cast.combatId===combat?.id&&(round>cast.lastRound+1||round===cast.lastRound+1&&index>=0&&combat.turn>index);
   const outside=(!combat?.started||cast.combatId!==combat.id)&&now()>=cast.lastTime+12;
   if(now()>=cast.expiresAt||outside||missedEnd||phase==='end'&&cast.combatId===combat?.id&&subject.actor.uuid===token?.actor.uuid&&round>cast.lastRound)
    await endCast(subject.actor,cast.id);
  }
 }
}

export const ongoingCasts=actor=>casterCasts(actor).filter(c=>c.combatId===game.combat?.id&&c.sceneId===canvas.scene?.id&&c.expiresAt>now());
export async function openOngoingSpells(token=canvas.tokens.controlled[0]){
 if(!token?.actor||!game.user.isGM&&!token.actor.testUserPermission(game.user,'OWNER'))throw new Error('Select your caster first');
 const casts=ongoingCasts(token.actor);if(!casts.length){ui.notifications.info('No supported sustained spells are active for this caster.');return;}
 const result=await foundry.applications.api.DialogV2.wait({window:{title:`Ongoing spells — ${token.name}`},
  content:`<p>Sustain costs one action per spell. Player action counts remain manual.</p><select name="cast">${casts.map(c=>`<option value="${escape(c.id)}">${escape(c.slug)}</option>`).join('')}</select>`,
  buttons:[{action:'sustain',label:'Sustain',callback:(_e,b)=>({action:'sustain',id:b.form.elements.cast.value})},
   {action:'end',label:'End spell',callback:(_e,b)=>({action:'end',id:b.form.elements.cast.value})}],rejectClose:false});
 if(!result)return;const activeGM=game.users.activeGM;if(!activeGM)throw new Error('An active GM is required');
 const request={...result,tokenId:token.id,sceneId:canvas.scene.id};
 return activeGM.id===game.user.id?(requestResolver??receiveOngoingRequest)(request,game.user):activeGM.query(query,request);
}
async function receiveOngoingRequest(data,user){
 if(!gm()||canvas.scene?.id!==data.sceneId)throw new Error('The scene or active GM changed');
 const token=canvas.tokens.get(data.tokenId);
 if(!token?.actor||!user.isGM&&!token.actor.testUserPermission(user,'OWNER'))throw new Error('You do not own this caster');
 if(!ongoingCasts(token.actor).some(c=>c.id===data.id))throw new Error('Unknown sustained spell');
 if(data.action==='end')return endSustainedCast(token.actor,data.id);
 if(data.action==='sustain')return sustainCast(token.actor,data.id);
 throw new Error('Unknown ongoing spell action');
}
export function installOngoingSpells({reactions,onError}){
 globalThis.CONFIG??={};
 requestResolver=(data,user)=>reactions.resolve(()=>receiveOngoingRequest(data,user));
 CONFIG.queries??={};CONFIG.queries[query]=(data,{user})=>requestResolver(data,user);
 Hooks.on('pf2e.startTurn',(combatant,combat)=>{const token=canvas.tokens.get(combatant.tokenId);if(token)void reactions.resolve(()=>advanceOngoingSpells({token,phase:'start',combat})).catch(onError);});
 Hooks.on('pf2e.endTurn',(combatant,combat)=>{const token=canvas.tokens.get(combatant.tokenId);
  const endedRound=combatant.getFlag?.('pf2e','roundOfLastTurnEnd')??combatant.flags?.pf2e?.roundOfLastTurnEnd??combat.round;
  if(token)void reactions.resolve(()=>advanceOngoingSpells({token,phase:'end',combat,round:endedRound})).catch(onError);});
 Hooks.on('updateWorldTime',()=>{void reactions.resolve(()=>advanceOngoingSpells()).catch(onError);});
}
async function resetSpells(tokenIds){
 await cleanupDefinedSpells({resetTokenIds:tokenIds});
 const ids=new Set(tokenIds);
 for(const token of canvas.tokens.placeables){
  const effects=owned(token.actor).filter(e=>{const d=e.flags[ns].ongoingSpell;return ids.has(d.sourceTokenId)||ids.has(d.targetId);}).map(e=>e.id);
  if(effects.length)await token.actor.deleteEmbeddedDocuments('Item',effects);
  const casts=casterCasts(token.actor),retained=casts.filter(c=>!ids.has(c.sourceTokenId)&&!ids.has(c.targetId));
  if(casts.length!==retained.length)await token.actor.setFlag(ns,'ongoingCasts',retained);
 }
}
