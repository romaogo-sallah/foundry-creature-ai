const held=(item,hands=1)=>item?.system?.equipped?.carryType==='held'&&(item.system.equipped.handsHeld??0)>=hands;
const handsFor=item=>Number.isInteger(item.hands)?item.hands: /two|2/.test(item.system?.usage?.value??'')?2:1;
export function confusedStrikes(normal){
  const parts=normal.parts(),strikes=normal.profileStrikes?.(parts)??parts.native??[parts.strike,parts.ranged].filter(Boolean);
  return [...new Map(strikes.filter(Boolean).map(strike=>[strike.item.id,strike])).values()];
}
export function confusedGear(normal,strike){
  const parts=normal.parts(),item=strike.item,weapon=item.linkedWeapon??normal.actor.items?.get?.(item.flags?.pf2e?.linkedWeapon);
  const ranged=Boolean(item.isRanged),source={available:true,ready:strike.ready!==false&&strike.canAttack!==false,weapon,preparation:null};
  if(ranged&&normal.profileId==='manticore-quill')source.available=normal.spikesRemaining>0;
  if(parts.refuse?.item.id===item.id){
    source.available=normal.refuseCount>0;source.ready=normal.refuseHeld;
    if(!source.ready)source.preparation=held(parts.javelin)?{kind:'stow',itemId:parts.javelin.id}:{kind:'drawRefuse'};
    return source;
  }
  if(weapon){
    const hands=parts.bow?.id===weapon.id?2:parts.hook?.id===weapon.id?2:handsFor(weapon);
    source.ready=held(weapon,hands)&&strike.ready!==false&&strike.canAttack!==false;source.hands=hands;
    if(item.isRanged&&(weapon.traits?.has?.('thrown')||item.system?.traits?.value?.some(t=>t.startsWith('thrown-'))))source.available=weapon.system.quantity>0;
    if(held(weapon,hands)&&!source.ready)source.available=false;
    if(!source.ready){
      const occupied=[...normal.actor.items.values()].filter(other=>other!==weapon&&held(other));
      const used=occupied.reduce((sum,other)=>sum+(other.system.equipped.handsHeld??1),0);
      const free=2-used-(held(weapon)?weapon.system.equipped.handsHeld:0),needed=hands-(held(weapon)?weapon.system.equipped.handsHeld:0);
      // A simple free Release can accompany drawing a one-handed weapon.
      const release=hands===1&&occupied.find(other=>other.system.equipped.handsHeld===2);
      if(free<needed&&!release)source.preparation={kind:'stow',itemId:occupied[0]?.id};
      else source.preparation={kind:'drawWeapon',itemId:weapon.id,hands,releaseId:release?.id};
    }
  }
  if(parts.ranged?.item.id===item.id&&parts.bow){
    source.available=Boolean(parts.bolts?.system.quantity>0);
    if(source.ready&&!normal.loaded){source.ready=false;source.preparation={kind:'reload'};}
  }
  if(parts.javelin&&item.id===parts.thrown?.item.id)source.available=parts.javelin.system.quantity>0&&!normal.refuseHeld;
  return source;
}
export async function executeConfusedGear(driver,choice,ledger,{canContinue=()=>true}={}){
  const normal=driver.normal,valid=()=>canContinue()&&driver.turnKey()===ledger.turn&&driver.actor.hasCondition('confused');
  if(['reload','drawRefuse'].includes(choice.kind))return driver.nativeExecute(choice,ledger,{canContinue:valid});
  const item=driver.actor.items.get(choice.itemId);
  if(!item)return {skipped:true,skipReason:'The weapon changed before the equipment action.'};
  if(driver.config.pauseForReactions!==false){
    const reaction=await driver.reactions?.action({mover:driver.token,kind:'manipulate',valid,applyDamage:driver.config.applyDamage});
    if(reaction?.endTurn||reaction?.pause||reaction?.disrupted)return {...reaction,resolved:true};
  }
  if(!valid())return {resolved:true,pause:true};
  if(choice.kind==='stow')await item.update({'system.equipped.carryType':'worn','system.equipped.handsHeld':0});
  else{
    const release=choice.releaseId&&normal.actor.items.get(choice.releaseId);
    if(release&&held(release,2))await release.update({'system.equipped.handsHeld':1});
    await item.update({'system.equipped.carryType':'held','system.equipped.handsHeld':choice.hands});
  }
  return {resolved:true,lastAction:{kind:choice.kind}};
}
