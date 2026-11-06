import {applyConditionSpell,beginSustainedCast} from './ongoing-spells.mjs';
import {restrictionsEnabled} from './action-restrictions.mjs';
import {spellDefinition} from '../framework/spell-definitions.mjs';
import {applyDefinedSpellEffects} from './defined-spell-effects.mjs';
const ns='foundry-creature-ai',query=`${ns}.conditionSpell`,supported=new Set(['laughing-fit','stupefy','blindness']);
const has=(options,value)=>options?.has?.(value)??options?.includes?.(value)??false;
const resolved=new Map();let resolver;
const supports=spell=>supported.has(spell?.slug)||spellDefinition(spell)?.kind==='save'&&
 Boolean(spellDefinition(spell).persistent||spellDefinition(spell).outcomes?.some(o=>o.conditions?.length||o.noAllies||o.noActions||o.noReactions));
export async function wrapConditionSave(wrapped,check,context,...rest){
 const spell=context?.item;
 if(!restrictionsEnabled()||context?.type!=='saving-throw'||context.isReroll||context.createMessage===false||
  !supports(spell)||has(context.options,`${ns}:managed`))return wrapped(check,context,...rest);
 // Own only these spell conditions. The native save retains its modifiers,
 // immunity and incapacitation adjustments; external rules must not add a
 // second copy of the same outcome while this resolver is awaiting the roll.
 context={...context,options:new Set([...(context.options??[]),'skip-handling-message'])};
 const original=rest[1];let messageId;
 rest[1]=async(...args)=>{messageId=args[2]?.id;await original?.(...args);};
 const roll=await wrapped(check,context,...rest);
 if(!roll)return roll;
 if(!messageId)throw new Error('The spell save has no chat message; resolve its conditions manually');
 const activeGM=game.users.activeGM;if(!activeGM)throw new Error('An active GM is needed to resolve spell conditions');
 const request={messageId,sceneId:canvas.scene.id};
 if(activeGM.id===game.user.id)await resolver(request,game.user);
 else await activeGM.query(query,request);
 return roll;
}
export async function resolveManualSpellSave(data,user){
 if(game.users.activeGM?.id!==game.user.id||canvas.scene?.id!==data.sceneId)throw new Error('Spell resolution requires the active scene and GM');
 const message=game.messages.get(data.messageId),ctx=message?.flags.pf2e?.context;
 if(!message||ctx?.type!=='saving-throw'||ctx.isReroll||(message.author?.id??message.user?.id)!==user.id)throw new Error('Cannot validate the spell save message');
 const target=canvas.tokens.get(message.speaker.token);
 if(!target?.actor||!user.isGM&&!target.actor.testUserPermission(user,'OWNER'))throw new Error('You do not own the saving creature');
 const spell=await fromUuid(message.flags.pf2e.origin?.uuid);
 if(!supports(spell)||!spell.actor)throw new Error('Unsupported spell save origin');
 const degree=message.rolls?.[0]?.degreeOfSuccess??['criticalFailure','failure','success','criticalSuccess'].indexOf(ctx.outcome);
 const sourceToken=canvas.tokens.placeables.find(t=>t.actor?.uuid===spell.actor.uuid);
 let commitment;if(spell.slug==='laughing-fit')commitment=await beginSustainedCast({actor:spell.actor,token:sourceToken},spell,target,`manual-${message.id}`);
 if(target.actor.isImmuneTo?.(spell))return null;
 const definition=spellDefinition(spell);
 if(definition?.resolver==='outcomes')return applyDefinedSpellEffects({source:{actor:spell.actor,token:sourceToken},target,spell,definition,degree,
  dc:spell.spellcasting?.statistic?.dc?.value??spell.actor.itemTypes.spellcastingEntry.find(e=>e.id===spell.system.location.value)?.statistic.dc.value});
 return applyConditionSpell({source:{actor:spell.actor,token:sourceToken},target,spell,degree,castId:commitment?.id});
}
export function installManualConditionSpells({reactions}){
 resolver=(data,user)=>{
  const key=data.messageId;if(resolved.has(key))return resolved.get(key);
  const operation=reactions.resolve(()=>resolveManualSpellSave(data,user));resolved.set(key,operation);
  operation.catch(()=>resolved.delete(key));if(resolved.size>300)resolved.delete(resolved.keys().next().value);
  return operation;
 };
 CONFIG.queries??={};CONFIG.queries[query]=(data,{user})=>resolver(data,user);
}
