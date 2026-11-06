import {domination,effectiveAlliance} from './domination.mjs';
const ns='foundry-creature-ai';
export function spellAllyOf(wrapped,other){if(this.flags?.[ns]?.noAllies)return false;
 if(domination(this)||domination(other))return this!==other&&effectiveAlliance(this)!=null&&effectiveAlliance(this)===effectiveAlliance(other);return wrapped(other);}
export function spellEnemyOf(wrapped,other){if(this.flags?.[ns]?.hostileReactions&&this!==other)return true;
 if(domination(this)||domination(other))return this!==other&&effectiveAlliance(this)!=null&&effectiveAlliance(other)!=null&&effectiveAlliance(this)!==effectiveAlliance(other);return wrapped(other);}
export function installSpellAlliances({packageId}){
 const actor=CONFIG.Actor?.documentClass?.prototype;
 if(typeof actor?.isAllyOf==='function')libWrapper.register(packageId,'CONFIG.Actor.documentClass.prototype.isAllyOf',spellAllyOf,'MIXED');
 if(typeof actor?.isEnemyOf==='function')libWrapper.register(packageId,'CONFIG.Actor.documentClass.prototype.isEnemyOf',spellEnemyOf,'MIXED');
}
