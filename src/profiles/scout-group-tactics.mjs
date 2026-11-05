const clamp=value=>Math.max(0,Math.min(1,value));
import {tacticalPosition,backtrackCost} from '../framework/tactical-field.mjs';

// Position preference, not an assertion of flanking or future allied damage.
// Actual off-guard comes exclusively from the adapter's current legal geometry.
export function scoutGroupPosition(state,enemies=state.enemies,gear=state){
  const group=state.group;if(!group)return 0;
  let swarm=0;
  if(gear.bladeReady)for(const enemy of enemies){
    const support=group.targets?.[enemy.id];
    if(!support?.swarm||enemy.distance>5||enemy.lineOfSight===false||enemy.lineOfEffect===false||!enemy.flankable||enemy.prone||enemy.offGuard)continue;
    swarm=Math.max(swarm,Math.min(3.5,(state.sneakDamage??3.5)*0.5*support.helpers)*(enemy.threat?.reactive?0.3:1));
  }
  let kite=0;
  if(gear.bowReady&&gear.bolts>0&&group.rangedCount>=2){
    const threats=enemies.filter(e=>e.lineOfSight!==false&&e.physicalPath!==false&&e.strikes&&
      Object.entries(e.strikes).some(([id,p])=>state.strikes.some(s=>s.id===id&&s.ranged)&&p.geometryUsable!==false&&p.inReach!==false));
    if(threats.length)kite=Math.min(...threats.map(enemy=>{
      const reach=enemy.threat?.reach??5,speed=enemy.threat?.speed??25;
      const separation=clamp(((enemy.threatDistance??enemy.distance)-reach)/Math.max(5,speed));
      const support=group.targets?.[enemy.id]?.rangedSupport??group.rangedCount-1;
      return Math.min(1.5,support*0.75)*separation*(enemy.threat?.ranged&&enemy.distance<=(enemy.threat.range??120)?0.25:1);
    }));
  }
  return Math.max(swarm,kite);
}

export function scoutSwarmOpportunity(state,enemies=state.enemies){
  return enemies.find(enemy=>state.group?.targets?.[enemy.id]?.swarm&&enemy.flankable&&enemy.distance<=5&&
    enemy.lineOfSight!==false&&enemy.lineOfEffect!==false);
}

// Only a bounded number of native, already validated routes enters lookahead.
// They are alternatives for one future move, never a reservation or teleport.
export function scoutFutureMoves(state){
  if(!state.group&&state.bolts>0&&!state.tactical||state.self.immobile||state.self.prone||state.self.restrained)return [];
  const before=scoutGroupPosition(state),moves=[];
  for(const move of state.moves??[]){
    if(!['step','stride'].includes(move.kind)||!move.cost||move.cost>(move.kind==='step'?5:state.speed)||state.visited?.includes(`${move.x},${move.y}`))continue;
    const enemies=state.enemies.map(e=>({...e,...move.targets[e.id],stealthChance:0,undetectedChance:0}));
    const swarm=scoutSwarmOpportunity(state,enemies),kite=scoutGroupPosition(state,enemies,{...state,bladeReady:false,bowReady:true});
    const flank=enemies.find(e=>e.distance<=5&&Object.values(e.strikes??{}).some(p=>p.flanked&&p.geometryUsable));
    const melee=state.bolts<1&&(enemies.find(e=>state.strikes.some(s=>!s.ranged&&e.strikes?.[s.id]?.geometryUsable))||
      move.nearestEnemy<state.nearestEnemy&&enemies.slice().sort((a,b)=>a.distance-b.distance)[0]);
    if(state.bolts<1&&!melee&&!flank)continue;
    const room=tacticalPosition({...state,tactical:move.tactical})-tacticalPosition(state);
    if(!swarm&&!flank&&!melee&&kite<=before+0.05&&room<=0.1)continue;
    if(!enemies.some(e=>e.lineOfSight!==false&&e.lineOfEffect!==false))continue;
    const potential=scoutGroupPosition(state,enemies,{...state,bladeReady:true,bowReady:false});
    moves.push({id:`${move.kind}:${move.x},${move.y}`,kind:move.kind,destination:{x:move.x,y:move.y},move,
      swarmTargetId:swarm?.id??flank?.id,meleeTargetId:melee?.id,
      potential:Math.max(kite-before,potential-before)+room-backtrackCost(state,move)+(flank?1:0)+(melee?scoutMeleeProgress(state,move):0)-(move.reactionRisk??0)-(move.terrainRisk??0)});
  }
  moves.sort((a,b)=>b.potential-a.potential||a.move.cost-b.move.cost);
  // Keep both a melee and a ranged alternative even if one goal scores higher.
  const chosen=new Map();
  for(const entry of [moves.find(m=>m.swarmTargetId),moves.find(m=>!m.swarmTargetId),...moves]){
    if(entry)chosen.set(entry.id,entry);if(chosen.size>=8)break;
  }
  return [...chosen.values()];
}

export function scoutMeleeProgress(state,move){
  if(state.bolts>0||!Number.isFinite(state.nearestEnemy)||state.nearestEnemy>=2147483647)return 0;
  return Math.max(0,Math.min(1,(state.nearestEnemy-move.nearestEnemy)/Math.max(1,state.speed/5)))*(state.self.averageDamage??3.5);
}
