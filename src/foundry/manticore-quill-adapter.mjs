import {PF2eBasicNPCAdapter,preparedNPCStrikes} from './basic-npc-adapter.mjs';
import {executeNativeStrike} from './native-strikes.mjs';
import {quillSupply,consumeSpikes,setSpikesRemaining} from './spike-supply.mjs';
import {applySpikePin} from './spike-pin.mjs';
import {spikeVolleyCandidates} from '../framework/spike-volley.mjs';
import {distanceToPosition} from './vertical-geometry.mjs';
import {reveal} from './stealth-awareness.mjs';
const ns='foundry-creature-ai',slug=item=>item.slug??item.system.slug??item.name.toLowerCase().replaceAll(' ','-');
export const MANTICORE_QUILL_SOURCE='Compendium.pf2e.pathfinder-monster-core.Actor.ZeUxgpNi5AXr9pX6';
export class PF2eManticoreQuillAdapter extends PF2eBasicNPCAdapter{
 get profileId(){return 'manticore-quill';}
 parts(){
  const parts=super.parts(),native=preparedNPCStrikes(this.actor),find=name=>native.find(s=>slug(s.item)===name);
  const spike=find('spike'),jaws=find('jaws'),claw=find('claw'),volley=this.actor.itemTypes.action.find(i=>slug(i)==='spike-volley');
  if(!spike?.item.isRanged||!jaws||!claw?.item.traits.has('agile')||!volley||volley.actionCost.type!=='action'||volley.actionCost.value!==1||spike.item.system.range?.increment!==40)
   throw new Error('Quill-tail Manticore requires native Jaws, agile Claw, range-40 Spike and one-action Spike Volley');
  const text=volley.system.description.value.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  if(!text.includes('20 feet')||!text.includes('dc=23')||!text.includes('12 spikes in 24 hours'))throw new Error('Unsupported edits to Spike Volley: expected 20-foot target separation, DC 23 and 12 spikes per 24 hours');
  return {...parts,native,spike,jaws,claw,volley,unsupported:parts.unsupported.filter(n=>![volley.name,'Untaught ranged weapon/ammunition configuration'].includes(n)),
   abilityNames:[parts.strike.item.name,...native.filter(s=>s!==parts.strike).map(s=>s.item.name),'Spike Volley (split targets or pin, Escape DC 23)','Fly','Hover','Arrest a Fall','Stand','Escape','Seek','Hide','Sneak']};
 }
 get spikesRemaining(){return this.configOverride?.quillPreviewRemaining??quillSupply(this.actor).remaining;}
 async setSpikesRemaining(count){return setSpikesRemaining(this.actor,count);}
 preferRangedFlight(){return this.spikesRemaining>0;}
 describeStrike(strike){return {...super.describeStrike(strike),...strike.item.isRanged?{available:this.spikesRemaining>0,rangeAversion:0.08}:{}};}
 strikeGeometry(cell,target,allies,position,strike){const result=super.strikeGeometry(cell,target,allies,position,strike);
  return {...result,usable:result.usable&&(!strike.item.isRanged||this.spikesRemaining>0)};}
 async snapshot(ledger,options){
  const state=await super.snapshot(ledger,options),parts=this.parts(),separations={};
  for(let i=0;i<state.enemies.length;i++)for(let j=i+1;j<state.enemies.length;j++){
   const one=state.enemies[i],two=state.enemies[j],a=this.perceivedTarget(one),b=this.perceivedTarget(two);
   separations[`${one.id}:${two.id}`]=distanceToPosition(a,b,a.document);
  }
  for(const enemy of state.enemies)enemy.immobilized=canvas.tokens.get(enemy.id).actor.hasCondition('immobilized','grabbed','restrained');
  const shown=this.token.document.getFlag(ns,'quillShown')?.combatId===game.combat.id;
  state.volley={strikeId:parts.spike.item.id,remaining:this.spikesRemaining,separations,shown};
  state.diagnostics.resources={spikes:this.spikesRemaining,limit:12,periodHours:24};
  if(!this.spikesRemaining)state.diagnostics.manualAbilities=parts.unsupported;
  return state;
 }
 candidates(state){return [...super.candidates(state),...spikeVolleyCandidates(state)];}
 async executeProfileAction(choice,ledger,context={}){
  const parts=this.parts(),volley=choice.kind==='spikeVolley',ranged=volley||choice.kind==='strike'&&choice.strikeId===parts.spike.item.id;
  if(!ranged)return super.executeProfileAction(choice,ledger,context);
  const ids=volley?choice.targetIds:[choice.targetId],required=volley?2:1;
  if(!ids?.length||volley&&!['pin','split'].includes(choice.mode)||volley&&(choice.mode==='pin'?ids.length!==1:ids.length!==2||ids[0]===ids[1]))throw new Error('Invalid Spike Volley targets');
  if(this.spikesRemaining<required)return {skipped:true,skipReason:'Not enough spikes remain'};
  const valid=()=> (context.canContinue?.()??true)&&this.turnKey()===ledger.turn&&!game.paused&&game.user.isGM&&game.users.activeGM?.id===game.user.id&&!this.turnEndReason();
  const first=this.liveTarget(ids[0]),second=ids[1]&&this.liveTarget(ids[1]);
  const usable=target=>target&&this.strikeGeometry(this.originCell(),target,[],this.actualWaypoint(),parts.spike).usable;
  const close=()=>!second||distanceToPosition(first,second,first.document)<=20;
  if(!usable(first)||volley&&choice.mode==='split'&&(!usable(second)||!close()))return {skipped:true,skipReason:'Spike targets or separation changed'};
  const results=[];let consumed=0;
  for(const id of ids){
   const target=this.liveTarget(id);if(!usable(target)||!close())break;
   const interrupt=this.config.pauseForReactions!==false?await this.reactions?.action({mover:this.token,kind:'ranged',valid,applyDamage:this.config.applyDamage}):null;
   if(interrupt?.endTurn||interrupt?.pause)return {...interrupt,attackNotAttempted:results.length===0,lastAction:{kind:choice.kind,targetId:choice.targetId}};
   if(!valid())throw new Error('The quill attack stopped during a reaction');
   if(this.liveTarget(id)!==target||!usable(target)||!close())break;
   const cost=volley&&choice.mode==='pin'?2:1;
   await consumeSpikes(this.actor,cost);consumed+=cost;
   let result;
   try{result=await executeNativeStrike(this,parts.spike,target,ledger,{...context,canContinue:valid});}
   finally{await reveal(this.token);}
   results.push(result);
   if(volley&&choice.mode==='pin'&&result.lastAction.hit&&!target.actor.isDead&&valid())await applySpikePin(this,target);
  }
  return {resolved:true,attackNotAttempted:results.length===0,pause:results.some(r=>r.pause),
   lastAction:{kind:choice.kind,hit:results.some(r=>r.lastAction.hit),targetId:choice.targetId,strikeId:parts.spike.item.id},
   note:`${volley?'Spike Volley':'Spike'}: ${consumed} spike(s) spent; ${this.spikesRemaining} remain.${volley&&choice.mode==='pin'&&results[0]?.lastAction.hit?' Pin: Escape or Force Open DC 23.':''}`};
 }
 async recordOutcome(choice,_ledger,result={}){
  if(choice.kind==='spikeVolley'&&result.resolved&&!result.attackNotAttempted)await this.token.document.setFlag(ns,'quillShown',{combatId:game.combat.id});
 }
}
