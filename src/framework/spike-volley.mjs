import {preparedStrikeCandidates} from './strike-capability.mjs';
import {attackValue} from '../dawnsbury/chooser.mjs';
// Pure action estimates; no secret defenses or live Foundry documents.
export function spikeVolleyCandidates(state){
 const volley=state.volley;
 if(!volley||volley.remaining<2||state.actionsRemaining<1||state.self.restrained||state.self.unable)return [];
 const shots=preparedStrikeCandidates(state).filter(c=>c.strikeId===volley.strikeId),result=[];
 const spike=state.strikes.find(s=>s.id===volley.strikeId);
 const showcase=state.style?.enabled&&!volley.shown?(state.style.showcaseBonus??0):0;
 for(const shot of shots){
  const enemy=state.enemies.find(e=>e.id===shot.targetId),position=enemy.strikes[volley.strikeId];
  if(enemy.immobilized)continue;
  const control=attackValue({bonus:spike.bonus+spike.mapPenalties[Math.min(state.attacksMade,2)]-(position.rangePenalty??0),
   damage:enemy.tactics?.role==='ranged'?2:5,referenceAC:state.self.referenceAC,
   defenseAdjustment:position.coverBonus??0,concealmentDC:position.concealmentDC});
  result.push({id:`volley:pin:${enemy.id}`,kind:'spikeVolley',mode:'pin',strikeId:spike.id,targetId:enemy.id,targetIds:[enemy.id],legal:true,
   actionCost:1,mapIncreases:1,provokes:true,features:{ranged:true,volley:true},assessment:{value:shot.assessment.value+control+showcase-0.5},
   scoringTerms:[...shot.scoringTerms,{label:'Estimated value of pinning a mobile enemy',contribution:control},
    {label:'Use two limited spikes',contribution:-0.5},...showcase?[{label:'Show Spike Volley once',contribution:showcase}]:[]]});
 }
 for(let i=0;i<shots.length;i++)for(let j=i+1;j<shots.length;j++){
  const one=shots[i],two=shots[j];if((volley.separations[`${one.targetId}:${two.targetId}`]??Infinity)>20)continue;
  result.push({id:`volley:split:${one.targetId}:${two.targetId}`,kind:'spikeVolley',mode:'split',strikeId:spike.id,targetId:one.targetId,
   targetIds:[one.targetId,two.targetId],legal:true,actionCost:1,mapIncreases:1,provokes:true,features:{ranged:true,volley:true},
   assessment:{value:one.assessment.value+two.assessment.value+showcase-0.5},
   scoringTerms:[{label:'Two native Spike attacks at the same MAP',contribution:one.assessment.value+two.assessment.value},
    {label:'Use two limited spikes',contribution:-0.5},...showcase?[{label:'Show Spike Volley once',contribution:showcase}]:[]]});
 }
 return result;
}
export const aerialAttackCandidates=state=>[...preparedStrikeCandidates(state),...spikeVolleyCandidates(state)];
