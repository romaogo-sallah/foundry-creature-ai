import test from 'node:test';
import assert from 'node:assert/strict';
import { ogreCapabilities, rangedPreparationScore, strikeScore } from '../src/profiles/ogre-boss.mjs';
import '../src/profiles/ogre.mjs';
import { chooseOption } from '../src/dawnsbury/chooser.mjs';
import { fixture } from './helpers/ogre-fixture.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';

function state({held=true,actions=2,rangePenalty=2,afterPenalty=0}={}){
  const hook={id:'hook',ranged:false,bonus:19,damage:16.5,mapPenalties:[0,-5,-10]},javelin={id:'javelin',ranged:true,bonus:17,damage:10.5,mapPenalties:[0,-5,-10]};
  const positions=penalty=>({hook:{usable:false,inReach:false,lineOfEffect:true},javelin:{usable:held,inReach:true,lineOfEffect:true,rangePenalty:penalty}});
  return {actionsRemaining:actions,attacksMade:0,self:{cell:{x:0,y:0},referenceAC:25,averageDamage:16.5,mapPenalties:[0,-5,-10],reachSquares:2},
    style:{enabled:false},strikes:[hook,javelin],hookId:'hook',hookReady:!held,javelinHeld:held,javelins:6,throwRange:180,
    hookReach:10,groundSpeed:25,reactiveStrikeAvailable:false,sweepingAvailable:false,commandRecipients:[],shownAbilities:{},
    nearestEnemy:12,enemies:[{id:'foe',distance:60,lineOfEffect:true,strikes:positions(rangePenalty)}],
    moves:[{x:5,y:0,kind:'stride',cost:25,path:[{x:0,y:0},{x:5,y:0}],nearestEnemy:7,targets:{foe:{distance:30,lineOfEffect:true,strikes:positions(afterPenalty)}}}]};
}
const options=s=>ogreCapabilities.candidates('ogre-boss',s);
const choose=s=>chooseOption(options(s),{actionsRemaining:s.actionsRemaining}).chosen;

test('a held javelin with two actions prefers moving into a better range increment before throwing',()=>{
  const s=state();assert.equal(choose(s).kind,'stride');
  const move=options(s).find(c=>c.kind==='stride'),shot=options(s).find(c=>c.kind==='strike');
  assert.ok(move.assessment.value>shot.assessment.value);assert.equal(move.assessment.goodAttacksLeft,true);
  assert.equal(move.features.rangedFollowUp,true);
});

test('ogres do not move just to throw at the same accuracy, or spend their last throwing action on movement',()=>{
  assert.equal(choose(state({rangePenalty:0,afterPenalty:0})).kind,'strike');
  assert.equal(choose(state({actions:1})).kind,'strike');
});

test('moving then drawing and throwing needs three normal actions',()=>{
  assert.equal(choose(state({held:false,actions:3})).kind,'stride');
  assert.equal(choose(state({held:false,actions:2})).kind,'drawJavelin');
  const s=state({held:false,actions:2});
  assert.equal(options(s).find(c=>c.kind==='stride').features.rangedFollowUp,false);
});

test('cover and concealment reduce target, Draw, and destination scores consistently',()=>{
  const s=state({rangePenalty:0}),ranged=s.strikes[1],clear=s.enemies[0];
  const covered=structuredClone(clear);covered.id='covered';covered.strikes.javelin.coverBonus=4;covered.strikes.javelin.concealmentDC=5;
  s.enemies.push(covered);s.moves=[];
  assert.equal(choose(s).targetId,'foe');
  assert.ok(rangedPreparationScore(s,ranged,covered)<rangedPreparationScore(s,ranged,clear));
  const blocked=state();blocked.moves[0].targets.foe.strikes.javelin.coverBonus=4;
  assert.equal(choose(blocked).kind,'strike','a shorter range is worse if the destination adds too much cover');
  const fog=state({rangePenalty:0});fog.enemies[0].strikes.javelin.concealmentDC=5;
  assert.equal(choose(fog).kind,'stride','an available clear lane is worth repositioning for');
  const hidden=state({held:false,actions:3});hidden.enemies[0].strikes.javelin.coverBonus=2;hidden.enemies[0].strikes.javelin.concealmentDC=5;
  const prep=options(hidden).find(c=>c.kind==='drawJavelin').assessment.value;
  assert.equal(prep,rangedPreparationScore(hidden,hidden.strikes[1],hidden.enemies[0]));
});

test('Refuse preparation respects concealment, cover, occupied hands and finite stock',()=>{
  const s=state({held:false,actions:3});s.refuseId='refuse';s.refuseCount=1;s.refuseHeld=false;
  const refuse={...s.strikes[1],id:'refuse',damage:13.5};s.strikes.push(refuse);
  s.enemies[0].strikes.refuse={...s.enemies[0].strikes.javelin,rangePenalty:4,coverBonus:2,concealmentDC:5};s.moves=[];
  const candidate=ogreCapabilities.candidates('ogre',s).find(c=>c.kind==='drawRefuse');
  assert.equal(candidate.assessment.value,rangedPreparationScore(s,refuse,s.enemies[0]));
  s.refuseCount=0;assert.equal(ogreCapabilities.candidates('ogre',s).some(c=>c.kind==='drawRefuse'),false);
  s.refuseCount=1;s.javelinHeld=true;assert.equal(rangedPreparationScore(s,refuse,s.enemies[0]),0);
});

test('native ogre geometry supplies javelin range increments to movement lookahead',async()=>{
  const f=fixture();f.player.document.x=1400;await f.adapter.configure();
  const parts=f.adapter.parts();parts.hook.system.equipped.handsHeld=1;
  parts.javelin.system.equipped={carryType:'held',handsHeld:1};
  const l={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2};
  const s=await f.adapter.snapshot(l);s.style.enabled=false;
  const decision=f.adapter.decide(s),move=decision.chosen;
  assert.ok(s.enemies[0].strikes[parts.thrown.item.id].rangePenalty>0);
  assert.equal(move.kind,'stride');
  const destination=s.moves.find(m=>m.x===move.destination.x&&m.y===move.destination.y);
  assert.ok(destination.targets[f.player.id].strikes[parts.thrown.item.id].rangePenalty<s.enemies[0].strikes[parts.thrown.item.id].rangePenalty);
});

test('a closer but sight-blocked destination never counts as a better prepared throw',()=>{
  const s=state();Object.assign(s.moves[0].targets.foe,{lineOfSight:false,lineOfEffect:false});
  Object.assign(s.moves[0].targets.foe.strikes.javelin,{usable:true,lineOfSight:false,lineOfEffect:false});
  assert.equal(choose(s).kind,'strike');
  assert.equal(options(s).find(c=>c.kind==='stride').assessment.value,0);
});

test('movement is revalidated for destination sight when a wall changes during the action pause',async()=>{
  const f=fixture();f.player.document.x=1400;await f.adapter.configure();
  const parts=f.adapter.parts();parts.hook.system.equipped.handsHeld=1;parts.javelin.system.equipped={carryType:'held',handsHeld:1};
  const l={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2};
  const s=await f.adapter.snapshot(l);s.style.enabled=false;const move=f.adapter.decide(s).chosen;assert.equal(move.kind,'stride');
  assert.deepEqual(move.features.destinationSightTargets,[f.player.id]);
  f.boss.checkCollision=(_destination,{type,origin}={})=>type==='sight'&&origin.x>f.boss.center.x;
  await assert.rejects(f.adapter.revalidate(move,l),/Sight from the planned destination changed|chosen action is no longer available/);
  assert.equal(f.calls.some(c=>c[0]==='move'),false);
});

test('the boss closes toward distant observed foes instead of taking Steps to see additional foes',()=>{
  const s=state({held:false,actions:2});s.javelins=0;s.enemies[0].lineOfSight=true;s.enemies[0].awareness={state:'observed'};
  s.enemies.push({id:'hidden',distance:105,lineOfSight:false,lineOfEffect:false,
    awareness:{state:'known-square',searchRequired:false},strikes:{}});
  s.nearestEnemy=18;s.moves=[{x:-1,y:0,kind:'step',cost:5,nearestEnemy:18,targets:{
    foe:{lineOfSight:true,lineOfEffect:false,strikes:{}},hidden:{lineOfSight:true,lineOfEffect:false,strikes:{}}}},
  {x:5,y:0,kind:'stride',cost:25,nearestEnemy:13,targets:{foe:{lineOfSight:true,lineOfEffect:false,strikes:{}},hidden:{lineOfSight:false,lineOfEffect:false,strikes:{}}}}];
  assert.equal(choose(s).kind,'stride');assert.deepEqual(choose(s).destination,{x:5,y:0});
  assert.equal(options(s).some(c=>c.kind==='step'),false,'redundant sight gains no utility');
});

test('at minus six the boss advances with two actions rather than drawing for a poor last-action throw',()=>{
  const s=state({held:false,actions:2,rangePenalty:6,afterPenalty:4});
  const decision=ogreCapabilities.decide('ogre-boss',s);
  assert.equal(decision.chosen.kind,'stride');
  assert.equal(decision.chosen.features.rangeApproach.rangePenalty,6);
  assert.equal(decision.chosen.features.rangedFollowUp,false,'Draw plus Strike cannot fit after the move');
  assert.equal(decision.ranked[0].layer,6,'future positioning competes with equipment rather than losing by layer');
  assert.ok(decision.chosen.assessment.value>options(s).find(c=>c.kind==='drawJavelin').assessment.value);
});

test('poor-range pursuit can use the last action or advance without crossing an increment this turn',()=>{
  for(const actions of [1,2,3]){
    const s=state({held:true,actions,rangePenalty:6,afterPenalty:6});
    assert.equal(choose(s).kind,'stride',`${actions} action(s), same range increment`);
  }
  assert.equal(choose(state({held:true,actions:1,rangePenalty:2,afterPenalty:0})).kind,'strike',
    'a small penalty keeps the normal immediate-attack preference');
});

test('range aversion is a scoring cost, scaled by lost accuracy, never an additional roll penalty',()=>{
  const s=state({rangePenalty:6}),throwing=s.strikes[1];s.moves=[];
  const poor=strikeScore(s,throwing,s.enemies[0]);
  const small=state({rangePenalty:2}),moderate=strikeScore(small,small.strikes[1],small.enemies[0]);
  assert.ok(poor.rangeCost>moderate.rangeCost);assert.ok(poor.value>0);
  const option=choose(s);assert.equal(option.kind,'strike','no legal approach still permits the poor throw');
  assert.ok(option.scoringTerms.some(term=>/poor ranged accuracy/.test(term.label)&&term.contribution<0));
  assert.equal(throwing.bonus,17);assert.equal(s.enemies[0].strikes.javelin.rangePenalty,6);
  const clear=state({rangePenalty:0});assert.equal(strikeScore(clear,clear.strikes[1],clear.enemies[0]).rangeCost,0);
});

test('range pursuit respects obstacles, hazards, reaction exposure and actual route progress',()=>{
  for(const kind of ['blocked','hazard','reaction','away','stationary','visited']){
    const s=state({held:true,actions:1,rangePenalty:6,afterPenalty:4});
    if(kind==='blocked')Object.assign(s.moves[0].targets.foe,{lineOfSight:false,lineOfEffect:false});
    if(kind==='hazard')s.moves[0].terrainRisk=100;
    if(kind==='reaction')s.moves[0].reactionRisk=100;
    if(kind==='away')s.moves[0].nearestEnemy=s.nearestEnemy+1;
    if(kind==='stationary')s.moves[0].nearestEnemy=s.nearestEnemy;
    if(kind==='visited')s.visited=['5,0'];
    assert.equal(choose(s).kind,'strike',kind);
  }
});

test('an available closer target and a reachable melee attack prevent unnecessary pursuit of distant enemies',()=>{
  const s=state({held:true,actions:1,rangePenalty:6,afterPenalty:4});
  const close=structuredClone(s.enemies[0]);close.id='closer';close.distance=20;close.strikes.javelin.rangePenalty=0;
  s.enemies.push(close);s.moves[0].targets.closer=structuredClone(close);
  assert.equal(choose(s).kind,'strike');assert.equal(choose(s).targetId,'closer');
  s.enemies.pop();s.enemies[0].strikes.hook={usable:true,inReach:true,lineOfEffect:true};
  assert.equal(choose(s).strikeId,'hook');
});

test('multi-target approach does not credit closing on one opponent as pursuing another opponent behind us',()=>{
  const s=state({held:false,actions:2,rangePenalty:6,afterPenalty:4});
  s.moves[0].targets.foe.coverBonus=2;
  const other=structuredClone(s.enemies[0]);other.id='behind';other.distance=120;
  s.enemies.push(other);s.moves[0].targets.behind={...structuredClone(other),distance:145};
  const choice=choose(s);assert.equal(choice.kind,'stride');assert.equal(choice.targetId,'foe');
});

test('native boss with two actions approaches from minus-six range without drawing or spending ammunition',async()=>{
  const f=fixture({size:32});f.player.document.x=2500;await f.adapter.configure();
  const parts=f.adapter.parts(),ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2};
  const s=await f.adapter.snapshot(ledger);s.style.enabled=false;
  assert.equal(s.enemies[0].strikes[parts.thrown.item.id].rangePenalty,6);
  const choice=f.adapter.decide(s).chosen;assert.equal(choice.kind,'stride');
  await f.adapter.saveLedger(ledger);
  const finished=await new TurnRunner(f.adapter).run();
  assert.equal(finished.actionsRemaining,0);
  assert.equal(f.calls.filter(call=>call[0]==='move').length,2,'both actions close distance, with recalculation after each');
  assert.ok(f.boss.document.x>200);assert.equal(parts.javelin.system.quantity,6);
  assert.equal(parts.javelin.system.equipped.handsHeld,0);
  assert.equal(f.calls.some(call=>call[0]==='attack'),false);
});
