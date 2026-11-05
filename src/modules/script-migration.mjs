import {MODULE_ID} from '../foundry/rules-context.mjs';
import {ENVIRONMENT_SCRIPT,HAZARD_SCRIPT} from '../foundry/terrain-contract.mjs';
import {GREASE_SCRIPT} from '../foundry/spell-zones.mjs';
const scripts=new Map([
 ["game.modules.get('foundry-creature-ai')?.api?.zones?.refresh?.();",ENVIRONMENT_SCRIPT],
 ["await game.modules.get('foundry-creature-ai')?.api?.terrain?.onHazardMove(event, region, behavior);",HAZARD_SCRIPT],
 ["await game.modules.get('foundry-creature-ai')?.api?.spells?.refresh?.();",GREASE_SCRIPT],
]);
export async function migrateRegionScripts(){
 if(game.users?.activeGM?.id!==game.user?.id)return;
 for(const scene of game.scenes?.contents??[])for(const region of scene.regions?.contents??[]){
  const changes=(region.behaviors?.contents??[]).filter(behavior=>behavior.type==='executeScript'&&behavior.flags?.[MODULE_ID]&&scripts.has(behavior.system?.source))
   .map(behavior=>({_id:behavior.id,'system.source':scripts.get(behavior.system.source)}));
  if(changes.length)await region.updateEmbeddedDocuments('RegionBehavior',changes);
 }
}
