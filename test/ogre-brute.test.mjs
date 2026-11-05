import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fixture as makeFixture } from './helpers/ogre-fixture.mjs';
import { PF2eOgreBruteAdapter, ogreBruteParts } from '../src/foundry/ogre-brute-adapter.mjs';
import { creatureProfile, createCreatureAdapter, supportedProfiles } from '../src/foundry/creature-profiles.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';
import { isOgre, commandEffects } from '../src/foundry/command-effects.mjs';

const data=JSON.parse(await readFile(new URL('./fixtures/ogre-mechanics.json',import.meta.url)));
const fixture=options=>makeFixture({npcData:data,Adapter:PF2eOgreBruteAdapter,...options});
const configureRefuse=(f,count)=>f.flags.set(`token-boss:${MODULE_ID}:config`,{...f.adapter.config,refuseCount:count});
const attack=(f,strike,targetId=f.player.id)=>({kind:'strike',strikeId:strike.item.id,targetId});

test('the supplied legacy Ogre matches a distinct bruiser profile and keeps its declared axe',async()=>{
  const f=fixture(); const parts=ogreBruteParts(f.actor);
  assert.equal(createCreatureAdapter(f.boss).profileId,'ogre');
  assert.deepEqual(supportedProfiles().find(profile=>profile.id==='ogre').roles,['bruiser']);
  assert.equal(parts.strike.item.name,'Battle Axe'); assert.equal(parts.averageDamage,9.5);
  assert.equal(parts.meleeWeapon,null); assert.equal(parts.javelin.system.quantity,6);
  assert.equal(f.actor.hitPoints.max,35); assert.equal(f.actor.level,2);
  assert.equal(isOgre(f.actor),true,'the boss can recognize this legacy ogre ally');
  f.actor.name='Renamed brute'; f.actor.sourceId='Actor.world-copy';f.actor._stats={compendiumSource:data.source};
  assert.equal(creatureProfile(f.actor).id,'ogre');
  await f.adapter.assertReady(); const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  const kinds=new Set(f.adapter.candidates(state).map(choice=>choice.kind));
  for(const kind of ['bellow','sweepingHook','trip','knockdown','regrip'])assert.equal(kinds.has(kind),false,kind);
  assert.equal(f.reactions.inspectReactiveStrike(f.boss).abilityFound,false);
});

test('full melee turn uses the NPC axe at ten-foot reach and progresses MAP without drawing the stowed hook',async()=>{
  const f=fixture(); const start={x:f.boss.document.x,y:f.boss.document.y};
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining,0);assert.equal(ledger.attacksMade,3);
  assert.deepEqual(f.calls.filter(call=>call[0]==='attack').map(call=>[call[2],call[3]]),
    [[f.adapter.parts().strike.item.id,0],[f.adapter.parts().strike.item.id,1],[f.adapter.parts().strike.item.id,2]]);
  assert.deepEqual({x:f.boss.document.x,y:f.boss.document.y},start);
  assert.equal(f.actor.itemTypes.weapon.find(item=>item.system.baseItem==='ogre-hook').system.equipped.handsHeld,0);
});

test('a ranged javelin turn throws once and can use its last action to draw the next javelin',async()=>{
  const f=fixture();f.player.document.x=1500;
  const ledger=await new TurnRunner(f.adapter).run();const parts=f.adapter.parts();
  assert.equal(parts.thrown.item.isRanged,true);assert.equal(parts.refuse.item.isRanged,true);
  assert.equal(parts.javelin.system.quantity,5);assert.equal(parts.javelin.system.equipped.handsHeld,1);
  assert.equal(f.adapter.primaryReady(),true);
  assert.equal(ledger.attacksMade,1);assert.equal(f.calls.filter(call=>call[0]==='attack')[0][2],parts.thrown.item.id);
});

test('Refuse requires an Interact pickup, spends configured stock once on a throw, and keeps the physical javelins',async()=>{
  const f=fixture();configureRefuse(f,1);await f.adapter.configure();f.player.document.x=800;
  const parts=f.adapter.parts(), turn=f.adapter.turnKey();
  assert.equal(f.adapter.rangedReady(parts.refuse),false);
  await f.adapter.execute({kind:'drawRefuse'},{turn,attacksMade:0,actionsRemaining:2});
  assert.equal(f.adapter.refuseCount,1);assert.equal(f.adapter.refuseHeld,true);
  await f.adapter.execute(attack(f,parts.refuse),{turn,attacksMade:1,actionsRemaining:1});
  assert.equal(f.adapter.refuseCount,0);assert.equal(f.adapter.refuseHeld,false);
  assert.equal(parts.javelin.system.quantity,6);
  assert.equal(f.calls.filter(call=>call[0]==='attack').length,1);
  assert.equal(f.calls.find(call=>call[0]==='attack')[2],parts.refuse.item.id);
  assert.equal(f.actor.system.actions.some(strike=>strike.item.id===parts.refuse.item.id),true,'no attack item is deleted at zero stock');
  const state=await f.adapter.snapshot({...await f.adapter.readLedger(turn),actionsRemaining:2});
  assert.equal(f.adapter.candidates(state).some(choice=>choice.kind==='drawRefuse'),false);
  assert.match(f.adapter.decide(state).rejected.find(choice=>choice.id==='refuse').reason,/supply is empty/);
});

test('configured Refuse is actually chosen and executed through the shared turn runner',async()=>{
  const f=fixture();configureRefuse(f,1);f.player.document.x=800;
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(f.adapter.refuseCount,0);assert.equal(ledger.attacksMade,1);
  assert.equal(f.calls.find(call=>call[0]==='attack')[2],f.adapter.parts().refuse.item.id);
  assert.equal(f.boss.document.getFlag(MODULE_ID,'playState').abilities.refuse,true);
});

test('one remaining action can prepare ammunition for next turn without borrowing a second action to throw it',async()=>{
  const f=fixture();configureRefuse(f,3);f.player.document.x=800;
  const l={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1};await f.adapter.saveLedger(l);
  const state=await f.adapter.snapshot(l);
  assert.equal(f.adapter.candidates(state).some(choice=>['drawRefuse','drawJavelin'].includes(choice.kind)),true);
  const result=await new TurnRunner(f.adapter).run();assert.equal(result.actionsRemaining,0);assert.equal(result.attacksMade,0);
  assert.equal(f.calls.some(call=>call[0]==='attack'),false);assert.equal(f.adapter.refuseHeld,true);assert.equal(f.adapter.refuseCount,3);
});

test('a javelin occupying the throwing hand prevents picking up Refuse',async()=>{
  const f=fixture();configureRefuse(f,2);await f.adapter.configure();
  const parts=f.adapter.parts();parts.javelin.system.equipped={carryType:'held',handsHeld:1};
  const result=await f.adapter.execute({kind:'drawRefuse'},{turn:f.adapter.turnKey(),actionsRemaining:2,attacksMade:0});
  assert.equal(result.skipped,true);assert.equal(f.adapter.refuseHeld,false);assert.equal(f.adapter.refuseCount,2);
  assert.equal(f.adapter.primaryReady(),true,'the axe can still be used with a held javelin');
});

test('a cancelled Refuse attack keeps stock spent and its action reservation uncertain',async()=>{
  const f=fixture();configureRefuse(f,1);await f.adapter.configure();f.player.document.x=800;
  await f.boss.document.setFlag(MODULE_ID,'ogreGear',{refuseHeld:true});
  await f.adapter.saveLedger({...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1});
  f.adapter.parts().refuse.variants[0].roll=async()=>null;
  await assert.rejects(new TurnRunner(f.adapter).run({oneAction:true}),/resolved result/);
  assert.equal(f.adapter.refuseCount,0);assert.equal(f.adapter.refuseHeld,false);
  assert.equal(f.boss.document.getFlag(MODULE_ID,'ledger').uncertain,true);
});

test('Sweep uses native sweep-bonus only after an axe attempt against a different target, including a miss',async()=>{
  const f=fixture({attackDegree:1});await f.adapter.configure();
  const second=f.token('second',f.makeActor('second',{...data,type:'character'}),500,300);
  second.actor.alliance='party';f.combat.combatants.push({id:'c-second',tokenId:second.id,sceneId:'scene',actor:second.actor});
  const parts=f.adapter.parts(),turn=f.adapter.turnKey();
  await f.adapter.execute(attack(f,parts.strike),{turn,attacksMade:1,actionsRemaining:2});
  assert.equal(f.calls.find(call=>call[0]==='attack')[4].options.includes('sweep-bonus'),false);
  const state=await f.adapter.snapshot({...await f.adapter.readLedger(turn),attacksMade:1,actionsRemaining:2});
  assert.equal(state.enemies.find(enemy=>enemy.id===second.id).strikes[parts.strike.item.id].sweepBonus,1);
  assert.equal(state.enemies.find(enemy=>enemy.id===f.player.id).strikes[parts.strike.item.id].sweepBonus,0);
  state.style.enabled=false;
  assert.equal(f.adapter.decide(state).chosen.targetId,second.id,'Sweep encourages attacking a different equal target');
  await f.adapter.execute(attack(f,parts.strike,second.id),{turn,attacksMade:2,actionsRemaining:1});
  assert.equal(f.calls.filter(call=>call[0]==='attack')[1][4].options.includes('sweep-bonus'),true);
  await f.adapter.execute(attack(f,parts.strike),{turn,attacksMade:3,actionsRemaining:0});
  assert.equal(f.calls.filter(call=>call[0]==='attack')[2][4].options.includes('sweep-bonus'),true,'earlier other target need not be the most recent target');
  f.combat.round++;
  await f.adapter.execute(attack(f,parts.strike,second.id),{turn:f.adapter.turnKey(),attacksMade:1,actionsRemaining:2});
  assert.equal(f.calls.filter(call=>call[0]==='attack')[3][4].options.includes('sweep-bonus'),false,'new turn resets Sweep history');
});

test('a thrown attack does not grant the axe Sweep bonus',async()=>{
  const f=fixture();await f.adapter.configure();
  await f.adapter.parts().javelin.update({'system.equipped.carryType':'held','system.equipped.handsHeld':1});
  const turn=f.adapter.turnKey();await f.adapter.execute(attack(f,f.adapter.parts().thrown),{turn,attacksMade:1,actionsRemaining:2});
  await f.adapter.execute(attack(f,f.adapter.parts().strike),{turn,attacksMade:2,actionsRemaining:1});
  assert.equal(f.calls.filter(call=>call[0]==='attack')[1][4].options.includes('sweep-bonus'),false);
});

test('the taught profile preserves actor numerical adjustments and rejects unknown Refuse counts',async()=>{
  const f=fixture();f.adapter.parts().strike.item.system.bonus.value+=2;
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.strikes[0].bonus,13);
  configureRefuse(f,-1);await assert.rejects(f.adapter.assertReady(),/whole number/);
});

test('an ogre retains sight-blocked enemies for pursuit but cannot throw through an opaque barrier',async()=>{
  const f=fixture();await f.adapter.configure();f.player.document.x=800;
  const parts=f.adapter.parts();
  await parts.javelin.update({'system.equipped.carryType':'held','system.equipped.handsHeld':1});
  f.boss.checkCollision=(_destination,{type}={})=>type==='sight';
  const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
  assert.equal(state.enemies.length,1);
  assert.equal(state.enemies[0].lineOfSight,false);
  assert.equal(state.enemies[0].strikes[parts.thrown.item.id].usable,false);
  assert.ok(state.moves.length>0);
  const result=await f.adapter.execute(attack(f,parts.thrown),{...ledger,attacksMade:1});
  assert.equal(result.skipped,true);
  assert.equal(parts.javelin.system.quantity,6);
  assert.equal(f.calls.some(call=>call[0]==='attack'),false);
});

test('the Ogre Boss can command this legacy Ogre and it spends the extra action only on movement',async()=>{
  const f=makeFixture(),ally=f.token('brute',f.makeActor('brute',data),900,500,2);
  f.combat.combatants.push({id:'c-brute',tokenId:ally.id,sceneId:'scene',actor:ally.actor});
  f.flags.set(`token-brute:${MODULE_ID}:config`,{enabled:true,packMorale:false,applyDamage:true,refuseCount:2});
  assert.ok(f.adapter.commandRecipients().includes(ally));
  await f.adapter.execute({kind:'bellow'},{turn:f.adapter.turnKey(),attacksMade:0},{canContinue:()=>true});
  assert.equal(commandEffects(ally.actor).length,1);
  f.combat.turn=2;f.combat.combatant=f.combat.turns[2];
  const adapter=createCreatureAdapter(ally,null,{reactions:f.reactions});
  const ledger=await adapter.readLedger(adapter.turnKey());
  assert.equal(ledger.actionsRemaining,3);assert.equal(ledger.bonusMovementActions,1);
  const state=await adapter.snapshot({...ledger,actionsRemaining:0});
  const options=adapter.candidates(state).filter(choice=>choice.kind!=='endTurn');
  assert.ok(options.length>0);assert.ok(options.every(choice=>['stride','step'].includes(choice.kind)));
});

test('Alt+W controls recognize the new Ogre and save the Refuse supply without demanding boss abilities',async()=>{
  const f=fixture();const hooks=new Map();let dialog;
  globalThis.Hooks={once:(name,fn)=>hooks.set(name,fn),on:(name,fn)=>hooks.set(name,fn)};
  globalThis.ui={notifications:{info:()=>{},error:()=>{}}};
  globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{
    dialog=config;
    const elements={targetMode:{value:'alliance'},autoRun:{checked:false},autoAdvance:{checked:true},
      applyDamage:{checked:true},pauseForReactions:{checked:true},refuseCount:{value:'4'}};
    return config.buttons.find(button=>button.action==='save').callback({}, {form:{elements}});
  }}}}};
  const main=await import('../src/foundry/main.mjs?ogre-controls');
  await main.openControls(f.boss);
  assert.match(dialog.content,/Profile:<\/strong> Ogre/);
  assert.match(dialog.content,/Refuse remaining/);
  assert.doesNotMatch(dialog.content,/hook Trip|Bellowing Command/);
  assert.equal(f.adapter.config.refuseCount,4);assert.equal(f.adapter.config.autoAdvance,true);
});
