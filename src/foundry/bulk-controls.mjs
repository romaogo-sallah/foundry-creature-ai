import {createCreatureAdapter} from './creature-profiles.mjs';
import {targetingMode} from './targeting.mjs';
const ns='foundry-creature-ai';
export async function enableSelectedFullAuto({tokens=canvas.tokens.controlled,reactions}={}){
  if(!game.user?.isGM||game.users.activeGM?.id!==game.user.id)throw new Error('Enable full automation as the active GM');
  if(!canvas.ready)throw new Error('View the scene first');
  if(!tokens?.length)throw new Error('Select the NPC tokens to enable first');
  const report={enabled:[],skipped:[],errors:[]};
  for(const token of new Set(tokens)){
    const document=token.document;
    const reason=token.actor?.type!=='npc'?'only NPC tokens support Creature AI':document?.parent?.id!==canvas.scene.id?'not in the viewed scene':
      document.actorLink||document.isLinked?'linked actor; use an unlinked NPC token':null;
    if(reason){report.skipped.push({id:token.id,name:token.name,reason});continue;}
    try{
      const config=document.getFlag(ns,'config')??{};
      createCreatureAdapter(token,null,{reactions}).parts();
      if(targetingMode(token.actor,config)==='manual'&&!config.targetIds?.length)throw new Error('Assign manual targets in Alt+W first');
      await document.setFlag(ns,'config',{applyDamage:true,...config,enabled:true,autoRun:true,autoAdvance:true});
      report.enabled.push({id:token.id,name:token.name});
    }catch(error){report.errors.push({id:token.id,name:token.name,reason:error.message});}
  }
  return report;
}
