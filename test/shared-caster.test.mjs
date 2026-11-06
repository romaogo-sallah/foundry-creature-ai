import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {casterCatalog,resolveSpellBinding} from '../src/foundry/spell-catalog.mjs';
import {spellDefinition,constructSpellDefinition,registerSpellDefinition,replaceCustomSpellDefinitions} from '../src/framework/spell-definitions.mjs';
import {genericCastingCandidates} from '../src/framework/generic-casting.mjs';
import {executeSpell} from '../src/foundry/spellcasting.mjs';
import {cleanupDefinedSpells} from '../src/foundry/defined-spell-effects.mjs';
import {executeRetch} from '../src/foundry/manual-condition-actions.mjs';
import {creatureProfile,createCreatureAdapter,registerCreatureProfile} from '../src/foundry/creature-profiles.mjs';
import {PF2eBasicNPCAdapter} from '../src/foundry/basic-npc-adapter.mjs';
import {ongoingCasts,endSustainedCast,sustainCast} from '../src/foundry/ongoing-spells.mjs';
import {spellAllyOf,spellEnemyOf} from '../src/foundry/spell-alliance.mjs';
import {installSpellRegionFixture} from './helpers/spell-regions.mjs';
import {casterTurnCandidates} from '../src/framework/caster-planning.mjs';
import {applyDefinedSpellEffects} from '../src/foundry/defined-spell-effects.mjs';
import {aerialAttackCandidates} from '../src/framework/spike-volley.mjs';
import {wrapConditionSave,installManualConditionSpells} from '../src/foundry/manual-condition-spells.mjs';
const ns='foundry-creature-ai',item=(f,slug)=>f.actor.itemTypes.spell.find(s=>s.slug===slug);
async function select(f,slug,cost=2){const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false});
 const choice=genericCastingCandidates(state).find(c=>c.spellSlug===slug&&c.actionCost===cost);assert.ok(choice,`${slug} has a legal native binding`);return {choice,ledger,state};}
test('an unrelated NPC automatically reuses taught spells from both innate and spontaneous entries',async()=>{
 const f=fixture();assert.equal(creatureProfile(f.actor).id,'spellcaster');const catalog=casterCatalog(f.actor);
 assert.ok(catalog.descriptors.some(s=>s.slug==='daze'));assert.ok(catalog.descriptors.some(s=>s.slug==='phantom-pain'));
 assert.equal(catalog.entries.length,2);assert.ok(catalog.unsupported.some(s=>s.name==='Darkness'));
 const {state}=await select(f,'phantom-pain');assert.equal(state.diagnostics.castingEntries.length,2);assert.equal(state.maxForecastActions,10);
});
test('a caster without a melee weapon has spell candidates and no invented Strike',async()=>{
 const f=fixture();f.actor.system.actions=[];const {state}=await select(f,'force-barrage',1);
 assert.equal(f.adapter.parts().native.length,0);assert.equal(f.adapter.candidates(state).some(c=>c.kind==='strike'),false);
});
test('a taught martial kit gains spell components without losing its identity or native Strikes',async()=>{
 const f=fixture();f.actor.sourceId='Actor.test-martial-caster';
 class Martial extends PF2eBasicNPCAdapter{get profileId(){return 'test-martial-caster';}}
 registerCreatureProfile({id:'test-martial-caster',label:'Martial caster test',roles:['bruiser'],Adapter:Martial,matches:a=>a.sourceId==='Actor.test-martial-caster'});
 f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});const {state}=await select(f,'force-barrage',1);
 assert.equal(f.adapter.profileId,'test-martial-caster');assert.equal(f.adapter.hasSpellcasting,true);
 f.player.document.x=300;const nearby=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false});
 const choices=f.adapter.candidates(nearby);assert.ok(choices.some(c=>c.kind==='strike'));assert.ok(choices.some(c=>c.kind==='castSpell'));
 assert.ok(state.behavior.configuration.components.includes('spellcasting'));
});
test('prepared spells bind actual slot rank/index and expire only that prepared slot',async()=>{
 const f=fixture(),s=item(f,'phantom-pain'),entry=f.actor.itemTypes.spellcastingEntry[0];entry.system.prepared.value='prepared';
 entry.system.slots.slot1.prepared=[{id:s.id,expended:false},{id:s.id,expended:true}];
 const {choice,ledger}=await select(f,'phantom-pain');assert.equal(choice.slotId,0);
 await executeSpell(f.adapter,choice,ledger);assert.equal(entry.system.slots.slot1.prepared[0].expended,true);
 assert.equal(resolveSpellBinding(f.actor,choice),undefined);assert.equal(entry.system.slots.slot1.value,4);
});
test('focus spells share the native focus pool and retain their own focus cost',()=>{
 const f=fixture(),s=item(f,'soothe'),entry=f.actor.itemTypes.spellcastingEntry[0];s.isFocusSpell=true;s.system.cast={focusPoints:2};f.actor.system.resources={focus:{value:2,max:3}};
 const descriptor=casterCatalog(f.actor).descriptors.find(d=>d.slug==='soothe');assert.equal(descriptor.poolId,'focus');assert.equal(descriptor.resourceCost,2);assert.equal(descriptor.available,true);
 f.actor.system.resources.focus.value=1;assert.equal(casterCatalog(f.actor).descriptors.find(d=>d.slug==='soothe').available,false);
});
test('innate uses are individual spell resources and never consume a spontaneous slot',async()=>{
 const f=fixture(),s=item(f,'phantom-pain'),entry=f.actor.itemTypes.spellcastingEntry[1];s.system.location={value:entry.id,uses:{value:2,max:2}};
 const {choice,ledger}=await select(f,'phantom-pain');await executeSpell(f.adapter,choice,ledger);
 assert.equal(s.system.location.uses.value,1);assert.equal(f.actor.itemTypes.spellcastingEntry[0].system.slots.slot1.value,4);
 assert.equal(f.calls.find(c=>c[0]==='consume-spell')[3],entry.id);
});
test('at-will innate casts do not spend their zero-use counter',async()=>{
 const f=fixture(),s=item(f,'force-barrage'),entry=f.actor.itemTypes.spellcastingEntry[1];s.system.location={value:entry.id,uses:{value:0,max:0}};s.atWill=true;
 const {choice,ledger}=await select(f,'force-barrage',1);await executeSpell(f.adapter,choice,ledger);
 assert.equal(s.system.location.uses.value,0);assert.equal(f.calls.some(c=>c[0]==='consume-spell'),false);
});
for(const cost of [1,2,3])test(`Force Barrage uses ${cost} actions, one slot, independent combined shard dice and no MAP`,async()=>{
 const f=fixture(),{choice,ledger}=await select(f,'force-barrage',cost);const result=await executeSpell(f.adapter,choice,ledger);
 assert.equal(choice.mapIncreases,0);assert.equal(ledger.attacksMade,0);assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);
 assert.ok(f.calls.some(c=>c[0]==='native-damage-formula'&&c[1]===`(${cost}d4+${cost})[force]`));assert.equal(result.resolved,true);
});
for(const degree of [0,1,2,3])test(`Phantom Pain outcome ${degree} applies its non-basic damage, recovery condition and persistent source`,async()=>{
 const f=fixture({saveDegree:degree}),{choice,ledger}=await select(f,'phantom-pain');await executeSpell(f.adapter,choice,ledger);
 assert.equal(f.calls.filter(c=>c[0]==='damage-applied').length,degree===3?0:1);
 if(degree<3)assert.equal(f.calls.find(c=>c[0]==='damage-applied')[2].damage.total,10,'success is full damage; critical failure is not double initial damage');
 assert.equal(f.player.actor.hasCondition('sickened'),degree<2);assert.equal(f.player.actor.hasCondition('persistent-damage'),degree<2);
 if(degree<2){assert.equal(f.player.actor.getCondition('sickened').value,degree===0?2:1);assert.equal(f.player.actor.getCondition('sickened').getFlag(ns,'dc'),24);}
});
test('Retch can recover from Phantom Pain; linked cleanup preserves unrelated persistent damage',async()=>{
 const f=fixture(),{choice,ledger}=await select(f,'phantom-pain');await executeSpell(f.adapter,choice,ledger);
 const unrelated={name:'Other fire',type:'condition',system:{slug:'persistent-damage',value:{value:null},persistent:{formula:'1d6',damageType:'fire',dc:15}},flags:{}};
 const [other]=await f.player.actor.createEmbeddedDocuments('Item',[unrelated]);
 f.saveDegree=2;await executeRetch(f.player);assert.equal(f.player.actor.hasCondition('sickened'),false);
 await cleanupDefinedSpells();assert.equal(f.player.actor.items.has(other.id),true);
 assert.equal([...f.player.actor.items.values()].some(i=>i.flags?.[ns]?.definedSpell),false);
});
test('timed spell cleanup and actor reset remove only their own effects and resources stay spent',async()=>{
 const f=fixture(),{choice,ledger}=await select(f,'phantom-pain');await executeSpell(f.adapter,choice,ledger);game.time.worldTime=61;
 await cleanupDefinedSpells();assert.equal(f.player.actor.hasCondition('sickened'),false);assert.equal(f.player.actor.hasCondition('persistent-damage'),false);
 assert.equal(f.actor.itemTypes.spellcastingEntry[0].system.slots.slot1.value,3);
});
test('deleting a source effect cleans its remaining spell-owned conditions',async()=>{
 const f=fixture(),{choice,ledger}=await select(f,'phantom-pain');await executeSpell(f.adapter,choice,ledger);
 const root=f.player.actor.itemTypes.effect.find(i=>i.flags?.[ns]?.definedSpell?.isRoot);
 await f.player.actor.deleteEmbeddedDocuments('Item',[root.id]);await cleanupDefinedSpells();
 assert.equal(f.player.actor.hasCondition('sickened'),false);assert.equal(f.player.actor.hasCondition('persistent-damage'),false);
});
test('Soothe heals an injured self and installs a timed native mental-defense modifier',async()=>{
 const f=fixture();f.actor.hitPoints.value-=20;const before=f.actor.hitPoints.value,{choice,ledger}=await select(f,'soothe');
 assert.equal(choice.targetId,f.boss.id);await executeSpell(f.adapter,choice,ledger);assert.equal(f.actor.hitPoints.value,before+10);
 const effect=f.actor.itemTypes.effect.find(e=>e.flags?.[ns]?.definedSpell?.slug==='soothe');
 assert.deepEqual(effect.system.rules[0],{key:'FlatModifier',selector:'saving-throw',type:'status',value:2,predicate:['item:trait:mental']});
 game.time.worldTime=61;await cleanupDefinedSpells();assert.equal(f.actor.items.has(effect.id),false);
});
test('ordinary healing excludes dead allies and rechecks death before spending a slot',async()=>{
 const f=fixture();f.actor.hitPoints.value-=20;const {choice,ledger}=await select(f,'soothe');f.actor.isDead=true;
 assert.equal((await executeSpell(f.adapter,choice,ledger)).skipped,true);assert.equal(f.calls.some(c=>c[0]==='consume-spell'),false);
 const state=await f.adapter.snapshot(ledger,{movement:false});assert.equal(genericCastingCandidates(state).some(c=>c.spellSlug==='soothe'&&c.targetId===f.boss.id),false);
});
test('a stale target or unavailable resource is rejected before any spell is consumed',async()=>{
 const f=fixture(),{choice,ledger}=await select(f,'force-barrage',1);f.player.document.x=100000;
 const result=await executeSpell(f.adapter,choice,ledger);assert.equal(result.skipped,true);assert.equal(f.calls.some(c=>c[0]==='consume-spell'),false);
});
test('spell constructor requires explicit outcomes for non-basic saves and accepts reusable taught profiles',()=>{
 const f=fixture();assert.throws(()=>constructSpellDefinition({...item(f,'phantom-pain'),slug:'unknown-pain'}),/outcome table/);
 const s=item(f,'daze'),profile=constructSpellDefinition(s,{slug:'shared-bolt',outcomes:[{damage:2,conditions:[{slug:'clumsy',value:1}]},{damage:1},{damage:0.5},{damage:0}],duration:12});
 registerSpellDefinition(profile);assert.equal(spellDefinition('shared-bolt').duration,12);
 replaceCustomSpellDefinitions([{...profile,slug:'daze'}]);replaceCustomSpellDefinitions([]);assert.equal(spellDefinition('daze').outcomes[0].conditions[0].slug,'stunned');
});
test('Forbidding Ward protects a distinct ally against a chosen foe and ends with its maintained cast',async()=>{
 const f=fixture(),ally=f.addOgre('ally',500,300);installSpellRegionFixture(canvas.tokens.placeables);ally.actor.signature='ally-sig';f.player.actor.signature='foe-sig';
 const {choice,ledger}=await select(f,'forbidding-ward');assert.equal(choice.targetId,ally.id);assert.equal(choice.wardEnemyId,f.player.id);
 await executeSpell(f.adapter,choice,ledger);const cast=ongoingCasts(f.actor).find(c=>c.slug==='forbidding-ward');assert.ok(cast);
 const effect=ally.actor.itemTypes.effect.find(i=>i.flags?.[ns]?.definedSpell);
 assert.deepEqual(effect.system.rules[0].predicate,['origin:signature:foe-sig']);
 assert.equal(effect.system.rules[0].value,1);assert.deepEqual(effect.system.rules[0].selector,['ac','saving-throw']);
 game.combat.round=2;await sustainCast(f.actor,cast.id);await endSustainedCast(f.actor,cast.id);assert.equal(ally.actor.items.has(effect.id),false);
});
test('Paranoia changes ally treatment through source flags, without granting Confused behavior',()=>{
 const actor={flags:{[ns]:{noAllies:true,hostileReactions:true}}},other={};
 assert.equal(spellAllyOf.call(actor,()=>true,other),false);assert.equal(spellEnemyOf.call(actor,()=>false,other),true);
 assert.equal(actor.flags[ns].confused,undefined);actor.flags[ns]={};assert.equal(spellAllyOf.call(actor,()=>true,other),true);
});
test('a manual Paranoia save awaits the shared relationship effect without applying damage',async()=>{
 const f=fixture(),spell=item(f,'paranoia'),message={id:'manual-paranoia',author:game.user,speaker:{token:f.player.id},
  flags:{pf2e:{origin:{uuid:spell.uuid},context:{type:'saving-throw',outcome:'failure'}}},rolls:[{degreeOfSuccess:1}]};
 game.messages=new Map([[message.id,message]]);globalThis.fromUuid=async()=>spell;
 installManualConditionSpells({reactions:f.reactions});
 await wrapConditionSave(async(_check,context,_event,callback)=>{
  assert.ok(context.options.has('skip-handling-message'));await callback({degreeOfSuccess:1},'failure',message);return {degreeOfSuccess:1};
 },{},{type:'saving-throw',item:spell,options:new Set()},null,async()=>{});
 assert.equal(f.player.actor.flags[ns].noAllies,true);assert.equal(f.calls.some(c=>c[0]==='damage-applied'),false);
});
test('Telekinetic Maneuver uses a native spell attack against Reflex and counts its MAP',async()=>{
 const f=fixture(),entry=f.actor.itemTypes.spellcastingEntry[0];let context;
 entry.statistic.check.roll=async options=>{context=options;return {degreeOfSuccess:2};};
 const {choice,ledger}=await select(f,'telekinetic-maneuver');assert.equal(choice.mapIncreases,1);
 await executeSpell(f.adapter,choice,{...ledger,attacksMade:2});assert.equal(context.attackNumber,2);assert.equal(context.dc.slug,'reflex');
 assert.equal(f.player.actor.hasCondition('prone'),true);
 const {state}=await select(f,'force-barrage',1);assert.equal(genericCastingCandidates(state).some(c=>c.spellSlug==='telekinetic-maneuver'),false);
});
test('one-action spell forecasts cannot spend the same last slot three times',async()=>{
 const f=fixture(),s=item(f,'force-barrage'),entry=f.actor.itemTypes.spellcastingEntry[0];entry.system.slots.slot1.value=1;
 const {state}=await select(f,'force-barrage',1);state.spells=state.spells.filter(d=>d.slug==='force-barrage');state.moves=[];
 const plans=casterTurnCandidates(state,{actions:genericCastingCandidates});
 assert.ok(plans.length);for(const plan of plans)assert.equal(plan.features.turnPlan.filter(a=>a.kind==='castSpell').length,1);
});
test('aerial attack forecasts include supported ranged spells rather than only weapons',async()=>{
 const f=fixture(),{state}=await select(f,'force-barrage',1);
 assert.ok(aerialAttackCandidates(state).some(c=>c.spellSlug==='force-barrage'));assert.equal(f.adapter.preferRangedFlight(state),true);
});
test('a taught simple attack uses its native attack roll and critical damage rather than automatic hits',async()=>{
 const f=fixture(),s=item(f,'force-barrage');s.slug='test-spell-attack';s.system.slug=s.slug;s.isAttack=true;s.system.time.value='2';
 registerSpellDefinition({slug:s.slug,kind:'attack',actionCosts:[2]});let attacks=0;
 s.rollAttack=async()=>{attacks++;return {degreeOfSuccess:3};};
 const {choice,ledger}=await select(f,s.slug);assert.equal(choice.mapIncreases,1);await executeSpell(f.adapter,choice,{...ledger,attacksMade:1});
 assert.equal(attacks,1);assert.equal(f.calls.find(c=>c[0]==='damage-applied')[2].damage.total,20);
});
test('phase-based reaction denial waits for the caster start and has an outside-combat fallback',async()=>{
 const f=fixture(),s=item(f,'phantom-pain'),definition={outcomes:[{}, {damage:0,noReactions:true,until:'caster-start',duration:6},{},{}]};
 await applyDefinedSpellEffects({source:{actor:f.actor,token:f.boss},target:f.player,spell:s,definition,degree:1,dc:24});
 assert.equal(f.player.actor.flags.pf2e.noUseReactions,true);game.time.worldTime=6;
 await cleanupDefinedSpells();assert.equal(f.player.actor.flags.pf2e.noUseReactions,true);
 game.combat.round=2;await cleanupDefinedSpells({token:f.boss,phase:'start',round:2});assert.equal(f.player.actor.flags.pf2e.noUseReactions,undefined);
 await applyDefinedSpellEffects({source:{actor:f.actor,token:f.boss},target:f.player,spell:s,definition,degree:1,dc:24});
 game.combat.started=false;game.time.worldTime+=6;await cleanupDefinedSpells();assert.equal(f.player.actor.flags.pf2e.noUseReactions,undefined);
});
