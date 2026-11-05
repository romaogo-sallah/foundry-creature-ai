import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture as makeFixture } from './helpers/ogre-fixture.mjs';
import { PF2eKoboldScoutAdapter, scoutParts } from '../src/foundry/kobold-scout-adapter.mjs';
import { createCreatureAdapter, creatureProfile } from '../src/foundry/creature-profiles.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';
import { rollStealth, detectionFor, reveal, visibleToUser, stealthRecord, installStealthVisibility } from '../src/foundry/stealth-awareness.mjs';
import { targetKnowledge, rememberTargets, movementKnowledge } from '../src/foundry/target-memory.mjs';
import { applyEnvironmentCover, concealmentCheck } from '../src/foundry/environment-rolls.mjs';
import { stealthBelief } from '../src/foundry/stealth-belief.mjs';

const data=JSON.parse(await readFile(new URL('./fixtures/kobold-scout-mechanics.json',import.meta.url)));
function fixture({die=15,...options}={}){
  const f=makeFixture({npcData:data,Adapter:PF2eKoboldScoutAdapter,footprint:1,...options});
  const get=f.actor.getStatistic;
  f.actor.getStatistic=slug=>slug!=='stealth'?get(slug):{dc:{value:17},check:{mod:7,modifiers:[],roll:async options=>{
    f.calls.push(['stealth',options]);return {total:die+7,dice:[{faces:20,total:die}]};}}};
  globalThis.Roll=class{async evaluate(){this.total=15;return this;}async toMessage(data){f.calls.push(['flat',data]);}};
  return f;
}
function fog(f){
  const r={id:'fog',name:'Fog',parent:canvas.scene,flags:{[MODULE_ID]:{environment:{enabled:true,cover:'none',coverMode:'occupants',concealment:'through'}}},
    testPoint:p=>p.x>=100&&p.x<=430&&p.y>=100&&p.y<=600,
    segmentizeMovementPath:([from,to])=>from.y<=600&&to.y<=600?[{from,to,type:0}]:[]};
  canvas.scene.regions.contents.push(r);return r;
}
const ledger=async f=>f.adapter.readLedger(f.adapter.turnKey());
const choice=(kind,extra={})=>({id:kind,kind,actionCost:1,...extra});
const observerAdapter=(f,observer=f.player)=>({actor:observer.actor,token:observer,targetIds:()=>[f.boss.id],assessTarget:()=>({id:f.boss.id,name:f.boss.name,target:f.boss,reason:null})});

test('the supplied remastered scout matches its own skulk profile and preserves actor mechanics',async()=>{
  const f=fixture(),parts=scoutParts(f.actor);
  assert.equal(creatureProfile(f.actor).id,'kobold-scout');assert.ok(createCreatureAdapter(f.boss,null) instanceof PF2eKoboldScoutAdapter);
  assert.equal(parts.averageDamage,3.5);assert.equal(parts.bolts.system.quantity,20);assert.equal(parts.bow.system.equipped.handsHeld,2);
  assert.deepEqual(parts.unsupported,['Construct Trap']);await f.adapter.assertReady();
  f.actor.name='Renamed scout';assert.equal(creatureProfile(f.actor).id,'kobold-scout');
});

test('a scout in the open cannot Hide, and an unloaded crossbow cannot Strike',async()=>{
  const f=fixture();let state=await f.adapter.snapshot(await ledger(f));
  assert.equal(state.hideTargets.length,0);assert.equal(f.adapter.candidates(state).some(c=>c.kind==='hide'),false);
  await f.boss.document.setFlag(MODULE_ID,'scoutGear',{loaded:false});state=await f.adapter.snapshot(await ledger(f));
  assert.equal(f.adapter.candidates(state).some(c=>c.kind==='strike'&&c.strikeId===f.adapter.parts().ranged.item.id),false);
  assert.equal(f.adapter.candidates(state).some(c=>c.kind==='reload'),true);
});

test('Hide uses one native secret roll, spends one action, and stores a separate result per observer',async()=>{
  const f=fixture();fog(f);
  const second=f.token('second',f.makeActor('second',{...data,type:'character'}),600,500,1);
  second.actor.getStatistic=()=>({dc:{value:30}});f.combat.combatants.push({id:'c-second',tokenId:second.id,sceneId:'scene',actor:second.actor});
  const result=await f.adapter.execute(choice('hide'),{...await ledger(f),actionsRemaining:2});
  assert.equal(detectionFor(f.player,f.boss).state,'hidden');assert.equal(detectionFor(second,f.boss).state,'observed');
  assert.equal(f.calls.filter(c=>c[0]==='stealth').length,1);assert.match(result.note,/hidden/);
  const roll=f.calls.find(c=>c[0]==='stealth')[1];assert.equal(roll.skipDialog,true);assert.ok(roll.extraRollOptions.includes('secret'));
  assert.equal(f.actor.hasCondition('hidden'),false,'no global Hidden condition leaks one observer result to everyone');
});

test('Sneak retains the old known square on success and does not broadcast the new position to that observer',async()=>{
  const f=fixture();fog(f);const watcher=observerAdapter(f);await rememberTargets(watcher);
  await f.adapter.execute(choice('hide'),{...await ledger(f),actionsRemaining:2});
  const start=f.boss.document.x,l=await ledger(f),path=[f.adapter.originCell(),{x:3,y:2}];
  const result=await f.adapter.execute(choice('sneak',{path,destination:{x:3,y:2}}),{...l,actionsRemaining:1});
  assert.equal(result.pause,false);assert.equal(f.boss.document.x,300);assert.equal(detectionFor(f.player,f.boss).state,'undetected');
  const knownMovement=movementKnowledge(f.boss.document,{method:'api',passed:{waypoints:[{action:'walk'}]}});
  await rememberTargets(watcher,()=>true,knownMovement);
  assert.equal(targetKnowledge(watcher).checks[0].target.document.x,start);
  assert.equal(stealthRecord(f.boss).moving,false);
});

test('a hidden scout can Sneak twice in one turn, rolling once for each action and preserving observer memory',async()=>{
  const f=fixture();fog(f);await f.adapter.execute(choice('hide'),await ledger(f));
  for(const [from,to]of [[2,3],[3,2]]){
    const path=[{x:from,y:2},{x:to,y:2}],move=choice('sneak',{path,destination:path.at(-1)});
    const result=await f.adapter.execute(move,await ledger(f));await f.adapter.recordOutcome(move,await ledger(f),result);
    assert.equal(detectionFor(f.player,f.boss).state,'undetected');
  }
  assert.equal(f.boss.document.getFlag(MODULE_ID,'scoutActions').sneakAttempts,2);
  assert.equal(f.calls.filter(call=>call[0]==='stealth').length,3,'Hide plus two separate secret Sneak checks');
  assert.equal(stealthRecord(f.boss).entries[0].knownPosition.x,200);
});

test('Sneak is not planned without a hiding attempt, and cannot exceed half Speed',async()=>{
  const f=fixture();fog(f);const path=[{x:2,y:2},{x:3,y:2}];
  assert.equal(f.adapter.candidates(await f.adapter.snapshot(await ledger(f))).some(c=>c.kind==='sneak'),false);
  await f.adapter.execute(choice('hide'),await ledger(f));
  const far=[{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2}];
  assert.equal((await f.adapter.execute(choice('sneak',{path:far,destination:far.at(-1)}),await ledger(f))).skipped,true);
});

test('failed Sneak never temporarily grants undetected protection against reactions',async()=>{
  const f=fixture({die:1});fog(f);
  await f.boss.document.setFlag(MODULE_ID,'stealth',{combatId:f.combat.id,sceneId:'scene',moving:false,entries:[{observerId:f.player.id,state:'hidden',knownPosition:{x:200,y:200,width:1,height:1,depth:1,elevation:0,level:'ground'}}]});
  let duringMove;
  const move=f.boss.document.move;f.boss.document.move=async(...args)=>{duringMove=detectionFor(f.player,f.boss).state;return move(...args);};
  const path=[{x:2,y:2},{x:3,y:2}];await f.adapter.execute(choice('sneak',{path,destination:path.at(-1)}),await ledger(f));
  assert.equal(duringMove,'observed');assert.equal(detectionFor(f.player,f.boss).state,'observed');
});

test('a hidden attack carries native off-guard precision options through damage and then reveals the scout',async()=>{
  const f=fixture();fog(f);await f.adapter.execute(choice('hide'),await ledger(f));
  const ranged=f.adapter.parts().ranged;
  await f.adapter.execute(choice('strike',{strikeId:ranged.item.id,targetId:f.player.id}),{...await ledger(f),actionsRemaining:1,attacksMade:1});
  assert.ok(f.calls.find(c=>c[0]==='attack')[4].options.includes('target:condition:off-guard'));
  assert.ok(f.calls.find(c=>c[0]==='damage-roll')[3].options.includes('target:condition:off-guard'));
  assert.equal(f.adapter.parts().bolts.system.quantity,19);assert.equal(f.adapter.loaded,false);
  assert.equal(detectionFor(f.player,f.boss).state,'observed');
});

test('Reload costs an Interact action, reveals the scout before its reaction, and never refills ammunition',async()=>{
  const f=fixture();fog(f);await f.adapter.execute(choice('hide'),await ledger(f));
  await f.boss.document.setFlag(MODULE_ID,'scoutGear',{loaded:false});let revealed;
  f.adapter.interrupt=async()=>{revealed=detectionFor(f.player,f.boss).state;return {};};
  await f.adapter.execute(choice('reload'),{...await ledger(f),actionsRemaining:2});
  assert.equal(revealed,'observed');assert.equal(f.adapter.loaded,true);assert.equal(f.adapter.parts().bolts.system.quantity,20);
});

test('Scamper can use Speed plus five feet, remains one action, and clears its temporary protection',async()=>{
  const f=fixture();f.player.document.x=300;
  const path=[{x:2,y:2},...Array.from({length:6},(_,i)=>({x:2,y:3+i}))];
  const result=await f.adapter.execute(choice('scamper',{path,destination:path.at(-1)}),{...await ledger(f),actionsRemaining:2});
  assert.equal(result.movement.cost,30);assert.equal(result.movement.arrived,true);
  assert.equal(f.boss.document.getFlag(MODULE_ID,'scampering'),false);
  const far=fixture();assert.equal((await far.adapter.execute(choice('scamper',{path,destination:path.at(-1)}),await ledger(far))).skipped,true);
});

test('Scamper +2 is a native circumstance bonus only against reactions during movement',async()=>{
  const f=fixture();let modifiers;
  game.pf2e.Modifier=class{constructor(data){Object.assign(this,data);}};
  const context={type:'attack-roll',origin:{token:{object:f.player}},target:{token:{object:f.boss}},options:new Set([`${MODULE_ID}:reaction`]),
    dc:{value:16,statistic:{parent:{clone:({modifiers:m})=>{modifiers=m;return {dc:{value:18}};}}}}};
  await f.boss.document.setFlag(MODULE_ID,'scampering',true);applyEnvironmentCover(context);
  assert.equal(modifiers.find(m=>m.slug==='scamper').modifier,2);assert.equal(context.dc.value,18);
  modifiers=null;context.options.clear();applyEnvironmentCover(context);assert.equal(modifiers,null);
});

test('no bolts leaves a valid melee profile and does not fabricate ammunition',async()=>{
  const f=fixture();const {bolts}=f.adapter.parts();f.actor.items.delete(bolts.id);
  const state=await f.adapter.snapshot(await ledger(f));assert.equal(state.bolts,0);
  assert.equal(f.adapter.candidates(state).some(c=>c.kind==='reload'),false);
  assert.equal(f.adapter.candidates(state).some(c=>c.kind==='strike'&&c.strikeId===f.adapter.parts().ranged.item.id),false);
  await f.adapter.execute(choice('drawSword'),await ledger(f));
  const melee=await f.adapter.snapshot(await ledger(f));
  assert.equal(f.adapter.candidates(melee).some(c=>['stowSword','gripBow'].includes(c.kind)),false,'do not put the sword away to ready an empty bow');
});

test('drawing the shortsword releases one crossbow hand and cannot keep the bow ready',async()=>{
  const f=fixture();await f.adapter.execute(choice('drawSword'),{...await ledger(f),actionsRemaining:2});
  const {bow,sword}=f.adapter.parts();assert.equal(bow.system.equipped.handsHeld,1);assert.equal(sword.system.equipped.handsHeld,1);
  const state=await f.adapter.snapshot(await ledger(f));assert.equal(state.bowReady,false);assert.equal(state.bladeReady,true);
  await assert.rejects(f.adapter.execute(choice('gripBow'),await ledger(f)),/Stow the shortsword/);
});

test('player visibility follows owned observers, retains GM view and does not set GM Hidden',async()=>{
  const f=fixture();fog(f);await rollStealth(f.boss,'hide');
  await f.boss.document.setFlag(MODULE_ID,'stealth',{...stealthRecord(f.boss),entries:stealthRecord(f.boss).entries.map(e=>({...e,state:'undetected'}))});
  f.player.actor.testUserPermission=user=>user.id==='player';
  assert.equal(visibleToUser(f.boss,{id:'player',isGM:false}),false);
  assert.equal(visibleToUser(f.boss,{id:'gm',isGM:true}),true);
  await reveal(f.boss);assert.equal(visibleToUser(f.boss,{id:'player',isGM:false}),true);assert.notEqual(f.boss.document.hidden,true);
});

test('losing cover to a clear observer reveals the scout and old combat records do not survive a new encounter',async()=>{
  const f=fixture();fog(f);await rollStealth(f.boss,'hide');assert.equal(detectionFor(f.player,f.boss).state,'hidden');
  canvas.scene.regions.contents=[];assert.equal(detectionFor(f.player,f.boss).state,'observed');
  f.combat.id='new';assert.equal(stealthRecord(f.boss),null);
});

test('a complete scout turn uses the native rolls and spends exactly three actions without trap construction',async()=>{
  const f=fixture();fog(f);
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0);assert.equal(result.uncertain,false);
  assert.equal(f.calls.some(c=>c[0]==='attack'),true);
  assert.equal(f.adapter.parts().bolts.system.quantity,19);assert.equal(result.attacksMade,1);
  assert.equal(f.calls.some(c=>c[0]==='create-effects'),false);
});

test('cover contributes the correct per-observer Stealth bonus without adding a global effect',async()=>{
  const f=fixture({die:8}),r=fog(f);r.flags[MODULE_ID].environment={enabled:true,cover:'standard',coverMode:'occupants',concealment:'none'};
  const entries=await rollStealth(f.boss,'hide');
  assert.equal(entries[0].total,17);assert.equal(entries[0].state,'hidden');assert.equal(entries[0].dc,16);
  assert.equal(f.calls.some(c=>c[0]==='create-effects'),false);
});

test('Scamper rejects an endpoint still adjacent to an enemy',async()=>{
  const f=fixture();f.player.document.x=300;
  const path=[{x:2,y:2},{x:2,y:3}];
  const result=await f.adapter.execute(choice('scamper',{path,destination:path.at(-1)}),await ledger(f));
  assert.equal(result.skipped,true);assert.match(result.skipReason,/outside adjacency/);assert.equal(f.calls.some(c=>c[0]==='move'),false);
});

test('relative visibility wraps the native getter and suppresses movement rulers for Undetected Step',async()=>{
  const f=fixture();fog(f);await rollStealth(f.boss,'hide');
  const saved=stealthRecord(f.boss);await f.boss.document.setFlag(MODULE_ID,'stealth',{...saved,entries:saved.entries.map(e=>({...e,state:'undetected'}))});
  let wrapper;globalThis.libWrapper={register:(id,path,fn)=>{assert.equal(path,'CONFIG.Token.objectClass.prototype.isVisible');wrapper=fn;}};
  installStealthVisibility();f.player.actor.testUserPermission=user=>user.id==='player';
  const gm=game.user;game.user={id:'player',isGM:false};assert.equal(wrapper.call(f.boss,()=>true),false);
  game.user=gm;assert.equal(wrapper.call(f.boss,()=>true),true);assert.equal(wrapper.call(f.boss,()=>false),false);
  const nativeMove=f.boss.document.move;let moveOptions;
  f.boss.document.move=(path,options)=>{moveOptions=options;return nativeMove(path,options);};
  await f.adapter.execute(choice('step',{path:[{x:2,y:2},{x:3,y:2}],destination:{x:3,y:2}}),await ledger(f));
  assert.equal(moveOptions.showRuler,false);assert.equal(detectionFor(f.player,f.boss).state,'undetected');
});

test('Alt+W recognizes the scout and consumes shared terrain/detection APIs without installing manual hooks',async()=>{
  const f=fixture(),hooks=new Map(),wrappers=[];
  globalThis.Hooks={once:(id,fn)=>hooks.set(id,fn),on:(id,fn)=>hooks.set(id,fn)};
  globalThis.libWrapper={register:(id,path)=>{
    assert.equal(wrappers.includes(path),false,`libWrapper rejects duplicate registration: ${path}`);wrappers.push(path);
  }};
  game.modules=new Map([[MODULE_ID,{}]]);game.user.targets=new Set();
  game.settings={get:()=>true};
  globalThis.ui={notifications:{info:()=>{},error:message=>{throw new Error(message);}}};
  const profiles=JSON.parse(await readFile(new URL('../profiles/creatures.json',import.meta.url)));
  globalThis.fetch=async()=>({ok:true,json:async()=>profiles});
  globalThis.foundry={applications:{api:{DialogV2:{wait:async dialog=>{
    assert.match(dialog.content,/Kobold Scout/);assert.match(dialog.content,/Construct Trap/);assert.doesNotMatch(dialog.content,/name="packMorale"/);
    return dialog.buttons.find(b=>b.action==='save').callback({}, {form:{elements:{targetMode:{value:'alliance'},autoRun:{checked:false},autoAdvance:{checked:false},applyDamage:{checked:true},pauseForReactions:{checked:false},crossbowLoaded:{checked:false}}}});
  }}}}};
  const main=await import('../src/foundry/main.mjs?scout-controls');await hooks.get('ready')();await main.openControls(f.boss);
  assert.equal(f.adapter.loaded,false);assert.equal(f.adapter.config.enabled,true);assert.equal(f.adapter.config.packMorale,false);
  assert.equal(typeof game.modules.get(MODULE_ID).api.zones.open,'function');assert.equal(typeof game.modules.get(MODULE_ID).api.stealth.open,'function');
  assert.deepEqual(wrappers,[],'manual packages own all native rule wrappers');
  const controls={tokens:{tools:{}}};hooks.get('getSceneControlButtons')(controls);
  assert.ok(controls.tokens.tools.wolfAI);assert.equal(controls.tokens.tools.environmentZones,undefined);assert.equal(controls.tokens.tools.stealthControls,undefined);
});

test('Preview can inspect a different loaded state without changing the saved ammunition state',async()=>{
  const f=fixture();const preview=new PF2eKoboldScoutAdapter(f.boss,null,{config:{...f.adapter.config,crossbowLoaded:false}});
  assert.equal(preview.loaded,false);assert.equal(f.adapter.loaded,true);
  assert.equal(f.boss.document.getFlag(MODULE_ID,'scoutGear'),undefined);
});

test('secret Hide results and real opposing Perception DCs do not change the scout planner',async()=>{
  const cases=[];
  for(const {die,dc}of [{die:1,dc:16},{die:20,dc:16},{die:15,dc:40}]){
    const f=fixture({die});fog(f);
    const native=f.player.actor.getStatistic;
    f.player.actor.getStatistic=slug=>slug==='perception'?{dc:{value:dc}}:native(slug);
    const l=await ledger(f),hide=choice('hide');
    const result=await f.adapter.execute(hide,l);await f.adapter.recordOutcome(hide,l,result);
    const state=await f.adapter.snapshot({...l,actionsRemaining:2});
    cases.push({actual:detectionFor(f.player,f.boss).state,belief:stealthBelief(f.boss),state,options:f.adapter.candidates(state)});
    assert.ok(state.enemies[0].stealthChance>0&&state.enemies[0].stealthChance<1);
    assert.ok(state.moves.some(move=>move.sneakObservers.includes(f.player.id)));
    assert.equal('scoutDetection'in state.enemies[0],false);assert.equal('hiddenFrom'in state.enemies[0],false);
    assert.equal('dc'in state.diagnostics.stealth[0],false);
  }
  assert.deepEqual(cases.map(c=>c.actual),['observed','hidden','observed'],'GM truth still resolves the actual roll and DC');
  for(const other of cases.slice(1)){
    assert.deepEqual(other.belief,cases[0].belief);assert.deepEqual(other.state,cases[0].state);
    assert.deepEqual(other.options,cases[0].options,'secret success/failure must not change availability or ranking');
  }
});

test('an attempted Sneak after a secretly failed Hide still rolls, moves, and spends an action',async()=>{
  const f=fixture({die:1});const smoke=fog(f);
  canvas.scene.regions.contents.push({...smoke,id:'shelter',name:'Covered firing position',
    flags:{[MODULE_ID]:{environment:{enabled:true,cover:'standard',coverMode:'occupants',concealment:'none'}}},
    testPoint:p=>p.x>=300&&p.x<=430&&p.y>=100&&p.y<=600});
  const l=await ledger(f),hide=choice('hide');
  await f.adapter.execute(hide,l);await f.adapter.recordOutcome(hide,l);
  assert.equal(detectionFor(f.player,f.boss).state,'observed');
  await f.adapter.saveLedger({...l,actionsRemaining:2});
  const state=await f.adapter.snapshot({...l,actionsRemaining:2});
  const sneak=f.adapter.candidates(state).find(c=>c.kind==='sneak');
  assert.ok(sneak,'secret failure does not remove useful protected half-Speed routes');
  const nativeDecide=f.adapter.decide.bind(f.adapter);f.adapter.decide=s=>({...nativeDecide(s),chosen:sneak});
  const after=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(after.actionsRemaining,1);assert.equal(f.calls.filter(c=>c[0]==='stealth').length,2);
  assert.equal(f.boss.document.x,sneak.destination.x*100);assert.equal(f.boss.document.y,sneak.destination.y*100);
  assert.equal(detectionFor(f.player,f.boss).state,'observed','GM execution does not grant stealth after a failed Hide');
  assert.ok(stealthBelief(f.boss)[0].unseenChance>0,'planning remains uncertain');
});

test('revealing actions clear estimates even without an actual hidden record',async()=>{
  const f=fixture({die:1});fog(f);await f.adapter.execute(choice('hide'),await ledger(f));
  assert.ok(stealthBelief(f.boss).length);assert.equal(detectionFor(f.player,f.boss).state,'observed');
  await f.adapter.execute(choice('reload'),await ledger(f));assert.deepEqual(stealthBelief(f.boss),[]);
});

test('reaction planning ignores secret Undetected outcomes while actual reaction eligibility honors them',async()=>{
  const f=fixture();fog(f);f.player.document.x=300;
  f.player.actor.items.set('reactive',{id:'reactive',type:'feat',slug:'reactive-strike'});
  f.player.actor.system.actions=[{type:'strike',item:{id:'sword',isMelee:true},ready:true}];
  const planned=[];
  for(const actual of ['observed','undetected']){
    await f.boss.document.setFlag(MODULE_ID,'stealth',{combatId:f.combat.id,sceneId:'scene',moving:false,entries:[{observerId:f.player.id,state:actual}]});
    planned.push(f.reactions.reactors(f.boss,{planning:true}).map(token=>token.id));
    assert.equal(f.reactions.reactors(f.boss).length,actual==='observed'?1:0);
  }
  assert.deepEqual(planned,[['fighter'],['fighter']]);
});

test('the next turn retains belief from Hide and does not Hide again, even after a secretly failed roll',async()=>{
  for(const die of [1,15]){
    const f=fixture({die});fog(f);const l=await ledger(f);
    const result=await f.adapter.execute(choice('hide'),l);await f.adapter.recordOutcome(choice('hide'),l,result);
    game.combat.round++;const next=await f.adapter.snapshot(await ledger(f));
    assert.equal(next.hideAttempts,0);assert.ok(next.enemies[0].stealthChance>0);assert.equal(next.hideTargets.length,0);
    assert.equal(f.adapter.candidates(next).some(c=>c.kind==='hide'),false);
    assert.ok(f.adapter.decide(next).rejected.some(c=>c.kind==='hide'&&c.reason.includes('previous Hide/Sneak')));
    await f.adapter.execute(choice('reload'),await ledger(f));
    const revealed=await f.adapter.snapshot(await ledger(f));assert.ok(revealed.hideTargets.length);
  }
});

test('scouts retain observed reach and speed without reading a concealed weapon change',async()=>{
  const f=fixture();f.player.actor.getReach=()=>10;
  f.player.actor.system.actions=[{type:'strike',ready:true,item:{isMelee:true}}];
  f.player.actor.system.movement={speeds:{land:{value:20}}};
  const l=await ledger(f);await f.adapter.prepareTurn({ledger:l,canContinue:()=>true});
  const seen=await f.adapter.snapshot(l);assert.equal(seen.enemies[0].threat.reach,10);assert.equal(seen.enemies[0].threat.speed,20);
  f.player.actor.conditionsSet.add('undetected');f.player.actor.getReach=()=>30;
  f.player.actor.system.movement.speeds.land.value=90;
  const remembered=await f.adapter.snapshot(l);
  assert.equal(remembered.enemies[0].threat.reach,10);assert.equal(remembered.enemies[0].threat.speed,20);
  f.player.actor.conditionsSet.delete('undetected');
  const observedAgain=await f.adapter.snapshot(l);assert.equal(observedAgain.enemies[0].threat.reach,30);
});

test('focus fire uses witnessed recent hits, expires, and never reads target HP',async()=>{
  const f=fixture(),ally=f.token('scout-ally',f.makeActor('scout-ally',data),200,300,1);
  const unseen=f.token('unseeing-ally',f.makeActor('unseeing-ally',data),200,400,1);
  unseen.checkCollision=()=>true;
  const strike=choice('strike',{targetId:f.player.id,strikeId:f.adapter.parts().ranged.item.id});
  await f.adapter.recordOutcome(strike,await ledger(f),{lastAction:{kind:'strike',hit:true}});
  const record=f.boss.document.getFlag(MODULE_ID,'scoutFocus');
  assert.ok(record.witnessIds.includes(ally.id));assert.ok(!record.witnessIds.includes(unseen.id));
  const allyAdapter=createCreatureAdapter(ally,null),unseenAdapter=createCreatureAdapter(unseen,null);
  const seen=await allyAdapter.snapshot(await allyAdapter.readLedger(f.adapter.turnKey()));
  const blind=await unseenAdapter.snapshot(await unseenAdapter.readLedger(f.adapter.turnKey()));
  assert.equal(seen.enemies[0].focusFire,true);assert.equal(blind.enemies[0]?.focusFire??false,false);
  game.combat.round+=2;
  const expired=await allyAdapter.snapshot(await allyAdapter.readLedger(f.adapter.turnKey()));
  assert.equal(expired.enemies[0].focusFire,false);
});

test('a missed or unseen attack does not create shared focus-fire knowledge',async()=>{
  const f=fixture(),strike=choice('strike',{targetId:f.player.id});
  await f.adapter.recordOutcome(strike,await ledger(f),{lastAction:{kind:'strike',hit:false}});
  assert.equal(f.boss.document.getFlag(MODULE_ID,'scoutFocus'),undefined);
  f.player.actor.conditionsSet.add('hidden');
  await f.adapter.recordOutcome(strike,await ledger(f),{lastAction:{kind:'strike',hit:true}});
  assert.deepEqual(f.boss.document.getFlag(MODULE_ID,'scoutFocus').witnessIds,[]);
});

function supportingScouts(f){
  const allies=[[100,300],[200,400],[100,500]].map(([x,y],i)=>{
    const ally=f.token(`support-${i}`,f.makeActor(`support-${i}`,data),x,y,1);
    f.flags.set(`token-${ally.id}:${MODULE_ID}:config`,{enabled:true});
    return ally;
  });
  const self=f.combat.combatants[0],enemy=f.combat.combatants[1];
  f.combat.combatants=[self,...allies.map(ally=>({id:`c-${ally.id}`,tokenId:ally.id,sceneId:'scene',actor:ally.actor})),enemy];
  return allies;
}

test('isolated-target swarm support accounts for living scouts and initiative before the enemy',async()=>{
  const f=fixture(),allies=supportingScouts(f),l=await ledger(f);
  let s=await f.adapter.snapshot(l);
  assert.equal(s.group.rangedCount,4);assert.equal(s.group.targets[f.player.id].arriving,3);assert.equal(s.group.targets[f.player.id].swarm,true);
  const enemy=f.combat.combatants.pop();f.combat.combatants.splice(1,0,enemy);
  s=await f.adapter.snapshot(l);assert.equal(s.group.targets[f.player.id].swarm,false);
  const ally=allies[0];ally.actor.hitPoints.value=0;
  s=await f.adapter.snapshot(l);assert.equal(s.group.rangedCount,3);
});

test('nearby hostile reinforcements or unknown enemy locations prevent assuming an isolated target',async()=>{
  const f=fixture();supportingScouts(f);
  const reinforcement=f.token('reinforcement',f.makeActor('reinforcement',{...data,type:'character'}),600,400,1);
  f.combat.combatants.push({id:'c-reinforcement',tokenId:reinforcement.id,sceneId:'scene',actor:reinforcement.actor});
  let s=await f.adapter.snapshot(await ledger(f));assert.equal(s.group.targets[f.player.id].swarm,false);
  reinforcement.document.x=1200;reinforcement.document.y=1200;reinforcement.actor.conditionsSet.add('undetected');
  s=await f.adapter.snapshot(await ledger(f));assert.equal(s.seek.suspectedOpponents,1);assert.equal(s.group.targets[f.player.id].swarm,false);
});

test('hidden, unseen or disabled scouts do not promise coordinated support',async()=>{
  const f=fixture(),allies=supportingScouts(f);
  allies[0].document.hidden=true;
  allies[1].actor.conditionsSet.add('undetected');
  f.flags.set(`token-${allies[2].id}:${MODULE_ID}:config`,{enabled:false});
  const s=await f.adapter.snapshot(await ledger(f));assert.equal(s.group.rangedCount,1);assert.equal(s.group.targets[f.player.id].swarm,false);
});

test('ranged group support requires each ally to have an actual firing lane',async()=>{
  const f=fixture(),allies=supportingScouts(f);
  for(const ally of allies)ally.checkCollision=()=>true;
  const s=await f.adapter.snapshot(await ledger(f));assert.equal(s.group.rangedCount,4);
  assert.equal(s.group.targets[f.player.id].rangedSupport,0);assert.equal(s.group.targets[f.player.id].swarm,false);
});

test('native projected flanking applies to the sword, while native melee rolls receive its off-guard option',async()=>{
  const f=fixture();f.player.document.x=300;
  const ally=f.token('flanker',f.makeActor('flanker',data),400,200,1);
  f.combat.combatants.push({id:'c-flanker',tokenId:ally.id,sceneId:'scene',actor:ally.actor});
  f.boss.onOppositeSides=(from,other,target)=>from.mechanicalBounds.x<target.document.x&&other.document.x>target.document.x;
  f.boss.isFlanking=()=>true;
  const s=await f.adapter.snapshot(await ledger(f)),parts=f.adapter.parts(),enemy=s.enemies[0];
  assert.equal(enemy.strikes[parts.strike.item.id].flanked,true);assert.equal(enemy.strikes[parts.ranged.item.id].flanked,false);
  await f.adapter.execute(choice('strike',{targetId:f.player.id,strikeId:parts.ranged.item.id}),{...await ledger(f),attacksMade:1});
  const ranged=f.calls.filter(c=>c[0]==='attack').at(-1);assert.ok(!ranged[4].options.includes('target:condition:off-guard'));
  await f.adapter.execute(choice('drawSword'),await ledger(f));
  await f.adapter.execute(choice('strike',{targetId:f.player.id,strikeId:parts.strike.item.id}),{...await ledger(f),attacksMade:1});
  const melee=f.calls.filter(c=>c[0]==='attack').at(-1);assert.ok(melee[4].options.includes('target:condition:off-guard'));
  assert.equal(f.player.actor.hasCondition('off-guard'),false);
});

test('a complete native swarm turn spends Draw, movement and a sword Strike without using bolts',async()=>{
  const f=fixture(),allies=supportingScouts(f);
  allies[0].document.x=600;allies[0].document.y=200;
  f.boss.onOppositeSides=(from,other,target)=>from.mechanicalBounds.x<target.document.x&&other.document.x>target.document.x;
  await f.boss.document.setFlag(MODULE_ID,'scoutGear',{loaded:false});
  const sword=f.adapter.parts().strike.item.id;
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0);assert.equal(result.uncertain,false);
  assert.equal(f.adapter.parts().bolts.system.quantity,20);
  assert.equal(f.adapter.parts().sword.system.equipped.handsHeld,1);
  assert.equal(f.adapter.parts().bow.system.equipped.handsHeld,1);
  assert.equal(f.calls.filter(c=>c[0]==='attack'&&c[2]===sword).length,1);
  assert.ok(f.calls.some(c=>c[0]==='move'));
});

test('an empty bolt stack switches to a shortsword without needing swarm support or refilling ammunition',async()=>{
  const f=fixture();await f.adapter.parts().bolts.update({'system.quantity':0});
  const result=await new TurnRunner(f.adapter).run();
  assert.equal(result.actionsRemaining,0);assert.equal(result.uncertain,false);
  assert.equal(f.adapter.parts().bolts.system.quantity,0);assert.equal(f.adapter.parts().sword.system.equipped.handsHeld,1);
  const attacks=f.calls.filter(c=>c[0]==='attack');assert.ok(attacks.length>0);
  assert.ok(attacks.every(c=>c[2]===f.adapter.parts().strike.item.id));assert.equal(f.calls.some(c=>c[0]==='stealth'),false);
});

test('a deleted ammunition stack still permits spending one action to ready the sword',async()=>{
  const f=fixture();f.actor.items.delete(f.adapter.parts().bolts.id);
  const result=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(result.actionsRemaining,2);assert.equal(f.adapter.parts().sword.system.equipped.handsHeld,1);
  assert.equal(f.adapter.parts().bow.system.equipped.handsHeld,1);assert.equal(f.adapter.parts().bolts,undefined);
});

test('scout movement memory records resolved destinations across turns and expires in a new encounter',async()=>{
  const f=fixture(),l=await ledger(f),path=[f.adapter.originCell(),{x:2,y:3}];
  const c=choice('stride',{path,destination:{x:2,y:3}}),r=await f.adapter.execute(c,{...l,actionsRemaining:2});
  await f.adapter.recordOutcome(c,l,r);
  game.combat.round++;
  const state=await f.adapter.snapshot(await ledger(f));assert.ok(state.motionMemory.some(e=>e.cell.x===2&&e.cell.y===3));
  game.combat.id='new-combat';
  assert.deepEqual((await f.adapter.snapshot(await ledger(f))).motionMemory,[]);
});

test('tactical maps use remembered enemy geometry rather than live Undetected coordinates',async()=>{
  const f=fixture();await f.adapter.prepareTurn({ledger:await ledger(f),canContinue:()=>true});
  f.player.actor.conditionsSet.add('undetected');
  const first=await f.adapter.snapshot(await ledger(f));
  const before=JSON.stringify([...f.adapter.lastTacticalMap.cells]);
  f.player.document.x=1200;f.player.document.y=1200;
  const after=await f.adapter.snapshot(await ledger(f));
  assert.equal(JSON.stringify([...f.adapter.lastTacticalMap.cells]),before);
  assert.deepEqual(after.enemies[0].awareness.position,first.enemies[0].awareness.position);
});

test('tactical caches reuse unchanged geometry and invalidate when a wall changes',async()=>{
  const f=fixture();canvas.scene.walls={contents:[]};
  await f.adapter.snapshot(await ledger(f));const original=f.adapter.lastTacticalMap;
  await f.adapter.snapshot(await ledger(f));assert.equal(f.adapter.lastTacticalMap,original);
  for(let y=0;y<16;y++)f.walls.add(`4,${y}`);
  canvas.scene.walls.contents.push({id:'barrier',c:[400,0,400,1600],move:20,dir:0,ds:0});
  await f.adapter.snapshot(await ledger(f));assert.notEqual(f.adapter.lastTacticalMap,original);
  assert.ok(f.adapter.lastTacticalMap.origin.enemyArrival>original.origin.enemyArrival);
});
