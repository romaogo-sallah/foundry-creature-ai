import {flySpeed} from './flight-costs.mjs';
import {floorBelow,isAirborne} from './flight-surfaces.mjs';
import {incapacitationReason,occupiesMovementSpace} from './combat-state.mjs';
import {tokenAt,volumesOverlap} from './vertical-geometry.mjs';
import {MANAGED_MOVEMENT} from './movement-options.mjs';
const ns='foundry-creature-ai',pending=new Map();
export const flightLost=token=>Boolean(incapacitationReason(token)||token.actor.hasCondition('prone','paralyzed','petrified','unconscious')||!flySpeed(token.actor));
const validToken=token=>canvas.ready&&canvas.tokens.get(token.id)===token&&game.users.activeGM?.id===game.user.id;
export async function resolveFlightFall(token,{reactions,force=false,applyDamage=true,valid=()=>true}={}){
  const key=token.document.uuid??token.id;
  if(pending.has(key))return pending.get(key);
  const task=(async()=>{
    if(!validToken(token)||!valid()||!isAirborne(token)||!force&&!flightLost(token))return {};
    await (token.movementAnimationPromise??token.document.movement?.animation?.ended);
    if(!validToken(token)||!valid())return {pause:true};
    const p=token.document._source??token.document,from={x:p.x,y:p.y,elevation:p.elevation,level:p.level},floor=floorBelow(token,from),distance=from.elevation-floor;
    let arrested=false;
    if(flySpeed(token.actor)&&!incapacitationReason(token)&&!token.actor.hasCondition('paralyzed','petrified','restrained')&&reactions?.available(token)){
      const check=token.actor.getStatistic('acrobatics')?.check;
      if(check?.roll)await reactions.exclusive(token,async()=>{
        if(!reactions.available(token))return;
        const reserved=await reactions.reserve(token,'arrest-a-fall',()=>validToken(token)&&valid());
        const roll=await check.roll({skipDialog:true,token:token.document,dc:{value:15},action:'arrest-a-fall',
          extraRollOptions:[`${ns}:managed`,'action:arrest-a-fall','skip-handling-message']});
        if(!Number.isInteger(roll?.degreeOfSuccess))throw new Error('Arrest a Fall was not resolved; inspect the reserved reaction.');
        arrested=roll.degreeOfSuccess>=2;await reactions.confirm(token,reserved);
      });
    }
    if(!validToken(token)||!valid())return {pause:true};
    const landing={...from,elevation:floor,action:'displace',snapped:false};
    const occupants=canvas.tokens.placeables.filter(other=>other!==token&&occupiesMovementSpace(other)&&volumesOverlap(tokenAt(token,landing),other));
    const moved=await token.document.move([landing],{[MANAGED_MOVEMENT]:true,animate:true,showRuler:false});
    await (token.movementAnimationPromise??token.document.movement?.animation?.ended);
    if(!moved)throw new Error('Foundry stopped the fall before its landing; inspect the position.');
    await token.document.update?.({movementAction:'walk'});
    const amount=!arrested&&distance>5?Math.floor(distance/2):0;
    if(amount){
      const DamageRoll=CONFIG.Dice.rolls.find(type=>type.name==='DamageRoll');
      const damage=await new DamageRoll(`${amount}[bludgeoning]`).evaluate();
      await damage.toMessage({speaker:ChatMessage.getSpeaker({token:token.document}),flavor:`Falling ${distance} feet`,
        flags:{[ns]:{managed:true},pf2e:{suppressDamageButtons:applyDamage,context:{type:'damage-roll',options:[`${ns}:managed`,'falling','skip-handling-message']}}}});
      if(applyDamage){
        const before=token.actor.hitPoints.value+(token.actor.hitPoints.temp??0);
        await token.actor.applyDamage({damage,token:token.document,rollOptions:new Set(['falling',`${ns}:managed`])});
        if(token.actor.hitPoints.value+(token.actor.hitPoints.temp??0)<before&&!token.actor.hasCondition('prone'))await token.actor.increaseCondition('prone');
      }
    }
    const pause=Boolean(amount&&!applyDamage||occupants.length);
    return {resolved:true,fall:true,pause,note:`${token.name} fell ${distance} feet.${arrested?' Arrest a Fall prevented falling damage.':''}`,
      pauseReason:pause?occupants.length?'The fall landed in an occupied space. Resolve falling-on-a-creature and final placement manually.':'Apply the falling damage before resuming.':null};
  })();
  pending.set(key,task);try{return await task;}finally{pending.delete(key);}
}
let installed=false;
export function installFlightFalls({reactions,onError}){
  if(installed)return;installed=true;
  const check=actor=>{
    if(!canvas.ready||game.users.activeGM?.id!==game.user.id)return;
    for(const token of canvas.tokens.placeables)if((token.actor===actor||token.actor?.uuid===actor?.uuid)&&token.document.getFlag(ns,'config')?.enabled&&
      token.document.getFlag(ns,'flight')&&flightLost(token))void reactions.resolve(()=>resolveFlightFall(token,{reactions,applyDamage:token.document.getFlag(ns,'config').applyDamage!==false})).catch(onError);
  };
  Hooks.on('updateActor',check);
  for(const name of ['createItem','updateItem','deleteItem'])Hooks.on(name,item=>{if(['condition','effect'].includes(item.type))check(item.actor);});
  Hooks.on('pf2e.endTurn',combatant=>{
    const token=canvas.tokens.get(combatant.tokenId),state=token?.document.getFlag(ns,'flight');
    const round=combatant.getFlag?.('pf2e','roundOfLastTurnEnd')??combatant.flags?.pf2e?.roundOfLastTurnEnd??game.combat?.round;
    if(!token||!state||!token.document.getFlag(ns,'config')?.enabled||state.combatId===game.combat?.id&&state.round===round)return;
    void reactions.resolve(()=>resolveFlightFall(token,{reactions,force:true,applyDamage:token.document.getFlag(ns,'config').applyDamage!==false})).catch(onError);
  });
}
