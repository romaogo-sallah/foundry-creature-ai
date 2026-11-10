import {pitAt} from './pit-geometry.mjs';
import {pitHeldItems} from './pit-actions.mjs';
import {flySpeed} from './flight-costs.mjs';
import {flightCollision,flightCost,flightPoint} from './flight-movement.mjs';
import {occupiesMovementSpace} from './combat-state.mjs';
import {tokenAt,volumesOverlap} from './vertical-geometry.mjs';

// Geometry only: ascend inside the opening before crossing its edge. Native
// walls, surfaces, occupied banks and actual Fly costs remain authoritative.
export async function pitEscapeFacts(adapter,pit,options={}){
 const actor=adapter.actor,origin={...adapter.originCell(),elevation:adapter.actualWaypoint().elevation},height=pit.rim-origin.elevation;
 if(height<=.1)return null;
 const speed=flySpeed(actor),landSpeed=adapter.groundSpeed(),climb=actor.getStatistic('athletics'),
  climbSpeed=actor.system.movement?.speeds.climb?.value??actor.system.attributes.speed?.otherSpeeds?.find(s=>s.type==='climb')?.value??0;
 const facts={height,dc:pit.climbDC,climbBonus:climb?.mod??climb?.check?.mod??0,climbSpeed,landSpeed,flySpeed:speed,heldItems:pitHeldItems(actor).length,flightExitCost:null,flightMoves:[]};
 const paths=[],vertical=[origin];
 for(let z=origin.elevation;z<pit.rim-.1;){z=Math.min(z+5,pit.rim);vertical.push({...origin,elevation:z});}
 const rect=canvas.dimensions.sceneRect,occupied=canvas.tokens.placeables.filter(t=>t!==adapter.token&&occupiesMovementSpace(t));
 const clear=path=>path.slice(1).every((p,i)=>flightCollision(adapter,flightPoint(adapter,path[i]),flightPoint(adapter,p)));
 if(!clear(vertical))return facts;
 for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]){
  await options.budget?.checkpoint();const path=[...vertical];
  for(let n=1;n<=32;n++){
   const p={x:origin.x+dx*n,y:origin.y+dy*n,elevation:pit.rim},position=flightPoint(adapter,p);
   if(!rect.contains(position.x,position.y)||!rect.contains(position.x+adapter.token.w-1,position.y+adapter.token.h-1))break;
   if(!flightCollision(adapter,flightPoint(adapter,path.at(-1)),position))break;
   if(occupied.some(t=>volumesOverlap(tokenAt(adapter.token,position),t,{acrossLevels:true})))break;
   path.push(p);
   if(!pitAt(adapter.token.document,position)){
    const estimate=height*2+(n+(dx&&dy?Math.floor(n/2):0))*5;
    facts.flightExitCost=Math.min(facts.flightExitCost??Infinity,estimate);paths.push(path);break;
   }
  }
 }
 if(!speed||!paths.length)return facts;
 const context=adapter.movementContext(),seen=new Set();
 for(const route of paths){
  await options.budget?.checkpoint();let path=[origin],cost=0;
  for(const point of route.slice(1)){const next=[...path,point],measured=flightCost(adapter,next,context);if(measured>speed+.001)break;path=next;cost=measured;}
  const end=path.at(-1),key=`${end.x},${end.y},${end.elevation}`;
  if(path.length<2||seen.has(key))continue;seen.add(key);
  const position=flightPoint(adapter,end),threats=adapter.movementThreats?.(end,position)??[];
  facts.flightMoves.push({...end,path,cost,heightGained:end.elevation-origin.elevation,exits:!pitAt(adapter.token.document,position)&&end.elevation>=pit.rim,
   provokes:Boolean((adapter.movementThreats?.(origin,adapter.actualWaypoint())??[]).length),destinationThreatened:threats.length>0});
 }
 return facts;
}
