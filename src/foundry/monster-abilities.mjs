import {spellDefenseCheck,SPELL_OPTIONS} from './spell-checks.mjs';
import {areaContains} from './spell-areas.mjs';
import {applyDefinedSpellEffects} from './defined-spell-effects.mjs';
import {environmentBehavior} from './terrain-contract.mjs';
import {clearAttackPath,clearSightPath} from './attack-path.mjs';
import {rulesAPI} from './rules-api.mjs';
const ns='foundry-creature-ai';
const fearJobs=new WeakMap();
const immunityKey=uuid=>encodeURIComponent(uuid).replace(/\./g,'%2E');
function immunityExpiry(saved,uuid){
 let legacy=saved;for(const part of uuid.split('.'))legacy=legacy?.[part];
 return Math.max(saved[immunityKey(uuid)]??0,saved[uuid]??0,typeof legacy==='number'?legacy:0);
}
export const abilitySlug=item=>item?.slug??item?.system?.slug??item?.name?.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-$/,'');
export const monsterAbility=(actor,slug)=>(actor.itemTypes?.action??[]).find(a=>abilitySlug(a)===slug);
export const monsterAdjustment=actor=>actor.isElite||actor.system.attributes.adjustment==='elite'?1:actor.isWeak||actor.system.attributes.adjustment==='weak'?-1:0;
export const monsterDC=(actor,base)=>base+monsterAdjustment(actor)*2;
export async function abilityDamage(source,targets,{formula,dc,save='reflex',item,applyDamage=true,valid=()=>true,persistent,limited=false}={}){
 const adjustment=monsterAdjustment(source.actor);
 if(adjustment){const bracket=formula.indexOf('[');formula=`(${formula.slice(0,bracket)}${adjustment>0?'+':'-'}${limited?4:2})${formula.slice(bracket)}`;dc+=adjustment*2;}
 const DamageRoll=CONFIG.Dice.rolls.find(c=>c.name==='DamageRoll'),roll=await new DamageRoll(formula).evaluate(),saved=[];
 await roll.toMessage({speaker:ChatMessage.getSpeaker({token:source.document}),flavor:item.name,
  flags:{[ns]:{managed:true},pf2e:{suppressDamageButtons:applyDamage,origin:{uuid:item.uuid},context:{options:SPELL_OPTIONS}}}});
 for(const target of targets){if(!valid())throw new Error('Combat changed during ability resolution');
  if(target.actor.isImmuneTo?.(item))continue;
  const degree=save?await spellDefenseCheck(target,{dc,statistic:save,origin:source,spell:item,label:item.name}):1;
  saved.push({target,degree});if(degree===3)continue;
  const damage=degree===0?roll.alter(2,0):degree===2?roll.alter(0.5,0):roll;
  if(applyDamage){const reactions=rulesAPI()?.reactions,block=await reactions?.shieldBlock({origin:source,target,damage,item,valid});
   await target.actor.applyDamage({damage,token:target.document,item,outcome:['criticalFailure','failure','success','criticalSuccess'][degree],shieldBlockRequest:Boolean(block),rollOptions:new Set([...SPELL_OPTIONS,...item.getRollOptions?.('item')??[]])});
   if(block)await reactions.confirm(block.token,block.reservation);}
  if(persistent&&degree===0&&applyDamage)await applyDefinedSpellEffects({source:{actor:source.actor,token:source},target,spell:{...item,name:item.name,slug:abilitySlug(item),rank:source.actor.level,uuid:item.uuid},
   definition:{persistent:{formula:persistent,type:'fire',degrees:[0]}},degree,dc});
 }
 return {saved,pause:!applyDamage&&saved.some(s=>s.degree<3)};
}
export async function pyreBreath(adapter,choice,{valid=()=>true}={}){
 const item=monsterAbility(adapter.actor,'pyre-breath'),targets=canvas.tokens.placeables.filter(t=>t!==adapter.token&&t.actor?.isOfType?.('creature')&&areaContains(adapter.token,t,choice.area)&&clearAttackPath(adapter.token,t));
 const result=await abilityDamage(adapter.token,targets,{item,formula:'9d6[fire]',dc:29,persistent:'2d6',limited:true,applyDamage:adapter.config.applyDamage,valid});
 const recharge=await new Roll('1d4').evaluate();await recharge.toMessage({speaker:ChatMessage.getSpeaker({token:adapter.token.document}),flavor:'Pyre Breath recharge',flags:{[ns]:{managed:true}}});
 await adapter.token.document.setFlag(ns,'pyreRecharge',{combatId:game.combat.id,round:game.combat.round+recharge.total});
 await createObscuringZone(adapter.token,{name:'Pyre Breath smoke',area:choice.area,duration:60,smoke:true});
 return {resolved:true,pause:result.pause,lastAction:{kind:'pyreBreath'},note:`Pyre Breath affected ${result.saved.length} creatures; smoke lasts 1 minute. Recharge in ${recharge.total} rounds.`};
}
export async function createObscuringZone(source,{name,area,duration=60,smoke=false,flags={}}){
 const volume=area.volume,low=volume?volume.origin.z-volume.range:source.document.elevation,high=volume?volume.origin.z+volume.range:source.document.elevation+20;
 return source.document.parent.createEmbeddedDocuments('Region',[{name,shapes:area.shapes,elevation:{bottom:low,top:high},levels:source.document.level?[source.document.level]:[],
  color:smoke?'#555555':'#b5bfc7',behaviors:[environmentBehavior({enabled:true,cover:'none',coverMode:'occupants',concealment:'through',firingRadius:0})],
  flags:{[ns]:{obscuring:{smoke,volume,expiresAt:game.time.worldTime+duration,...flags}},'pf2e-toolbelt':{targetHelper:{skip:true}}}}],{renderSheet:false});
}
export async function resolveFrightfulPresence(source,target){
 // Movement and turn hooks can arrive together. Serialize on the target actor
 // so separate sources cannot overwrite each other's persisted immunity.
 const actor=target.actor;if(!actor)return;
 const task=(fearJobs.get(actor)??Promise.resolve()).catch(()=>{}).then(()=>resolvePresence(source,target));
 fearJobs.set(actor,task);try{return await task;}finally{if(fearJobs.get(actor)===task)fearJobs.delete(actor);}
}
async function resolvePresence(source,target){
 const item=monsterAbility(source.actor,'frightful-presence');if(!item||!target.actor?.hitPoints?.value||!source.actor.isEnemyOf(target.actor)||!clearSightPath(target,source)||!clearAttackPath(source,target))return;
 const radius=item.system.rules?.find(r=>r.key==='Aura')?.radius??(monsterAbility(source.actor,'pyre-breath')?90:60);
 if(source.distanceTo(target)>radius||target.actor.hasCondition('blinded'))return;
 const uuid=source.document.uuid??source.id,key=immunityKey(uuid),immunities=target.actor.getFlag(ns,'frightfulImmunities')??{};
 if(immunityExpiry(immunities,uuid)>game.time.worldTime)return;
 const dc=monsterDC(source.actor,Number(item.system.description.value.match(/dc:(\d+)/)?.[1]??29));
 const degree=await spellDefenseCheck(target,{dc,statistic:'will',origin:source,spell:item,label:'Frightful Presence'});
 await target.actor.setFlag(ns,'frightfulImmunities',{...immunities,[key]:game.time.worldTime+60});
 if(target.actor.isImmuneTo?.(item)||degree===3)return;
 const desired=[4,2,1][degree],current=target.actor.getCondition('frightened')?.value??0;
 if(current<desired){const editable=target.actor.getCondition('frightened',{all:true}).find(c=>!c.isLocked);await target.actor.increaseCondition('frightened',{value:desired-(editable?.value??0),max:desired});}
}
export async function siphonLife(source,target,{damage=true}={}){
 const item=monsterAbility(source.actor,'lich-siphon-life');if(!item||target.actor.modeOfBeing!=='living'||target.actor.hitPoints.value<=0)return;
 if(damage&&(source.actor.hitPoints.temp??0)<5)await source.actor.createEmbeddedDocuments('Item',[{name:'Siphon Life: temporary HP',type:'effect',img:'icons/svg/blood.svg',system:{slug:'siphon-life-temp-hp',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[{key:'TempHP',value:5}]}}]);
 const degree=await spellDefenseCheck(target,{dc:monsterDC(source.actor,Number(item.system.description.value.match(/dc:(\d+)/)?.[1]??34)),statistic:'fortitude',origin:source,spell:item,label:'Siphon Life'});
 if(degree<2&&!target.actor.isImmuneTo?.(item)&&(target.actor.getCondition('drained')?.value??0)<4){const hp=target.actor.hitPoints.value,desired=(target.actor.getCondition('drained')?.value??0)+1,editable=target.actor.getCondition('drained',{all:true}).find(c=>!c.isLocked);await target.actor.increaseCondition('drained',{value:desired-(editable?.value??0),max:4});
  await target.actor.update({'system.attributes.hp.value':Math.max(0,hp-Math.max(0,target.actor.level))});}
}
export function installMonsterAbilities({reactions,onError}){
 const refresh=async token=>{if(!canvas.ready||game.users.activeGM?.id!==game.user.id)return;
  for(const source of canvas.tokens.placeables.filter(t=>monsterAbility(t.actor??{},'frightful-presence')&&t.actor.hitPoints.value>0))
   for(const target of token===source?canvas.tokens.placeables:token?[token]:canvas.tokens.placeables)if(target!==source)await resolveFrightfulPresence(source,target);};
 Hooks.on('moveToken',document=>{if(game.users.activeGM?.id===game.user.id)void reactions.resolve(()=>refresh(document.object)).catch(onError);});
 Hooks.on('pf2e.startTurn',c=>{if(game.users.activeGM?.id!==game.user.id)return;void reactions.resolve(async()=>{
  const token=canvas.tokens.get(c.tokenId);if(!token)return;await refresh(token);
  if(monsterAbility(token.actor,'lich-siphon-life')&&token.actor.hasCondition('grabbed','restrained')){
   const conditions=token.actor.getCondition('grabbed',{all:true}).concat(token.actor.getCondition('restrained',{all:true})),holders=new Set(conditions.map(c=>c.flags?.[ns]?.vampireGrab?.sourceTokenId).filter(Boolean));
   for(const condition of conditions){const effect=condition.appliedBy??condition,origin=effect.system?.context?.origin??condition.system?.context?.origin;
    if(!origin?.item)continue;const item=await fromUuid(origin.item);
    if(item?.type==='melee'||['grapple','grab','improved-grab'].includes(abilitySlug(item))){const source=canvas.tokens.placeables.find(t=>t.document.uuid===origin.token||t.actor?.uuid===origin.actor);if(source)holders.add(source.id);}
   }
   for(const id of holders){const holder=canvas.tokens.get(id);if(holder)await siphonLife(token,holder,{damage:false});}
  }
 }).catch(onError);});
 Hooks.on('updateWorldTime',()=>{if(game.users.activeGM?.id!==game.user.id||!canvas.scene)return;
  const ids=canvas.scene.regions.contents.filter(r=>r.flags?.[ns]?.obscuring?.expiresAt<=game.time.worldTime).map(r=>r.id);
  if(ids.length)void reactions.resolve(()=>canvas.scene.deleteEmbeddedDocuments('Region',ids)).catch(onError);});
}
