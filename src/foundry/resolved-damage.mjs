// PF2e supplies post-IWR damageTaken with its native actor update. HP deltas
// alone lose overkill and temporary/stamina damage and must not size life drain.
export async function captureAppliedDamage(actor,operation){
  let damageTaken=0,captured=false;
  const capture=(updated,_changes,options={})=>{
    if(!captured&&updated.uuid===actor.uuid&&Number.isFinite(options.damageTaken)){damageTaken=Math.max(0,options.damageTaken);captured=true;}
  };
  Hooks.on('updateActor',capture);
  try{await operation();return {damageTaken};}finally{Hooks.off('updateActor',capture);}
}
