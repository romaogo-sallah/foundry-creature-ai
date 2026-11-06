import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture as casterFixture} from './helpers/modular-caster-fixture.mjs';
import {PF2eVampireAdapter} from '../src/foundry/vampire-adapter.mjs';
import {createCreatureAdapter,creatureProfile} from '../src/foundry/creature-profiles.mjs';
import {casterCatalog} from '../src/foundry/spell-catalog.mjs';
import {genericCastingCandidates} from '../src/framework/generic-casting.mjs';
import {executeSpell} from '../src/foundry/spellcasting.mjs';
import {applyDomination,dominateImmune,effectiveAlliance,advanceDomination} from '../src/foundry/domination.mjs';
import {drinkBlood,vampireGrab,releaseVampireGrabs,bloodEligible} from '../src/foundry/vampire-blood.mjs';
import {mistEscapeRoute} from '../src/foundry/vampire-escape.mjs';
import {vampireDamage,ensureMistEscape,setVampireForm,resolveVampireHealing} from '../src/foundry/vampire-lifecycle.mjs';
import {configureVampire,advanceVampireState} from '../src/foundry/vampire-controls.mjs';
import {applySupportSpell,endHostileInvisibility} from '../src/foundry/support-spells.mjs';
import {spellDefinition} from '../src/framework/spell-definitions.mjs';
import {applyDefinedSpellEffects,cleanupDefinedSpells} from '../src/foundry/defined-spell-effects.mjs';
import {resolveFireDamage,sustainFloatingFire} from '../src/foundry/lingering-fire.mjs';
import {createFireShield,raiseFireShield,prepareFireShieldDamage,finishFireShieldDamage} from '../src/foundry/fire-shield.mjs';
import {incapacitationReason,encounterOutcome} from '../src/foundry/combat-state.mjs';
import {installSpellRegionFixture} from './helpers/spell-regions.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {flightLost} from '../src/foundry/flight-falling.mjs';
import {manualConditionViolation} from '../src/foundry/condition-actions.mjs';
import {createLingeringFire} from '../src/foundry/lingering-fire.mjs';
const ns='foundry-creature-ai',data=Object.fromEntries(await Promise.all(['guardian','count','mastermind'].map(async key=>[key,JSON.parse(await readFile(new URL(`./fixtures/vampire-${key}-mechanics.json`,import.meta.url)))])));
function fixture(kind='count',options={}){const f=casterFixture({...options,npcData:data[kind],Adapter:PF2eVampireAdapter});f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 f.player.actor.modeOfBeing='living';f.boss.document.actorLink=false;
 f.player.actor.increaseCondition=async(slug,{value=1}={})=>{const existing=f.player.actor.getCondition(slug);if(existing?.system)existing.system.value.value+=value;
  else{const raw=game.pf2e.ConditionManager.getCondition(slug)?.toObject();if(raw){raw.system.value.value=value;await f.player.actor.createEmbeddedDocuments('Item',[raw]);}else f.player.actor.conditionsSet.add(slug);}};
 for(const actor of [f.actor,f.player.actor])actor.update=async change=>{if(change['system.attributes.hp.value']!=null)actor.hitPoints.value=change['system.attributes.hp.value'];};
 return f;}
for(const kind of ['guardian','count','mastermind'])test(`${kind} is recognized and binds its distinct at-will Dominate`,async()=>{
 const f=fixture(kind);assert.equal(creatureProfile(f.actor).id,`vampire-${kind}`);
 const catalog=casterCatalog(f.actor),dom=catalog.descriptors.find(s=>s.slug==='dominate');assert.ok(dom.available);assert.equal(dom.cantrip,false);assert.equal(dom.unlimited,true);
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(ledger,{movement:false});assert.ok(s.spells.some(s=>s.slug==='dominate'));
});
test('Mastermind native prepared ranks and group buff choices are preserved',async()=>{
 const f=fixture('mastermind'),ledger=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(ledger,{movement:false});
 assert.ok(s.spells.some(s=>s.slug==='dispel-magic'&&s.castRank===3));assert.ok(s.spells.some(s=>s.slug==='fireball'&&s.castRank===3));
 assert.ok(genericCastingCandidates(s).some(c=>c.spellSlug==='haste'));assert.ok(s.spells.some(s=>s.slug==='floating-flame'));
});
for(const [kind,drain,heal]of [['guardian',1,13],['count',2,10],['mastermind',2,10]])test(`${kind} applies its own Drink Blood numbers and no repeat healing`,async()=>{
 const f=fixture(kind);f.actor.hitPoints.value=40;f.player.actor.conditionsSet.add('restrained');await drinkBlood(f.adapter,f.player);
 assert.equal(f.player.actor.getCondition('drained').value,drain);assert.equal(f.actor.hitPoints.value,40+heal);
 const hp=f.actor.hitPoints.value;await drinkBlood(f.adapter,f.player);assert.equal(f.player.actor.getCondition('drained').value,drain+1);assert.equal(f.actor.hitPoints.value,hp);
});
test('Dominate immunity is vampire-specific; 0 HP alone does not end existing control',async()=>{
 const f=fixture(),spell=f.actor.itemTypes.spell.find(s=>s.slug==='dominate'),source={actor:f.actor,token:f.boss};
 await applyDomination({source,target:f.player,spell,degree:2,dc:22});assert.equal(dominateImmune(f.player.actor,f.boss.id),true);assert.equal(dominateImmune(f.player.actor,'other-vampire'),false);
 await applyDomination({source,target:f.player,spell,degree:1,dc:22});assert.equal(effectiveAlliance(f.player.actor),f.actor.alliance);
 f.actor.hitPoints.value=0;f.saveDegree=1;await advanceDomination(f.player,'end');assert.equal(f.player.actor.hasCondition('controlled'),true);
 f.saveDegree=2;await advanceDomination(f.player,'end');assert.equal(f.player.actor.hasCondition('controlled'),false);
});
test('Mist Escape remains mobile and damage immune at 0 HP and prevents a premature battle stop',async()=>{
 const f=fixture();f.actor.hitPoints.value=0;await f.actor.setFlag(ns,'vampire',{form:'mist',escape:true,expiresAt:7200});
 assert.equal(incapacitationReason(f.boss),null);assert.equal(encounterOutcome(),null);
 let applied=0;await vampireDamage.call(f.actor,async()=>{applied++;},{damage:100});assert.equal(applied,0);
 const route=mistEscapeRoute(f.boss);assert.ok(route.path.length);assert.ok(route.cost<=10);
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(ledger,{movement:false}),choice=f.adapter.decide(s).chosen;
 assert.equal(choice.kind,'mistFly');assert.equal(choice.actionCost,1);
 f.boss.document.x=0;assert.equal(mistEscapeRoute(f.boss).atEdge,true);
});
for(const kinds of [['guardian'],['count'],['mastermind'],['guardian','count'],['guardian','mastermind'],['count','mastermind'],['guardian','count','mastermind'],['mastermind','mastermind','guardian','count']])test(`mixed encounter: ${kinds.join(', ')} retain independent profiles, resources and allies`,async()=>{
 const f=fixture(kinds[0]),vamps=[f.boss];for(let i=1;i<kinds.length;i++){
  const actor=f.makeActor(`vamp-${i}`,data[kinds[i]]);for(const type of ['spell','spellcastingEntry'])Object.defineProperty(actor.itemTypes,type,{get:()=>[...actor.items.values()].filter(item=>item.type===type)});
  const t=f.token(`vamp-${i}`,actor,200,300+i*100);vamps.push(t);game.combat.combatants.push({id:`c-vamp-${i}`,tokenId:t.id,sceneId:'scene',actor});
 }
 installSpellRegionFixture(canvas.tokens.placeables);
 for(let i=0;i<vamps.length;i++){assert.equal(creatureProfile(vamps[i].actor).id,`vampire-${kinds[i]}`);assert.ok(vamps[i].actor.isAllyOf(vamps.at(-1).actor));}
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(ledger,{movement:false});assert.deepEqual(s.enemies.map(e=>e.id),[f.player.id]);assert.equal(s.casterAllies.length,vamps.length);
 await f.actor.setFlag(ns,'vampire',{form:'mist',escape:true,expiresAt:7200});for(const t of vamps.slice(1))assert.equal(t.actor.getFlag(ns,'vampire'),undefined);
});
test('Grab spends its own action without MAP, restrains on critical success and expires after next turn',async()=>{
 const f=fixture(),claw=f.adapter.parts().native.find(s=>s.item.name==='Claw');f.player.document.x=300;
 const original=f.actor.getStatistic;f.actor.getStatistic=slug=>slug==='athletics'?{dc:{value:27},check:{roll:async options=>{f.calls.push(['grab-check',options]);return {degreeOfSuccess:3};}}}:original(slug);
 const ledger=await f.adapter.readLedger(f.adapter.turnKey());await vampireGrab(f.adapter,f.player,{...ledger,lastAction:{hit:true,targetId:f.player.id,strikeId:claw.item.id}});
 assert.equal(f.player.actor.hasCondition('restrained'),true);assert.equal(f.calls.find(c=>c[0]==='grab-check')[1].attackNumber,1);
 let s=await f.adapter.snapshot(ledger,{movement:false});assert.equal(f.adapter.extraCasterActions(s).find(c=>c.kind==='grab').mapIncreases,0);
 await releaseVampireGrabs({phase:'end',source:f.boss.id,round:1});assert.equal(f.player.actor.hasCondition('restrained'),true);
 await releaseVampireGrabs({phase:'end',source:f.boss.id,round:2});assert.equal(f.player.actor.hasCondition('restrained'),false);
});
test('Rapier cannot unlock Grab and blood cannot be drunk from undead or constructs',async()=>{
 const f=fixture(),rapier=f.adapter.parts().native.find(s=>s.item.name==='Rapier');
 assert.equal((await vampireGrab(f.adapter,f.player,{lastAction:{hit:true,targetId:f.player.id,strikeId:rapier.item.id}})).skipped,true);
 for(const type of ['undead','construct'])assert.equal(bloodEligible({modeOfBeing:type}),false);
 f.player.actor.modeOfBeing='undead';f.player.actor.conditionsSet.add('restrained');assert.equal((await drinkBlood(f.adapter,f.player)).skipped,true);
});
test('Drink Blood check may fail; only new victims heal and overflow creates temporary HP',async()=>{
 const f=fixture();f.player.actor.conditionsSet.add('grabbed');f.actor.getStatistic=()=>({dc:{value:27},check:{roll:async()=>({degreeOfSuccess:1})}});
 const hp=f.actor.hitPoints.value;await drinkBlood(f.adapter,f.player);assert.equal(f.actor.hitPoints.value,hp);assert.equal(f.player.actor.hasCondition('drained'),false);
 f.player.actor.conditionsSet.add('restrained');f.actor.hitPoints.value=f.actor.hitPoints.max-3;await drinkBlood(f.adapter,f.player);assert.equal(f.actor.hitPoints.temp,7);
 assert.equal(f.player.actor.hitPoints.value,100-f.player.actor.level*2);
});
for(const kind of ['guardian','count','mastermind'])test(`${kind} keeps its exported Drained 5 death rule`,async()=>{
 const f=fixture(kind);f.player.actor.conditionsSet.add('restrained');await f.player.actor.increaseCondition('drained',{value:4});await drinkBlood(f.adapter,f.player);
 assert.equal(f.player.actor.hasCondition('dead'),kind!=='guardian');
});
test('Haste enables only extra Strike/Stride; Slowed uses that extra action first',async()=>{
 const f=fixture(),spell={slug:'haste',name:'Haste',rank:3,uuid:'spell.haste'};globalThis.fromUuid=async()=>({toObject:()=>({name:'Haste',type:'effect',system:{rules:[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.nlCjDvLMf2EkV2dl',inMemoryOnly:true}]}})});
 await applySupportSpell({actor:f.actor,token:f.boss},f.boss,spell,spellDefinition('haste'));
 const l=await f.adapter.readLedger(f.adapter.turnKey());assert.equal(l.bonusMovementActions,1);assert.equal(l.actionsRemaining,3);
 f.player.document.x=300;const s=await f.adapter.snapshot({...l,actionsRemaining:0},{movement:false}),extra=f.adapter.candidates(s).filter(c=>c.bonusActionCost===1);
 assert.ok(extra.some(c=>c.kind==='strike'));assert.ok(extra.every(c=>['stride','strike'].includes(c.kind)));
 f.actor.conditionsSet.add('slowed');const next=await f.adapter.readLedger('other-turn');assert.equal(next.bonusMovementActions,0);assert.equal(next.actionsRemaining,3);
});
test('Drain Bonded Item only recovers an expended preparation before other actions',async()=>{
 const f=fixture('mastermind'),entry=f.actor.itemTypes.spellcastingEntry.find(e=>e.system.prepared.value==='prepared'),slot=Object.values(entry.system.slots.slot3.prepared)[0];slot.expended=true;
 const bond=f.actor.itemTypes.action.find(a=>a.name==='Drain Bonded Item');assert.ok(casterCatalog(f.actor).bindings.some(b=>b.bonded===bond));
 await f.boss.document.setFlag(ns,'vampireActions',{turn:f.adapter.turnKey()});assert.ok(casterCatalog(f.actor).bindings.every(b=>!b.bonded));
});
test('Invisibility ends after a hostile action at rank 2 but not rank 4',async()=>{
 for(const rank of [2,4]){const f=fixture(),spell={slug:'invisibility',name:'Invisibility',rank,uuid:'spell.invisibility'};
  await applySupportSpell({actor:f.actor,token:f.boss},f.boss,spell,spellDefinition('invisibility'));assert.equal(f.actor.hasCondition('invisible'),true);
  await endHostileInvisibility(f.boss);assert.equal(f.actor.hasCondition('invisible'),rank>=4);}
});
test('Dizzying Colors separates short blindness and full-round stun from longer effects',async()=>{
 const f=fixture('mastermind'),spell=f.actor.itemTypes.spell.find(s=>s.slug==='dizzying-colors'),definition=spellDefinition(spell);
 await applyDefinedSpellEffects({source:{actor:f.actor,token:f.boss},target:f.player,spell,definition,degree:1,dc:29});
 game.time.worldTime=6;game.combat.round=2;await cleanupDefinedSpells({token:f.boss,phase:'start'});assert.equal(f.player.actor.hasCondition('blinded'),false);assert.equal(f.player.actor.hasCondition('dazzled'),true);
 await applyDefinedSpellEffects({source:{actor:f.actor,token:f.boss},target:f.boss,spell,definition,degree:0,dc:29});assert.equal(f.actor.flags.pf2e.noActions,true);
 game.time.worldTime=12;game.combat.round=3;await cleanupDefinedSpells({token:f.boss,phase:'start'});assert.equal(f.actor.flags.pf2e.noActions,undefined);assert.equal(f.actor.hasCondition('blinded'),true);
});
test('Floating Flame damages at most once per creature per round; Wall has no saving throw',async()=>{
 const f=fixture('mastermind'),flame=f.actor.itemTypes.spell.find(s=>s.slug==='floating-flame'),region={name:'Flame',flags:{[ns]:{lingeringFire:{slug:'floating-flame',sourceTokenId:f.boss.id,spellId:flame.id,formula:'3d6[fire]',dc:29,expiresAt:60,hitRounds:{}}}},setFlag:async(_n,k,v)=>{region.flags[ns][k]=v;}};
 await resolveFireDamage(region,[f.player]);const hp=f.player.actor.hitPoints.value;await resolveFireDamage(region,[f.player]);assert.equal(f.player.actor.hitPoints.value,hp);
 game.combat.round++;await resolveFireDamage(region,[f.player]);assert.ok(f.player.actor.hitPoints.value<hp);
 const saves=f.calls.filter(c=>c[0]==='spell-save').length;region.flags[ns].lingeringFire.slug='wall-of-fire';await resolveFireDamage(region,[f.player],{startTurn:true});
 assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,saves);const after=f.player.actor.hitPoints.value;await resolveFireDamage(region,[f.player],{startTurn:true});assert.equal(f.player.actor.hitPoints.value,after);
});
test('Sunlight grows Slowed until no actions remain; coffin restoration requires a real marked coffin and no stake',async()=>{
 const f=fixture();await configureVampire(f.boss,{sunlight:true});await advanceVampireState(f.boss,'start');assert.equal(incapacitationReason(f.boss),null);
 await advanceVampireState(f.boss,'end');assert.equal(f.actor.getFlag(ns,'vampire').sunlightValue,2);assert.equal(incapacitationReason(f.boss),null);
 await advanceVampireState(f.boss,'end');assert.equal(f.actor.getFlag(ns,'vampire').sunlightValue,2);game.combat.round++;
 await advanceVampireState(f.boss,'end');assert.equal(incapacitationReason(f.boss),'destroyed');
 await configureVampire(f.boss,{coffin:true,staked:true});game.time.worldTime=3601;await advanceVampireState(f.boss,'time');assert.equal(f.actor.hitPoints.value,0);
 await configureVampire(f.boss,{coffin:true});game.time.worldTime+=3600;await advanceVampireState(f.boss,'time');assert.equal(f.actor.hitPoints.value,1);
});
test('Fast Healing yields to Workbench and never heals mist or a staked vampire',async()=>{
 const f=fixture();f.actor.hitPoints.value=30;game.i18n={localize:k=>k};const message={actor:f.actor,isDamageRoll:true,rolls:[{total:7,kinds:new Set(['healing'])}],flavor:'PF2E.Encounter.Broadcast.FastHealing.fast-healing.ReceivedMessage',token:f.boss.document};
 game.modules.set('xdy-pf2e-workbench',{active:true});game.settings.get=()=>true;await resolveVampireHealing(message);assert.equal(f.actor.hitPoints.value,30);
 game.modules.clear();await resolveVampireHealing(message);assert.equal(f.actor.hitPoints.value,37);
 await f.actor.setFlag(ns,'vampire',{form:'mist'});await resolveVampireHealing(message);assert.equal(f.actor.hitPoints.value,37);
});
test('Mist completes its escape and passes the turn while other combatants remain',async()=>{
 const f=fixture();f.addOgre('ally');f.actor.hitPoints.value=0;await f.actor.setFlag(ns,'vampire',{form:'mist',escape:true,expiresAt:7200});
 f.actor.conditionsSet.add('unconscious');assert.equal(flightLost(f.boss),false);
 f.flags.get(`token-boss:${ns}:config`).autoAdvance=true;f.adapter.report=async()=>{};
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(f.actor.getFlag(ns,'vampire').escaped,true);assert.equal(ledger.done,true);assert.equal(f.calls.filter(c=>c[0]==='next-turn').length,1);
});
test('Ordinary mist prohibits offensive actions and reverts instead of wasting spell slots',async()=>{
 const f=fixture('mastermind');await f.actor.setFlag(ns,'vampire',{form:'mist'});
 assert.match(manualConditionViolation(f.actor,{kind:'castSpell',traits:[]}),/Mist/);assert.equal(manualConditionViolation(f.actor,{kind:'fly',traits:['move']}),null);
 const l=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(l,{movement:false});assert.ok(f.adapter.candidates(s).every(c=>c.kind==='vampireForm'));
});
test('Fire Shield has a distinct Raise action, native shield HP and half hardness against water',async()=>{
 const f=fixture('mastermind');Object.defineProperty(f.actor.itemTypes,'shield',{get:()=>[...f.actor.items.values()].filter(i=>i.type==='shield')});
 const spell=f.actor.itemTypes.spell.find(s=>s.slug==='fire-shield');await createFireShield(f.actor,spell);const shield=f.actor.itemTypes.shield[0];assert.equal(shield.system.hp.max,40);
 await raiseFireShield(f.boss);assert.ok(f.actor.itemTypes.effect.some(e=>e.flags[ns]?.fireShieldRaised));
 await prepareFireShieldDamage(f.actor,{shieldBlockRequest:true,item:{traits:new Set(['water'])}});assert.equal(shield.system.hardness,5);
 await prepareFireShieldDamage(f.actor,{shieldBlockRequest:true,item:{traits:new Set()}});assert.equal(shield.system.hardness,10);
});
test('Lingering fire stores parseable native damage and never burns immediately on wall placement',async()=>{
 const f=fixture('mastermind'),spell=f.actor.itemTypes.spell.find(s=>s.slug==='wall-of-fire');
 spell.getDamage=async()=>({template:{damage:{roll:{formula:'4d6 + 4 fire',toJSON:()=>({formula:'{(4d6 + 4)[fire]}'})}}}});
 let created;canvas.scene.createEmbeddedDocuments=async(_type,rows,options)=>{created=rows[0];assert.equal(options.renderSheet,false);return [{...created,id:'wall'}];};
 await createLingeringFire(f.adapter,spell,f.adapter.parts().entries[0],{area:{shapes:[{type:'rectangle',x:500,y:200,width:100,height:300}]}},spellDefinition(spell));
 assert.equal(created.flags[ns].lingeringFire.formula,'{(4d6 + 4)[fire]}');assert.equal(created.behaviors[1].flags[ns].terrain.formula,'4d6+4');assert.equal(f.calls.filter(c=>c[0]==='damage-applied').length,0);
});
test('Steady Spellcasting is a DC 15 check; a failed check still spends the preparation',async()=>{
 for(const total of [14,15]){const f=fixture('mastermind'),l=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(l,{movement:false}),choice=genericCastingCandidates(s).find(c=>c.spellSlug==='enfeeble');
  f.reactions.action=async()=>({disrupted:true});globalThis.Roll=class{async evaluate(){return {total,toMessage:async()=>{}};}};
  const result=await executeSpell(f.adapter,choice,{...l,actionsRemaining:1});assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,1);
  assert.equal(f.calls.some(c=>c[0]==='spell-save'),total>=15);if(total<15)assert.match(result.note,/disrupted/);
 }
});
test('Bonded recasting spends the daily use without consuming another prepared slot',async()=>{
 const f=fixture('mastermind'),entry=f.actor.itemTypes.spellcastingEntry.find(e=>e.system.prepared.value==='prepared');
 const enfeeble=f.actor.itemTypes.spell.find(s=>s.slug==='enfeeble');const slot=Object.values(entry.system.slots.slot1.prepared).find(s=>s.id===enfeeble.id);slot.expended=true;
 const l=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(l,{movement:false}),choice=genericCastingCandidates(s).find(c=>c.spellSlug==='enfeeble'&&c.bindingId.endsWith(':bonded'));
 assert.ok(choice);await executeSpell(f.adapter,choice,{...l,actionsRemaining:1});assert.equal(f.calls.filter(c=>c[0]==='consume-spell').length,0);
 assert.equal(f.actor.itemTypes.action.find(a=>a.name==='Drain Bonded Item').system.frequency.value,0);assert.equal(slot.expended,true);
});
test('A complete wounded Count turn uses Claw, Grab and Drink Blood with only one MAP increase',async()=>{
 const f=fixture(),choices=[];f.player.document.x=300;f.actor.hitPoints.value=30;f.actor.conditionsSet.add('blinded');f.adapter.report=async(d,l,r)=>{await f.adapter.recordOutcome(d.chosen,l,r);choices.push(d.chosen?.kind);};
 const original=f.actor.getStatistic;f.actor.getStatistic=slug=>slug==='athletics'?{dc:{value:27},check:{roll:async options=>{f.calls.push(['athletics',options]);return {degreeOfSuccess:2};}}}:original(slug);
 const ledger=await new TurnRunner(f.adapter).run();assert.equal(ledger.actionsRemaining,0);assert.equal(ledger.attacksMade,1,JSON.stringify({choices,calls:f.calls.map(c=>c[0])}));assert.equal(f.player.actor.hasCondition('grabbed'),true);
 assert.equal(f.player.actor.getCondition('drained')?.value,2);assert.equal(f.actor.hitPoints.value,40);assert.equal(f.calls.filter(c=>c[0]==='athletics').length,2);
});
test('Sustaining a stationary flame resolves occupants once in the new round',async()=>{
 const f=fixture('mastermind'),spell=f.actor.itemTypes.spell.find(s=>s.slug==='floating-flame'),region={name:'Flame',shapes:[{type:'rectangle',x:500,y:200,width:100,height:100}],elevation:{bottom:0},flags:{[ns]:{lingeringFire:{slug:'floating-flame',sourceTokenId:f.boss.id,spellId:spell.id,castId:'flame',formula:'3d6[fire]',dc:29,expiresAt:60,hitRounds:{}}}},setFlag:async(_n,k,v)=>region.flags[ns][k]=v,
  update:async changes=>Object.assign(region,changes),testPoint:p=>{const r=region.shapes[0];return p.x>=r.x&&p.x<r.x+r.width&&p.y>=r.y&&p.y<r.y+r.height;}};
 canvas.scene.regions.contents=[region];f.boss.checkCollision=()=>true;await sustainFloatingFire(f.actor,{id:'flame',sourceTokenId:f.boss.id});const hp=f.player.actor.hitPoints.value;assert.ok(hp<100);
 await sustainFloatingFire(f.actor,{id:'flame',sourceTokenId:f.boss.id});assert.equal(f.player.actor.hitPoints.value,hp);
});
