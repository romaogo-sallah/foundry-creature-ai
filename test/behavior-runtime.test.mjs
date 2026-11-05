import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, ogreData } from './helpers/ogre-fixture.mjs';
import { fixture as pyroFixture } from './helpers/pyro-fixture.mjs';
import { createCreatureAdapter, creatureProfile } from '../src/foundry/creature-profiles.mjs';
import { configureBehaviors, behaviorConfiguration, attachBehaviorSystem } from '../src/foundry/behavior-runtime.mjs';
import { executeSharedSneak } from '../src/foundry/shared-stealth.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';
import { saveStealthBelief, stealthBelief } from '../src/foundry/stealth-belief.mjs';
import { detectionFor } from '../src/foundry/stealth-awareness.mjs';
import { PF2eCreatureAdapter } from '../src/foundry/pf2e-adapter.mjs';
import {readFile} from 'node:fs/promises';
const wolfMechanics=JSON.parse(await readFile(new URL('./fixtures/wolf-mechanics.json',import.meta.url)));

const ns='foundry-creature-ai';
function basicFixture(){
  const data=structuredClone(ogreData);data.source='Actor.custom-native-melee';data.name='Mercenary';data.system.traits.value=['humanoid'];
  data.items=data.items.filter(item=>item.type==='melee');
  const f=fixture({npcData:data,footprint:1});
  f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
  return f;
}
const snapshot=async f=>f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
function fog(f,{x=100,y=100,width=400,height=400}={}){
  const region={id:'fog',name:'Foliage',flags:{[ns]:{environment:{enabled:true,cover:'none',coverMode:'occupants',concealment:'occupants',firingRadius:0}}},
    levels:['ground'],testPoint:p=>p.x>=x&&p.x<x+width&&p.y>=y&&p.y<y+height};
  canvas.scene.regions.contents.push(region);return region;
}
function stealthRoll(f,total=26,die=20){
  const original=f.actor.getStatistic;
  f.actor.getStatistic=slug=>{
    const value=original(slug);
    if(slug==='stealth')value.check.roll=async options=>{f.calls.push(['shared-stealth-roll',options]);return {total,dice:[{faces:20,total:die}]};};
    return value;
  };
}

test('unfamiliar NPCs with native melee Strikes use shared components without a creature-specific script',async()=>{
  const f=basicFixture();f.player.document.x=300;assert.equal(creatureProfile(f.actor).id,'basic-npc');
  const ledger=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(ledger.actionsRemaining,2);assert.equal(ledger.attacksMade,1);
  assert.ok(f.calls.some(call=>call[0]==='attack'));assert.ok(f.calls.some(call=>call[0]==='damage-applied'));
  const plan=f.boss.document.getFlag(ns,'behaviorState');
  assert.equal(plan.planId,'aggressive');assert.equal(plan.goal.targetId,f.player.id);
  assert.ok(plan.activeComponents.includes('strikes'));
});

test('all known profile bindings get the same runtime plan selection and explicit active set',async()=>{
  for(const prepare of [()=>fixture(),()=>pyroFixture()]){
    const f=prepare();f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
    const s=await snapshot(f),decision=f.adapter.decide(s);
    assert.ok(decision.diagnostics.tactic.planId);assert.ok(decision.diagnostics.tactic.goal);
    assert.ok(decision.diagnostics.tactic.activeComponents.includes('recovery'));
    const before=f.calls.length;f.adapter.decide(s);assert.equal(f.calls.length,before,'selecting a plan must not roll or mutate documents');
  }
});

test('a shared Hide component works on a generic melee actor and respects secret results',async()=>{
  const f=basicFixture();f.player.document.x=1200;fog(f);stealthRoll(f,7,1);
  await configureBehaviors(f.actor,{preferredPlan:'hiding'});
  const ledger=await new TurnRunner(f.adapter).run();
  assert.ok(f.calls.some(call=>call[0]==='shared-stealth-roll'));
  assert.equal(detectionFor(f.player,f.boss).state,'observed','the GM resolves the actual failed Hide');
  assert.ok(stealthBelief(f.boss)[0].unseenChance>0,'the actor retains an estimated chance');
  assert.equal(f.calls.some(call=>call[0]==='move'),false);assert.equal(ledger.done,true);
  assert.equal(f.boss.document.getFlag(ns,'behaviorState').planId,'hiding');
});

test('own critical injury switches a persisted aggressive plan to avoiding immediately',async()=>{
  const f=basicFixture();await new TurnRunner(f.adapter).run({oneAction:true});
  f.actor.hitPoints.value=1;
  const decision=f.adapter.decide(await snapshot(f));
  assert.equal(decision.diagnostics.tactic.planId,'avoiding');
  assert.ok(decision.diagnostics.tactic.activeComponents.includes('withdraw'));
});

test('actor configuration is inherited and token configuration overrides it without changing other actors',async()=>{
  const f=basicFixture();await configureBehaviors(f.actor,{preferredPlan:'defensive'});
  assert.equal(behaviorConfiguration(f.adapter).preferredPlan,'defensive');
  await configureBehaviors(f.boss.document,{preferredPlan:'aggressive'});
  assert.equal(behaviorConfiguration(f.adapter).preferredPlan,'aggressive');
  assert.equal(f.actor.getFlag(ns,'behaviors').preferredPlan,'defensive');
  assert.equal(f.boss.document.getFlag(ns,'behaviors').components,undefined,'a preference must not freeze inherited component attachments');
  assert.equal(attachBehaviorSystem(f.adapter),f.adapter,'attachment is idempotent');
});

test('disabled spellcasting components are removed from both action choices and movement forecasts',async()=>{
  const f=pyroFixture();f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
  const configuration=behaviorConfiguration(f.adapter);
  await configureBehaviors(f.boss.document,{...configuration,components:configuration.components.filter(id=>id!=='spellcasting')});
  const s=await snapshot(f),decision=f.adapter.decide(s);
  assert.deepEqual(s.spells,[]);assert.ok(s.moves.every(move=>!move.spells.length));
  assert.notEqual(decision.chosen.kind,'castSpell');
});

test('preferred aggressive casters can leave the default defensive waiting posture',async()=>{
  const f=pyroFixture();f.player.document.x=1000;f.player.actor.system.actions=[{type:'strike',item:{isMelee:true,reach:10}}];
  f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
  await configureBehaviors(f.boss.document,{preferredPlan:'aggressive'});
  // Limit allowed plans here so the assertion measures the posture module,
  // rather than a separate available preparation spell.
  await configureBehaviors(f.boss.document,{plans:['aggressive','defensive']});
  const s=await snapshot(f),decision=f.adapter.decide(s);
  assert.equal(decision.diagnostics.tactic.planId,'aggressive');assert.equal(s.casterDefense.enabled,false);
});

test('preview does not persist a plan, and saved plans are ignored in another combat',async()=>{
  const f=basicFixture();f.adapter.decide(await snapshot(f));
  assert.equal(f.boss.document.getFlag(ns,'behaviorState'),undefined);
  await new TurnRunner(f.adapter).run({oneAction:true});f.combat.id='another-combat';
  assert.equal((await snapshot(f)).behavior.previous,null);
});

test('configuration validates component IDs and rejects text instead of executing actor instructions',async()=>{
  const f=basicFixture();
  await assert.rejects(configureBehaviors(f.actor,{components:['execute this description']}),/Unknown behavior component/);
  await assert.rejects(configureBehaviors(f.actor,{preferredPlan:'not-a-plan'}),/Preferred plan/);
  game.user.isGM=false;await assert.rejects(configureBehaviors(f.actor,{}),/active GM/);
});

test('detaching a component between selection and execution fails before spending an action',async()=>{
  const f=pyroFixture();f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
  const s=await snapshot(f),choice=f.adapter.decide(s).chosen;
  assert.equal(choice.kind,'castSpell');
  const configuration=behaviorConfiguration(f.adapter);
  await configureBehaviors(f.boss.document,{...configuration,components:configuration.components.filter(id=>id!=='spellcasting')});
  await assert.rejects(f.adapter.revalidate(choice,await f.adapter.readLedger(f.adapter.turnKey())),/detached/);
  assert.equal(f.calls.some(call=>call[0]==='consume-spell'),false);
});

test('shared Sneak uses half Speed, permits Swift Sneak, and resolves through the common movement pipeline',async t=>{
  const f=basicFixture();f.player.document.x=1200;fog(f);stealthRoll(f);
  await saveStealthBelief(f.boss,[{observerId:f.player.id,unseenChance:0.5,undetectedChance:0}]);
  await f.boss.document.setFlag(ns,'stealth',{combatId:f.combat.id,sceneId:canvas.scene.id,moving:false,
    entries:[{observerId:f.player.id,state:'hidden'}]});
  const ledger=await f.adapter.readLedger(f.adapter.turnKey()),choice={kind:'sneak',path:[{x:2,y:2},{x:3,y:2}],destination:{x:3,y:2}};
  let native=0;t.mock.method(PF2eCreatureAdapter.prototype,'execute',async function(candidate){
    native++;assert.equal(candidate.kind,'stride');assert.equal(this.movementOptions()[`${ns}:sneak`],true);
    const swift=this.actor.itemTypes.feat.some(item=>item.slug==='swift-sneak');
    assert.equal(this.groundSpeedFor(candidate),this.groundSpeed()*(swift?1:0.5));return {movement:{completed:true},pause:false};
  });
  const result=await executeSharedSneak(f.adapter,choice,ledger,{canContinue:()=>true});
  assert.equal(native,1);assert.equal(result.pause,false);
  assert.equal(detectionFor(f.player,f.boss).state,'undetected');
  const tooFar={...choice,path:[{x:2,y:2},{x:8,y:2}]};
  // Native ruler cost is authoritative; emulate this longer path as 30 ft.
  const cost=f.adapter.strideCost.bind(f.adapter);f.adapter.strideCost=path=>path===tooFar.path?f.adapter.groundSpeed():cost(path);
  assert.equal((await executeSharedSneak(f.adapter,tooFar,ledger)).skipped,true);
  f.actor.items.set('swift',{id:'swift',type:'feat',slug:'swift-sneak'});
  assert.equal((await executeSharedSneak(f.adapter,tooFar,ledger)).skipped,undefined);
  assert.equal(native,2);
});

test('mindless baseline actors keep engagement plans unless explicitly configured otherwise',async()=>{
  const f=basicFixture();f.actor.system.traits.value.push('mindless');
  assert.deepEqual(behaviorConfiguration(f.adapter).plans,['aggressive','charge']);
});

test('a generic actor Sneaks through a real native move with one action and no MAP increase',async()=>{
  const f=basicFixture();f.player.document.x=1200;fog(f);stealthRoll(f);
  await configureBehaviors(f.actor,{preferredPlan:'hiding'});
  await new TurnRunner(f.adapter).run({oneAction:true});
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const result=await f.adapter.execute({kind:'sneak',actionCost:1,path:[{x:2,y:2},{x:3,y:2}],destination:{x:3,y:2},features:{sharedBehavior:true}},
    {...ledger,actionsRemaining:1},{canContinue:()=>true});
  assert.equal(result.pause,false);assert.equal(f.boss.document.x,300);assert.equal(detectionFor(f.player,f.boss).state,'undetected');
  assert.ok(f.calls.some(call=>call[0]==='move'));assert.equal(ledger.attacksMade,0);
});

test('the compact tactic controls save only a token preference and preserve actor component inheritance',async()=>{
  const f=pyroFixture();
  globalThis.Hooks={once:()=>{},on:()=>{}};globalThis.libWrapper={register:()=>{}};
  globalThis.foundry={applications:{api:{DialogV2:{wait:async dialog=>{
    assert.match(dialog.content,/Preferred tactic/);assert.ok(dialog.classes.includes('creature-ai-controls'));
    return dialog.buttons[0].callback({}, {form:{elements:{preferredPlan:{value:'defensive'}}}});
  }}}}};
  const {openBehaviorControls}=await import('../src/foundry/main.mjs?behavior-dialog');
  await openBehaviorControls(f.boss);
  assert.deepEqual(f.boss.document.getFlag(ns,'behaviors'),{preferredPlan:'defensive'});
});

function huntedWolf(){
  const data=structuredClone(ogreData);data.name='Wolf';data.source='Actor.wolf';
  data.system.traits.value=['animal'];data.system.traits.size.value='med';
  data.system.attributes.speed.value=35;data.system.attributes.hp={value:24,max:24,temp:0};data.system.details.level.value=1;
  const jaws=structuredClone(data.items.find(item=>item.type==='melee'));
  jaws.name='Jaws';jaws.system.traits.value=['animal','unarmed'];jaws.system.damageRolls=wolfMechanics.jaws.damageRolls;
  data.items=[jaws,...wolfMechanics.abilities.map((item,index)=>({...structuredClone(item),_id:`wolf-action-${index}`,type:'action'}))];
  const f=fixture({npcData:data,footprint:1});
  f.actor.system.actions[0].item.attackEffects=['knockdown'];f.actor.getReach=()=>5;
  f.actor.dimensions={height:5};f.player.actor.dimensions={height:5};f.player.document.elevation=25;
  f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
  return f;
}

test('a wolf facing only an unreachable hunter Hides, Sneaks under cover, then holds its position',async()=>{
  const f=huntedWolf();fog(f,{x:0,y:0,width:900,height:900});stealthRoll(f);
  assert.equal(f.adapter.profileId,'wolf');
  const initial=await snapshot(f);assert.equal(initial.groundThreats.unanswerable,true);
  assert.equal(f.adapter.decide(initial).diagnostics.tactic.planId,'lay-low');
  const ledger=await new TurnRunner(f.adapter).run();
  const rolls=f.calls.filter(c=>c[0]==='shared-stealth-roll');
  assert.deepEqual(rolls.map(c=>c[1].action),['hide','sneak']);
  assert.equal(detectionFor(f.player,f.boss).state,'undetected');
  assert.equal(f.calls.some(c=>c[0]==='attack'),false);assert.equal(ledger.attacksMade,0);assert.equal(ledger.done,true);
  f.combat.round+=3;
  const later=await snapshot(f);assert.equal(f.adapter.decide(later).diagnostics.tactic.planId,'lay-low','no timeout into futile charging');
  f.player.document.elevation=0;
  assert.notEqual(f.adapter.decide(await snapshot(f)).diagnostics.tactic.planId,'lay-low','a landing creates a new attack opportunity');
});

test('a wolf in open ground holds rather than chasing a flyer or inventing cover for Hide',async()=>{
  const f=huntedWolf();stealthRoll(f);
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.done,true);assert.equal(f.calls.some(c=>['move','shared-stealth-roll','attack'].includes(c[0])),false,
    JSON.stringify(f.calls.filter(c=>['move','shared-stealth-roll','perception','attack'].includes(c[0]))));
});

test('a failed secret Hide does not tell the wolf to change its defensive plan or reroll Hide',async()=>{
  const f=huntedWolf();fog(f,{x:0,y:0,width:900,height:900});stealthRoll(f,6,1);
  await new TurnRunner(f.adapter).run();
  assert.deepEqual(f.calls.filter(c=>c[0]==='shared-stealth-roll').map(c=>c[1].action),['hide','sneak']);
  assert.equal(detectionFor(f.player,f.boss).state,'observed');assert.ok(stealthBelief(f.boss)[0].undetectedChance>0);
  assert.equal(f.adapter.decide(await snapshot(f)).diagnostics.tactic.planId,'lay-low');
});

test('a reachable ground opponent or an available ranged response prevents the unreachable-hunter posture',async()=>{
  const f=basicFixture();fog(f);stealthRoll(f);f.player.document.elevation=25;
  const ranged=await snapshot(f);ranged.strikes.push({id:'bow',ranged:true});
  const {groundThreats}=await import('../src/foundry/ground-threats.mjs');
  assert.equal(groundThreats(f.adapter,ranged).unanswerable,false);
  f.player.document.elevation=0;
  assert.equal((await snapshot(f)).groundThreats.unanswerable,false);
});
