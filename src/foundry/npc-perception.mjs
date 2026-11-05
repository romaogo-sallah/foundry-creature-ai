import { checkDegree } from '../framework/math.mjs';
import { tileDistance } from '../dawnsbury/chooser.mjs';
import { clearSightPath } from './attack-path.mjs';
import { environmentBetween } from './environment-zones.mjs';
import { detectionFor, stealthRecord, stealthContext, stealthConditionStamp, refreshStealthVisibility } from './stealth-awareness.mjs';
import { rememberTargets } from './target-memory.mjs';
import { nonvisualSense } from './perception-senses.mjs';

const ns='foundry-creature-ai';
export function registerPerceptionSettings(){
  game.settings.register(ns,'seekScope',{name:'NPC Seek search scope',scope:'world',config:true,type:String,default:'field',
    choices:{field:'Simplified: all opposing creatures not blocked by LOS',area:'Bounded: 15-foot search area within 30 feet'},
    hint:'Field search is a simplified rule: one secret Perception roll across the visible field. Walls, elevation, invisibility and individual Stealth DCs still apply.'});
}
export function seekScope(){
  try{return game.settings?.get(ns,'seekScope')==='area'?'area':'field';}catch{return 'field';}
}
const position=token=>Object.fromEntries(['x','y','elevation','level','width','height','depth'].map(key=>
  [key,(token.document._source??token.document)[key]??(['width','height','depth'].includes(key)?1:key==='elevation'?0:null)]));
export function seekArea(square) {
  return {x:square.x+square.width*canvas.grid.size/2,y:square.y+square.height*canvas.grid.size/2,
    elevation:square.elevation,level:square.level,radius:15};
}
export function inSeekArea(token,area) {
  if(token.document.elevation!==area.elevation||token.document.level!==area.level)return false;
  const grid=canvas.grid.size;
  for(let x=0;x<Math.ceil(token.document.width);x++)for(let y=0;y<Math.ceil(token.document.height);y++){
    const point={x:(token.document.x+(x+0.5)*grid)/grid,y:(token.document.y+(y+0.5)*grid)/grid};
    if(tileDistance(point,{x:area.x/grid,y:area.y/grid})*canvas.grid.distance<=area.radius)return true;
  }
  return false;
}

export async function executeSeek(adapter,choice,ledger,{canContinue=()=>true}={}) {
  const observer=adapter.token,actor=adapter.actor,context=stealthContext();
  const valid=()=>canContinue()&&adapter.turnKey()===ledger.turn&&!game.paused&&game.users.activeGM?.id===game.user.id&&
    canvas.scene?.id===context.sceneId&&canvas.tokens.get(observer.id)===observer&&!adapter.turnEndReason();
  if(!valid())return {skipped:true,pause:true,skipReason:'Stopped before Seek began'};
  const blind=actor.hasCondition('blinded'),sense=blind?nonvisualSense(observer):null;
  if(blind&&!sense)throw new Error('No usable sense for automatic Seek');
  const statistic=actor.getStatistic('perception');
  if(!statistic?.check?.roll)throw new Error('This creature has no native Perception roll');
  const field=choice.searchScope==='field',area=field?null:seekArea(choice.searchPosition);
  // Capture GM truth only after choosing the scope. It never influences the
  // area centre, availability, utility, or the creature's narrative intent.
  const subjects=adapter.targetIds().map(id=>adapter.assessTarget(id,{pursuit:true}).target).filter(subject=>subject&&!subject.document.hidden&&
    subject.actor?.hitPoints?.value>0&&subject.document.elevation===observer.document.elevation&&subject.document.level===observer.document.level&&
    (field||inSeekArea(subject,area))&&(blind?nonvisualSense(observer,subject):clearSightPath(observer,subject))).map(subject=>({
      subject,start:detectionFor(observer,subject),position:position(subject),stamp:stealthConditionStamp(subject),
      record:JSON.stringify(stealthRecord(subject))}));
  const roll=await statistic.check.roll({skipDialog:true,action:'seek',traits:['concentrate','secret'],
    rollMode:'blindroll',extraRollOptions:[`${ns}:managed`,'secret','action:seek','skip-handling-message']});
  if(!roll||!Number.isFinite(roll.total))throw new Error('Seek was cancelled or unresolved; inspect the spent action');
  if(!valid())throw new Error('The turn changed during Seek; inspect the spent action');
  const die=roll.dice?.find(d=>d.faces===20)?.total;
  if(!Number.isInteger(die))throw new Error('Cannot determine the native Perception d20 result');
  const results=[],knowledge=[];
  for(const candidate of subjects){
    const {subject,start}=candidate;
    if(!['hidden','undetected'].includes(start.state))continue;
    if(canvas.tokens.get(subject.id)!==subject||JSON.stringify(position(subject))!==JSON.stringify(candidate.position)||
      stealthConditionStamp(subject)!==candidate.stamp||JSON.stringify(stealthRecord(subject))!==candidate.record){
      results.push(`${subject.name}: changed during Seek; its newer detection state was retained`);continue;
    }
    const statistic=subject.actor.getStatistic('stealth'),dc=statistic?.dc?.value;
    if(!Number.isFinite(dc))throw new Error(`Cannot determine ${subject.name}'s native Stealth DC`);
    const cover=environmentBetween(observer,subject).stealthBonus;
    const existing=Math.max(0,...(statistic.dc?.modifiers??statistic.modifiers??[]).filter(m=>m.type==='circumstance'&&m.enabled!==false&&!m.ignored).map(m=>m.modifier??m.value??0));
    const degree=checkDegree(die,roll.total-die,dc+Math.max(0,cover-existing));
    if(degree<2){results.push(`${subject.name}: not located`);continue;}
    const imprecise=blind&&nonvisualSense(observer,subject)?.acuity!=='precise';
    const state=imprecise||subject.actor.hasCondition('invisible')||start.state==='undetected'&&degree===2?'hidden':'observed';
    const saved=stealthRecord(subject),entries=(saved?.entries??[]).filter(entry=>entry.observerId!==observer.id);
    entries.push({observerId:observer.id,state,knownPosition:position(subject),source:'seek',conditionStamp:candidate.stamp,
      sense:imprecise?nonvisualSense(observer,subject)?.type:null,
      precisionBlocked:imprecise||subject.actor.hasCondition('invisible')});
    if(!valid())throw new Error('The turn changed before detection was updated');
    await subject.document.setFlag(ns,'stealth',{...context,moving:false,entries});
    knowledge.push({subjectId:subject.id,state,knownPosition:candidate.position});
    results.push(`${subject.name}: ${state}`);
  }
  // Mirror this observer's current knowledge without touching anyone else's
  // results or deleting global/manual/granted conditions on the subject.
  const saved=observer.document.getFlag(ns,'perception');
  const previous=saved?.sceneId===context.sceneId&&(saved.combatId??null)===context.combatId?saved.entries??[]:[];
  const entries=new Map(previous.map(entry=>[entry.subjectId,entry]));
  for(const result of knowledge)entries.set(result.subjectId,result);
  if(valid()&&knowledge.length)await observer.document.setFlag(ns,'perception',{...context,entries:[...entries.values()]});
  await rememberTargets(adapter,valid);refreshStealthVisibility();
  return {resolved:true,lastAction:{kind:'seek'},note:`Seek (${blind?sense.type+'; ':''}${field?'simplified field':'15-foot search area'}): ${results.join('; ')||'no additional creature located'}.`};
}
