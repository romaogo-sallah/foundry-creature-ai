import {createObscuringZone} from './monster-abilities.mjs';
import {spellDefenseCheck,SPELL_OPTIONS} from './spell-checks.mjs';
import {clearAttackPath} from './attack-path.mjs';
import {spellZoneVisibility} from './spell-zone-visibility.mjs';
const ns='foundry-creature-ai',active=()=>canvas.scene?.regions?.contents??[],weather=r=>r.flags?.[ns]?.weather;
export async function createAdvancedZone(adapter,spell,entry,choice,definition){
 if(definition.ice)return createIceWall(adapter,spell,choice);
 const flags={slug:spell.slug,sourceTokenId:adapter.token.id,spellId:spell.id,dc:entry.statistic.dc.value,rank:spell.rank,round:game.combat?.round??0};
 if(spell.slug==='toxic-cloud'){
  const damage=await spell.getDamage({skipDialog:true}),roll=damage?.template?.damage?.roll;
  if(!roll)throw new Error('Toxic Cloud has no native damage formula');flags.formula=roll.toJSON?.().formula??roll._formula??roll.formula;
  const shape=choice.area.shapes[0],dx=shape.x-adapter.token.center.x,dy=shape.y-adapter.token.center.y,len=Math.hypot(dx,dy)||1;
  flags.drift={x:dx/len*canvas.grid.size*2,y:dy/len*canvas.grid.size*2};flags.hitTurns={};
 }
 const regions=await createObscuringZone(adapter.token,{name:`${spell.name}: ${adapter.token.name}`,area:choice.area,duration:definition.duration,flags});
 return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id},note:`${spell.name} is active${flags.formula?'; breathing creatures save at turn start; it drifts 10 feet per round':''}.`,regionIds:regions.map(r=>r.id)};
}
export async function createBlizzard(adapter,area,spell){
 const [region]=await adapter.token.document.parent.createEmbeddedDocuments('Region',[{name:'Howling Blizzard: difficult terrain',shapes:area.shapes,elevation:{bottom:area.volume?area.volume.origin.z-area.volume.range:adapter.token.document.elevation,top:area.volume?area.volume.origin.z+area.volume.range:adapter.token.document.elevation+60},
  levels:adapter.token.document.level?[adapter.token.document.level]:[],color:'#98cfee',visibility:spellZoneVisibility(),behaviors:[{type:'modifyMovementCost',name:'Blizzard difficult terrain',system:{difficulties:{walk:2,fly:2}}}],
  flags:{[ns]:{weather:{slug:spell.slug,sourceTokenId:adapter.token.id,expiresAt:game.time.worldTime+6,untilSourceStart:true,combatId:game.combat?.id,round:game.combat?.round??0}},'pf2e-toolbelt':{targetHelper:{skip:true}}}}],{renderSheet:false});return region;
}
export async function createIceWall(adapter,spell,choice){
 const size=canvas.grid.size,thickness=size/5,shape=choice.area.shapes[0],horizontal=shape.width>shape.height,
  segments=Array.from({length:Math.max(1,Math.round((horizontal?shape.width:shape.height)/(size*2)))},(_,i)=>({x:shape.x+(horizontal?i*size*2:0),y:shape.y+(horizontal?0:i*size*2),width:horizontal?size*2:thickness,height:horizontal?thickness:size*2,
   bottom:adapter.token.document.elevation,top:adapter.token.document.elevation+10,hp:40+Math.floor((spell.rank-5)/2)*10}));
 if(segments.some(s=>canvas.tokens.placeables.some(t=>t.document.x<s.x+s.width&&t.document.x+t.w>s.x&&t.document.y<s.y+s.height&&t.document.y+t.h>s.y&&t.document.elevation<s.top&&t.document.elevation+5>s.bottom)))return {resolved:true,note:'The ice wall could not form in an unbroken open space; the cast remains spent.'};
 await adapter.token.document.parent.createEmbeddedDocuments('Region',[{name:`Wall of Ice: ${adapter.token.name}`,shapes:segments.map(s=>({type:'rectangle',x:s.x,y:s.y,width:s.width,height:s.height})),elevation:{bottom:adapter.token.document.elevation,top:adapter.token.document.elevation+10},levels:adapter.token.document.level?[adapter.token.document.level]:[],
  color:'#73bce6',visibility:spellZoneVisibility(),flags:{[ns]:{iceWall:{segments,rank:spell.rank,sourceTokenId:adapter.token.id,expiresAt:game.time.worldTime+60}},'pf2e-toolbelt':{targetHelper:{skip:true}}}}],{renderSheet:false});
 return {resolved:true,lastAction:{kind:'castSpell',spellId:spell.id},note:'Wall of Ice blocks movement and sight for 1 minute. Each section has Hardness 10 and separate HP; use Ice walls to attack a section.'};
}
export async function advanceWeather(combatant,{reactions}={}){
 const token=canvas.tokens.get(combatant.tokenId);if(!token)return;
 for(const region of active()){
  const data=region.flags?.[ns]?.obscuring;if(data?.slug!=='toxic-cloud'||data.expiresAt<=game.time.worldTime)continue;
  if(data.sourceTokenId===token.id&&data.round!==(game.combat?.round??0)){
   const shape=region.shapes[0],candidate={...shape.toObject?.()??shape,x:shape.x+data.drift.x,y:shape.y+data.drift.y},from={x:shape.x,y:shape.y,elevation:region.elevation.bottom+5},to={x:candidate.x,y:candidate.y,elevation:from.elevation};
   if(!token.checkCollision(to,{origin:from,type:'move',mode:'any'}))await region.update({shapes:[candidate]});
   await region.setFlag(ns,'obscuring',{...data,round:game.combat.round});
  }
  const turn=`${game.combat.id}:${game.combat.round}:${combatant.id}`;
  if(data.hitTurns?.[token.id]===turn||!token.document.testInsideRegion(region)||token.actor.modeOfBeing!=='living'||(token.actor.itemTypes.action??[]).some(a=>/no breath|doesn.t breathe/i.test(a.name)))continue;
  const source=canvas.tokens.get(data.sourceTokenId),spell=source?.actor.items.get(data.spellId);if(!source||!spell)continue;
  if(token.actor.isImmuneTo?.(spell))continue;
  await region.setFlag(ns,'obscuring',{...region.flags[ns].obscuring,hitTurns:{...data.hitTurns,[token.id]:turn}});
  const degree=await spellDefenseCheck(token,{dc:data.dc,statistic:'fortitude',origin:source,spell,label:'Toxic Cloud'});if(degree===3)continue;
  const DamageRoll=CONFIG.Dice.rolls.find(c=>c.name==='DamageRoll'),damage=await new DamageRoll(data.formula).evaluate();
  await damage.toMessage({speaker:ChatMessage.getSpeaker({token:source.document}),flavor:'Toxic Cloud',flags:{[ns]:{managed:true},pf2e:{suppressDamageButtons:true,context:{options:SPELL_OPTIONS}}}});
  await token.actor.applyDamage({damage:degree===0?damage.alter(2,0):degree===2?damage.alter(0.5,0):damage,token:token.document,item:spell,rollOptions:new Set(SPELL_OPTIONS)});
 }
 const expired=active().filter(r=>weather(r)?.slug==='howling-blizzard'&&weather(r).sourceTokenId===token.id&&weather(r).round<game.combat.round).map(r=>r.id);
 if(expired.length)await canvas.scene.deleteEmbeddedDocuments('Region',expired);
}
export function installWeather({reactions,onError}){
 Hooks.on('pf2e.startTurn',c=>{if(game.users.activeGM?.id===game.user.id)void reactions.resolve(()=>advanceWeather(c,{reactions})).catch(onError);});
 Hooks.on('updateWorldTime',()=>{if(game.users.activeGM?.id!==game.user.id)return;
  const ids=active().filter(r=>{const w=weather(r);return (w?.expiresAt??r.flags?.[ns]?.iceWall?.expiresAt??Infinity)<=game.time.worldTime&&(!w?.untilSourceStart||!game.combat?.started||w.combatId!==game.combat.id);}).map(r=>r.id);if(ids.length)void reactions.resolve(()=>canvas.scene.deleteEmbeddedDocuments('Region',ids)).catch(onError);});
}
export async function resetAdvancedZones(sourceTokenIds){
 const ids=active().filter(r=>sourceTokenIds.includes((r.flags?.[ns]?.obscuring??weather(r)??r.flags?.[ns]?.iceWall)?.sourceTokenId)).map(r=>r.id);
 if(ids.length)await canvas.scene.deleteEmbeddedDocuments('Region',ids);
}
