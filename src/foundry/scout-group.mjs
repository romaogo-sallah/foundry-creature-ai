import { clearAttackPath, clearSightPath } from './attack-path.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { incapacitationReason } from './combat-state.mjs';

const ns='foundry-creature-ai';
const held=(item,hands=1)=>item.system?.equipped?.carryType==='held'&&item.system.equipped.handsHeld>=hands;
export function scoutGroup(adapter,state){
  const combat=game.combat,roster=new Set(Array.from(combat.combatants??[]).map(c=>c.tokenId));
  const allies=canvas.tokens.placeables.filter(ally=>ally!==adapter.token&&roster.has(ally.id)&&ally.actor&&adapter.actor.isAllyOf(ally.actor)&&
    ally.actor.canAttack&&!ally.document.hidden&&!incapacitationReason(ally)&&
    ally.document.elevation===adapter.token.document.elevation&&ally.document.level===adapter.token.document.level&&
    detectionFor(adapter.token,ally).state==='observed'&&clearSightPath(adapter.token,ally));
  const scouts=allies.flatMap(ally=>{
    const config=ally.document.getFlag?.(ns,'config');if(!config?.enabled)return [];
    const weapons=ally.actor.itemTypes?.weapon??[],bow=weapons.find(w=>w.system.baseItem==='crossbow'),sword=weapons.find(w=>w.system.baseItem==='shortsword');
    if(!bow||!sword||!ally.actor.itemTypes.action?.some(a=>a.slug==='sneak-attack'))return [];
    const bolts=(ally.actor.itemTypes.ammo??[]).find(a=>a.system.baseItem==='bolts')?.system.quantity??0;
    return [{token:ally,ranged:held(bow,2)&&bolts>0,speed:ally.actor.system.movement?.speeds?.land?.value??ally.actor.system.attributes?.speed?.value??25}];
  });
  const turns=Array.from(combat.turns??combat.combatants),selfIndex=turns.findIndex(c=>c.tokenId===adapter.token.id);
  const next=id=>{const index=turns.findIndex(c=>c.tokenId===id);return selfIndex<0||index<0?Infinity:(index-selfIndex+turns.length)%turns.length||turns.length;};
  const knowledge=new Map(state.enemies.map(enemy=>[enemy.id,enemy.awareness?.state==='known-square'
    ?null:canvas.tokens.get(enemy.id)]));
  const targets={};
  for(const enemy of state.enemies){
    const target=knowledge.get(enemy.id);if(!target)continue;
    const nearbyHostiles=state.enemies.some(other=>other.id!==enemy.id&&(()=>{
      const otherTarget=knowledge.get(other.id);
      // A known but unobserved opponent is not silently declared too far away.
      return !otherTarget||target.distanceTo(otherTarget)<=Math.max(30,(other.threat?.speed??25)+(other.threat?.reach??5));
    })());
    const close=scouts.filter(ally=>ally.token.distanceTo(target)<=ally.speed+5&&clearSightPath(ally.token,target)&&clearAttackPath(ally.token,target));
    const engaged=close.filter(ally=>ally.token.canFlank(target)&&
      ally.token.distanceTo(target,{reach:ally.token.actor.getReach({action:'attack'})})<=ally.token.actor.getReach({action:'attack'}));
    const arriving=close.filter(ally=>!engaged.includes(ally)&&next(ally.token.id)<next(enemy.id));
    const helpers=engaged.length+arriving.length;
    const rangedSupport=scouts.filter(ally=>ally.ranged&&ally.token.distanceTo(target)<=720&&
      clearSightPath(ally.token,target)&&clearAttackPath(ally.token,target)).length;
    targets[enemy.id]={swarm:!nearbyHostiles&&!state.seek?.suspectedOpponents&&Boolean(enemy.flankable)&&
      (engaged.length>0||arriving.length>=2),helpers,engaged:engaged.length,arriving:arriving.length,rangedSupport};
  }
  return {rangedCount:1+scouts.filter(s=>s.ranged).length,targets};
}
