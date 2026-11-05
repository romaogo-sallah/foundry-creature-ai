import { casterStealthKnowledge } from './caster-stealth.mjs';
import { rememberedToken } from './target-memory.mjs';
import { stealthObservers, hidingFrom, rollStealth, stealthRecord, finishSneak, reveal, detectionFor } from './stealth-awareness.mjs';
import { saveStealthBelief } from './stealth-belief.mjs';
import { coverAlongPath } from './environment-zones.mjs';
import { PF2eCreatureAdapter } from './pf2e-adapter.mjs';

export const sneakSpeed=adapter=>adapter.groundSpeed()*((adapter.actor.itemTypes.feat??[]).some(item=>['swift-sneak','legendary-sneak'].includes(item.slug))?1:0.5);

export const stealthAdapter=adapter=>({token:adapter.token,actor:adapter.actor,perceivedSpellTarget:enemy=>{
  const token=canvas.tokens.get(enemy.id);
  return enemy.awareness?.state==='known-square'?rememberedToken(token,enemy.awareness.position,enemy.awareness):token;
}});

export async function executeSharedHide(adapter,choice,ledger,context={}) {
  const valid=()=> (context.canContinue?.()??true)&&adapter.turnKey()===ledger.turn&&!game.paused&&game.users.activeGM?.id===game.user.id;
  if(!await adapter.waitForReactions({signal:context.signal})||!valid())return {skipped:true,pause:true,skipReason:'Stopped before Hide'};
  const state=await adapter.snapshot(ledger,{movement:false}),belief=casterStealthKnowledge(stealthAdapter(adapter),state).project();
  const observers=stealthObservers(adapter.token),eligible=observers.filter(observer=>hidingFrom(observer,adapter.token).canHide).map(observer=>observer.id);
  if(!eligible.length)return {skipped:true,skipReason:'No cover or concealment remains for Hide'};
  const results=await rollStealth(adapter.token,'hide',{observers,eligible,valid});
  await saveStealthBelief(adapter.token,belief);
  return {resolved:true,note:`Hide: ${results.map(entry=>`${canvas.tokens.get(entry.observerId)?.name}: ${entry.state}`).join('; ')}. Planning retains estimated chances.`};
}

export async function retainStepStealth(adapter,before) {
  const record=stealthRecord(adapter.token);
  if(record)await finishSneak(adapter.token,record.entries.map(entry=>{
    const observer=canvas.tokens.get(entry.observerId);
    return observer&&hidingFrom(observer,adapter.token).canHide?entry:{...entry,state:'observed'};
  }));
  await saveStealthBelief(adapter.token,casterStealthKnowledge(stealthAdapter(adapter),before).priors);
}

export async function executeSharedSneak(adapter,choice,ledger,context={}) {
  const valid=()=> (context.canContinue?.()??true)&&adapter.turnKey()===ledger.turn&&!game.paused&&game.users.activeGM?.id===game.user.id;
  if(!await adapter.waitForReactions({signal:context.signal})||!valid())return {skipped:true,pause:true,skipReason:'Stopped before Sneak'};
  if(adapter.strideCost(choice.path)>sneakSpeed(adapter))return {skipped:true,skipReason:'Sneak exceeds its allowed Speed'};
  const state=await adapter.snapshot(ledger,{movement:false}),belief=casterStealthKnowledge(stealthAdapter(adapter),state).projectSneak(adapter.center(choice.destination),choice.path);
  const observers=stealthObservers(adapter.token),eligible=observers.filter(observer=>detectionFor(observer,adapter.token).state!=='observed').map(observer=>observer.id);
  const coverThroughout=new Map(observers.map(observer=>[observer.id,coverAlongPath(observer,adapter.token,choice.path.map(cell=>adapter.center(cell)))]));
  const results=await rollStealth(adapter.token,'sneak',{observers,eligible,valid,coverThroughout,destination:adapter.center(choice.destination),moving:true});
  adapter.sharedSneaking=true;
  try{
    const result=await PF2eCreatureAdapter.prototype.execute.call(adapter,{...choice,kind:'stride',sharedSneak:true},ledger,context);
    if(result.pause||result.endTurn||!valid()){await reveal(adapter.token);return result;}
    await finishSneak(adapter.token,results);await saveStealthBelief(adapter.token,belief);
    return {...result,note:'Sneak resolved; its outcome remains separate from the movement plan'};
  }catch(error){await reveal(adapter.token);throw error;}finally{adapter.sharedSneaking=false;}
}
