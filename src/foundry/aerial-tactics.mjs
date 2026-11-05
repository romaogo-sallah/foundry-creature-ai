import {flySpeed} from './flight-costs.mjs';
import {isAirborne,floorBelow} from './flight-surfaces.mjs';
import {perceivedFlightTarget,flightPoint} from './flight-movement.mjs';
import {tokenAt,tokenHeight} from './vertical-geometry.mjs';
import {hidingFrom} from './stealth-awareness.mjs';
import {zoneConfig} from './environment-zones.mjs';
import {aerialAttackCandidates} from '../framework/spike-volley.mjs';

const ns='foundry-creature-ai';
export const aerialDistance=(a,b)=>Math.max(Math.abs(a.x-b.x)*5,Math.abs(a.y-b.y)*5)+
  Math.max(0,b.elevation-a.elevation)*2+Math.max(0,a.elevation-b.elevation)/2;

// These are goals, never teleport destinations. The worker proposes a bounded
// route and native geometry, terrain costs and observer-relative Hide eligibility
// validate it. Only the known target roster enters this knowledge model.
function protectedGoals(adapter,targets){
  const points=[],size=canvas.grid.size,rect=canvas.dimensions.sceneRect;
  for(const region of canvas.scene.regions?.contents??[]){
    const config=zoneConfig(region);
    if(region.hidden||!config||config.cover==='none'&&config.concealment==='none')continue;
    for(const shape of region._source?.shapes??region.shapes??[]){
      if(shape.hole)continue;
      const vertices=shape.type==='polygon'?Array.from({length:Math.floor((shape.points?.length??0)/2)},(_,i)=>({x:shape.points[i*2],y:shape.points[i*2+1]})):
        [{x:shape.x,y:shape.y},{x:shape.x+shape.width,y:shape.y+shape.height}];
      if(!vertices.length)continue;
      const left=Math.min(...vertices.map(p=>p.x)),right=Math.max(...vertices.map(p=>p.x)),top=Math.min(...vertices.map(p=>p.y)),bottom=Math.max(...vertices.map(p=>p.y));
      for(const fx of [0.25,0.5,0.75])for(const fy of [0.25,0.5,0.75])points.push({x:Math.round((left+(right-left)*fx-adapter.token.w/2)/size),
        y:Math.round((top+(bottom-top)*fy-adapter.token.h/2)/size)});
    }
  }
  // Wall ends can provide a retreat even without a declared cover zone.
  for(const wall of (canvas.scene.walls?.contents??[]).slice(0,32)){
    const c=wall.c??wall._source?.c;if(c?.length!==4)continue;
    for(const i of [0,2])for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]])points.push({x:Math.round(c[i]/size)+dx,y:Math.round(c[i+1]/size)+dy});
  }
  const unique=new Map();
  for(const cell of points){
    const p=flightPoint(adapter,cell);p.elevation=floorBelow(adapter.token,{...p,elevation:adapter.token.document.elevation});
    if(p.x<rect.x||p.y<rect.y||p.x+adapter.token.w>rect.x+rect.width||p.y+adapter.token.h>rect.y+rect.height)continue;
    const point={...cell,elevation:p.elevation},proxy=tokenAt(adapter.token,flightPoint(adapter,point));
    const protection=targets.filter(t=>hidingFrom(t,proxy).canHide).length/Math.max(1,targets.length);
    if(protection>0)unique.set(`${cell.x},${cell.y},${p.elevation}`,{...point,protection});
  }
  const origin={...adapter.originCell(),elevation:adapter.token.document.elevation};
  return [...unique.values()].sort((a,b)=>b.protection-a.protection||aerialDistance(origin,a)-aerialDistance(origin,b)).slice(0,4);
}

export function aerialTactics(adapter,state){
  const targets=state.enemies.map(enemy=>({enemy,target:perceivedFlightTarget(adapter,enemy)}))
    .filter(({target})=>flySpeed(target?.actor)>0&&isAirborne(target));
  if(!targets.length)return null;
  targets.sort((a,b)=>a.enemy.distance-b.enemy.distance||a.enemy.id.localeCompare(b.enemy.id));
  const saved=adapter.token.document.getFlag(ns,'aerialPlan');
  const {enemy,target}=targets.find(t=>saved?.combatId===game.combat.id&&t.enemy.id===saved.targetId)??targets[0];
  const speed=state.flight.speed,opponentSpeed=flySpeed(target.actor),origin=state.flight.origin;
  const previous=saved?.combatId===game.combat.id&&saved.targetId===enemy.id?saved:null;
  const ownReach=adapter.planningReach()??5;
  const rise=Math.max(0,target.document.elevation-origin.elevation-tokenHeight(adapter.token)-ownReach+5);
  const closingCost=Math.max(0,enemy.distance-ownReach)+rise;
  const reachable=closingCost<=Math.max(0,state.actionsRemaining-1)*speed;
  const shots=state.flight.ranged&&aerialAttackCandidates(state).some(c=>c.assessment.value>0);
  // Freeze the height objective when the plan is first acted on. A moving
  // opponent cannot raise it on every snapshot. Three setup Fly actions total,
  // across turns, then engage; an attack starts a short setup cooldown.
  const reach=target.actor.getReach?.({action:'attack'})??5;
  const setupElevation=previous?.setupElevation??Math.ceil((target.document.elevation+tokenHeight(target)+opponentSpeed*1.5+reach+5)/5)*5;
  const setupActions=previous?.setupActions??0;
  const cooling=previous?.attackedRound!=null&&game.combat.round-previous.attackedRound<3;
  const preparing=adapter.profileId==='eagle'&&speed>opponentSpeed&&!cooling&&setupActions<3&&origin.elevation<setupElevation&&state.attacksMade===0;
  let mode=shots?'ranged':preparing?'setup':'engage',coverGoals=[];
  if(!shots&&speed<opponentSpeed&&!reachable&&target.document.elevation>origin.elevation+speed/2){
    coverGoals=protectedGoals(adapter,targets.map(t=>t.target));
    if(coverGoals.length)mode='disengage';
  }
  const protectedHere=mode==='disengage'&&targets.some(t=>hidingFrom(t.target,adapter.token).canHide);
  return {mode,targetId:enemy.id,targetSpeed:opponentSpeed,setupElevation,setupActions,attackedRound:previous?.attackedRound??null,protectedHere,
    targetPosition:{...adapter.cell(target.document),elevation:target.document.elevation},coverGoals,
    reason:mode==='setup'?'Use superior flight speed for a bounded height advantage, then attack':mode==='disengage'?
      'The faster high opponent cannot be reached efficiently; descend to protection and Hide':mode==='ranged'?
      'A ranged attack can answer the airborne opponent without chasing its altitude':'Close three-dimensional reach and fight the airborne opponent'};
}

export async function recordAerialPlan(adapter,choice,result){
  const plan=choice.features?.aerialPlan;if(!plan||result.skipped)return;
  const attack=['strike','eagleDive','spikeVolley'].includes(choice.kind)&&!result.attackNotAttempted;
  await adapter.token.document.setFlag(ns,'aerialPlan',{combatId:game.combat.id,targetId:plan.targetId,setupElevation:plan.setupElevation,
    setupActions:plan.setupActions+(choice.features?.aerialSetup?1:0),
    attackedRound:attack?game.combat.round:plan.attackedRound??null});
}
