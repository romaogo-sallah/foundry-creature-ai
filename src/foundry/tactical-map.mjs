import {buildTacticalField,cellKey} from '../framework/tactical-field.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
import {clearSightPath} from './attack-path.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {terrainMovementPath} from './movement-regions.mjs';

const ns='foundry-creature-ai';
export function scoutTacticalMap(adapter,state){
  if(adapter.token.document.width!==1||adapter.token.document.height!==1)return null;
  const rect=canvas.dimensions.sceneRect,size=canvas.grid.size,origin=state.self.cell;
  if(!Number.isFinite(rect.width)||!Number.isFinite(rect.height))return null;
  let first=adapter.cell({x:rect.x+1,y:rect.y+1}),last=adapter.cell({x:rect.x+rect.width-1,y:rect.y+rect.height-1});
  const cropped=(last.x-first.x+1)*(last.y-first.y+1)>4096;
  if(cropped){const radius=Math.max(12,Math.min(24,Math.ceil(adapter.groundSpeed()/5)*3));
    first={x:Math.max(first.x,origin.x-radius),y:Math.max(first.y,origin.y-radius)};
    last={x:Math.min(last.x,origin.x+radius),y:Math.min(last.y,origin.y+radius)};}
  const scene=canvas.scene,walls=scene.walls?.contents,regions=scene.regions?.contents??[];
  const geometryKey=JSON.stringify([scene.id,adapter.token.document.elevation,adapter.token.document.level,first,last,
    walls?.map(w=>[w.id,w.c,w.move,w.dir,w.ds,w._stats?.modifiedTime,w.flags]),
    regions.map(r=>[r.id,r._source?.shapes??r.shapes,r._stats?.modifiedTime,r.flags,
      (r.behaviors?.contents??[]).map(b=>[b.disabled,b.type,b._stats?.modifiedTime,b.flags,b.system?.movement])])]);
  let graph=walls&&adapter.tacticalGeometry?.key===geometryKey?adapter.tacticalGeometry.graph:null;
  if(!graph){graph=new Map();
    for(let x=first.x;x<=last.x;x++)for(let y=first.y;y<=last.y;y++)graph.set(`${x},${y}`,{x,y,edges:[]});
    for(const node of graph.values())for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
      if(!dx&&!dy)continue;const next={x:node.x+dx,y:node.y+dy},to=cellKey(next);if(!graph.has(to))continue;
      if(adapter.token.constrainMovementPath([adapter.waypoint(node),adapter.waypoint(next)],{ignoreWalls:false,ignoreCost:true})[1])continue;
      const measured=adapter.token.measureMovementPath(terrainMovementPath(adapter.token,[adapter.waypoint(node),adapter.waypoint(next)])).cost;
      if(!Number.isFinite(measured)||measured<=0)continue;
      graph.get(cellKey(node)).edges.push({to,cost:measured*(dx&&dy?1.5:1)});
    }
    // Keep the same no-corner-cutting rule as actual AI movement.
    for(const node of graph.values())node.edges=node.edges.filter(edge=>{const to=graph.get(edge.to);
      return to.x===node.x||to.y===node.y||node.edges.some(e=>e.to===`${to.x},${node.y}`)&&node.edges.some(e=>e.to===`${node.x},${to.y}`);});
    adapter.tacticalGeometry={key:geometryKey,graph};
  }
  const occupancy=[];
  for(const token of canvas.tokens.placeables){
    if(token===adapter.token||!occupiesMovementSpace(token)||token.document.hidden||token.document.level!==adapter.token.document.level||
      token.document.elevation!==adapter.token.document.elevation)continue;
    if(token.actor?.isOfType?.('creature')&&(detectionFor(adapter.token,token).state!=='observed'||!clearSightPath(adapter.token,token)))continue;
    if(token.actor&&!clearSightPath(adapter.token,token))continue;
    occupancy.push({id:token.id,cell:adapter.cell(token.document),width:token.document.width,height:token.document.height,
      passable:Boolean(token.actor?.isAllyOf?.(adapter.actor))});
  }
  const threats=state.enemies.flatMap(enemy=>{
    const position=enemy.awareness?.position;if(!position)return [];
    return [{id:enemy.id,cell:adapter.cell(position),width:position.width,height:position.height,
      speed:enemy.threat?.speed??25,reach:enemy.threat?.reach??5}];
  });
  const cacheKey=JSON.stringify([geometryKey,origin,adapter.groundSpeed(),threats,occupancy]);
  if(walls&&adapter.tacticalCache?.key===cacheKey)return adapter.tacticalCache.field;
  const local=new Map([...graph].map(([id,node])=>{
    const occupied=occupancy.filter(o=>node.x>=o.cell.x&&node.x<o.cell.x+o.width&&node.y>=o.cell.y&&node.y<o.cell.y+o.height);
    return [id,{...node,passable:occupied.every(o=>o.passable),stoppable:occupied.length===0}];
  }));
  const radius=Math.ceil((adapter.groundSpeed()+5)/5);
  // Sampling does not depend on live hidden-token collisions in native route
  // generation. A remembered opponent moving secretly cannot change this field.
  const needed=[...local.values()].filter(cell=>Math.max(Math.abs(cell.x-origin.x),Math.abs(cell.y-origin.y))<=radius);
  const field=buildTacticalField(local,{origin,threats,speed:adapter.groundSpeed(),needed});
  field.cropped=cropped;field.bounds={first,last};field.threats=threats;field.round=game.combat.round;field.sceneId=scene.id;
  field.barriers=[];
  for(const node of graph.values())for(const [dx,dy]of [[1,0],[0,1]]){
    const to=`${node.x+dx},${node.y+dy}`;
    if(graph.has(to)&&!node.edges.some(e=>e.to===to))field.barriers.push(dx?
      [node.x+1,node.y,node.x+1,node.y+1]:[node.x,node.y+1,node.x+1,node.y+1]);
  }
  adapter.lastTacticalMap=field;adapter.tacticalCache={key:cacheKey,field};
  return field;
}

export function scoutMotionMemory(adapter){
  const saved=adapter.token.document.getFlag(ns,'scoutMotion');
  return saved?.combatId===game.combat.id&&saved.sceneId===canvas.scene.id?(saved.entries??[]).filter(e=>e.round>=game.combat.round-2):[];
}
