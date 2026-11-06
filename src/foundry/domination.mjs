import {isTrueVampire,vampireState} from './vampire-state.mjs';
const ns='foundry-creature-ai',time=()=>game.time.worldTime;
export const domination=actor=>actor?.hasCondition?.('controlled')?(actor.getFlag?.(ns,'domination')??actor.flags?.[ns]?.domination):null;
export const effectiveAlliance=actor=>domination(actor)?.alliance??actor?.alliance;
export const dominateImmune=(actor,sourceId)=>(actor.itemTypes.effect??[]).some(e=>e.flags?.[ns]?.dominateImmunity?.sourceId===sourceId&&e.flags[ns].dominateImmunity.expiresAt>time());
async function immunity(target,sourceId){if(dominateImmune(target.actor,sourceId))return;
 await target.actor.createEmbeddedDocuments('Item',[{name:'Dominate: temporary immunity to this vampire',type:'effect',img:'icons/svg/eye.svg',
  system:{slug:'vampire-dominate-immunity',duration:{value:1,unit:'days',expiry:'turn-start',sustained:false},rules:[]},
  flags:{[ns]:{dominateImmunity:{sourceId,expiresAt:time()+86400}}}}]);}
export async function applyDomination({source,target,spell,degree,dc}){
 if(degree>=2){if(isTrueVampire(source.actor))await immunity(target,source.token.id);
  if(degree===2&&!target.actor.hasCondition('stunned'))await target.actor.increaseCondition('stunned');return;}
 const old=(target.actor.itemTypes.effect??[]).filter(e=>e.flags?.[ns]?.domination).map(e=>e.id);if(old.length)await target.actor.deleteEmbeddedDocuments('Item',old);
 const data={sourceId:source.token.id,sourceActor:source.actor.uuid,spellId:spell.id,dc,rank:spell.rank,
  alliance:effectiveAlliance(source.actor),endSaves:degree===1,againstNatureSavePending:degree===0,expiresAt:time()+86400};
 await target.actor.createEmbeddedDocuments('Item',[{name:`Dominate: obey ${source.token.name}`,type:'effect',img:spell.img??'icons/svg/eye.svg',
  system:{slug:'creature-ai-domination',level:{value:spell.rank},duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[
   {key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.9qGBRpbX9NEwtAAr',inMemoryOnly:true},
   {key:'ActiveEffectLike',mode:'override',path:`flags.${ns}.domination`,value:data}],
   context:{origin:{actor:source.actor.uuid,token:source.token.document.uuid,item:spell.uuid,spellcasting:null,rollOptions:[]}}},flags:{[ns]:{domination:data}}}]);
}
export async function advanceDomination(token,phase){
 for(const effect of token?.actor?.itemTypes.effect??[]){const d=effect.flags?.[ns]?.domination;if(!d)continue;
  const caster=canvas.tokens.get(d.sourceId),destroyed=caster&&vampireState(caster.actor).destroyed;
  if(time()>=d.expiresAt||destroyed){await token.actor.deleteEmbeddedDocuments('Item',[effect.id]);continue;}
  if(!(phase==='end'&&d.endSaves||phase==='start'&&d.againstNatureSavePending))continue;
  const item=caster?.actor.items.get(d.spellId),roll=await token.actor.getStatistic('will').check.roll({skipDialog:true,token:token.document,origin:caster?.actor,item,
   dc:{value:d.dc},label:'Dominate: resist the vampire\'s command',extraRollOptions:[`${ns}:managed`,'skip-handling-message']});
  if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Dominate recovery save was unresolved');
  if(roll.degreeOfSuccess>=2){await token.actor.deleteEmbeddedDocuments('Item',[effect.id]);if(caster&&isTrueVampire(caster.actor))await immunity(token,d.sourceId);}
  else if(phase==='start')await effect.update({[`flags.${ns}.domination.againstNatureSavePending`]:false,'system.rules':effect.system.rules.map(r=>r.key==='ActiveEffectLike'?{...r,value:{...d,againstNatureSavePending:false}}:r)});
 }
}
export function installDomination({reactions,onError}){
 for(const phase of ['start','end'])Hooks.on(`pf2e.${phase}Turn`,combatant=>{if(game.users.activeGM?.id===game.user.id)
  void reactions.resolve(()=>advanceDomination(canvas.tokens.get(combatant.tokenId),phase)).catch(onError);});
 Hooks.on('updateWorldTime',()=>{if(game.users.activeGM?.id===game.user.id)void reactions.resolve(async()=>{
  for(const token of canvas.tokens.placeables)for(const item of token.actor?.itemTypes.effect??[])if(item.flags?.[ns]?.dominateImmunity?.expiresAt<=time()||item.flags?.[ns]?.domination?.expiresAt<=time())await token.actor.deleteEmbeddedDocuments('Item',[item.id]);}).catch(onError);});
 Hooks.on('updateActor',actor=>{if(game.users.activeGM?.id===game.user.id&&vampireState(actor).destroyed)
  void reactions.resolve(async()=>{for(const token of canvas.tokens.placeables)await advanceDomination(token,'time');}).catch(onError);});
}
