import {vampireAbility,vampireState} from './vampire-state.mjs';
import {concealmentCheck} from './environment-rolls.mjs';
import {markKilled} from './death-status.mjs';
const ns='foundry-creature-ai',conditionUUID={grabbed:'kWc1fhmv9LBiTuei',restrained:'VcDeM8A5oI6VqhbM'};
export const bloodEligible=actor=>actor?.modeOfBeing!=='undead'&&actor?.modeOfBeing!=='construct'&&
 !(actor?.system?.traits?.value??[]).some(t=>['undead','construct','incorporeal','ooze'].includes(t));
export const ownGrab=(actor,sourceId)=>(actor.itemTypes.effect??[]).find(e=>e.flags?.[ns]?.vampireGrab?.sourceTokenId===sourceId);
export async function vampireGrab(adapter,target,ledger,{valid=()=>true}={}){
 const existing=ownGrab(target.actor,adapter.token.id);
 if(existing){await existing.update({[`flags.${ns}.vampireGrab.expiresRound`]:game.combat.round+1});return {resolved:true,lastAction:{kind:'grab',targetId:target.id},note:'Grab maintained until the end of the vampire\'s next turn.'};}
 const last=ledger.lastAction??adapter.token.document.getFlag(ns,'vampireLastStrike');
 if(!last?.hit||last.targetId!==target.id||!adapter.parts().native.find(s=>s.item.id===last.strikeId)?.item.attackEffects?.includes?.('grab')&&
  !adapter.parts().native.find(s=>s.item.id===last?.strikeId)?.item.system?.attackEffects?.value?.includes('grab'))return {skipped:true,skipReason:'Grab requires the preceding successful Grab Strike'};
 if(!await concealmentCheck(adapter.token,target,{valid}))return {resolved:true,note:'Grab targeting failed; action spent.'};
 const check=await adapter.actor.getStatistic('athletics').check.roll({skipDialog:true,token:adapter.token.document,target:target.actor,
  item:vampireAbility(adapter.actor,'grab'),dc:{slug:'fortitude'},attackNumber:1,label:'Grab (no MAP)',extraRollOptions:[`${ns}:managed`,'skip-handling-message','action:grapple']});
 if(!Number.isInteger(check?.degreeOfSuccess)||!valid())throw new Error('Grab check was unresolved');
 if(check.degreeOfSuccess>=2){const kind=check.degreeOfSuccess===3?'restrained':'grabbed';
  await target.actor.createEmbeddedDocuments('Item',[{name:`${adapter.token.name}: ${kind}`,type:'effect',img:'icons/svg/net.svg',
   system:{slug:'vampire-grab',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[{key:'GrantItem',uuid:`Compendium.pf2e.conditionitems.Item.${conditionUUID[kind]}`}],
    context:{origin:{actor:adapter.actor.uuid,token:adapter.token.document.uuid,item:vampireAbility(adapter.actor,'grab').uuid,spellcasting:null,rollOptions:[]}}},
   flags:{[ns]:{vampireGrab:{sourceTokenId:adapter.token.id,expiresRound:game.combat.round+1},escapeDC:adapter.actor.getStatistic('athletics').dc.value}}}]);
 }
 if(check.degreeOfSuccess===0&&!adapter.actor.hasCondition('prone'))await adapter.actor.increaseCondition('prone');
 return {resolved:true,lastAction:{kind:'grab',targetId:target.id},note:check.degreeOfSuccess===0?'Grab critically failed. The target forces the vampire Prone (the automatic counter choice). MAP is unchanged.':
  check.degreeOfSuccess===1?'Grab failed; no restraint was applied. MAP is unchanged.':`Grab succeeded: the target is ${check.degreeOfSuccess===3?'restrained':'grabbed'}. MAP is unchanged.`};
}
export async function drinkBlood(adapter,target,{valid=()=>true}={}){
 if(!bloodEligible(target.actor)||!target.actor.hasCondition('grabbed','restrained','paralyzed','unconscious'))return {skipped:true,skipReason:'Drink Blood requires a living held or helpless victim'};
 if(!await concealmentCheck(adapter.token,target,{valid}))return {resolved:true,note:'Drink Blood targeting failed; action spent.'};
 if(!target.actor.hasCondition('restrained','paralyzed','unconscious')){
  const roll=await adapter.actor.getStatistic('athletics').check.roll({skipDialog:true,token:adapter.token.document,target:target.actor,
   item:adapter.parts().drink,dc:{slug:'fortitude'},label:'Drink Blood',extraRollOptions:[`${ns}:managed`,'skip-handling-message']});
  if(!Number.isInteger(roll?.degreeOfSuccess)||!valid())throw new Error('Drink Blood check was unresolved');
  if(roll.degreeOfSuccess<2)return {resolved:true,note:'The victim resisted Drink Blood; action spent.'};
 }
 const previous=target.actor.getCondition('drained')?.value??0,increment=previous?1:adapter.vampireSpec.drain;
 const hp=target.actor.hitPoints.value,level=Math.max(0,target.actor.level),value=previous+increment;
 await target.actor.increaseCondition('drained',{value:increment});
 // Drained is HP loss, not a damage instance reduced by IWR. Assign the
 // before-condition HP minus the increase, avoiding max-HP-clamp double loss.
 await target.actor.update({'system.attributes.hp.value':Math.max(0,hp-level*increment)});
 let restored=0,temporary=0;
 if(!previous){const amount=adapter.vampireSpec.bloodHeal,before=adapter.actor.hitPoints.value,missing=adapter.actor.hitPoints.max-before;
  await adapter.actor.applyDamage({damage:-amount,token:adapter.token.document,item:adapter.parts().drink,rollOptions:new Set([`${ns}:managed`])});
  restored=Math.max(0,adapter.actor.hitPoints.value-before);temporary=Math.max(0,amount-missing);
  if(temporary>(adapter.actor.hitPoints.temp??0))await adapter.actor.createEmbeddedDocuments('Item',[{name:'Drink Blood: temporary HP',type:'effect',img:'icons/svg/blood.svg',
   system:{slug:'vampire-blood-temp-hp',duration:{value:-1,unit:'unlimited',expiry:null,sustained:false},rules:[{key:'TempHP',value:temporary}]},flags:{[ns]:{vampireBlood:true}}}]);
 }
 if(adapter.vampireSpec.killAtFive&&value>=5){await target.actor.update({'system.attributes.hp.value':0});await markKilled(target);}
 return {resolved:true,lastAction:{kind:'drinkBlood',targetId:target.id},note:`Drink Blood: Drained ${value}; restored ${restored} HP${temporary?`; ${temporary} temporary HP`:''}. Already-drained victims grant no healing.`};
}
export async function releaseVampireGrabs({phase,source,round=game.combat?.round}={}){
 for(const token of canvas.tokens.placeables){const ids=(token.actor?.itemTypes.effect??[]).filter(e=>{const grab=e.flags?.[ns]?.vampireGrab;if(!grab)return false;
  const holder=canvas.tokens.get(grab.sourceTokenId);return !holder||holder.actor.hitPoints.value<=0||vampireState(holder.actor).form==='mist'||
   phase==='end'&&source===grab.sourceTokenId&&round>=grab.expiresRound||holder.distanceTo(token,{reach:holder.actor.getReach({action:'attack'})})>holder.actor.getReach({action:'attack'});}).map(e=>e.id);
  if(ids.length)await token.actor.deleteEmbeddedDocuments('Item',ids);}
}
