import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {PF2eSpellcasterAdapter} from '../src/foundry/spellcaster-adapter.mjs';
import {creatureProfile} from '../src/foundry/creature-profiles.mjs';
import {dragonActivities} from '../src/foundry/cinder-dragon-adapter.mjs';
import {spellBindings} from '../src/foundry/spell-catalog.mjs';
import {spellDefinition} from '../src/framework/spell-definitions.mjs';
import {executeSpell} from '../src/foundry/spellcasting.mjs';
import {counterspell,monsterStrikeEffects} from '../src/foundry/monster-reactions.mjs';
import {resolveFrightfulPresence,siphonLife} from '../src/foundry/monster-abilities.mjs';
import {boxInVolume} from '../src/shared/area-volume.mjs';
import {iceBlocksRay} from '../src/foundry/ice-wall-geometry.mjs';
import {damageIceSection} from '../src/foundry/ice-wall-controls.mjs';
import {preparedStrikeCandidates} from '../src/framework/strike-capability.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {createAdvancedZone,advanceWeather,createBlizzard} from '../src/foundry/spell-weather.mjs';
import {concealmentCheck} from '../src/foundry/environment-rolls.mjs';
import {consumeSureStrike} from '../src/foundry/spell-attack-buffs.mjs';
import {environmentBetween} from '../src/foundry/environment-zones.mjs';
const ns='foundry-creature-ai',data=Object.fromEntries(await Promise.all(['lich','cinder-dragon-young','cinder-dragon-caster-young'].map(async k=>[k,JSON.parse(await readFile(new URL(`./fixtures/${k}-mechanics.json`,import.meta.url)))])));
function setup(kind='lich'){
 const f=fixture({npcData:data[kind],Adapter:PF2eSpellcasterAdapter,size:24});
 f.player.document.x=f.boss.document.x+200;f.player.document.y=f.boss.document.y;f.player.actor.modeOfBeing='living';
 f.boss.document.unsetFlag=async(namespace,key)=>f.boss.document.setFlag(namespace,key,undefined);
 const BaseRoll=globalThis.Roll;globalThis.Roll=class extends BaseRoll{constructor(formula){super(formula);this.testFormula=formula;}async evaluate(){return this.testFormula==='1d4'?{total:2,toMessage:async m=>f.calls.push(['recharge',m])}:super.evaluate();}};
 for(const entry of f.actor.itemTypes.spellcastingEntry){entry.statistic.dc.value=entry.system.spelldc.dc;entry.statistic.check.mod=entry.system.spelldc.value;}
 for(const item of f.actor.itemTypes.spell)item.loadVariant=({castRank})=>({...item,rank:castRank});
 let regionSequence=0;const scene=canvas.scene;
 const create=async(type,rows)=>{assert.equal(type,'Region');return rows.map(row=>{const r=new CONFIG.Region.documentClass(structuredClone(row));r.id=`zone-${++regionSequence}`;r.parent=scene;
  r.setFlag=async(namespace,key,value)=>{(r.flags[namespace]??={})[key]=structuredClone(value);};r.update=async changes=>Object.assign(r,changes);scene.regions.contents.push(r);return r;});};
 scene.createEmbeddedDocuments=create;f.boss.document.parent.createEmbeddedDocuments=create;
 scene.deleteEmbeddedDocuments=async(_type,ids)=>{scene.regions.contents=scene.regions.contents.filter(r=>!ids.includes(r.id));};
 for(const token of canvas.tokens.placeables)token.document.testInsideRegion=(r,p=token.document)=>p.elevation<(r.elevation?.top??Infinity)&&p.elevation+5>(r.elevation?.bottom??-Infinity)&&r.testPoint({x:p.x+token.w/2,y:p.y+token.h/2,elevation:p.elevation+2.5});
 return f;
}
const snap=async f=>f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false});
test('all three supplied exports select their actual taught kits and share only the spells they own',async()=>{
 for(const [key,id]of [['lich','lich'],['cinder-dragon-young','cinder-dragon'],['cinder-dragon-caster-young','cinder-dragon']]){
  const f=setup(key);assert.equal(creatureProfile(f.actor).id,id);const s=await snap(f);assert.equal(f.adapter.profileId,key==='cinder-dragon-caster-young'?'cinder-dragon-caster':id);
  if(s.dragon)assert.equal(s.dragon.frenzy,key==='cinder-dragon-young');
 }
});
test('every combat spell in the exports has a reusable resolver, while utility spells remain explicit',()=>{
 const utility=new Set(['locate','detect-magic','message','telekinetic-hand','cleanse-cuisine','read-aura','sigil','ventriloquism']);
 for(const a of Object.values(data))for(const item of a.items.filter(i=>i.type==='spell'))assert.equal(Boolean(spellDefinition(item.system.slug)),!utility.has(item.system.slug),item.name);
});
test('the martial dragon forecasts three Frenzy Strikes; the caster variant never invents Frenzy',async()=>{
 const f=setup('cinder-dragon-young');f.player.document.x=f.boss.document.x+100;const s=await snap(f),frenzy=dragonActivities(s).find(c=>c.kind==='draconicFrenzy');assert.ok(frenzy);
 assert.equal(frenzy.actionCost,2);assert.equal(frenzy.mapIncreases,3);assert.equal(frenzy.sequence.length,3);
 const names=frenzy.sequence.map(c=>f.actor.items.get(c.strikeId).name).sort();assert.deepEqual(names,['Claw','Claw','Wing']);
 await f.adapter.executeProfileAction(frenzy,{...s,turn:f.adapter.turnKey(),attacksMade:3},{canContinue:()=>true});
 assert.deepEqual(f.calls.filter(c=>c[0]==='attack').map(c=>c[3]),[0,1,2]);
 const caster=setup('cinder-dragon-caster-young');caster.player.document.x=caster.boss.document.x+100;assert.equal(dragonActivities(await snap(caster)).some(c=>c.kind==='draconicFrenzy'),false);
});
test('a downward volume cone reaches grounded prey but excludes creatures above or behind its origin',()=>{
 const v={type:'cone',origin:{x:0,y:0,z:25},direction:{x:0,y:0,z:-1},range:40};
 assert.equal(boxInVolume({x:5,y:5,z:0,width:5,height:5,depth:5},v),true);
 assert.equal(boxInVolume({x:0,y:0,z:30,width:5,height:5,depth:5},v),false);
 assert.equal(boxInVolume({x:40,y:40,z:0,width:5,height:5,depth:5},v),false);
});
test('an airborne dragon commits Pyre Breath, applies its fire rider, creates smoke and records recharge without consuming a spell',async()=>{
 const f=setup('cinder-dragon-young');f.boss.document.elevation=20;f.saveDegree=0;
 const state=await snap(f),choice=dragonActivities(state).find(c=>c.kind==='pyreBreath');assert.ok(choice,'downward breath must reach the grounded target');
 const result=await f.adapter.executeProfileAction(choice,{...state,turn:f.adapter.turnKey()},{canContinue:()=>true});
 assert.equal(result.resolved,true);assert.equal(f.boss.document.getFlag(ns,'pyreRecharge').round,game.combat.round+2);
 assert.ok(canvas.scene.regions.contents.some(r=>r.flags?.[ns]?.obscuring?.smoke));assert.ok(f.player.actor.itemTypes.condition.some(c=>c.slug==='persistent-damage'&&c.system.persistent.damageType==='fire'));
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,0);
});
test('a complete Lich turn commits casting resources and finishes without entering an unresolved action',async()=>{
 const f=setup(),result=await new TurnRunner(f.adapter).run();assert.equal(result.uncertain,false);assert.ok(result.done||result.actionsRemaining===0);assert.ok(f.calls.some(c=>c[0]==='consume-spell'));
});
test('a complete dragon turn takes off and uses a real offensive action rather than only hovering',{timeout:20000},async()=>{
 const f=setup('cinder-dragon-young');canvas.dimensions.sceneRect=new PIXI.Rectangle(0,0,1000,1000);f.player.document.x=600;f.player.document.y=400;
 const result=await new TurnRunner(f.adapter).run();assert.equal(result.uncertain,false);assert.ok(result.done||result.actionsRemaining===0);
 assert.ok(f.calls.some(c=>c[0]==='move'),'the dragon should use its flight');assert.ok(f.calls.some(c=>c[0]==='attack'||c[0]==='spell-save'),'the turn should include a Strike or breath save');
});
test('Draconic Momentum belongs only to the martial dragon and recharges on an actual critical Strike',async()=>{
 const f=setup('cinder-dragon-young');await f.boss.document.setFlag(ns,'pyreRecharge',{round:9});
 await f.adapter.momentum({lastAction:{critical:false}});assert.equal(f.boss.document.getFlag(ns,'pyreRecharge').round,9);
 await f.adapter.momentum({lastAction:{critical:true}});assert.equal(f.boss.document.getFlag(ns,'pyreRecharge'),undefined);
 const caster=setup('cinder-dragon-caster-young');await caster.boss.document.setFlag(ns,'pyreRecharge',{round:9});await caster.adapter.momentum({lastAction:{critical:true}});assert.equal(caster.boss.document.getFlag(ns,'pyreRecharge').round,9);
});
test('Frightful Presence resolves once per source per minute and does not invent Fleeing on a critical failure',async()=>{
 const f=setup();f.saveDegree=0;await resolveFrightfulPresence(f.boss,f.player);await resolveFrightfulPresence(f.boss,f.player);
 assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,1);assert.equal(f.player.actor.hasCondition('frightened'),true);assert.equal(f.player.actor.hasCondition('fleeing'),false);
 game.time.worldTime=61;await resolveFrightfulPresence(f.boss,f.player);assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,2);
});
test('Counterspell consumes an unexpended matching prepared slot and one reaction',async()=>{
 const f=setup(),spell=f.actor.itemTypes.spell.find(s=>s.slug==='fire-shield'),entry=f.actor.itemTypes.spellcastingEntry[0];
 entry.counteraction={check:{roll:async()=>({degreeOfSuccess:2})}};spell.spellcasting={statistic:{dc:{value:25}}};let reservations=0;
 const engine={available:t=>t===f.boss,exclusive:async(_t,fn)=>fn(),reserve:async()=>{reservations++;return {};},confirm:async()=>{},prompts:{ask:async()=> 'counter'}};
 assert.equal(await counterspell(engine,{source:f.player,spell}),true);assert.equal(reservations,1);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell'&&c[1]==='fire-shield').length,1);
 assert.equal(await counterspell(engine,{source:f.player,spell}),false,'an expended prepared copy cannot be used twice');
});
test('Drain Soul Cage offers an independent daily casting resource, including an expended spell',()=>{
 const f=setup(),cage=f.actor.itemTypes.action.find(a=>a.slug==='lich-drain-soul-cage');cage.system.frequency.value=1;
 const entry=f.actor.itemTypes.spellcastingEntry[0],slot=entry.system.slots.slot6.prepared[0];slot.expended=true;
 const bindings=spellBindings(f.actor).filter(b=>b.spell.id===slot.id);assert.equal(bindings.some(b=>b.soulCage===cage),true);assert.equal(bindings.some(b=>!b.soulCage),false);
});
test('Chain Lightning ends at a critical save and rolls no later target saves or damage',async()=>{
 const f=setup(),s=await snap(f),spell=s.spells.find(s=>s.slug==='chain-lightning');f.saveDegree=3;
 const ledger=await f.adapter.readLedger(f.adapter.turnKey());
 const result=await executeSpell(f.adapter,{kind:'castSpell',spellId:spell.id,spellSlug:spell.slug,entryId:spell.entryId,bindingId:spell.bindingId,castRank:spell.castRank,slotId:spell.slotId,targetId:f.player.id,targetIds:[f.player.id],actionCost:2},ledger);
 assert.equal(result.resolved,true);assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,1);assert.equal(f.calls.filter(c=>c[0]==='damage-applied').length,0);
});
test('Siphon Life gives five temporary HP and caps accumulated Drained at four',async()=>{
 const f=setup();f.player.actor.getCondition=(slug,options)=>slug==='drained'?options?.all?[{value:3}]:{value:3}:null;let applied;
 f.player.actor.update=async changes=>{if(changes['system.attributes.hp.value']!==undefined)f.player.actor.hitPoints.value=changes['system.attributes.hp.value'];};
 f.player.actor.increaseCondition=async(slug,options)=>{applied={slug,...options};};await siphonLife(f.boss,f.player);
 assert.equal(f.actor.hitPoints.temp,5);assert.equal(applied.slug,'drained');assert.equal(applied.value,1);assert.equal(applied.max,4);
 const hp=f.player.actor.hitPoints.value;applied=null;f.player.actor.getCondition=slug=>slug==='drained'?{value:4}:null;await siphonLife(f.boss,f.player);assert.equal(applied,null);assert.equal(f.player.actor.hitPoints.value,hp);
});
test('a bounded ice wall blocks below its top but allows a ray above it; sections take hardness and fire weakness',async()=>{
 const f=setup(),wall={id:'ice',flags:{[ns]:{iceWall:{rank:5,expiresAt:60,segments:[{x:300,y:0,width:20,height:600,bottom:0,top:10,hp:40}]}}},setFlag:async function(_ns,key,value){this.flags[ns][key]=value;},parent:canvas.scene};
 canvas.scene.regions.contents.push(wall);assert.equal(iceBlocksRay(canvas.scene,{x:100,y:100,elevation:5},{x:500,y:100,elevation:5}),true);
 assert.equal(iceBlocksRay(canvas.scene,{x:100,y:100,elevation:15},{x:500,y:100,elevation:15}),false);
 const first=await damageIceSection(wall,0,20,'physical');assert.equal(first.hp,30);
 const second=await damageIceSection(wall,0,30,'fire');assert.equal(second.hp,0);assert.equal(iceBlocksRay(canvas.scene,{x:100,y:100,elevation:5},{x:500,y:100,elevation:5}),false);
});
test('Strike setup value expires when its follow-up actions no longer fit',()=>{
 const state={actionsRemaining:3,attacksMade:0,self:{referenceAC:20},strikes:[{id:'claw',bonus:15,damage:10,mapPenalties:[0,-5,-10],onHitBenefits:[{minimumActions:2,value:5},{minimumActions:3,value:10}]}],enemies:[{id:'foe',strikes:{claw:{usable:true}}}]};
 const three=preparedStrikeCandidates(state)[0].assessment.value,two=preparedStrikeCandidates({...state,actionsRemaining:2})[0].assessment.value,one=preparedStrikeCandidates({...state,actionsRemaining:1})[0].assessment.value;
 assert.ok(three>two&&two>one);assert.equal(preparedStrikeCandidates({...state,actionsRemaining:1})[0].scoringTerms.some(t=>t.label.includes('on-hit')),false);
});
test('Boiling Blood consumes the ordinary reaction and cannot respond again before it refreshes',async()=>{
 const f=setup('cinder-dragon-young'),strike={item:{type:'weapon',isMelee:true,traits:new Set(['unarmed'])}},hp=f.player.actor.hitPoints.value;
 await monsterStrikeEffects(f.reactions,{source:f.player,target:f.boss,strike,degree:3,stage:'hit'});
 assert.ok(f.player.actor.hitPoints.value<hp);assert.equal(f.reactions.available(f.boss),false);const count=f.calls.filter(c=>c[0]==='spell-save').length;
 await monsterStrikeEffects(f.reactions,{source:f.player,target:f.boss,strike,degree:3,stage:'hit'});assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,count);
});
test('Sure Strike bypasses attack targeting checks, does not bypass a save spell check, and is consumed after one attack',async()=>{
 const f=setup(),[effect]=await f.actor.createEmbeddedDocuments('Item',[{name:'Sure Strike',type:'effect',system:{slug:'spell-effect-sure-strike',rules:[]},flags:{[ns]:{supportSpell:{slug:'sure-strike'}}}}]);
 globalThis.Roll=class{async evaluate(){return {total:1,toMessage:async()=>{}};}};
 assert.equal(await concealmentCheck(f.boss,f.player,{dc:11,attack:true}),true);assert.equal(await concealmentCheck(f.boss,f.player,{dc:11,attack:false}),false);
 await consumeSureStrike(f.actor);assert.equal(f.actor.items.has(effect.id),false);assert.equal(await concealmentCheck(f.boss,f.player,{dc:11,attack:true}),false);
});
test('Shield cantrip permits Shield Block against magical cold without requiring the feat',async()=>{
 const f=setup(),[effect]=await f.player.actor.createEmbeddedDocuments('Item',[{name:'Shield',type:'effect',system:{slug:'spell-effect-shield',rules:[]}}]);
 f.player.actor.attributes.shield={itemId:effect.id,raised:true,broken:false,destroyed:false,hardness:15};
 const cold={total:10,instances:[{type:'cold',total:10,persistent:false}]},spell=f.actor.itemTypes.spell.find(s=>s.slug==='frostbite');
 assert.equal(f.reactions.inspectShieldBlock(f.player,{damage:cold,item:spell}).eligible,true);
 assert.equal(f.reactions.inspectShieldBlock(f.player,{damage:cold}).eligible,false,'nonmagical cold is not covered by this exception');
});
test('Toxic Cloud ticks once per turn on a breathing creature, not on undead, and drifts on the following caster turn',async()=>{
 const f=setup(),spell=f.actor.itemTypes.spell.find(s=>s.slug==='toxic-cloud'),entry=f.actor.itemTypes.spellcastingEntry[0],area={shapes:[{type:'ellipse',x:f.player.center.x,y:f.player.center.y,radiusX:400,radiusY:400,rotation:0}]};
 await createAdvancedZone(f.adapter,spell,entry,{area},spellDefinition(spell));const region=canvas.scene.regions.contents[0],hp=f.player.actor.hitPoints.value;
 const combatant={id:'target-turn',tokenId:f.player.id};await advanceWeather(combatant);await advanceWeather(combatant);assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,1);assert.ok(f.player.actor.hitPoints.value<hp);
 f.player.actor.modeOfBeing='undead';game.combat.round++;await advanceWeather(combatant);assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,1);
 const x=region.shapes[0].x;await advanceWeather({id:'caster-turn',tokenId:f.boss.id});assert.equal(region.shapes[0].x,x+200);
});
test('Blizzard terrain ends at the caster next start, rather than at an earlier combatant turn',async()=>{
 const f=setup(),spell=f.actor.itemTypes.spell.find(s=>s.slug==='howling-blizzard'),area={shapes:[{type:'rectangle',x:500,y:500,width:100,height:100}]};await createBlizzard(f.adapter,area,spell);
 game.combat.round++;await advanceWeather({id:'other',tokenId:f.player.id});assert.equal(canvas.scene.regions.contents.length,1);
 await advanceWeather({id:'caster',tokenId:f.boss.id});assert.equal(canvas.scene.regions.contents.length,0);
});
