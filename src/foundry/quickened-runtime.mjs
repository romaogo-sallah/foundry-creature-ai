import {taughtBuffs} from './support-spells.mjs';
const haste=actor=>taughtBuffs(actor).includes('haste')&&actor.hasCondition('quickened');
export function attachQuickenedSystem(adapter){
 const bonus=adapter.movementBonusAvailable.bind(adapter),read=adapter.readLedger.bind(adapter),candidates=adapter.candidates.bind(adapter);
 adapter.movementBonusAvailable=()=>bonus()||haste(adapter.actor);
 adapter.readLedger=async turn=>{const old=adapter.token.document.getFlag('foundry-creature-ai','ledger'),ledger=await read(turn);
  ledger.hasteBonus=old?.turn===turn?Boolean(ledger.hasteBonus):haste(adapter.actor);return ledger;};
 adapter.candidates=state=>{
  const offered=candidates(state);if(!state.bonusMovementActions)return offered;
  const kinds=haste(adapter.actor)?['strike','stride']:bonus()?['step','stride']:[];
  const choices=candidates({...state,actionsRemaining:Math.max(1,state.actionsRemaining),bonusMovementActions:0});
  const extra=choices.filter(c=>kinds.includes(c.kind)&&c.actionCost===1&&!c.bonusActionCost).map(c=>({...c,id:`quickened:${c.id}`,actionCost:0,bonusActionCost:1,
   scoringTerms:[...c.scoringTerms??[],{label:'Restricted quickened action',contribution:0}]}));
  return [...offered.filter(c=>!state.hasteBonus||c.bonusActionCost!==1||kinds.includes(c.kind)),...extra];
 };
 return adapter;
}
