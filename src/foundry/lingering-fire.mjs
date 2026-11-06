import {environmentBehavior,hazardBehavior} from './terrain-contract.mjs';
import {spellDefenseCheck} from './spell-checks.mjs';
import {detectionFor} from './stealth-awareness.mjs';
import {clearSightPath,clearAttackPath} from './attack-path.mjs';
import {averageFormula} from '../framework/math.mjs';
const ns='foundry-creature-ai',locks=new WeakMap();
const fire=region=>region.flags?.[ns]?.lingeringFire;
const contents=()=>canvas.scene?.regions?.contents??[];
const inside=(token,region,position)=>token.document.testInsideRegion(region,position??token.document._source??token.document);
export async function createLingeringFire(adapter,spell,entry,choice,definition,{castId}={}){
 const damage=await spell.getDamage({skipDialog:true});if(!damage?.template?.damage?.roll)throw new Error('No native lingering spell damage');
 // DamageRoll.formula is a localized display string in PF2e. Serialize the
 // underlying formula, preserving damage types and native elite modifiers.
 const nativeRoll=damage.template.damage.roll,formula=nativeRoll.toJSON?.().formula??nativeRoll._formula??nativeRoll.formula,data={slug:spell.slug,sourceTokenId:adapter.token.id,spellId:spell.id,dc:entry.statistic.dc.value,
  castId:castId??null,formula,rank:spell.rank,expiresAt:game.time.worldTime+definition.duration,hitRounds:{},lastTurn:null};
 const behaviors=[];
 if(definition.wall){behaviors.push(environmentBehavior({enabled:true,cover:'none',coverMode:'intervening',concealment:'through',firingRadius:0}));
  let estimate=formula.replace(/\[[^\]]*\]/g,'').replace(/[{}()\s]/g,'');try{averageFormula(estimate);}catch{estimate=`${spell.rank}d6`;}
  const hazard=hazardBehavior({formula:estimate,damageType:'fire',frequency:'crossing'});hazard.system.events=['tokenMoveIn'];behaviors.push(hazard);}
 const [region]=await adapter.token.document.parent.createEmbeddedDocuments('Region',[{name:`${spell.name}: ${adapter.token.name}`,shapes:choice.area.shapes,
  elevation:{bottom:adapter.token.document.elevation,top:adapter.token.document.elevation+(definition.wall?10:5)},levels:adapter.token.document.level?[adapter.token.document.level]:[],
  color:'#ee6611',visibility:CONST.REGION_VISIBILITY?.ALWAYS??0,behaviors,flags:{[ns]:{lingeringFire:data}}}],{renderSheet:false});
 if(!definition.wall)await resolveFireDamage(region,canvas.tokens.placeables.filter(t=>t.actor?.isOfType?.('creature')&&inside(t,region)));
 return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id},note:definition.wall?'Wall of Fire burns on crossing and at turn start, and conceals through its flames.':'Floating Flame is active; Sustain can move it 10 feet and damage a creature at most once per round.'};
}
export async function resolveFireDamage(region,targets,{startTurn=false}={}){
 const task=(locks.get(region)??Promise.resolve()).catch(()=>{}).then(async()=>{
  const data=fire(region);if(!data||data.expiresAt<=game.time.worldTime)return;
  const round=`${game.combat?.id??'time'}:${game.combat?.round??Math.floor(game.time.worldTime/6)}`,
   valid=targets.filter(t=>t.actor?.hitPoints&&t.actor.hitPoints.value>0&&(data.slug!=='floating-flame'||data.hitRounds[t.id]!==round)&&(!startTurn||data.startRounds?.[t.id]!==round));
  if(!valid.length)return;
  const source=canvas.tokens.get(data.sourceTokenId),spell=source?.actor.items.get(data.spellId),DamageRoll=CONFIG.Dice.rolls.find(c=>c.name==='DamageRoll');
  const roll=await new DamageRoll(data.formula).evaluate();await roll.toMessage({speaker:ChatMessage.getSpeaker({token:source?.document}),flavor:region.name,
   flags:{[ns]:{managed:true},'xdy-pf2e-workbench':{noAutoDamageRoll:true},pf2e:{suppressDamageButtons:true,origin:spell?.getOriginData(),context:{options:[`${ns}:managed`,'skip-handling-message']}}}});
  for(const token of valid){const degree=data.slug==='floating-flame'?await spellDefenseCheck(token,{dc:data.dc,statistic:'reflex',origin:source,spell,label:region.name}):1;
   data.hitRounds[token.id]=round;if(startTurn){data.startRounds??={};data.startRounds[token.id]=round;}if(degree===3)continue;
   const factor=degree===0?2:degree===2?0.5:1,damage=factor===1?roll:roll.alter(factor,0);
   await token.actor.applyDamage({damage,token:token.document,item:spell,rollOptions:new Set([`${ns}:managed`,'magical','fire','skip-handling-message']),outcome:['criticalFailure','failure','success','criticalSuccess'][degree]});}
  await region.setFlag(ns,'lingeringFire',data);
 });locks.set(region,task);try{return await task;}finally{if(locks.get(region)===task)locks.delete(region);}
}
export async function sustainFloatingFire(actor,cast){
 const region=contents().find(r=>fire(r)?.castId===cast.id);if(!region)return;
 const source=canvas.tokens.get(cast.sourceTokenId),shape=region.shapes[0],size=canvas.grid.size;
 if(!source||shape.type!=='rectangle')return;
 const round=`${game.combat?.id??'time'}:${game.combat?.round??Math.floor(game.time.worldTime/6)}`;
 const enemies=canvas.tokens.placeables.filter(t=>t.actor?.hitPoints?.value>0&&t.actor.isEnemyOf(actor)&&fire(region).hitRounds[t.id]!==round&&!t.document.hidden&&detectionFor(source,t).state==='observed'&&clearSightPath(source,t));
 let best={score:0,path:[],shape};
 for(const dx of [-2,-1,0,1,2])for(const dy of [-2,-1,0,1,2]){if(Math.max(Math.abs(dx),Math.abs(dy))+Math.floor(Math.min(Math.abs(dx),Math.abs(dy))/2)>2)continue;
  const steps=Math.max(Math.abs(dx),Math.abs(dy),1),path=Array.from({length:steps+1},(_,i)=>({type:'rectangle',x:shape.x+Math.round(dx*i/steps)*size,y:shape.y+Math.round(dy*i/steps)*size,width:size,height:size}));
  if(path.some(p=>p.x<canvas.dimensions.sceneRect.x||p.y<canvas.dimensions.sceneRect.y||p.x+size>canvas.dimensions.sceneRect.right||p.y+size>canvas.dimensions.sceneRect.bottom))continue;
  const from={x:shape.x+size/2,y:shape.y+size/2,elevation:region.elevation.bottom};
  if(path.some(p=>source.checkCollision({x:p.x+size/2,y:p.y+size/2,elevation:from.elevation},{origin:from,type:'move',mode:'any'})))continue;
  const within=t=>path.some(p=>t.document.x<p.x+size&&t.document.x+t.w>p.x&&t.document.y<p.y+size&&t.document.y+t.h>p.y&&t.document.elevation===from.elevation);
  const hits=enemies.filter(within),allies=canvas.tokens.placeables.filter(t=>t.actor?.isAllyOf(actor)&&within(t));
  const score=hits.length-allies.length*3;if(score>best.score)best={score,path,shape:path.at(-1)};
 }
 const hit=new Set(canvas.tokens.placeables.filter(t=>t.actor?.isOfType?.('creature')&&inside(t,region)));
 for(const p of best.path){await region.update({shapes:[p]});for(const token of canvas.tokens.placeables)if(token.actor?.isOfType?.('creature')&&inside(token,region))hit.add(token);}
 await region.update({shapes:[best.shape]});await resolveFireDamage(region,[...hit]);
}
export async function endLingeringFire({castId,sourceTokenIds=[]}={}){
 const ids=contents().filter(r=>fire(r)&&(castId&&fire(r).castId===castId||sourceTokenIds.includes(fire(r).sourceTokenId)||fire(r).expiresAt<=game.time.worldTime)).map(r=>r.id);
 if(ids.length)await canvas.scene.deleteEmbeddedDocuments('Region',ids);
}
export function installLingeringFire({reactions,onError}){
 Hooks.on('pf2e.startTurn',c=>{if(game.users.activeGM?.id!==game.user.id)return;const token=canvas.tokens.get(c.tokenId);if(!token)return;
  void reactions.resolve(async()=>{for(const region of contents())if(fire(region)?.slug==='wall-of-fire'&&inside(token,region))await resolveFireDamage(region,[token],{startTurn:true});}).catch(onError);});
 Hooks.on('updateWorldTime',()=>{if(game.users.activeGM?.id===game.user.id)void reactions.resolve(()=>endLingeringFire()).catch(onError);});
}
