import { detectionFor } from './stealth-awareness.mjs';
import { concealmentCheck } from './environment-rolls.mjs';
import { rollEvent, MANAGED_OPTION } from './rules-context.mjs';

// The binding establishes weapon readiness/range. Every caller uses the same
// targeted flat check, MAP, native roll, damage/IWR and Shield Block barrier.
export async function executeNativeStrike(adapter,strike,target,ledger,{canContinue=()=>true,extraOptions=[]}={}) {
  const valid=()=>canContinue()&&adapter.turnKey()===ledger.turn;
  if(!await concealmentCheck(adapter.token,target,{valid}))return {resolved:true,lastAction:{kind:'strike',hit:false,targetId:target.id,strikeId:strike.item.id},note:'Targeting flat check failed'};
  const variant=Math.min(2,ledger.attacksMade-1),hidden=detectionFor(target,adapter.token).state!=='observed';
  const options=[MANAGED_OPTION,'skip-handling-message',...extraOptions,...hidden?['target:condition:off-guard']:[]];
  const roll=await strike.variants[variant].roll({target,options,event:rollEvent('check')});
  if(!Number.isInteger(roll?.degreeOfSuccess)||!valid())throw new Error('The native Strike was cancelled or interrupted');
  const hit=roll.degreeOfSuccess>=2;
  if(hit){
    const outcome=roll.degreeOfSuccess===3?'criticalSuccess':'success';
    const damage=await strike[roll.degreeOfSuccess===3?'critical':'damage']({target,mapIncreases:variant,options,event:rollEvent('damage')});
    if(!damage||!valid())throw new Error('Native Strike damage was cancelled or interrupted');
    if(adapter.config.applyDamage)await adapter.applyDamage(target,damage,strike.item,outcome,{valid});
  }
  return {resolved:true,lastAction:{kind:'strike',hit,targetId:target.id,strikeId:strike.item.id},pause:hit&&!adapter.config.applyDamage};
}
