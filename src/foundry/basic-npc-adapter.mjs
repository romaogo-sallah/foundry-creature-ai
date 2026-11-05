import { PF2eCreatureAdapter } from './pf2e-adapter.mjs';
import { averageFormula } from '../framework/math.mjs';
import { basicCapabilities } from '../profiles/basic-npc.mjs';
import { executeNativeStrike } from './native-strikes.mjs';
import { rememberedToken } from './target-memory.mjs';
import { detectionFor } from './stealth-awareness.mjs';
import { clearSightPath } from './attack-path.mjs';

export const basicMeleeStrikes=actor=>(actor?.system?.actions??[]).filter(strike=>strike.type==='strike'&&strike.item?.isMelee&&
  Number.isFinite(strike.totalModifier)&&Object.values(strike.item.system?.damageRolls??{}).some(part=>part.damage)&&
  strike.variants?.length>=3&&typeof strike.variants[0].roll==='function'&&typeof strike.damage==='function');
const average=strike=>Object.values(strike.item.system.damageRolls??{}).filter(part=>!part.category).reduce((sum,part)=>sum+averageFormula(part.damage),0);

export class PF2eBasicNPCAdapter extends PF2eCreatureAdapter {
  get profileId(){return 'basic-npc';}
  get config(){return {...super.config,packMorale:false};}
  parts(){
    const native=basicMeleeStrikes(this.actor),strike=native[0];
    if(!strike)throw new Error('This NPC needs a prepared native melee Strike');
    const unsupported=(this.actor.itemTypes.action??[]).map(item=>item.name);
    if(this.actor.itemTypes.spell?.length)unsupported.push('Untaught spell list');
    if(this.actor.system.actions.some(action=>action.item?.isRanged))unsupported.push('Untaught ranged weapon/ammunition configuration');
    return {strike,native,averageDamage:average(strike),abilityNames:[...native.map(action=>action.item.name),'Stand','Escape','Seek','Hide','Sneak'],unsupported};
  }
  planningReach(){return Math.max(...this.parts().native.map(strike=>this.actor.getReach({action:'attack',weapon:strike.item})));}
  targetAt(cell,target,allies,position,weapon=this.parts().strike.item){return super.targetAt(cell,target,allies,position,weapon);}
  async snapshot(ledger,options){
    const state=await super.snapshot(ledger,options),parts=this.parts();
    const describe=(cell,enemy,position)=>{
      const target=this.perceivedTarget(enemy);
      const allies=target.memoryView?[]:this.allies(target).filter(ally=>detectionFor(this.token,ally).state==='observed'&&clearSightPath(this.token,ally));
      const positions=Object.fromEntries(parts.native.map(strike=>{
        const geometry=this.targetAt(cell,target,allies,position,strike.item);
        return [strike.item.id,{...geometry,usable:geometry.inReach&&geometry.lineOfEffect&&strike.ready!==false}];
      }));
      return {strikes:positions,inReach:Object.values(positions).some(position=>position.usable)};
    };
    for(const enemy of state.enemies)Object.assign(enemy,describe(state.self.cell,enemy,this.actualWaypoint()));
    for(const move of state.moves)for(const enemy of state.enemies)Object.assign(move.targets[enemy.id],describe(move,enemy));
    return {...state,strikes:parts.native.map(strike=>({id:strike.item.id,bonus:strike.totalModifier,damage:average(strike),ranged:false,
      mapPenalties:[0,strike.variants[1]?.penalty??-5,strike.variants[2]?.penalty??-10]})),
      diagnostics:{...state.diagnostics,profileId:this.profileId,manualAbilities:parts.unsupported}};
  }
  perceivedTarget(enemy){
    const token=canvas.tokens.get(enemy.id);
    return enemy.awareness?.state==='known-square'?rememberedToken(token,enemy.awareness.position,enemy.awareness):token;
  }
  candidates(state){return basicCapabilities.candidates('basic-npc',state);}
  decide(state){const decision=basicCapabilities.decide('basic-npc',state);return {...decision,diagnostics:{...state.diagnostics,...decision.diagnostics}};}
  async executeProfileAction(choice,ledger,context){
    const target=this.liveTarget(choice.targetId),strike=this.parts().native.find(strike=>strike.item.id===choice.strikeId);
    if(choice.kind!=='strike'||!target||!strike||strike.ready===false||!this.targetAt(this.originCell(),target,[],this.actualWaypoint(),strike.item).inReach)
      return {skipped:true,skipReason:'The prepared melee Strike or its target is no longer available'};
    return executeNativeStrike(this,strike,target,ledger,context);
  }
}
