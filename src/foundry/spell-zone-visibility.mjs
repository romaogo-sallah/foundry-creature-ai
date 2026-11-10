const ns='foundry-creature-ai';
export const spellZoneVisibility=()=>globalThis.CONST?.REGION_VISIBILITY?.ALWAYS??2;
const owned=region=>['spellZone','lingeringFire','obscuring','weather','iceWall'].some(key=>region.flags?.[ns]?.[key]);
export async function refreshSpellZoneVisibility(scene=globalThis.canvas?.scene){
 if(!scene||game.users.activeGM?.id!==game.user.id)return;
 const modes=globalThis.CONST?.REGION_VISIBILITY??{LAYER:0,LAYER_UNLOCKED:4};
 const updates=(scene.regions?.contents??[]).filter(r=>owned(r)&&!r.hidden&&
  (r.visibility==null||[modes.LAYER,modes.LAYER_UNLOCKED].includes(r.visibility))).map(r=>({_id:r.id,visibility:spellZoneVisibility()}));
 if(updates.length)await scene.updateEmbeddedDocuments('Region',updates);
}
export function installSpellZoneVisibility({onError}){
 Hooks.on('canvasReady',()=>{void refreshSpellZoneVisibility().catch(onError);});
 if(canvas.ready)void refreshSpellZoneVisibility().catch(onError);
}
