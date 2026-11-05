import {PF2eBasicNPCAdapter} from './basic-npc-adapter.mjs';
import {executeNativeStrike} from './native-strikes.mjs';
import {exposeToPoison} from './poison-effects.mjs';
import {MANTICORE_VENOM,venomBenefit} from '../framework/poison.mjs';
const ns='foundry-creature-ai',slug=item=>item.slug??item.system.slug??item.name.toLowerCase().replaceAll(' ','-');
export const MANTICORE_SCORPION_SOURCE='Compendium.pf2e.pathfinder-monster-core.Actor.k89Kw65a4Ip2ZSGA';
export class PF2eManticoreAdapter extends PF2eBasicNPCAdapter{
  get profileId(){return 'manticore-scorpion';}
  parts(){
    const parts=super.parts(),find=name=>parts.native.find(s=>slug(s.item)===name);
    const stinger=find('stinger'),jaws=find('jaws'),claw=find('claw'),venom=this.actor.itemTypes.action.find(item=>slug(item)==='manticore-venom');
    if(!stinger||!jaws||!claw||!venom||!claw.item.traits.has('agile')||!stinger.item.traits.has('reach-10')||!venom.traits.has('poison'))
      throw new Error('Scorpion-tail Manticore needs native Jaws, agile Claw, reach-10 Stinger and Manticore Venom');
    const description=venom.system.description?.value??'';
    const text=description.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').toLowerCase();
    if(!description.includes('dc:22')||!description.includes('1d10[poison]')||!description.includes('2d10[poison]')||
      !text.includes('maximum duration 6 rounds')||!text.includes('enfeebled 2'))
      throw new Error('The taught Manticore Venom requires its exported DC 22 and 1d10/2d10 poison stages');
    return {...parts,stinger,jaws,claw,venom,unsupported:parts.unsupported.filter(name=>name!==venom.name),
      abilityNames:['Stinger (reach 10 ft, venom)','Jaws','Agile Claw','Fly','Hover','Arrest a Fall','Stand','Escape','Seek','Hide','Sneak']};
  }
  async snapshot(ledger,options){
    const state=await super.snapshot(ledger,options),stinger=this.parts().stinger;
    const history=this.token.document.getFlag(ns,'manticoreHunts'),hits=history?.combatId===game.combat.id?history.hits??{}:{};
    for(const enemy of state.enemies)enemy.strikeEffectValues={[stinger.item.id]:venomBenefit(hits[enemy.id]??0)};
    state.strikes.find(s=>s.id===stinger.item.id).onHitValue=venomBenefit();
    return state;
  }
  async executeProfileAction(choice,ledger,context={}){
    const target=this.liveTarget(choice.targetId),strike=this.parts().native.find(s=>s.item.id===choice.strikeId);
    if(choice.kind!=='strike'||!target||!strike||strike.ready===false||!this.targetAt(this.originCell(),target,[],this.actualWaypoint(),strike.item).inReach)
      return {skipped:true,skipReason:'The Manticore Strike or its target is no longer available'};
    const result=await executeNativeStrike(this,strike,target,ledger,context);
    if(strike.item.id!==this.parts().stinger.item.id||!result.lastAction.hit||target.actor.isDead)return result;
    const venom=await exposeToPoison(this,target,MANTICORE_VENOM,context);
    return {...result,pause:result.pause||venom.pause,note:venom.note??'Manticore Venom: the target resisted this exposure.'};
  }
  async recordOutcome(choice,ledger,result={}){
    if(result.skipped||choice.kind!=='strike'||!result.lastAction?.hit||choice.strikeId!==this.parts().stinger.item.id)return;
    const previous=this.token.document.getFlag(ns,'manticoreHunts'),hits=previous?.combatId===game.combat.id?previous.hits??{}:{};
    await this.token.document.setFlag(ns,'manticoreHunts',{combatId:game.combat.id,hits:{...hits,[choice.targetId]:(hits[choice.targetId]??0)+1}});
  }
}
