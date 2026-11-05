import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ogreData } from './helpers/ogre-fixture.mjs';
import { ogreParts } from '../src/foundry/ogre-adapter.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';
import { createCreatureAdapter, supportedProfiles } from '../src/foundry/creature-profiles.mjs';
import { commandEffects, expireCommands, movementQuickened, cleanupOrphanCommands } from '../src/foundry/command-effects.mjs';
import { readFile } from 'node:fs/promises';

test('the supplied export resolves to its bruiser/leader profile and validates its linked inventory', () => {
  const f=fixture(), parts=ogreParts(f.actor);
  assert.equal(ogreData.system.details.level.value,7);
  assert.equal(parts.strike.totalModifier,19);
  assert.equal(parts.averageDamage,16.5);
  assert.equal(parts.javelin.system.quantity,6);
  assert.equal(createCreatureAdapter(f.boss).profileId,'ogre-boss');
  assert.deepEqual(supportedProfiles().find(profile=>profile.id==='ogre-boss').roles,['bruiser','leader']);
  parts.strike.item.flags.pf2e.linkedWeapon='missing';
  assert.throws(()=>ogreParts(f.actor),/linked/);
});

test('a 2×2 creature has legal ten-foot hook reach and cannot enter one-cell gaps', async () => {
  const f=fixture();
  await f.adapter.assertReady();
  const ledger=await f.adapter.readLedger(f.adapter.turnKey()), state=await f.adapter.snapshot(ledger);
  assert.equal(state.enemies[0].distance,10);
  assert.equal(state.enemies[0].strikes[state.hookId].usable,true);
  f.player.document.x=600;
  assert.equal((await f.adapter.snapshot(ledger)).enemies[0].strikes[state.hookId].usable,false);
  for(let y=0;y<16;y++)if(y!==5)f.walls.add(`6,${y}`);
  const blocked=await f.adapter.snapshot(ledger);
  assert.ok(!blocked.moves.some(move=>move.x>=6),'one free grid cell cannot fit the Large footprint');
  assert.ok(blocked.moves.every(move=>move.x<=14&&move.y<=14),'the complete footprint remains on the map');
});

test('a full turn can Trip and Sweep, with a reaction and the correct subsequent MAP', async () => {
  const f=fixture();
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(f.calls.filter(call=>call[0]==='trip').length,1);
  const attacks=f.calls.filter(call=>call[0]==='attack');
  assert.deepEqual(attacks.map(call=>call[3]),[1,2,2]);
  assert.equal(f.calls.find(call=>call[0]==='trip')[1].multipleAttackPenalty,0);
  assert.equal(ledger.actionsRemaining,0);
  assert.equal(ledger.attacksMade,4,'Trip, its reaction Strike, and the two remaining normal Strikes');
  assert.equal(f.reactions.available(f.boss),false);
  assert.equal(f.actor.getFlag(MODULE_ID,'reaction').kind,'sweeping-hook');
  assert.equal(f.actor.hasCondition('prone'),false);
});

test('a missed Trip cannot trigger Sweeping Hook, and an already prone enemy cannot be tripped', async () => {
  const f=fixture({tripOutcome:'failure'});
  await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(f.calls.filter(call=>call[0]==='attack').length,0);
  assert.equal(f.reactions.available(f.boss),true);
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  assert.equal(ledger.pendingSweep,null);
  f.player.actor.conditionsSet.add('prone');
  assert.ok(!f.adapter.candidates(await f.adapter.snapshot(ledger)).some(candidate=>candidate.kind==='trip'));
});

test('using the ordinary reaction prevents Sweeping Hook and a final-action Trip still permits its reaction', async () => {
  const f=fixture();
  await f.reactions.setSpent(f.boss,true);
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.sweepingAvailable,false);
  const other=fixture();
  await other.adapter.saveLedger({...await other.adapter.readLedger(other.adapter.turnKey()),actionsRemaining:1});
  const ledger=await new TurnRunner(other.adapter).run();
  assert.equal(ledger.actionsRemaining,0);
  assert.equal(ledger.attacksMade,2);
  assert.deepEqual(other.calls.filter(call=>call[0]==='attack').map(call=>call[3]),[1]);
});

test('javelins require Draw, release a hook hand, consume real ammunition, and need another draw', async () => {
  const f=fixture();
  f.player.document.x=1500;
  const ledger=await new TurnRunner(f.adapter).run();
  const parts=f.adapter.parts();
  assert.equal(parts.thrown.item.isRanged,true,'blank source range is normalized from the taught thrown attack');
  assert.equal(parts.javelin.system.quantity,5);
  assert.equal(parts.hook.system.equipped.handsHeld,1);
  assert.equal(parts.javelin.system.equipped.handsHeld,0);
  assert.equal(ledger.attacksMade,1);
  assert.equal(f.calls.filter(call=>call[0]==='attack').length,1);
  assert.ok(f.calls.some(call=>call[0]==='item-update'&&call[1]===parts.javelin.id&&call[2]['system.equipped.carryType']==='held'));
});

test('after throwing, a nearby enemy outside hook reach makes the last action ready the hook for reactions', async () => {
  const f=fixture(); await f.adapter.configure();
  f.player.document.x=600; // 15 ft away: the hook cannot Strike yet.
  const parts=f.adapter.parts(); parts.hook.system.equipped.handsHeld=1;
  const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1};
  await f.adapter.saveLedger(ledger);
  const state=await f.adapter.snapshot(ledger);
  assert.equal(state.enemies[0].strikes[state.hookId].inReach,false);
  assert.equal(f.adapter.decide(state).chosen.kind,'regrip');
  const after=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(parts.hook.system.equipped.handsHeld,2);
  assert.equal(after.actionsRemaining,0,'regrip spends an Interact action');
  assert.equal(after.attacksMade,1,'regrip does not increase MAP');
  assert.equal(f.reactions.available(f.boss),true,'regrip preserves the reaction');
  f.player.document.x=500;
  assert.equal(f.reactions.meleeStrikes(f.boss,f.player).length,1);
});

test('regrip for future reactions is not invented against distant enemies', async () => {
  const f=fixture(); await f.adapter.configure();
  f.player.document.x=1500;
  f.adapter.parts().hook.system.equipped.handsHeld=1;
  const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1};
  const state=await f.adapter.snapshot(ledger);
  assert.equal(f.adapter.candidates(state).some(choice=>choice.kind==='regrip'),false);
  assert.notEqual(f.adapter.decide(state).chosen.kind,'regrip');
});

test('Bellowing Command affects only ogre allies who hear, understand and can receive its mental effect', async () => {
  const f=fixture(), ally=f.addOgre('ally'), deaf=f.addOgre('deaf',1100,500), immune=f.addOgre('immune',900,800);
  deaf.actor.conditionsSet.add('deafened');immune.actor.attributes.immunities.push({type:'fear'});
  const before=await f.adapter.readLedger(f.adapter.turnKey());
  const state=await f.adapter.snapshot(before);
  assert.deepEqual(state.commandRecipients.map(ally=>ally.id),['ally']);
  const choice=f.adapter.candidates(state).find(candidate=>candidate.kind==='bellow');
  assert.ok(choice);
  await f.adapter.execute(choice,{...before,actionsRemaining:2},{canContinue:()=>true});
  assert.equal(commandEffects(ally.actor).length,1);
  assert.equal(ally.actor.hasCondition('quickened'),true);
  assert.equal(commandEffects(f.player.actor).length,0);
  assert.equal(commandEffects(deaf.actor).length,0);
  assert.equal(commandEffects(immune.actor).length,0);
  assert.equal(commandEffects(f.actor).length,0,'the boss does not command itself');
  const effect=commandEffects(ally.actor)[0];
  assert.equal(effect.flags[MODULE_ID].command.expiryRound,1);
  assert.equal(effect.system.rules[0].key,'GrantItem');
});

test('Bellowing Command ignores acoustics, walls, distance, elevation, levels and silence effects', async () => {
  const f=fixture(),ally=f.addOgre('far-ally',2500,1400);
  ally.document.elevation=40;ally.document.level='upper';
  f.actor.items.set('silence',{id:'silence',type:'effect',slug:'silence'});
  f.boss.checkCollision=(_destination,{type}={})=>{
    if(type==='sound')throw new Error('Collision testing for Token sound sources is not supported at this time');
    return true; // Walls block physical and sight rays, not this command.
  };
  assert.deepEqual(f.adapter.commandRecipients().map(token=>token.id),[ally.id]);
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  const choice=f.adapter.candidates({...state,self:{...state.self,silenced:true}}).find(candidate=>candidate.kind==='bellow');
  assert.ok(choice,'an acoustic/silence flag does not suppress the command');
  await f.adapter.execute(choice,{turn:f.adapter.turnKey(),attacksMade:0},{canContinue:()=>true});
  assert.equal(commandEffects(ally.actor).length,1);
  assert.equal(ally.actor.hasCondition('quickened'),true);
});

test('command Quickened grants only a movement action and expires at the end of the ally next turn', async () => {
  const f=fixture(), ally=f.addOgre('ally');
  const choice=f.adapter.candidates(await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()))).find(candidate=>candidate.kind==='bellow');
  await f.adapter.execute(choice,{turn:f.adapter.turnKey(),attacksMade:0},{canContinue:()=>true});
  f.combat.turn=2;f.combat.combatant=f.combat.turns[2];
  const adapter=createCreatureAdapter(ally,null,{reactions:f.reactions});
  const ledger=await adapter.readLedger(adapter.turnKey());
  assert.equal(ledger.actionsRemaining,3);
  assert.equal(ledger.bonusMovementActions,1);
  const onlyBonus={...ledger,actionsRemaining:0};
  const decision=adapter.decide(await adapter.snapshot(onlyBonus));
  assert.ok(['stride','step'].includes(decision.chosen.kind));
  assert.equal(decision.chosen.actionCost,0);
  assert.equal(decision.chosen.bonusActionCost,1);
  await expireCommands({combat:f.combat,endedTokenId:ally.id});
  assert.equal(movementQuickened(ally.actor),false);
  assert.equal(ally.actor.hasCondition('quickened'),false);
});

test('command applied after an ally acted lasts through its next-round turn, and other Quickened is not deleted', async () => {
  const f=fixture(), ally=f.addOgre('ally');
  f.combat.combatants=[f.combat.combatants[2],...f.combat.combatants.slice(0,2)];
  f.combat.turn=1;
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const choice=f.adapter.candidates(await f.adapter.snapshot(ledger)).find(candidate=>candidate.kind==='bellow');
  await f.adapter.execute(choice,ledger,{canContinue:()=>true});
  assert.equal(commandEffects(ally.actor)[0].flags[MODULE_ID].command.expiryRound,2);
  await expireCommands();assert.equal(commandEffects(ally.actor).length,1);
  f.combat.round=2;f.combat.turn=0;f.combat.combatant=f.combat.turns[0];
  await expireCommands();assert.equal(commandEffects(ally.actor).length,1);
  await expireCommands({endedTokenId:ally.id});assert.equal(commandEffects(ally.actor).length,0);
});

test('a slowed recipient loses the restricted action first without losing an extra normal action', async () => {
  const f=fixture(),ally=f.addOgre('ally');
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const choice=f.adapter.candidates(await f.adapter.snapshot(ledger)).find(candidate=>candidate.kind==='bellow');
  await f.adapter.execute(choice,ledger,{canContinue:()=>true});
  ally.actor.conditionsSet.add('slowed');
  f.combat.turn=2;f.combat.combatant=f.combat.turns[2];
  const adapter=createCreatureAdapter(ally,null,{reactions:f.reactions});
  const slowed=await adapter.readLedger(adapter.turnKey());
  assert.equal(slowed.actionsRemaining,3);
  assert.equal(slowed.bonusMovementActions,0);
});

test('ending command effects is serialized and preserves an unrelated Quickened grant', async () => {
  const f=fixture(),ally=f.addOgre('ally');
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const choice=f.adapter.candidates(await f.adapter.snapshot(ledger)).find(candidate=>candidate.kind==='bellow');
  await f.adapter.execute(choice,ledger,{canContinue:()=>true});
  await ally.actor.createEmbeddedDocuments('Item',[{type:'effect',name:'Other Quickened source',system:{rules:[{key:'GrantItem',uuid:'Compendium.pf2e.conditionitems.Item.nlCjDvLMf2EkV2dl'}]}}]);
  const id=commandEffects(ally.actor)[0].id;
  await Promise.all([expireCommands({endedTokenId:ally.id}),expireCommands({endedTokenId:ally.id})]);
  assert.equal(commandEffects(ally.actor).length,0);
  assert.equal(ally.actor.hasCondition('quickened'),true);
  assert.equal(f.calls.filter(call=>call[0]==='delete-items'&&call[2].includes(id)).length,1);
});

test('command expiry also cleans up on combat deletion and does not create stacking bonuses', async () => {
  const f=fixture(),ally=f.addOgre('ally');
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const choice=f.adapter.candidates(await f.adapter.snapshot(ledger)).find(candidate=>candidate.kind==='bellow');
  await f.adapter.execute(choice,ledger,{canContinue:()=>true});
  const again=await f.adapter.execute(choice,ledger,{canContinue:()=>true});
  assert.equal(again.skipped,true);
  assert.equal(commandEffects(ally.actor).length,1);
  await expireCommands({combat:f.combat,removeAll:true});
  assert.equal(commandEffects(ally.actor).length,0);
});

function reactivePlayer(f, degree=3) {
  f.player.document.x=400;
  f.player.actor.items.set('reactive',{id:'reactive',type:'feat',slug:'reactive-strike',system:{}});
  f.player.actor.system.actions=[{type:'strike',ready:true,canAttack:true,item:{id:'sword',name:'Sword',isMelee:true,getRollOptions:()=>[]},
    variants:[{roll:async()=>({degreeOfSuccess:degree})}],damage:async()=>({total:5,instances:[{type:'slashing',total:5}]}),
    critical:async()=>({total:10,instances:[{type:'slashing',total:10}]})}];
  f.reactions.prompts.ask=async request=>{f.prompts.push(request);return request.choices[0].id;};
}

test('a critical Reactive Strike disrupts Draw after its free release, spending the action without drawing', async () => {
  const f=fixture();reactivePlayer(f);
  await f.adapter.configure();
  const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2};
  const result=await f.adapter.execute({kind:'drawJavelin'},ledger,{canContinue:()=>true});
  assert.match(result.pauseReason,/disrupted/);
  assert.equal(result.skipped,undefined);
  assert.equal(f.adapter.parts().hook.system.equipped.handsHeld,1);
  assert.equal(f.adapter.parts().javelin.system.equipped.handsHeld,0);
  assert.equal(f.reactions.available(f.player),false);
  assert.equal(f.reactions.meleeStrikes(f.boss,f.player).length,0,'a hook held in one hand cannot Reactive Strike');
});

test('a ranged attack can provoke while grabbed, waits for its reaction and still resolves if the ogre survives', async () => {
  const f=fixture();reactivePlayer(f,2);
  await f.adapter.configure();
  const parts=f.adapter.parts();
  await parts.hook.update({'system.equipped.handsHeld':1});
  await parts.javelin.update({'system.equipped.carryType':'held','system.equipped.handsHeld':1});
  f.actor.conditionsSet.add('grabbed');
  const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2,attacksMade:1};
  const result=await f.adapter.execute({kind:'strike',strikeId:parts.thrown.item.id,targetId:f.player.id},ledger,{canContinue:()=>true});
  assert.equal(result.lastAction.hit,true);
  assert.equal(result.pause,false);
  assert.ok(f.prompts.some(prompt=>/ranged attack/.test(prompt.description)));
  assert.equal(parts.javelin.system.quantity,5);
});

test('a manually spent reaction is respected when a pending Sweeping Hook is resumed', async () => {
  const f=fixture();
  const previous=await f.adapter.readLedger(f.adapter.turnKey());
  await new TurnRunner(f.adapter).run({oneAction:true});
  assert.ok((await f.adapter.readLedger(f.adapter.turnKey())).pendingSweep);
  await f.reactions.setSpent(f.boss,true);
  await new TurnRunner(f.adapter).run();
  assert.equal(f.calls.filter(call=>call[0]==='attack').length,2,'only the two remaining ordinary attacks resolve');
  assert.equal((await f.adapter.readLedger(previous.turn)).attacksMade,3);
});

test('the general Alt+W controls save and run the supplied ogre through the main module', async () => {
  const f=fixture(),hooks=new Map(),messages=[];
  globalThis.libWrapper={register:()=>{}};
  globalThis.Hooks={once:(id,fn)=>hooks.set(id,fn),on:(id,fn)=>hooks.set(id,fn)};
  game.modules=new Map([[MODULE_ID,{}]]);
  globalThis.ui={notifications:{info:message=>messages.push(message),error:message=>messages.push(message)}};
  const profiles=JSON.parse(await readFile(new URL('../profiles/creatures.json',import.meta.url)));
  globalThis.fetch=async()=>({ok:true,json:async()=>profiles});
  globalThis.foundry={applications:{api:{DialogV2:{wait:async dialog=>{
    assert.match(dialog.content,/Ogre Boss/);
    assert.match(dialog.content,/Bellowing Command/);
    return dialog.buttons.find(button=>button.action==='run').callback({}, {form:{elements:{targetMode:{value:'alliance'},
      autoRun:{checked:false},autoAdvance:{checked:false},applyDamage:{checked:true},pauseForReactions:{checked:true}}}});
  }}}}};
  const main=await import('../src/foundry/main.mjs?ogre-controls');
  await hooks.get('ready')();
  const ledger=await main.openControls(f.boss);
  assert.equal(ledger.actionsRemaining,0);
  assert.equal(ledger.attacksMade,4);
  assert.equal(f.boss.document.getFlag(MODULE_ID,'config').packMorale,false,'bosses do not inherit wolf flight defaults');
  assert.equal(typeof game.modules.get(MODULE_ID).api.registerCreatureProfile,'function');
});

test('a new command effect does not add a movement action to an already saved turn ledger', async () => {
  const f=fixture(),ally=f.addOgre('ally');
  const allyAdapter=createCreatureAdapter(ally,null,{reactions:f.reactions});
  f.combat.turn=2;f.combat.combatant=f.combat.turns[2];
  const before=await allyAdapter.readLedger(allyAdapter.turnKey());
  await allyAdapter.saveLedger(before);
  const ownTurn=f.combat.combatant;
  f.combat.turn=0;f.combat.combatant=f.combat.turns[0];
  const bossLedger=await f.adapter.readLedger(f.adapter.turnKey());
  const command=f.adapter.candidates(await f.adapter.snapshot(bossLedger)).find(candidate=>candidate.kind==='bellow');
  await f.adapter.execute(command,bossLedger,{canContinue:()=>true});
  f.combat.turn=2;f.combat.combatant=ownTurn;
  const same=await allyAdapter.readLedger(allyAdapter.turnKey());
  assert.equal(same.bonusMovementActions,0);
  assert.equal(same.actionsRemaining,3);
});

test('reload cleanup removes only orphaned command effects whose combat no longer exists', async () => {
  const f=fixture(),ally=f.addOgre('ally');
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const command=f.adapter.candidates(await f.adapter.snapshot(ledger)).find(candidate=>candidate.kind==='bellow');
  await f.adapter.execute(command,ledger,{canContinue:()=>true});
  game.combats=new Map([[f.combat.id,f.combat]]);
  await cleanupOrphanCommands();assert.equal(commandEffects(ally.actor).length,1);
  game.combats.clear();
  await cleanupOrphanCommands();assert.equal(commandEffects(ally.actor).length,0);
});
