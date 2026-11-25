import {playerSneakSpeed} from './player-stealth.mjs';
import {MOVEMENT_ID} from './rules-context.mjs';
import {landSpeed} from './flight-costs.mjs';

// Register during init so Foundry normalizes the descriptors and accepts them
// in TokenDocument.movementAction. Native terrain always derives from walking.
export function registerMovementModes(actions=CONFIG.Token?.movement?.actions){
  if(!actions)return;
  const walking=document=>document.actor?.isOfType?.('creature')&&!document.actor.hasCondition('prone','immobilized','grabbed','restrained');
  actions.step??={label:'Step',icon:'fa-solid fa-shoe-prints',order:0.1,terrainAction:'walk',
    canSelect:document=>walking(document)&&landSpeed(document.actor)>=10};
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

export function sneakActionCost(actor,cost){
  const budget=playerSneakSpeed(actor);
  if(!(budget>0)||!(cost>0))return null;
  const actual=Math.ceil((cost-1e-8)/budget);
  return {actions:Math.min(3,Math.max(1,actual)),overage:actual>3};
}

export function decorateSneakRulerContext(context,waypoint,actor){
  if(!context||waypoint?.action!=='sneak')return context;
  const actionCost=sneakActionCost(actor,waypoint.measurement?.cost);
  if(actionCost)context.actionCost=actionCost;
  return context;
}

export function installSneakRulerLabels({packageId=MOVEMENT_ID}={}){
  libWrapper.register(packageId,'CONFIG.Token.rulerClass.prototype._getWaypointLabelContext',function(wrapped,waypoint,state){
    return decorateSneakRulerContext(wrapped(waypoint,state),waypoint,this.token?.actor);
  },'WRAPPER');
}
