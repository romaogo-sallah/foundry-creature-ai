import {distanceToPosition,tokenHeight,rayAt} from './vertical-geometry.mjs';
import {clearAttackPath} from './attack-path.mjs';

// Ordinary melee reach matters even when a creature has no Reactive Strike,
// or has already spent its reaction. Only the observer's known targets enter.
export function flightThreats(adapter,state,targetFor){
  const step=canvas.grid.distance;
  return state.enemies.flatMap(enemy=>{
    const target=targetFor(enemy),actor=target?.actor;
    if(!actor||actor.canAttack===false||actor.hasCondition('unconscious','dying','dead','paralyzed','petrified'))return [];
    const melee=(actor.system.actions??[]).flatMap(strike=>[strike,...strike.altUsages??[]])
      .filter(strike=>strike.item?.isMelee&&strike.ready!==false&&strike.canAttack!==false);
    const reach=Math.max(0,...melee.map(strike=>actor.getReach({action:'attack',weapon:strike.item})),
      ...(!melee.length?[actor.getReach({action:'attack'})??0]:[]));
    if(!reach)return [];
    const safeElevation=Math.ceil((target.document.elevation+tokenHeight(target)+reach)/step)*step+step;
    return [{target,reach,safeElevation}];
  });
}

export function flightSafety(adapter,position,threats){
  let exposed=0,deficit=0;
  for(const {target,reach,safeElevation} of threats){
    // A five-foot clearance above height + reach is a tactical margin, not an
    // extra reach bonus to native attack/reaction legality.
    const horizontal=distanceToPosition(adapter.token,target,{...position,elevation:target.document.elevation},reach);
    const distance=distanceToPosition(adapter.token,target,position,reach);
    const overhead=horizontal<=reach&&position.elevation>=target.document.elevation&&position.elevation<safeElevation;
    if((distance<=reach||overhead)&&clearAttackPath(adapter.token,target,rayAt(adapter.token,position,'move'))){
      exposed++;deficit=Math.max(deficit,safeElevation-position.elevation);
    }
  }
  return {safe:exposed===0,exposed,deficit:Math.max(0,deficit),aboveReach:threats.length>0&&threats.every(threat=>position.elevation>=threat.safeElevation)};
}
