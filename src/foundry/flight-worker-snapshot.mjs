import {flightBounds} from './flight-surfaces.mjs';
import {tokenHeight} from './vertical-geometry.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
import {clearSightPath} from './attack-path.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {perceivedFlightTarget} from './flight-movement.mjs';
import {flySpeed} from './flight-costs.mjs';
import {flightThreats} from './flight-safety.mjs';
import {sceneLevels} from './vertical-space.mjs';

function polygon(shape,size){
  if(shape.type==='polygon'){
    const points=shape.points??[];
    return Array.from({length:Math.floor(points.length/2)},(_,i)=>({x:points[i*2]/size,y:points[i*2+1]/size}));
  }
  const {x=0,y=0,width=0,height=0,rotation=0}=shape,cx=x+width/2,cy=y+height/2,angle=rotation*Math.PI/180;
  const points=shape.type==='ellipse'?Array.from({length:16},(_,i)=>[Math.cos(i*Math.PI/8)*width/2,Math.sin(i*Math.PI/8)*height/2]):
    [[-width/2,-height/2],[width/2,-height/2],[width/2,height/2],[-width/2,height/2]];
  return points.map(([dx,dy])=>({x:(cx+dx*Math.cos(angle)-dy*Math.sin(angle))/size,y:(cy+dx*Math.sin(angle)+dy*Math.cos(angle))/size}));
}

export function flightWorkerSnapshot(adapter,state){
  const size=canvas.grid.size,rect=canvas.dimensions.sceneRect,bounds=flightBounds(adapter.token),origin=state.flight.origin;
  const footprint={width:adapter.token.w/size,height:adapter.token.h/size,depth:tokenHeight(adapter.token)};
  const occupied=canvas.tokens.placeables.filter(t=>t!==adapter.token&&occupiesMovementSpace(t)&&!t.document.hidden&&
    detectionFor(adapter.token,t).state==='observed'&&clearSightPath(adapter.token,t))
    .map(t=>({x:t.document.x/size,y:t.document.y/size,elevation:t.document.elevation,width:t.w/size,height:t.h/size,
      depth:tokenHeight(t),passable:adapter.actor.isAllyOf(t.actor)}));
  const walls=(canvas.scene.walls?.contents??[]).filter(w=>w.move!==0&&w._source?.move!==0&&!(w.door>0&&w.ds===1))
    .flatMap(w=>{
      const c=w.c??w._source?.c;if(c?.length!==4)return [];
      const assigned=sceneLevels(canvas.scene,adapter.token.document.level).filter(l=>!w.levels?.size||w.levels.has?.(l.id));
      return assigned.length?assigned.map(l=>({x1:c[0]/size,y1:c[1]/size,x2:c[2]/size,y2:c[3]/size,
        low:l.elevation?.bottom??-Infinity,high:l.elevation?.top??Infinity})):[{x1:c[0]/size,y1:c[1]/size,x2:c[2]/size,y2:c[3]/size}];
    });
  const surfaces=[];
  for(const region of canvas.scene.regions?.contents??[])if(!region.hidden)for(const s of region.flags?.['foundry-creature-ai']?.iceWall?.segments??[])if(s.hp>0)
   for(const [x1,y1,x2,y2]of [[s.x,s.y,s.x+s.width,s.y],[s.x+s.width,s.y,s.x+s.width,s.y+s.height],[s.x+s.width,s.y+s.height,s.x,s.y+s.height],[s.x,s.y+s.height,s.x,s.y]])walls.push({x1:x1/size,y1:y1/size,x2:x2/size,y2:y2/size,low:s.bottom,high:s.top});
  for(const region of canvas.scene.regions?.contents??[]){
    if(region.hidden)continue;
    for(const behavior of region.behaviors?.contents??[])if(behavior.type==='defineSurface'&&!behavior.disabled&&behavior.system.move){
      const heights=[];
      if(behavior.system.placement!=='top')heights.push(region.elevation.bottom);
      if(behavior.system.placement!=='bottom')heights.push(region.elevation.top);
      for(const shape of region._source?.shapes??region.shapes??[]){
        if(shape.hole||!['rectangle','ellipse','polygon'].includes(shape.type))continue;
        const points=polygon(shape,size);if(points.length<3)continue;
        for(const elevation of heights)if(Number.isFinite(elevation))surfaces.push({elevation,points});
      }
    }
  }
  const air=state.flight.airCombat;
  const preferredElevation=air?(air.mode==='setup'?air.setupElevation:origin.elevation):state.flight.hunt?.preferredElevation??state.flight.preferredElevation??origin.elevation;
  const height=Math.min(preferredElevation,origin.elevation+Math.floor(state.flight.speed/10)*5);
  const goals=air?(air.mode==='disengage'?air.coverGoals:air.mode==='setup'?[{...origin,elevation:height},air.targetPosition]:[air.targetPosition]):[{...origin,elevation:height},...state.enemies.map(enemy=>{
    const p=perceivedFlightTarget(adapter,enemy).document;
    return {...adapter.cell(p),elevation:preferredElevation};
  })];
  if(air&&state.flight.safety?.safe===false&&air.mode!=='disengage')
    goals.push({...origin,elevation:Math.min(bounds.top,origin.elevation+Math.floor(state.flight.speed/10)*5)});
  // A low ceiling prevents the usual vertical retreat. Preserve lateral
  // escape goals so the bounded worker shortlist does not offer only overhead
  // squares that remain inside the conservative melee danger margin.
  if(!air&&state.flight.safety?.safe===false)for(const threat of flightThreats(adapter,state,e=>perceivedFlightTarget(adapter,e)).slice(0,2)){
    if(threat.safeElevation<=(state.flight.preferredElevation??bounds.top))continue;
    const cell=adapter.cell(threat.target.document),radius=Math.ceil((threat.reach+25)/5)+1;
    for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])goals.push({x:cell.x+dx*radius,y:cell.y+dy*radius,elevation:state.flight.preferredElevation??bounds.top});
  }
  const attackTargets=state.enemies.map(enemy=>{const t=perceivedFlightTarget(adapter,enemy);return {x:t.document.x/size,y:t.document.y/size,
    elevation:t.document.elevation,width:t.w/size,height:t.h/size,depth:tokenHeight(t)};});
  return {origin,footprint,budget:state.flight.speed,preferredElevation,airCombat:Boolean(air),occupied,walls,surfaces,goals,
    attackTargets:state.flight.ranged?[]:attackTargets,attackReach:adapter.planningReach(),
    limits:{left:Math.ceil(rect.x/size),right:Math.floor((rect.x+rect.width-adapter.token.w)/size),
      top:Math.ceil(rect.y/size),bottom:Math.floor((rect.y+rect.height-adapter.token.h)/size),low:bounds.bottom,high:bounds.top}};
}

// Authoritative freshness guard only. These unfiltered fields are never sent
// to the worker or used as an actor's knowledge of a hidden opponent.
export function flightWorldStamp(adapter){
  return JSON.stringify([adapter.turnKey(),game.paused,flySpeed(adapter.actor),adapter.actor.hitPoints?.value,
    sceneLevels(canvas.scene,adapter.token.document.level).map(l=>[l.id,l.elevation]),
    canvas.tokens.placeables.map(t=>[t.id,t.document.x,t.document.y,t.document.elevation,t.document.level,t.document.width,t.document.height,t.document.depth,
      t.actor?._stats?.modifiedTime,t.actor?.hitPoints?.value,t.document._stats?.modifiedTime,
      t.actor?.hasCondition?.('prone','immobilized','grabbed','restrained','unconscious','dying','dead','stunned'),
      t.actor?.getFlag?.('foundry-creature-ai','reaction'),
      (t.actor?.system.actions??[]).map(a=>[a.item?.id,a.totalModifier,a.ready,a.canAttack])]),
    (canvas.scene.walls?.contents??[]).map(w=>[w.id,w.ds,w._stats?.modifiedTime,w.c,w.move,w.dir]),
    (canvas.scene.regions?.contents??[]).map(r=>[r.id,r._stats?.modifiedTime,r.elevation,r.hidden,
      (r.behaviors?.contents??[]).map(b=>[b.id,b.disabled,b._stats?.modifiedTime])])]);
}
