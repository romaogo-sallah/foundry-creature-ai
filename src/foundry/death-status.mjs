// Dead is a Foundry status, not a PF2e ConditionManager condition. Native
// death-effect damage may already have applied it before our resolver returns.
export async function markKilled(token){
 const actor=token.actor;
 if(actor.statuses?.has('dead'))return;
 await actor.toggleStatusEffect('dead',{active:true,overlay:true});
}
