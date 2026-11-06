const ns='foundry-creature-ai';
import {installFascinationSources} from './fascination-sources.mjs';
export async function breakFascination(victim){
  if(game.users.activeGM?.id!==game.user.id||!victim)return [];
  const actors=new Set((canvas.tokens?.placeables??[]).map(token=>token.actor).filter(actor=>actor&&
    (actor===victim||actor.isAllyOf?.(victim))&&actor.hasCondition?.('fascinated'))),removed=[];
  for(const actor of actors)for(const condition of actor.getCondition('fascinated',{all:true})??[]){
    // Granted/locked conditions and explicit spell exceptions require their
    // owning effect resolver. Never delete a whole parent spell by guessing.
    if(!condition.id||condition.isLocked||condition.readonly||condition.inMemoryOnly||condition.getFlag?.(ns,'ignoreHostileAction'))continue;
    await actor.decreaseCondition(condition,{forceRemove:true});removed.push(actor.uuid);
  }
  return removed;
}
export function installFascination({reactions,onError}){
  installFascinationSources({reactions,onError});
  Hooks.on('createChatMessage',message=>{
    if(game.users.activeGM?.id!==game.user.id||message.flags?.pf2e?.context?.type!=='attack-roll'||message.isReroll)return;
    const target=message.target?.actor,uuid=message.flags.pf2e.context.target?.token;
    if(!target&&!uuid)return;
    void reactions.resolve(async()=>breakFascination(target??(await fromUuid(uuid))?.actor)).catch(onError);
  });
}
