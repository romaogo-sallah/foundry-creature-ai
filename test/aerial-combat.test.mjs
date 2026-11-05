import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture as eagleFixture} from './helpers/eagle-fixture.mjs';
import {fixture as scorpionFixture} from './helpers/manticore-fixture.mjs';
import {fixture as quillFixture} from './helpers/quill-fixture.mjs';
import {usePlanningWorker} from './helpers/browser-worker.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
usePlanningWorker();
function flyingTarget(f,{altitude=20,height=5,reach=5,width=1}={}){
 const target=f.player;target.document.elevation=altitude;target.document.width=target.document.height=width;
 target.w=target.h=width*100;target.actor.dimensions={height};target.actor.getReach=()=>reach;
 target.actor.system.attributes.speed={value:25,otherSpeeds:[{type:'fly',value:40}]};
 Object.defineProperty(target,'mechanicalBounds',{get:()=>new PIXI.Rectangle(target.document.x,target.document.y,target.w,target.h)});
 Object.defineProperty(target,'center',{get:()=>({x:target.document.x+target.w/2,y:target.document.y+target.h/2})});
 return createCreatureAdapter(f.boss,null,{reactions:f.reactions});
}

test('Eagle Dive hits a Large airborne opponent, then the eagle climbs away within the same three-action turn',async()=>{
 const f=eagleFixture({altitude:40}),ai=flyingTarget(f,{height:10,width:2});
 const state=await ai.snapshot(await ai.readLedger(ai.turnKey())),chosen=ai.decide(state).chosen;
 assert.equal(chosen.kind,'eagleDive');assert.equal(chosen.targetId,f.player.id);
 assert.ok(chosen.destination.elevation>=20,'the attack ends in the flying target’s space band, not on the ground');
 assert.ok(chosen.path[0].elevation-chosen.destination.elevation>=10);
 const result=await new TurnRunner(ai).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);assert.equal(result.attacksMade,1);
 const attack=f.calls.find(c=>c[0]==='attack');assert.equal(attack[2],ai.parts().talon.item.id);assert.equal(attack[4].target.id,f.player.id);
 assert.ok(f.boss.document.elevation>=40);assert.ok(f.calls.some(c=>c[0]==='damage-applied'));
});

test('an eagle below an airborne opponent stages first and actually attacks on its following turn',async()=>{
 const f=eagleFixture({altitude:5}),ai=flyingTarget(f,{height:10,width:2});
 await new TurnRunner(ai).run();assert.ok(f.boss.document.elevation>=40);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,0);
 game.combat.round++;
 const result=await new TurnRunner(ai).run();
 assert.equal(result.uncertain,false);assert.ok(f.calls.some(c=>c[0]==='attack'&&c[4].target.id===f.player.id));
 assert.ok(f.boss.document.elevation>=40);
});

test('scorpion-tail Manticore closes 3D Stinger reach, attacks an airborne opponent, and withdraws',async()=>{
 const f=scorpionFixture({altitude:35}),ai=flyingTarget(f);
 const result=await new TurnRunner(ai).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 const attacks=f.calls.filter(c=>c[0]==='attack');assert.equal(attacks.length,1);
 assert.equal(attacks[0][2],ai.parts().stinger.item.id);assert.equal(attacks[0][4].target.id,f.player.id);
 assert.equal(f.calls.filter(c=>c[0]==='venom-save').length,1);assert.ok(f.boss.document.elevation>=35);
});

test('quill-tail Manticore shoots an airborne opponent, spends real spikes and maintains flight',async()=>{
 const f=quillFixture({altitude:35}),ai=flyingTarget(f);
 const result=await new TurnRunner(ai).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 const attacks=f.calls.filter(c=>c[0]==='attack');assert.ok(attacks.length>0);
 assert.ok(attacks.every(c=>c[2]===ai.parts().spike.item.id&&c[4].target.id===f.player.id));
 assert.ok(ai.spikesRemaining<12);assert.ok(f.boss.document.elevation>=35);
 assert.equal(f.boss.document.getFlag('foundry-creature-ai','flight').round,game.combat.round);
});

test('an eagle threatened by Reactive Strike still chooses a real escape climb instead of hovering forever',async()=>{
 const f=eagleFixture({altitude:5});f.boss.document.x=400;
 f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;f.player.actor.level=6;
 for(const strike of f.actor.system.actions)for(const damage of Object.values(strike.item.system.damageRolls))damage.damage='2d8+9';
 f.player.actor.items.set('reactive',{id:'reactive',type:'feat',slug:'reactive-strike',system:{}});
 f.player.actor.system.actions=[{type:'strike',item:{id:'spear',name:'Spear',isMelee:true},ready:true}];
 const ai=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),state=await ai.snapshot(await ai.readLedger(ai.turnKey()));
 assert.equal(state.flight.safety.safe,false);
 assert.ok(state.flight.moves.some(m=>m.safety.safe&&m.reactionRisk>0));
 const chosen=ai.decide(state).chosen;assert.equal(chosen.kind,'fly');assert.equal(Boolean(chosen.features?.hover),false);
 assert.equal(chosen.features.flightRetreat,true);
 const result=await new TurnRunner(ai).run({oneAction:true});
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,2);assert.ok(f.boss.document.elevation>=25);
 assert.ok(f.prompts.length>0,'escaping must still wait for the real Reactive Strike prompt');
});
