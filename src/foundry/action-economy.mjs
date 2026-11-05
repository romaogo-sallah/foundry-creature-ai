const ns='foundry-creature-ai',workbench='xdy-pf2e-workbench';
const setting=(namespace,key)=>{try{return game.settings.get(namespace,key);}catch{return undefined;}};
export const workbenchReducesStunned=()=>Boolean(game.modules?.get?.(workbench)?.active&&setting(workbench,'autoReduceStunned'));
const nativePayment=actor=>{
  const saved=actor.getFlag?.(workbench,'stunReduction');
  return saved?.combat===game.combat?.id&&saved.round===game.combat?.round?saved.reducedBy??0:0;
};
export function valuedStunned(actor){
  const condition=actor.getCondition?.('stunned');
  return condition&&Number.isInteger(condition.value)&&condition.value>0?condition:null;
}
export async function initialActionBudget(actor,{extra=0}={}){
  // Workbench's start-turn hook is async; await its payment flag instead of
  // racing it or reducing the same condition again.
  if(workbenchReducesStunned()&&valuedStunned(actor)&&!nativePayment(actor)){
    await new Promise((resolve,reject)=>{
      const id=Hooks.on('updateActor',document=>{if(document===actor&&nativePayment(actor))finish();});
      const timer=setTimeout(()=>finish(new Error('Workbench has not finished Stunned reduction. Retry after its start-turn processing.')),2000);
      function finish(error){clearTimeout(timer);Hooks.off('updateActor',id);error?reject(error):resolve();}
      if(nativePayment(actor))finish();
    });
  }
  const stunned=valuedStunned(actor)?.value??0,paid=workbenchReducesStunned()?nativePayment(actor):0;
  const slowed=actor.getCondition?.('slowed')?.value??0;
  const base=actor.system?.traits?.value?.includes('minion')?2:3;
  const loss=Math.max(slowed,Math.min(base+extra,stunned+paid));
  return {actionsRemaining:Math.max(0,base-Math.max(0,loss-extra)),bonusMovementActions:Math.max(0,extra-loss),
    pendingStunned:workbenchReducesStunned()?0:Math.min(stunned,base+extra),stunnedLoss:Math.min(stunned+paid,base+extra),slowedLoss:slowed};
}
export async function settleStunned(adapter,ledger){
  const condition=valuedStunned(adapter.actor),available=ledger.actionsRemaining+(ledger.bonusMovementActions??0);
  const initial=ledger.pendingStunned??0,payment=initial||Math.min(condition?.value??0,available);
  if(!payment)return ledger;
  if(!condition||condition.isLocked||condition.readonly||condition.inMemoryOnly)throw new Error('Stunned has a locked or unavailable source; resolve its action loss manually.');
  const loss=initial?0:payment,bonusLost=Math.min(loss,ledger.bonusMovementActions??0);
  const pending={...ledger,actionsRemaining:Math.max(0,ledger.actionsRemaining-(loss-bonusLost)),
    bonusMovementActions:Math.max(0,(ledger.bonusMovementActions??0)-bonusLost),pendingStunned:payment,uncertain:true};
  await adapter.saveLedger(pending);
  for(let i=0;i<payment;i++){
    if(adapter.turnKey()!==ledger.turn)throw new Error('Turn changed during Stunned resolution; inspect the action ledger.');
    const current=valuedStunned(adapter.actor);if(!current)throw new Error('Stunned changed during resolution; inspect the action ledger.');
    await adapter.actor.decreaseCondition(current);
  }
  const resolved={...pending,pendingStunned:0,uncertain:false};await adapter.saveLedger(resolved);return resolved;
}
