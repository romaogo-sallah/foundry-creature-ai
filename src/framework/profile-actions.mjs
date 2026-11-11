import {basicSaveValue} from './spell-evaluation.mjs';
import {preparedStrikeCandidates} from './strike-capability.mjs';
import {checkProbabilities} from './math.mjs';

export function profileActions(state,facts={}){
 const result=[],once=key=>state.plannedCapabilities?.includes(key),remaining=state.actionsRemaining;
 if(facts.shield&&remaining>0&&!once('raise-shield')){
  const value=state.self.threatened?(facts.vampire?9:8):(facts.vampire?4:2);
  result.push({id:facts.shieldId,kind:'raiseFireShield',legal:true,actionCost:1,features:{onceKey:'raise-shield'},assessment:{value},scoringTerms:[{label:'Raise Fire Shield for AC and a blocking reaction',contribution:value}]});
 }
 if(facts.stare&&!facts.stareUsed&&remaining>0&&!state.self.restrained&&!once('cytillesh-stare'))
  for(const e of state.enemies.filter(e=>e.distance<=30&&e.lineOfSight!==false&&e.lineOfEffect!==false&&!e.awareness?.searchRequired&&!once('gaze:'+e.id)&&!state.spellAttempts.some(a=>a.slug==='blindness'&&a.targetId===e.id&&a.untilRound>=state.round))){
   const p=checkProbabilities(state.self.referenceAC-10,facts.stareDC),value=1.5+(p.failure+p.criticalFailure)*5;
   result.push({id:'stare:'+e.id,kind:'gaze',targetId:e.id,legal:true,actionCost:1,features:{onceKey:'cytillesh-stare'},assessment:{value},scoringTerms:[{label:'Dazzle and estimated chance to confuse; once per round',contribution:value}]});
  }
 if(state.dragon&&!state.self.unable&&!state.self.restrained){
  const dragon=state.dragon;
  if(dragon.breathReady&&remaining>=2&&!once('pyre'))for(const area of dragon.areas??[]){
   const value=basicSaveValue(dragon.breathDC??29,state.self.referenceAC-10,dragon.breathDamage??31.5)*(area.enemies.length-area.bystanders.filter(e=>!e.unaffected).length*2)+area.enemies.length*2;
   if(value>0)result.push({id:`pyre:${area.id}`,kind:'pyreBreath',area,targetId:area.enemies[0]?.id,actionCost:2,legal:true,traits:['fire','primal'],features:{onceKey:'pyre',blocksForecast:['pyre']},assessment:{value},scoringTerms:[{label:'Breath damage, fire and smoke; avoid friendly fire',contribution:value}]});
  }
  if(dragon.frenzy&&remaining>=2){
   let forecast=state,total=0;const sequence=[],parts=['claw','claw','wing'];
   for(let i=0;i<3;i++){
    const best=preparedStrikeCandidates({...forecast,strikes:state.strikes.filter(s=>parts.includes(s.dragonPart))}).sort((a,b)=>b.assessment.value-a.assessment.value)[0];if(!best)break;
    sequence.push({strikeId:best.strikeId,targetId:best.targetId});total+=best.assessment.value;parts.splice(parts.indexOf(state.strikes.find(s=>s.id===best.strikeId).dragonPart),1);forecast={...forecast,attacksMade:forecast.attacksMade+1};
   }
   if(sequence.length===3)result.push({id:'draconic-frenzy',kind:'draconicFrenzy',sequence,targetId:sequence[0].targetId,actionCost:2,mapIncreases:3,legal:true,traits:['attack'],assessment:{value:total},scoringTerms:[{label:'Two Claws and one Wing with normal MAP',contribution:total}]});
  }
  if(remaining&&dragon.burning?.length&&!once('stoke')){const value=dragon.burning.length*10.5;result.push({id:'stoke-flames',kind:'stokeFlames',actionCost:1,legal:true,traits:['fire','primal'],features:{onceKey:'stoke'},assessment:{value},scoringTerms:[{label:'Intensify persistent fire on known foes',contribution:value}]});}
 }
 if(facts.vampire&&state.vampire?.form!=='mist'){
  const v=state.vampire,last=v?.lastStrike,airThreat=state.enemies.some(e=>facts.elevations[e.id]>facts.elevation+10);
  if(remaining>=2&&v?.form==='vampire'&&v.retreatAvailable&&state.enemies.length){const value=14;
   result.push({id:'vampire:mist-retreat',kind:'vampireForm',form:'mist',retreat:true,retreatEdge:v.retreatEdge,legal:true,actionCost:1,
    features:{avoidance:true,defensiveSetup:true,onceKey:'mist-retreat'},assessment:{value},
    scoringTerms:[{label:'Critical health: become vapor and spend the remaining turn withdrawing',contribution:value}]});}
  if(remaining>0&&v?.form==='vampire'&&airThreat&&state.enemies.every(e=>!e.inReach))result.push({id:'vampire:bat',kind:'vampireForm',form:'bat',legal:true,actionCost:1,assessment:{value:12},scoringTerms:[{label:'Change into a giant bat to reach airborne opponents',contribution:12}]});
  if(remaining>0&&v?.form==='bat'&&facts.elevation===0&&!airThreat)result.push({id:'vampire:body',kind:'vampireForm',form:'vampire',legal:true,actionCost:1,assessment:{value:12},scoringTerms:[{label:'Resume the stronger vampire body at ground level',contribution:12}]});
  for(const e of state.enemies){if(!e.inReach||e.lineOfSight===false)continue;
   if(e.held&&e.bloodEligible){const value=e.drained?3+(v.killAtFive&&e.drained>=4?20:0):v.drain*3+Math.min(v.bloodHeal,facts.missingHP)+2;result.push({id:`blood:${e.id}`,kind:'drinkBlood',targetId:e.id,legal:true,actionCost:1,mapIncreases:0,assessment:{value},scoringTerms:[{label:'Drain a held foe and recover without wasting healing on a previously drained victim',contribution:value}]});}
   if(e.ownGrab||facts.canGrab[e.id]&&last?.hit&&last.targetId===e.id&&facts.grabStrikes.includes(last.strikeId)){const value=e.ownGrab?4:7+(remaining>=2&&e.bloodEligible?v.drain*2+Math.min(5,facts.missingHP):0);result.push({id:`grab:${e.id}`,kind:'grab',targetId:e.id,legal:true,actionCost:1,mapIncreases:0,assessment:{value},scoringTerms:[{label:'Hold a foe for allied attacks and eligible Drink Blood',contribution:value}]});}
  }
  for(const strike of state.strikes.filter(s=>!s.available)){
   const gear=facts.gear[strike.id];if(!gear||strike.ranged&&!facts.ammunition)continue;const cost=gear.other?2:1;if(cost>remaining)continue;
   const forecast=preparedStrikeCandidates({...state,actionsRemaining:Math.max(1,remaining-cost),strikes:[{...strike,available:true}]}),value=Math.max(0,...forecast.map(c=>c.assessment.value))-cost;
   if(value>0)result.push({id:`equip:${gear.weapon}`,kind:gear.other?'vampireStow':'vampireEquip',weaponId:gear.other??gear.weapon,legal:true,actionCost:1,assessment:{value},scoringTerms:[{label:'Prepare a native weapon for a useful attack',contribution:value}]});
  }
 }
 return result;
}
