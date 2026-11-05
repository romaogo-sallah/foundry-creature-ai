import { terrainBehavior, TERRAIN_NAMESPACE as namespace } from './terrain-contract.mjs';
import { averageFormula } from '../framework/math.mjs';
import { REQUESTED_MOVEMENT } from './movement-options.mjs';
import { requestedMovementPath } from './movement-request.mjs';
import { surfaceMovementPath } from './surface-terrain.mjs';

const progress=new Map(),actions=new Map();
const processed=new WeakMap();
const excludedMethods=new Set(['undo','paste','config','hud']);
const excludedActions=new Set(['displace','fly','burrow']);
const waypointKeys=['x','y','elevation','width','height','depth','shape','level','action','snapped','explicit','checkpoint'];
export function beginTerrainAction(token,key){actions.set(token.document.uuid,key);}
export function endTerrainAction(token){actions.delete(token.document.uuid);}

export function hazardSettings(region){
  if(region.hidden)return [];
  return (region.behaviors?.contents??[]).filter(b=>!b.disabled&&terrainBehavior(b,'hazard')).map(behavior=>{
    const data=behavior.flags[namespace].terrain;
    return {behavior,...data,averageDamage:averageFormula(data.formula)};
  });
}

export function touchesHazard(token,region,position){
  const document=token.document??token,grid=document.parent.grid??canvas.grid;
  if(document.testInsideRegion)return document.testInsideRegion(region,position);
  if(region.levels?.size&&!region.levels.has(position.level??document.level))return false;
  const elevation=position.elevation??document.elevation;
  for(let x=0;x<(document.width??1);x++)for(let y=0;y<(document.height??1);y++){
    const point={x:position.x+(x+0.5)*grid.size,y:position.y+(y+0.5)*grid.size,elevation:elevation+0.01};
    if(region.testPoint(point))return true;
  }
  return false;
}

export function hazardousAt(token,position){
  const scene=(token.document??token).parent;
  return (scene.regions?.contents??[]).filter(region=>hazardSettings(region).length&&touchesHazard(token,region,position));
}
export function terrainRiskForPath(token,path,waypoint){
  let damage=0;
  const once=new Set();
  for(const cell of path.slice(1))for(const region of hazardousAt(token,waypoint(cell)))for(const settings of hazardSettings(region)){
    const key=`${region.id}:${settings.behavior.id}`;
    if(settings.frequency==='entry'&&once.has(key))continue;
    once.add(key);damage+=settings.averageDamage;
  }
  return damage;
}

function hazardSquare(document,point){
  const grid=document.parent.grid??canvas.grid,source=document._source??document;
  const size=document.getSize?.(point)??{width:(point.width??source.width??1)*grid.size,height:(point.height??source.height??1)*grid.size};
  const offset=grid.getOffset({x:point.x+Math.min(size.width,grid.sizeX??grid.size)/2,y:point.y+Math.min(size.height,grid.sizeY??grid.size)/2});
  return `${point.level??source.level}:${point.elevation??source.elevation}:${offset.i}:${offset.j}`;
}

// Native MOVE_WITHIN checkpoints normally exist only at boundaries/endpoints.
// Insert ordinary checkpoints for each hazardous grid step before Foundry
// finalizes the movement, preserving native walls, cost and reaction workflows.
export function hazardousMovementPath(document,waypoints,options={}){
  const scene=document.parent,grid=scene?.grid??globalThis.canvas?.grid,source=document._source??document;
  if(!scene||!document.actor?.isOfType?.('creature')||options.isUndo||options.isPaste||options.teleport||options.planned||
    excludedMethods.has(options.method)||grid?.type!==1||grid.distance!==5||!document.getCompleteMovementPath||!waypoints?.length)return null;
  const hazards=(scene.regions?.contents??[]).filter(region=>hazardSettings(region).length);
  if(!hazards.length)return null;
  const origin=Object.fromEntries(waypointKeys.filter(key=>key in source).map(key=>[key,source[key]]));
  origin.action=document.movementAction??'walk';
  const complete=document.getCompleteMovementPath([origin,...waypoints]);
  if(complete.some(point=>['width','height','depth','shape','level','elevation'].some(key=>point[key]!==undefined&&source[key]!==undefined&&point[key]!==source[key])))return null;
  let changed=false;
  const path=complete.slice(1).map(point=>{
    const hazardous=!excludedActions.has(point.action)&&hazards.some(region=>touchesHazard(document,region,point));
    const copy=Object.fromEntries(waypointKeys.filter(key=>key in point).map(key=>[key,point[key]]));
    if(hazardous){copy.checkpoint=true;changed=true;}
    return copy;
  });
  if(changed&&complete.length>1024)throw new Error('Split this hazardous movement into shorter paths');
  return changed?path:null;
}

export function installHazardMovement(){
  libWrapper.register(namespace,'CONFIG.Token.documentClass.prototype._preUpdate',function(wrapped,changed,options,user){
    const instruction=options.movement?.[this.id];
    let points=instruction?.waypoints??(('x' in changed||'y' in changed)?[{...changed}]:null);
    if(points){
      const surface=surfaceMovementPath(this,points,{...options,method:instruction?.method??options.method,planned:instruction?.planned??options.planned});
      if(surface){
        // These turns in the slope are required route corners. Foundry drops
        // intermediate-only waypoints when continuing a native movement.
        points=surface.slice(1).map(point=>({...point,intermediate:false}));
        options.movement??={};options.movement[this.id]={...instruction,waypoints:points};
        options[REQUESTED_MOVEMENT]=surface;
      }
      // Also preserve paths that cross ordinary cover/concealment or difficult
      // terrain. Native region boundary points are not user snapping errors.
      options[REQUESTED_MOVEMENT]??=requestedMovementPath(this,points);
      const path=hazardousMovementPath(this,points,{...options,method:instruction?.method??options.method,planned:instruction?.planned??options.planned});
      if(path){
        options.movement??={};options.movement[this.id]={...instruction,waypoints:path};
      }
    }
    return wrapped(changed,options,user);
  },'WRAPPER');
}

export function hazardUnits(event,region,behavior,actionKey){
  const {token,movement}=event.data,settings=behavior.flags[namespace].terrain;
  if(!movement?.id||!movement.passed?.waypoints.length||excludedMethods.has(movement.method))return 0;
  const document=token.document??token,grid=document.parent.grid??canvas.grid;
  if(grid.type===1&&grid.distance===5){
    const origin={...(document._source??document),...movement.origin};
    const stamp=JSON.stringify([movement.id,...[origin,...movement.passed.waypoints].map(point=>[point.x,point.y,point.elevation,point.level,point.action])]);
    const identity=`${token.uuid}:${region.id}:${behavior.id}`,seen=processed.get(movement)??new Map();
    if(seen.get(identity)===stamp)return 0;
    seen.set(identity,stamp);processed.set(movement,seen);
    const key=`${identity}:${actionKey??movement.subpathId??movement.id}`;
    const record=progress.get(key)??{hits:0};progress.set(key,record);
    let square=hazardSquare(document,origin),inside=touchesHazard(document,region,origin),units=0;
    for(const raw of movement.passed.waypoints){
      const point={...origin,...raw},next=hazardSquare(document,point),entered=touchesHazard(document,region,point);
      if(entered&&(next!==square||!inside)&&!excludedActions.has(point.action??document.movementAction??'walk'))units++;
      square=next;inside=entered;
    }
    if(settings.frequency!=='per5')units=units&&record.hits===0?1:0;
    record.hits+=units;
    if(progress.size>500)progress.delete(progress.keys().next().value);
    return units;
  }
  if(movement.passed.waypoints.some(p=>excludedActions.has(p.action)))return 0;
  if(!touchesHazard(document,region,{...(document._source??document),...movement.passed.waypoints.at(-1)}))return 0;
  const distance=movement.passed.distance;
  if(!Number.isFinite(distance)||distance<0)throw new Error('Cannot measure hazardous terrain movement');
  const key=`${token.uuid}:${region.id}:${behavior.id}:${actionKey??movement.subpathId??movement.id}`;
  let record=progress.get(key);
  if(!record){record={moveId:movement.id,lastDistance:0,distance:0,hits:0,notified:false};progress.set(key,record);}
  if(record.moveId!==movement.id){record.moveId=movement.id;record.lastDistance=0;}
  // MOVE_IN is a native boundary checkpoint: the preceding distance was
  // outside. MOVE_WITHIN then reports movement through, and out of, the area.
  if(event.name==='tokenMoveIn')record.lastDistance=distance;
  else{record.distance+=Math.max(0,distance-record.lastDistance);record.lastDistance=distance;}
  const total=settings.frequency!=='per5'?1:Math.max(1,Math.ceil((record.distance-1e-7)/5));
  const units=Math.max(0,total-record.hits);record.hits=total;
  if(progress.size>500){const oldest=progress.keys().next().value;if(oldest!==key)progress.delete(oldest);}
  return units;
}

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function createHazardHandler({resolve=fn=>fn(),onPause=()=>{}}={}){
  return function onHazardMove(event,region,behavior){
    if(!['tokenMoveIn','tokenMoveWithin'].includes(event.name)||event.user?.id!==game.user.id || behavior.disabled || region.hidden)return;
    const {token,movement}=event.data,settings=behavior.flags[namespace].terrain;
    const units=hazardUnits(event,region,behavior,actions.get(token.uuid));
    if(!units||!token.actor?.isOfType?.('creature')||token.actor.hitPoints?.value<=0)return;
    // Pause synchronously, before the first await. Native movement must not
    // continue through a long drag while damage is still resolving.
    const resume=token.pauseMovement?.();let stopped=false;
    return resolve(async()=>{
      try{
        // The document reaches the checkpoint before its sprite animation.
        // Wait for that arrival while movement and the AI barrier stay paused.
        await (movement.animation?.ended??token.object?.movementAnimationPromise);
        if(!['entry','per5'].includes(settings.frequency)){
          onPause();stopped=true;await token.stopMovement?.();
          await ChatMessage.create({whisper:ChatMessage.getWhisperRecipients('GM').map(user=>user.id),
            content:`<p>${escape(token.name)} entered ${escape(region.name)}: resolve ${escape(settings.formula)} ${escape(settings.damageType)} damage manually. Movement is stopped; the action remains spent.</p>`});return;
        }
        if(units>50)throw new Error('Hazard movement exceeds the automatic damage limit; resolve it manually');
        averageFormula(settings.formula);
        if(!['piercing','slashing','bludgeoning','acid','cold','electricity','fire','poison','sonic'].includes(settings.damageType))throw new Error('Unsupported hazardous-terrain damage type');
        const DamageRoll=CONFIG.Dice.rolls.find(type=>type.name==='DamageRoll');
        if(!DamageRoll)throw new Error('PF2e DamageRoll is unavailable');
        for(let i=0;i<units;i++){
          if(token.parent.id!==canvas.scene.id||token.actor.hitPoints.value<=0)break;
          const damage=await new DamageRoll(`(${settings.formula})[${settings.damageType}]`).evaluate();
          await damage.toMessage({speaker:ChatMessage.getSpeaker({token}),flavor:`${escape(region.name)} — hazardous terrain`,
            flags:{[namespace]:{terrainDamage:true},'xdy-pf2e-workbench':{noAutoDamageRoll:true},pf2e:{suppressDamageButtons:true,
              context:{options:['skip-handling-message',`${namespace}:terrain-damage`]}}}});
          await token.actor.applyDamage({damage,token,item:null,rollOptions:new Set([...(token.actor.getSelfRollOptions?.()??[]),'hazardous-terrain']),outcome:'success'});
        }
        if(token.actor.hitPoints.value<=0){stopped=true;await token.stopMovement?.();}
      }catch(error){stopped=true;onPause();await token.stopMovement?.();throw error;}
      finally{if(!stopped && token.movement?.id===movement.id)await resume?.();}
    });
  };
}
