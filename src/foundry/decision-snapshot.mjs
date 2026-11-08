import {fireShield} from './fire-shield.mjs';
import {taughtBuffs} from './support-spells.mjs';
import {escapeBindings} from './escape.mjs';

export function profileActionFacts(adapter,state){
 const actor=adapter.actor,id=adapter.profileId,parts=adapter.parts(),attempts=adapter.token.document.getFlag('foundry-creature-ai','conditionCaster');
 const facts={shield:Boolean(fireShield(actor)&&!actor.attributes.shield?.raised),shieldId:id==='lich'?'lich:shield':id.startsWith('vampire-')?'vampire:raise-shield':'dragon:shield',
  stare:id==='dero-magister',stareUsed:attempts?.combatId===game.combat.id&&attempts.stareRound===game.combat.round,stareDC:parts.entry?.statistic?.dc.value};
 if(id.startsWith('vampire-')){
  const sizes=['tiny','sm','med','lg','huge','grg'];
  Object.assign(facts,{vampire:true,elevation:adapter.token.document.elevation,missingHP:actor.hitPoints.max-actor.hitPoints.value,ammunition:adapter.ammunition(),
   elevations:Object.fromEntries(state.enemies.map(e=>[e.id,e.awareness?.position?.elevation??adapter.perceivedTarget(e).document.elevation])),
   canGrab:Object.fromEntries(state.enemies.map(e=>[e.id,sizes.indexOf(canvas.tokens.get(e.id).actor.size)<=sizes.indexOf(actor.size)+1])),
   grabStrikes:parts.native.filter(s=>(s.item.attackEffects??s.item.system.attackEffects?.value??[]).includes('grab')).map(s=>s.item.id),
   gear:Object.fromEntries(parts.native.filter(s=>s.item.linkedWeapon).map(s=>[s.item.id,{weapon:s.item.linkedWeapon.id,other:parts.native.find(other=>other.item.linkedWeapon&&other.item.linkedWeapon!==s.item.linkedWeapon&&other.item.linkedWeapon.system.equipped.carryType==='held')?.item.linkedWeapon.id}]))});
 }
 return facts;
}

// Copy only prepared knowledge. Never serialize an Actor, Document, rendering
// object, hidden-roll record, or a method that could reach the live world.
export function planningData(value,path='state',seen=new Map()){
 if(value==null||['string','number','boolean'].includes(typeof value))return value;
 if(typeof value!=='object')throw new Error(`Non-data planning value at ${path}`);
 if(seen.has(value))return seen.get(value);
 if(Array.isArray(value)){const copy=[];seen.set(value,copy);for(let i=0;i<value.length;i++)copy.push(planningData(value[i],`${path}[${i}]`,seen));return copy;}
 if(value instanceof Set)return [...value].map(v=>planningData(v,path,seen));
 if(value instanceof Map)return Object.fromEntries([...value].map(([k,v])=>[k,planningData(v,path+'.'+k,seen)]));
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw new Error(`Live planning object at ${path}`);
 const copy={};seen.set(value,copy);for(const [key,item]of Object.entries(value)){
  if(path==='state.pit'&&key==='region')continue;
  copy[key]=planningData(item,path+'.'+key,seen);
 }return copy;
}

export function decisionModel(adapter,state){
 const id=adapter.profileId,caster=adapter.hasSpellcasting&&id!=='goblin-pyro',nativeCaster=['spellcaster','dero-magister','lich','cinder-dragon','cinder-dragon-caster'].includes(id)||id.startsWith('vampire-');
 return {profileId:id,kind:nativeCaster?'caster':['wolf','ogre','ogre-boss','kobold-scout','goblin-pyro'].includes(id)?id:'basic',casterAddon:caster&&!nativeCaster,
  extra:state.mistEscape||state.confusion||state.fleeing||!nativeCaster?{}:profileActionFacts(adapter,state),
  bonusKinds:taughtBuffs(adapter.actor).includes('haste')&&adapter.actor.hasCondition('quickened')?['strike','stride']:adapter.movementBonusAvailable()?['step','stride']:[],
  escapeConfigured:state.escapeBlocked&&escapeBindings(adapter.actor).length>0,
  unavailable:adapter.unavailableStrikes?.(state)??[]};
}
