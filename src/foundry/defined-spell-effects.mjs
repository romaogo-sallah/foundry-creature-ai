const ns='foundry-creature-ai',jobs=new WeakMap();
const serial=fn=>{const task=(jobs.get(game)??Promise.resolve()).catch(()=>{}).then(fn);jobs.set(game,task);return task;};
const items=actor=>[...(actor.items?.values?.()??[])].filter(i=>i.flags?.[ns]?.definedSpell);
const gm=()=>game.users.activeGM?.id===game.user.id;
function phaseDeadline(until,source,target){
 if(!until||!game.combat?.started)return null;
 const [who,phase]=until.split('-'),token=who==='caster'?source.token:target;
 const index=(game.combat.turns??game.combat.combatants??[]).findIndex(c=>c.tokenId===token?.id);if(index<0)return null;
 return {tokenId:token.id,phase,round:game.combat.round+Number(index<=game.combat.turn),combatId:game.combat.id};
}
export function applyDefinedSpellEffects({source,target,spell,definition,degree,dc,skipPersistent=false,castId:providedCastId,enemySignature}){
 return serial(async()=>{
  const outcome=definition.outcomes?.[degree]??{},conditions=outcome.conditions??[],persistent=!skipPersistent&&definition.persistent?.degrees.includes(degree)?definition.persistent:null;
  const nativeCondition=slug=>{const base=game.pf2e.ConditionManager?.getCondition(slug);if(!base)throw new Error(`Unknown native condition: ${slug}`);return base.toObject();};
  const castId=providedCastId??foundry.utils.randomID(),duration=outcome.duration??definition.duration,deadline=phaseDeadline(outcome.until,source,target),expiresAt=deadline?null:duration?game.time.worldTime+duration:null;
  const metadata={castId,slug:spell.slug,sourceTokenId:source.token?.id??null,targetId:target.id,expiresAt,deadline,fallbackExpiresAt:deadline?game.time.worldTime+(duration??6):null,endOnRecovery:definition.endOnRecovery??null,
   clearWhenEmpty:!definition.mentalDefense&&!definition.wardBonus&&!outcome.noAllies&&!outcome.noActions&&!outcome.noReactions};
  const children=conditions.map(c=>{const raw=nativeCondition(c.slug);delete raw._id;
   if(typeof raw.system.value?.value==='number')raw.system.value.value=c.value??1;
   const short=outcome.conditionDurations?.[c.slug],shortDeadline=short===6?phaseDeadline('caster-start',source,target):null;
   return {...raw,flags:{...raw.flags,[ns]:{definedSpell:short?{...metadata,expiresAt:shortDeadline?null:game.time.worldTime+short,deadline:shortDeadline,fallbackExpiresAt:game.time.worldTime+short,independentExpiry:true}:metadata,dc,...c.slug==='fascinated'?{fascinationSubjectId:source.token?.id??null}:{}}}};});
  if(persistent){const raw=nativeCondition('persistent-damage');delete raw._id;
   const formula=persistent.formula.replaceAll('@rank',String(spell.rank)),factor=degree===0&&persistent.criticalDouble?2:1;
   raw.system.persistent={formula:factor===1?formula:`2*(${formula})`,damageType:persistent.type,dc:15,criticalHit:false};
   children.push({...raw,flags:{...raw.flags,[ns]:{definedSpell:metadata}}});}
  const weakness=definition.weakness&&degree===definition.weakness.degree;
  if(!children.length&&!weakness&&!definition.mentalDefense&&!definition.wardBonus&&!outcome.noAllies&&!outcome.noActions&&!outcome.noReactions)return null;
  const rules=definition.mentalDefense?[{key:'FlatModifier',selector:'saving-throw',type:'status',value:definition.mentalDefense,predicate:['item:trait:mental']}]:[];
  if(weakness){rules.push({key:'Weakness',type:definition.weakness.type,value:spell.rank*definition.weakness.perRank});metadata.clearWhenEmpty=false;
   metadata.deadline=phaseDeadline(definition.weakness.until,source,target);metadata.expiresAt=metadata.deadline?null:game.time.worldTime+6;metadata.fallbackExpiresAt=game.time.worldTime+6;}
  if(definition.wardBonus){if(!enemySignature)throw new Error('Ward needs a native enemy signature');rules.push({key:'FlatModifier',selector:['ac','saving-throw'],type:'status',value:spell.rank>=6?2:definition.wardBonus,predicate:[`origin:signature:${enemySignature}`]});}
  for(const key of ['noAllies','hostileReactions'])if(outcome[key])rules.push({key:'ActiveEffectLike',mode:'override',path:`flags.${ns}.${key}`,value:true});
  for(const [field,key]of [['noActions','noActions'],['noReactions','noUseReactions']])if(outcome[field]&&!outcome.noActionsDuration)rules.push({key:'ActiveEffectLike',mode:'override',path:`flags.pf2e.${key}`,value:true});
  const parent={name:`${spell.name} — spell effects`,type:'effect',img:spell.img??'icons/svg/aura.svg',
   system:{slug:`modular-${spell.slug}`,level:{value:spell.rank},duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},tokenIcon:{show:true},rules,
    context:{origin:{actor:source.actor.uuid,token:source.token?.document.uuid??null,item:spell.uuid,spellcasting:null,rollOptions:[]}}},flags:{[ns]:{definedSpell:{...metadata,isRoot:true}}}};
  const timed=outcome.noActionsDuration?[{...parent,name:`${spell.name}: stunned for one round`,system:{...parent.system,rules:[
   {key:'ActiveEffectLike',mode:'override',path:'flags.pf2e.noActions',value:true},{key:'ActiveEffectLike',mode:'override',path:'flags.pf2e.noUseReactions',value:true}]},
   flags:{[ns]:{definedSpell:{...metadata,castId:`${castId}:stun`,parentCastId:castId,isRoot:true,
    deadline:phaseDeadline('caster-start',source,target),expiresAt:game.combat?.started?null:game.time.worldTime+outcome.noActionsDuration,
    fallbackExpiresAt:game.time.worldTime+outcome.noActionsDuration,clearWhenEmpty:false}}}}]:[];
  return target.actor.createEmbeddedDocuments('Item',[parent,...children,...timed]);
 });
}
export function cleanupDefinedSpells({resetTokenIds=[],castIds=[],token:turnToken,phase,round=game.combat?.round}={}){
 return serial(async()=>{
  if(!gm())return;const reset=new Set(resetTokenIds),casts=new Set(castIds);
  for(const token of canvas.tokens.placeables){const actor=token.actor;if(!actor)continue;const owned=items(actor),ending=new Set();
   const independent=[];
   for(const item of owned){const d=item.flags[ns].definedSpell;
    if(d.parentCastId&&!owned.some(root=>root.flags[ns].definedSpell.castId===d.parentCastId&&root.flags[ns].definedSpell.isRoot)){ending.add(d.castId);continue;}
    const index=d.deadline?(game.combat?.turns??[]).findIndex(c=>c.tokenId===d.deadline.tokenId):-1;
    const elapsed=d.deadline&&(d.deadline.combatId===game.combat?.id&&game.combat.started?
      round>d.deadline.round||round===d.deadline.round&&(d.deadline.tokenId===turnToken?.id&&d.deadline.phase===phase||index>=0&&game.combat.turn>index):
      game.time.worldTime>=d.fallbackExpiresAt);
    if(d.independentExpiry&&(d.expiresAt!=null&&d.expiresAt<=game.time.worldTime||elapsed)){independent.push(item.id);continue;}
    const orphan=item.type==='condition'&&!owned.some(root=>root.flags[ns].definedSpell.castId===d.castId&&root.flags[ns].definedSpell.isRoot);
    if(orphan||elapsed||casts.has(d.castId)||d.expiresAt!=null&&game.time.worldTime>=d.expiresAt||reset.has(d.sourceTokenId)||reset.has(d.targetId)||
      d.endOnRecovery&&!actor.hasCondition(d.endOnRecovery)||item.type==='effect'&&d.clearWhenEmpty&&!owned.some(other=>other.type==='condition'&&other.flags[ns].definedSpell.castId===d.castId))ending.add(d.castId);}
   const ids=[...new Set([...independent,...owned.filter(i=>ending.has(i.flags[ns].definedSpell.castId)).map(i=>i.id)])];
   if(ids.length)await actor.deleteEmbeddedDocuments('Item',ids);
  }
 });
}
export function installDefinedSpellEffects({reactions,onError}){
 const refresh=options=>{if(gm())void reactions.resolve(()=>cleanupDefinedSpells(options)).catch(onError);};
 Hooks.on('updateWorldTime',()=>refresh());
 for(const phase of ['start','end'])Hooks.on(`pf2e.${phase}Turn`,(combatant,combat)=>refresh({token:canvas.tokens.get(combatant.tokenId),phase,
  round:phase==='end'?(combatant.getFlag?.('pf2e','roundOfLastTurnEnd')??combat.round):combat.round}));
 for(const hook of ['updateItem','deleteItem'])Hooks.on(hook,item=>{if(item.type==='condition'||item.flags?.[ns]?.definedSpell)refresh();});
}
