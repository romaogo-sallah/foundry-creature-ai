import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture as makeFixture } from './helpers/ogre-fixture.mjs';
import { PF2eOgreBruteAdapter } from '../src/foundry/ogre-brute-adapter.mjs';
import { PF2eKoboldScoutAdapter } from '../src/foundry/kobold-scout-adapter.mjs';
import { detectionFor, stealthRecord, stealthConditionStamp } from '../src/foundry/stealth-awareness.mjs';
import { targetKnowledge, rememberTargets } from '../src/foundry/target-memory.mjs';
import { concealmentDC } from '../src/foundry/environment-rolls.mjs';
import { stealthStart } from '../src/foundry/player-stealth.mjs';
import { seekArea, inSeekArea, registerPerceptionSettings, seekScope } from '../src/foundry/npc-perception.mjs';
import { seekCandidates } from '../src/framework/perception.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';

const ns='foundry-creature-ai';
const data=JSON.parse(await readFile(new URL('./fixtures/ogre-mechanics.json',import.meta.url)));
const scout=JSON.parse(await readFile(new URL('./fixtures/kobold-scout-mechanics.json',import.meta.url)));
const square=token=>Object.fromEntries(['x','y','width','height','elevation','level'].map(key=>[key,token.document[key]]));
const ledger=f=>f.adapter.readLedger(f.adapter.turnKey());
const choice=(f,subject=f.player)=>({id:`seek:${subject.id}`,kind:'seek',targetId:subject.id,actionCost:1,searchPosition:square(subject)});
function fixture(options={}){
  const f=makeFixture({npcData:data,Adapter:PF2eOgreBruteAdapter,...options});
  globalThis.Roll=class{async evaluate(){this.total=15;return this;}async toMessage(data){f.calls.push(['flat',data]);}};
  return f;
}
function perception(f,die,total=die+6){
  const native=f.actor.getStatistic;
  f.actor.getStatistic=slug=>slug==='perception'?{check:{mod:6,roll:async options=>{
    f.calls.push(['perception',f.actor.id,options]);return total===null?null:{total,dice:[{faces:20,total:die}]};}}}:native(slug);
}
function dc(subject,value,modifiers=[]){
  const native=subject.actor.getStatistic;
  subject.actor.getStatistic=slug=>slug==='stealth'?{dc:{value,modifiers}}:native(slug);
}

test('a Blinded NPC can close and Strike a heard Hidden opponent without repeatedly Seeking',async()=>{
  const f=fixture();f.actor.conditionsSet.add('blinded');f.adapter.assertReady();
  const state=await f.adapter.snapshot(await ledger(f));
  assert.equal(state.enemies[0].awareness.detection,'hidden');
  assert.equal(state.enemies[0].concealmentDC,11);
  assert.ok(state.moves.length>0);assert.ok(state.seek.available);
  assert.ok(f.adapter.candidates(state).some(c=>c.kind==='strike'));
  assert.equal(seekCandidates(state).length,0,'hearing cannot improve a located Hidden creature to Observed');
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0);assert.ok(f.calls.some(c=>c[0]==='attack'));
  assert.ok(f.calls.some(c=>c[0]==='flat'));
  assert.equal(f.calls.some(c=>c[0]==='perception'),false);
});

test('hearing Seek locates an unknown Undetected creature as Hidden even on a critical success',async()=>{
  const f=fixture();f.actor.conditionsSet.add('blinded');f.player.actor.conditionsSet.add('undetected');
  game.settings.get=()=> 'field';
  dc(f.player,16);perception(f,20,30);
  const state=await f.adapter.snapshot(await ledger(f));
  assert.equal(state.enemies.length,0);assert.equal(state.seek.suspectedOpponents,1);
  assert.equal(seekCandidates(state)[0].kind,'seek');
  await f.adapter.execute({kind:'seek',actionCost:1,searchScope:'field'},await ledger(f));
  const detected=detectionFor(f.boss,f.player);
  assert.equal(detected.state,'hidden');assert.equal(detected.precisionBlocked,true);
  const next=await f.adapter.snapshot(await ledger(f));
  assert.equal(next.enemies[0].awareness.position.x,500);
  assert.equal(next.enemies[0].inReach,true);assert.equal(seekCandidates(next).length,0);
  assert.equal(f.player.actor.hasCondition('undetected'),true,'the global condition is not removed for other observers');
  f.actor.conditionsSet.delete('blinded');
  const sighted=await f.adapter.snapshot(await ledger(f));
  assert.ok(seekCandidates(sighted).length,'restored vision allows Hidden to improve to Observed');
  await f.adapter.execute({kind:'seek',actionCost:1,searchScope:'field'},await ledger(f));
  assert.equal(detectionFor(f.boss,f.player).state,'observed');
});

test('Blinded and Deafened requires another usable sense; precise nonvisual senses retain observation within range',async()=>{
  const f=fixture();f.actor.conditionsSet.add('blinded');f.actor.conditionsSet.add('deafened');
  let state=await f.adapter.snapshot(await ledger(f));
  assert.equal(state.seek.available,false);assert.equal(state.enemies.length,0);
  f.actor.system.perception={senses:[{type:'scent',acuity:'imprecise',range:30}]};
  state=await f.adapter.snapshot(await ledger(f));
  assert.equal(state.seek.available,true);assert.equal(state.enemies[0].concealmentDC,11);
  f.actor.system.perception.senses=[{type:'echolocation',acuity:'precise',range:30}];
  assert.equal(detectionFor(f.boss,f.player).state,'undetected','Deafened disables hearing-based echolocation');
  f.actor.conditionsSet.delete('deafened');
  assert.equal(detectionFor(f.boss,f.player).state,'observed');
  assert.equal(concealmentDC(f.boss,f.player),null);
  state=await f.adapter.snapshot(await ledger(f));assert.equal(state.enemies[0].awareness.state,'observed');
  f.actor.system.perception.senses[0].range=5;
  assert.equal(detectionFor(f.boss,f.player).state,'hidden');
});

test('bounded hearing Seek can search nearby unknown enemies without aiming at their hidden live square',async()=>{
  const f=fixture();f.actor.conditionsSet.add('blinded');f.player.actor.conditionsSet.add('undetected');dc(f.player,1);
  const state=await f.adapter.snapshot(await ledger(f)),search=seekCandidates(state)[0];
  assert.equal(search.id,'seek:nearby');assert.equal(search.searchPosition.x,f.boss.document.x);
  assert.notEqual(search.searchPosition.x,f.player.document.x);
  await f.adapter.revalidate(search,await ledger(f));await f.adapter.execute(search,await ledger(f));
  assert.equal(detectionFor(f.boss,f.player).state,'hidden');
});

test('Reactive Strike can target a heard creature while Blinded and awaits its DC 11 check',async()=>{
  const f=makeFixture();f.actor.conditionsSet.add('blinded');
  f.combat.turn=1;f.combat.combatant=f.combat.combatants[1];
  assert.equal(f.reactions.reactors(f.player).includes(f.boss),true);
  globalThis.Roll=class{async evaluate(){this.total=1;return this;}async toMessage(message){f.calls.push(['flat',message]);}};
  f.reactions.prompts.ask=async request=>request.choices.find(choice=>!['pass','pause'].includes(choice.id)).id;
  await f.reactions.action({mover:f.player,kind:'manipulate'});
  assert.ok(f.calls.some(c=>c[0]==='flat'));
  assert.equal(f.calls.some(c=>c[0]==='attack'),false,'failed flat check consumes the reaction without rolling an attack');
  assert.equal(f.reactions.available(f.boss),false);
  f.player.actor.conditionsSet.add('undetected');
  assert.equal(f.reactions.meleeStrikes(f.boss,f.player).length,0);
});

test('Seek uses one native blind Perception roll and updates only its observer, preserving global conditions',async()=>{
  const f=fixture();f.player.actor.conditionsSet.add('hidden');dc(f.player,16);
  await f.player.document.setFlag(ns,'stealth',{combatId:f.combat.id,sceneId:'scene',moving:false,
    entries:[{observerId:'other-observer',state:'hidden',knownPosition:square(f.player)}]});
  const result=await f.adapter.execute(choice(f),await ledger(f));
  assert.equal(result.resolved,true);assert.equal(detectionFor(f.boss,f.player).state,'observed');
  assert.equal(stealthRecord(f.player).entries.find(e=>e.observerId==='other-observer').state,'hidden');
  assert.equal(f.player.actor.hasCondition('hidden'),true,'global/manual/granted condition is preserved');
  assert.equal(targetKnowledge(f.adapter).checks[0].awareness.state,'observed');
  assert.equal(concealmentDC(f.boss,f.player),null,'global Hidden does not override this observer’s successful Seek');
  assert.equal(stealthStart(f.boss,f.player).state,'observed','a player cannot Sneak past an observer who just found them');
  assert.equal(f.boss.document.getFlag(ns,'perception').entries.find(e=>e.subjectId===f.player.id).state,'observed');
  const rolls=f.calls.filter(c=>c[0]==='perception');assert.equal(rolls.length,1);
  assert.equal(rolls[0][2].skipDialog,true);assert.equal(rolls[0][2].rollMode,'blindroll');
  assert.deepEqual(rolls[0][2].traits,['concentrate','secret']);assert.ok(rolls[0][2].extraRollOptions.includes('action:seek'));
  assert.equal('dc'in stealthRecord(f.player).entries.find(e=>e.observerId===f.boss.id),false);
});

test('success locates Undetected as Hidden; a later success or critical success can observe it',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('undetected');dc(f.player,16);
  await f.adapter.execute(choice(f),await ledger(f));
  assert.equal(detectionFor(f.boss,f.player).state,'hidden');
  assert.equal(targetKnowledge(f.adapter).checks[0].awareness.allowAttackEstimate,true);
  assert.equal(concealmentDC(f.boss,f.player),11);
  await f.adapter.execute(choice(f),await ledger(f));assert.equal(detectionFor(f.boss,f.player).state,'observed');
  const critical=fixture();await rememberTargets(critical.adapter);critical.player.actor.conditionsSet.add('undetected');dc(critical.player,16);perception(critical,20,26);
  await critical.adapter.execute(choice(critical),await ledger(critical));assert.equal(detectionFor(critical.boss,critical.player).state,'observed');
});

test('a search area uses one die against separate Stealth DCs, including an unknown creature actually in that area',async()=>{
  const f=fixture();f.player.actor.conditionsSet.add('hidden');dc(f.player,16);
  const second=f.token('second',f.makeActor('second',{...data,type:'character'}),600,300,1);
  f.combat.combatants.push({id:'c-second',tokenId:second.id,sceneId:'scene',actor:second.actor});
  second.actor.conditionsSet.add('undetected');dc(second,30);
  assert.equal(targetKnowledge(f.adapter).checks.find(c=>c.id===second.id).target,null);
  await f.adapter.execute(choice(f),await ledger(f));
  assert.equal(f.calls.filter(c=>c[0]==='perception').length,1);
  assert.equal(detectionFor(f.boss,f.player).state,'observed');assert.equal(detectionFor(f.boss,second).state,'undetected');
  dc(second,16);await f.adapter.execute(choice(f),await ledger(f));
  assert.equal(detectionFor(f.boss,second).state,'hidden');
  assert.equal(targetKnowledge(f.adapter).checks.find(c=>c.id===second.id).target.document.x,600);
});

test('Seek does not scan the whole scene, see through walls, change levels, or reveal GM-hidden tokens',async()=>{
  for(const reason of ['outside','wall','level','gm-hidden']){
    const f=fixture();await rememberTargets(f.adapter);const search=choice(f);f.player.actor.conditionsSet.add('undetected');dc(f.player,1);
    if(reason==='outside')f.player.document.x=1300;
    if(reason==='wall')f.boss.checkCollision=(_p,{type})=>type==='sight';
    if(reason==='level')f.player.document.level='upstairs';
    if(reason==='gm-hidden')f.player.document.hidden=true;
    await f.adapter.execute(search,await ledger(f));
    assert.equal(detectionFor(f.boss,f.player).state,'undetected',reason);
    assert.equal(stealthRecord(f.player),null,reason);
    assert.equal(f.boss.document.getFlag(ns,'targetMemory').entries[0].position.x,500,reason);
  }
});

test('an invisible creature remains Hidden even on a critical Seek and is attacked with DC 11 instead of re-Seeking forever',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('invisible');dc(f.player,16);perception(f,20,26);
  await f.adapter.execute(choice(f),await ledger(f));
  assert.equal(detectionFor(f.boss,f.player).state,'hidden');assert.equal(concealmentDC(f.boss,f.player),11);
  const state=await f.adapter.snapshot(await ledger(f));
  assert.equal(f.adapter.candidates(state).some(c=>c.kind==='seek'),false);
  assert.equal(f.adapter.candidates(state).some(c=>c.kind==='strike'),true);
});

test('cover adjusts the Stealth DC without stacking an existing circumstance bonus twice',async()=>{
  for(const existing of [false,true]){
    const f=fixture();f.player.actor.conditionsSet.add('hidden');perception(f,13,19);
    dc(f.player,existing?18:16,existing?[{type:'circumstance',modifier:2,enabled:true}]:[]);
    canvas.scene.regions.contents.push({id:'cover',name:'Cover',parent:canvas.scene,
      flags:{[ns]:{environment:{enabled:true,cover:'standard',coverMode:'occupants',concealment:'none'}}},testPoint:()=>true});
    await f.adapter.execute(choice(f),await ledger(f));assert.equal(detectionFor(f.boss,f.player).state,'observed');
  }
});

test('Seek candidates depend on remembered positions and benchmark odds, never real Stealth DC or hidden position',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('undetected');
  const initial=await f.adapter.snapshot(await ledger(f)),baseline=seekCandidates(initial);
  assert.ok(baseline.length);
  f.player.document.x=1300;dc(f.player,99);
  const next=await f.adapter.snapshot(await ledger(f));
  assert.deepEqual(seekCandidates(next),baseline);assert.equal(next.enemies[0].awareness.position.x,500);
  assert.ok(!JSON.stringify(baseline).includes('99'));
});

test('failed searches and investigation movement spend actions without MAP and finish the turn with auto-advance',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('undetected');dc(f.player,40);perception(f,1,7);
  await f.boss.document.setFlag(ns,'config',{...f.adapter.config,autoAdvance:true});
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0);assert.equal(result.attacksMade,0);assert.equal(result.uncertain,false);
  const searches=f.calls.filter(c=>c[0]==='perception').length,moves=f.calls.filter(c=>c[0]==='move').length;
  assert.ok(searches>0);assert.equal(searches+moves,3);assert.equal(f.calls.filter(c=>c[0]==='next-turn').length,1);
  assert.equal(detectionFor(f.boss,f.player).state,'undetected');assert.equal(f.calls.some(c=>c[0]==='attack'),false);
});

test('a cancelled secret Perception roll retains its reserved action for inspection',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('undetected');perception(f,1,null);
  await assert.rejects(new TurnRunner(f.adapter).run(),/Seek was cancelled/);
  const saved=await ledger(f);assert.equal(saved.actionsRemaining,2);assert.equal(saved.uncertain,true);
  assert.equal(stealthRecord(f.player),null);
});

test('scouts and both ogre profiles expose the shared Seek capability, including while restrained',async()=>{
  for(const options of [{},{npcData:undefined,Adapter:undefined},{npcData:scout,Adapter:PF2eKoboldScoutAdapter,footprint:1}]){
    const f=options.npcData===undefined&&'npcData'in options?makeFixture():fixture(options);
    await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('undetected');f.actor.conditionsSet.add('restrained');
    const state=await f.adapter.snapshot(await ledger(f));assert.ok(f.adapter.candidates(state).some(c=>c.kind==='seek'),f.adapter.profileId);
  }
});

test('after moving closer to a distant remembered square, an NPC can Seek and continue its normal turn',async()=>{
  const f=fixture();f.player.document.x=1000;await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('undetected');dc(f.player,1);
  const state=await f.adapter.snapshot(await ledger(f));
  assert.equal(seekCandidates(state).length,0);assert.ok(state.moves.length);
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0);assert.ok(f.calls.some(c=>c[0]==='move'));assert.ok(f.calls.some(c=>c[0]==='perception'));
});

test('a new global stealth condition invalidates an older observer-specific Seek override',async()=>{
  const f=fixture();f.player.actor.conditionsSet.add('hidden');await f.adapter.execute(choice(f),await ledger(f));
  assert.equal(detectionFor(f.boss,f.player).state,'observed');const stamp=stealthConditionStamp(f.player);
  f.player.actor.conditionsSet.add('undetected');assert.notEqual(stealthConditionStamp(f.player),stamp);
  assert.equal(detectionFor(f.boss,f.player).state,'undetected');
});

test('a target moving or hiding during a pending Perception check keeps its newer result and does not leak a new position',async()=>{
  const f=fixture();await rememberTargets(f.adapter);f.player.actor.conditionsSet.add('hidden');const search=choice(f);
  const native=f.actor.getStatistic;
  const newer={combatId:f.combat.id,sceneId:'scene',moving:true,entries:[{observerId:f.boss.id,state:'undetected',knownPosition:square(f.player)}]};
  f.actor.getStatistic=slug=>slug==='perception'?{check:{roll:async()=>{
    f.player.document.x=1100;await f.player.document.setFlag(ns,'stealth',newer);
    return {total:30,dice:[{faces:20,total:20}]};}}}:native(slug);
  const result=await f.adapter.execute(search,await ledger(f));
  assert.match(result.note,/newer detection state was retained/);assert.deepEqual(stealthRecord(f.player),newer);
  assert.equal(f.boss.document.getFlag(ns,'perception'),undefined);
  assert.equal(targetKnowledge(f.adapter).checks[0].awareness.position.x,500);
});

test('Hidden retains a current known square on ordinary movement; Undetected keeps the old square',async()=>{
  const f=fixture();f.player.actor.conditionsSet.add('hidden');await rememberTargets(f.adapter);
  await f.adapter.execute(choice(f),await ledger(f));f.player.actor.conditionsSet.delete('hidden');f.player.actor.conditionsSet.add('undetected');
  dc(f.player,16);await f.adapter.execute(choice(f),await ledger(f));
  assert.equal(detectionFor(f.boss,f.player).state,'hidden');f.player.document.x=600;
  assert.equal(targetKnowledge(f.adapter).checks[0].awareness.position.x,600);
  await rememberTargets(f.adapter);
  const saved=stealthRecord(f.player);await f.player.document.setFlag(ns,'stealth',{...saved,moving:true,
    entries:saved.entries.map(e=>({...e,state:'undetected',knownPosition:square(f.player)}))});
  await rememberTargets(f.adapter);f.player.document.x=1200;
  assert.equal(targetKnowledge(f.adapter).checks[0].awareness.position.x,600);
});

test('Seek area has a 15-foot radius and checks the actual footprint only during resolution',()=>{
  const f=fixture();const area=seekArea(square(f.player));assert.equal(inSeekArea(f.player,area),true);
  f.player.document.x+=300;assert.equal(inSeekArea(f.player,area),true);
  f.player.document.x+=100;assert.equal(inSeekArea(f.player,area),false);
});

test('whole-field Seek is an explicit simplified world setting, with bounded areas still selectable',()=>{
  const f=fixture(),settings=new Map();game.settings={register:(namespace,key,data)=>settings.set(key,data)};
  registerPerceptionSettings();assert.equal(settings.get('seekScope').default,'field');assert.equal(settings.get('seekScope').scope,'world');
  assert.deepEqual(Object.keys(settings.get('seekScope').choices),['field','area']);
  game.settings.get=()=> 'area';assert.equal(seekScope(),'area');game.settings.get=()=> 'field';assert.equal(seekScope(),'field');
});

test('whole-field Seek can find multiple far-away stealth users with one secret roll, while retaining LOS limits',async()=>{
  const f=fixture({size:64});game.settings.get=()=> 'field';f.player.document.x=2400;f.player.actor.conditionsSet.add('hidden');dc(f.player,16);
  const second=f.token('second',f.makeActor('second',{...data,type:'character'}),2000,1500,1);
  second.actor.conditionsSet.add('hidden');dc(second,16);f.combat.combatants.push({id:'c-second',tokenId:second.id,sceneId:'scene',actor:second.actor});
  const blocked=f.token('blocked',f.makeActor('blocked',{...data,type:'character'}),2200,1500,1);
  blocked.actor.conditionsSet.add('hidden');dc(blocked,16);f.combat.combatants.push({id:'c-blocked',tokenId:blocked.id,sceneId:'scene',actor:blocked.actor});
  f.boss.checkCollision=(destination,{type}={})=>type==='sight'&&destination.x===2250;
  const state=await f.adapter.snapshot(await ledger(f)),search=f.adapter.candidates(state).find(c=>c.kind==='seek');
  assert.equal(search.searchScope,'field');assert.equal(search.searchPosition,undefined,'the search does not aim at live hidden coordinates');
  await f.adapter.revalidate(search,await ledger(f));await f.adapter.execute(search,await ledger(f));
  assert.equal(f.calls.filter(c=>c[0]==='perception').length,1);
  assert.equal(detectionFor(f.boss,f.player).state,'observed');assert.equal(detectionFor(f.boss,second).state,'observed');
  assert.equal(detectionFor(f.boss,blocked).state,'hidden');
});

test('whole-field Seek can search an alert encounter without knowing an Undetected opponent’s square',async()=>{
  const f=fixture({size:64});game.settings.get=()=> 'field';f.player.actor.conditionsSet.add('undetected');f.player.document.x=2400;dc(f.player,1);
  const state=await f.adapter.snapshot(await ledger(f));assert.equal(state.enemies.length,0);assert.equal(state.seek.suspectedOpponents,1);
  const search=f.adapter.decide(state).chosen;assert.equal(search.kind,'seek');assert.equal(search.searchPosition,undefined);
  const result=await new TurnRunner(f.adapter).run({oneAction:true});assert.equal(result.actionsRemaining,2);assert.equal(result.attacksMade,0);
  assert.equal(detectionFor(f.boss,f.player).state,'observed');
});

test('looking for more enemies does not displace engagement with an already observed opponent',async()=>{
  const f=fixture({size:64});game.settings.get=()=> 'field';f.player.document.x=2400;
  const hidden=f.token('hidden',f.makeActor('hidden',{...data,type:'character'}),2200,1500,1);hidden.actor.conditionsSet.add('hidden');
  f.combat.combatants.push({id:'c-hidden',tokenId:hidden.id,sceneId:'scene',actor:hidden.actor});
  const s=await f.adapter.snapshot(await ledger(f));assert.equal(f.adapter.candidates(s).some(c=>c.kind==='seek'),false);
});
