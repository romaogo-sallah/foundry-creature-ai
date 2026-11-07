// Native Foundry diagnostics must never use Actor.create/createDocuments.
// Those methods save world documents; `temporary: true` is not a safe guard.
// This function is self-contained so browser inspection scripts can embed it.
export function createDiagnosticActor(data,{
  ActorClass=globalThis.CONFIG?.Actor?.documentClass,
  actors=globalThis.game?.actors,
  randomID=globalThis.foundry?.utils?.randomID,
}={}){
  if(typeof ActorClass!=='function'||typeof randomID!=='function')throw new Error('Native actor class and ID generator are required');
  const source=structuredClone(data);source._id=randomID();
  const before=new Set(actors?.keys()??[]);
  const actor=new ActorClass(source,{strict:true});
  if(actors?.get(actor.id)===actor||[...actors?.keys()??[]].some(id=>!before.has(id)))
    throw new Error('Diagnostic construction unexpectedly changed the world actor collection');
  // Native preparation and updateSource are in-memory operations. Persistent
  // mutations are forbidden on this object, including accidental test damage.
  // Native status toggles call ActiveEffect.create directly, bypassing the
  // actor createEmbeddedDocuments guard; intercept that entry point as well.
  for(const method of ['update','delete','setFlag','unsetFlag','createEmbeddedDocuments','updateEmbeddedDocuments','deleteEmbeddedDocuments','applyDamage','toggleStatusEffect'])
    Object.defineProperty(actor,method,{configurable:true,value(){throw new Error(`Diagnostic actors cannot persist ${method}; construct new source data instead`);}});
  return actor;
}
