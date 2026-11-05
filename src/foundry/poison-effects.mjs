import {MANTICORE_VENOM,poisonStage} from '../framework/poison.mjs';
const ns='foundry-creature-ai',locks=new Map(),specs=new Map([[MANTICORE_VENOM.id,MANTICORE_VENOM]]);
const owned=actor=>(actor?.itemTypes.effect??[]).filter(e=>specs.has(e.flags?.[ns]?.poison?.id));
const updater=()=>game.user?.isGM&&game.users.activeGM?.id===game.user.id;
const time=()=>game.time?.worldTime??0;
const dataOf=effect=>effect.flags[ns].poison;
async function serial(token,operation){
  const key=token.actor.uuid,previous=locks.get(key)??Promise.resolve(),task=previous.catch(()=>{}).then(operation);
  locks.set(key,task);try{return await task;}finally{if(locks.get(key)===task)locks.delete(key);}
}
function immune(actor,item){
  return actor.isImmuneTo?actor.isImmuneTo(item):(actor.attributes?.immunities??[]).some(e=>e.type==='poison');
}
function rules(stage,spec){return [{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.MIRkyAjyBeXivMa7',inMemoryOnly:true,
  alterations:[{mode:'override',property:'badge-value',value:spec.stages[stage-1].enfeebled}]}];}
export function poisonEffectData(spec,data,origin={}){
  return {name:`${spec.name} — Stage ${data.stage}`,type:'effect',img:'icons/skills/toxins/poison-bottle-open-fire-purple.webp',
    system:{slug:`creature-ai-${spec.id}`,description:{value:`<p>${spec.name}: DC ${spec.dc} Fortitude. Stage ${data.stage}; maximum ${spec.durationRounds} rounds. Remove this effect when cured.</p>`},
      duration:{unit:'unlimited',value:-1,expiry:null,sustained:false},level:{value:spec.level},tokenIcon:{show:true},
      badge:{type:'counter',value:data.stage},traits:{value:['poison']},rules:rules(data.stage,spec),
      context:origin.actor?{origin:{actor:origin.actor,token:origin.token??null,item:origin.item??null,spellcasting:null,rollOptions:[]}}:null},
    flags:{[ns]:{poison:data}}};
}
function expired(data,combat){
  if(time()>=data.expiresAt)return true;
  if(combat?.id!==data.combatId)return false;
  return combat.round>data.expiresRound||combat.round===data.expiresRound&&(combat.turn??0)>=data.expiresIndex;
}
async function save(token,spec,item,origin){
  const check=token.actor.getStatistic('fortitude')?.check;
  if(!check?.roll)throw new Error(`${token.name} has no native Fortitude saving throw`);
  const roll=await check.roll({skipDialog:true,token:token.document,item,origin,dc:{value:spec.dc},
    label:`${spec.name}: Fortitude`,extraRollOptions:[`${ns}:managed`,'skip-handling-message','poison',`affliction:${spec.id}`]});
  if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error(`${spec.name} save was cancelled; inspect the pending exposure`);
  return roll.degreeOfSuccess;
}
async function damageStage(token,effect,spec){
  const data=dataOf(effect),DamageRoll=CONFIG.Dice.rolls.find(type=>type.name==='DamageRoll');
  if(!DamageRoll)throw new Error('Native PF2e DamageRoll is unavailable');
  const damage=await new DamageRoll(`${spec.stages[data.stage-1].damage}[poison]`).evaluate();
  await damage.toMessage({speaker:ChatMessage.getSpeaker({token:token.document}),flavor:`${spec.name} — Stage ${data.stage}`,
    flags:{[ns]:{managed:true,damageAutoApplied:data.applyDamage},'xdy-pf2e-workbench':{noAutoDamageRoll:true},
      pf2e:{suppressDamageButtons:data.applyDamage,context:{type:'damage-roll',sourceType:'save',outcome:'failure',
        options:[`${ns}:managed`,'skip-handling-message','poison',`affliction:${spec.id}`]}}}});
  if(data.applyDamage)await token.actor.applyDamage({damage,token:token.document,item:effect,
    rollOptions:new Set([`${ns}:managed`,'poison',`affliction:${spec.id}`]),outcome:'failure'});
  return {pause:!data.applyDamage};
}
async function setStage(effect,spec,data){
  await effect.update({name:`${spec.name} — Stage ${data.stage}`,'system.badge.value':data.stage,'system.rules':rules(data.stage,spec),
    [`flags.${ns}.poison`]:data});
}

export function exposeToPoison(adapter,target,spec=MANTICORE_VENOM,context={}){
  return serial(target,async()=>{
    const combat=game.combat,actorUuid=target.actor.uuid;
    const valid=()=>updater()&&(context.canContinue?.()??true)&&target.actor?.uuid===actorUuid&&game.combat?.id===combat?.id;
    if(!valid())return {skipped:true};
    const item=adapter.parts().venom;
    if(immune(target.actor,item))return {immune:true,note:`${spec.name}: the target is immune.`};
    const external=(target.actor.itemTypes.effect??[]).find(e=>!e.flags?.[ns]?.poison&&
      (e.slug??e.system?.slug??e.name.toLowerCase().replaceAll(' ','-')).includes(spec.id));
    if(external)return {external:true,note:`${spec.name} is already managed by another effect; its stage is left to that effect.`};
    let effect=owned(target.actor).find(e=>dataOf(e).id===spec.id);
    if(effect&&expired(dataOf(effect),combat)){await target.actor.deleteEmbeddedDocuments('Item',[effect.id]);effect=null;}
    if(effect&&dataOf(effect).uncertain)throw new Error(`${spec.name} has an unresolved stage; inspect its effect before continuing`);
    if(effect)await effect.update({[`flags.${ns}.poison.uncertain`]:true});
    const degree=await save(target,spec,item,adapter.actor);
    if(!valid())throw new Error('Combat changed during the venom save; inspect its result');
    if(degree>=2){if(effect)await effect.update({[`flags.${ns}.poison.uncertain`]:false});return {saved:true};}
    const prior=effect?dataOf(effect):null,stage=poisonStage(prior?.stage??0,degree,{exposure:true,maxStage:spec.stages.length});
    const data=prior?{...prior,stage,uncertain:true}:{id:spec.id,stage,combatId:combat?.id??null,targetId:target.id,
      sourceTokenId:adapter.token.id,sourceActor:adapter.actor.uuid,expiresAt:time()+spec.durationRounds*6,
      expiresRound:(combat?.round??0)+spec.durationRounds,expiresIndex:combat?.turn??0,lastEndKey:null,
      applyDamage:adapter.config.applyDamage!==false,uncertain:true};
    if(effect)await setStage(effect,spec,data);
    else [effect]=await target.actor.createEmbeddedDocuments('Item',[poisonEffectData(spec,data,{actor:adapter.actor.uuid,token:adapter.token.document.uuid,item:item.uuid})]);
    if(!effect)throw new Error('The venom effect was not created; inspect the resolved save');
    const result=await damageStage(target,effect,spec);
    await effect.update({[`flags.${ns}.poison.uncertain`]:false});
    return {...result,stage,note:`${spec.name}: Stage ${stage}.`};
  });
}

export function advancePoisons(token,{combat=game.combat,endedRound=combat?.round}={}){
  return serial(token,async()=>{
    if(!updater())return {};
    let pause=false;
    for(const effect of owned(token.actor)){
      const data=dataOf(effect),spec=specs.get(data.id),key=`${combat?.id}:${endedRound}:${token.id}`;
      if(expired(data,combat)){await token.actor.deleteEmbeddedDocuments('Item',[effect.id]);continue;}
      if(data.combatId!==combat?.id||token.actor.isDead)continue;
      if(data.uncertain)throw new Error(`${spec.name} has an unresolved save or damage roll; inspect its effect before advancing`);
      if(data.lastEndKey===key)continue;
      if(immune(token.actor,effect)){await token.actor.deleteEmbeddedDocuments('Item',[effect.id]);continue;}
      await effect.update({[`flags.${ns}.poison`]:{...data,lastEndKey:key,uncertain:true}});
      const actorUuid=token.actor.uuid,degree=await save(token,spec,effect,null);
      if(!updater()||game.combat?.id!==combat.id||token.actor.uuid!==actorUuid||!token.actor.items.has(effect.id))
        throw new Error('The poisoned actor or encounter changed while its save resolved');
      const stage=poisonStage(data.stage,degree,{maxStage:spec.stages.length});
      if(!stage){await token.actor.deleteEmbeddedDocuments('Item',[effect.id]);continue;}
      await setStage(effect,spec,{...data,lastEndKey:key,stage,uncertain:true});
      pause=(await damageStage(token,effect,spec)).pause||pause;
      await effect.update({[`flags.${ns}.poison.uncertain`]:false});
    }
    return {pause};
  });
}

export async function expirePoisons(combat=game.combat){
  if(!updater()||!canvas.ready)return;
  for(const token of canvas.tokens.placeables){
    const ids=owned(token.actor).filter(e=>expired(dataOf(e),combat)).map(e=>e.id);
    if(ids.length)await serial(token,()=>token.actor.deleteEmbeddedDocuments('Item',ids));
  }
}
let installed=false;
export function installPoisonHooks({reactions,onError,onPause=()=>{}}){
  if(installed)return;installed=true;
  Hooks.on('pf2e.endTurn',(combatant,combat)=>{
    const token=canvas.tokens.get(combatant.tokenId);if(!updater()||!token||!owned(token.actor).length)return;
    const endedRound=combatant.getFlag?.('pf2e','roundOfLastTurnEnd')??combatant.flags?.pf2e?.roundOfLastTurnEnd??combat.round;
    void reactions.resolve(async()=>{if((await advancePoisons(token,{combat,endedRound})).pause)onPause();}).catch(onError);
  });
  Hooks.on('pf2e.startTurn',(_combatant,combat)=>{void reactions.resolve(()=>expirePoisons(combat)).catch(onError);});
  Hooks.on('updateWorldTime',()=>{void reactions.resolve(()=>expirePoisons()).catch(onError);});
}
