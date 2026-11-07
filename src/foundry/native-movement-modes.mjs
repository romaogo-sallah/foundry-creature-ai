// Register during init so Foundry normalizes the descriptors and accepts them
// in TokenDocument.movementAction. Native terrain always derives from walking.
export function registerMovementModes(actions=CONFIG.Token?.movement?.actions){
  if(!actions)return;
  const walking=document=>document.actor?.isOfType?.('creature')&&!document.actor.hasCondition('prone','immobilized','grabbed','restrained');
  actions.step??={label:'Step',icon:'fa-solid fa-shoe-prints',order:0.1,terrainAction:'walk',
    canSelect:document=>walking(document)&&(document.actor.system.movement?.speeds.land?.value??
      document.actor.system.attributes?.speed?.total??0)>=10};
  actions.sneak??={label:'Sneak',icon:'fa-solid fa-user-ninja',order:0.2,terrainAction:'walk',
    canSelect:walking};
  actions.jump??={label:'Leap / Long Jump',icon:'fa-solid fa-person-running',order:0.3,terrainAction:'walk',canSelect:walking};
}

export function selectedGroundAction(document,points=[]){
  const actions=new Set(points.slice(1).map(point=>point.action).filter(Boolean));
  if(actions.size>1)throw new Error('Use one movement mode per action.');
  const mode=[...actions][0]??document.movementAction??'walk';
  return mode==='walk'?'stride':mode;
}
