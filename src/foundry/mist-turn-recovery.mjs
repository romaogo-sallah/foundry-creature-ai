import {movingMist} from './vampire-state.mjs';
const ns='foundry-creature-ai';
// combatTurnChange runs after native turn/effect processing. Recover only a
// missing mist turn: never replay a turn with an existing ledger or active run.
export async function recoverMistTurn(combat,{paused=false,blocked=false,activeRuns,run}={}){
 if(paused||blocked||game.users.activeGM?.id!==game.user.id||!canvas.ready||game.combat!==combat||!combat.started)return false;
 const c=combat.combatant,token=canvas.tokens.get(c?.tokenId),config=token?.document.getFlag(ns,'config');
 if(!token||!movingMist(token.actor)||!config?.enabled||!config.autoRun||activeRuns?.has(token.id))return false;
 const turn=`${combat.id}:${combat.round}:${c.id}`;
 if(token.document.getFlag(ns,'ledger')?.turn===turn)return false;
 await run(token,{automatic:true,expectedTurn:turn});return true;
}
