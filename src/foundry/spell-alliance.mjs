const ns='foundry-creature-ai';
export function spellAllyOf(wrapped,other){return this.flags?.[ns]?.noAllies?false:wrapped(other);}
export function spellEnemyOf(wrapped,other){return this.flags?.[ns]?.hostileReactions&&this!==other?true:wrapped(other);}
export function installSpellAlliances({packageId}){
 const actor=CONFIG.Actor?.documentClass?.prototype;
 if(typeof actor?.isAllyOf==='function')libWrapper.register(packageId,'CONFIG.Actor.documentClass.prototype.isAllyOf',spellAllyOf,'MIXED');
 if(typeof actor?.isEnemyOf==='function')libWrapper.register(packageId,'CONFIG.Actor.documentClass.prototype.isEnemyOf',spellEnemyOf,'MIXED');
}
