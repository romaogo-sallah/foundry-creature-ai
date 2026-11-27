const ns='foundry-creature-ai';

// PF2e's start-turn hook is the primary trigger. combatTurnChange is a second,
// post-effects signal which recovers a missed trigger without replaying a turn
// that already has a ledger or is currently running.
export async function recoverAutomaticTurn(combat,{paused=false,blocked=false,activeRuns,run}={}){
 if(paused||blocked||game.users.activeGM?.id!==game.user.id||!canvas.ready||game.combat!==combat||!combat.started)return false;
 const c=combat.combatant,token=canvas.tokens.get(c?.tokenId),config=token?.document.getFlag(ns,'config');
 if(!token||!config?.enabled||!config.autoRun||activeRuns?.has(token.id))return false;
 const turn=`${combat.id}:${combat.round}:${c.id}`;
 if(token.document.getFlag(ns,'ledger')?.turn===turn)return false;
 await run(token,{automatic:true,expectedTurn:turn});return true;
}
