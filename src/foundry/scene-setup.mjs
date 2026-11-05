const namespace='foundry-creature-ai';

// Compare just the annotations/geometry used in the prepared plan. Unrelated
// scene changes (tokens, initiative, HP, journal edits) never get overwritten.
export function sourceSignature(document,kind) {
  const d=document.toObject?.()??document;
  const keys=kind==='notes'?['_id','x','y','elevation','levels','text','entryId','pageId']:
    kind==='drawings'?['_id','x','y','elevation','levels','rotation','shape']:
      ['_id','x','y','width','height','elevation','levels','rotation','texture'];
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return JSON.stringify(canonical(Object.fromEntries(keys.map(key=>[key,key==='texture'?d.texture?.src??null:key==='levels'?[...(d.levels??[])].sort():d[key]??null]))));
}

export async function applySceneSetup(plan,{scene=game.scenes.get(plan.sceneId)}={}) {
  if(!game.user.isGM || game.users.activeGM?.id!==game.user.id)throw new Error('Only the active GM can install a scene terrain setup');
  if(game.world.id!==plan.worldId || !scene || scene.id!==plan.sceneId || !scene.active)throw new Error('The prepared terrain setup does not match the active world/scene');
  const finished=scene.getFlag(namespace,'sceneSetups')??[];
  if(finished.some(entry=>entry.id===plan.id))return {alreadyApplied:true,created:0};
  for(const source of plan.sources){
    const document=scene[source.kind]?.get(source.id);
    if(!document || sourceSignature(document,source.kind)!==source.signature)throw new Error(`Terrain source changed: ${source.kind} ${source.id}. Refresh the setup plan before applying.`);
  }
  const existing=new Set(scene.regions.contents.filter(region=>region.flags?.[namespace]?.sceneSetup?.id===plan.id).map(region=>region.flags[namespace].sceneSetup.key));
  const pending=plan.regions.filter(region=>!existing.has(region.flags[namespace].sceneSetup.key));
  const created=pending.length?await scene.createEmbeddedDocuments('Region',structuredClone(pending)):[];
  await scene.setFlag(namespace,'sceneSetups',[...finished,{id:plan.id,createdAt:Date.now(),regions:plan.regions.length}]);
  return {created:created.length,total:plan.regions.length};
}

