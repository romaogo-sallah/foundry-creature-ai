import test from 'node:test';
import assert from 'node:assert/strict';
import {scoutCandidates,chooseScoutAction,scoutAttackValue} from '../src/profiles/kobold-scout.mjs';
import {scoutFutureMoves,scoutGroupPosition} from '../src/profiles/scout-group-tactics.mjs';

function fixture({distance=20,actions=3,swarm=true,rangedCount=1,blade=false,loaded=true}={}){
  const strikes=[{id:'bow',ranged:true,bonus:9,damage:4.5,mapPenalties:[0,-5,-10]},
    {id:'sword',ranged:false,bonus:9,damage:3.5,mapPenalties:[0,-4,-8]}];
  const position=(id,distance,flanked=false)=>({distance,threatDistance:distance,lineOfSight:true,lineOfEffect:true,physicalPath:true,
    incoming:{coverBonus:0},strikes:Object.fromEntries(strikes.map(strike=>[strike.id,{inReach:strike.ranged||distance<=5,
      geometryUsable:strike.ranged||distance<=5,usable:strike.ranged?!blade&&loaded:blade&&distance<=5,flanked:!strike.ranged&&flanked,lineOfSight:true,lineOfEffect:true}]))});
  const enemy={id:'ogre',...position('ogre',distance),flankable:true,stealthChance:0,undetectedChance:0,
    awareness:{state:'observed'},threat:{reach:10,speed:25,ranged:false}};
  const s={actionsRemaining:actions,attacksMade:0,self:{cell:{x:0,y:0},averageDamage:3.5,referenceAC:18,reachSquares:1,
    threatened:false,mapPenalties:[0,-5,-10]},strikes,sneakDamage:3.5,speed:25,bowReady:!blade,bladeReady:blade,loaded:true,bolts:20,
    hideTargets:[],hideAttempts:1,hideEstimates:[],freshHideEstimates:[],style:{enabled:false},visited:[],nearestEnemy:4,
    group:{rangedCount,targets:{ogre:{swarm,helpers:3,engaged:0,arriving:3}}},enemies:[enemy],moves:[],diagnostics:{}};
  s.loaded=loaded;
  const move=(x,distance,{flank=false,kind='stride',cost=25,risk=0,sight=true}={})=>({x,y:0,kind,cost,path:[{x:0,y:0},{x,y:0}],
    nearestEnemy:Math.max(1,distance/5),reactionRisk:risk,terrainRisk:0,provokes:risk>0,destinationThreatened:false,
    sneakObservers:[],sneakChances:[],stepChances:[],hideEstimates:[],
    targets:{ogre:{...position('ogre',distance,flank),lineOfSight:sight,lineOfEffect:sight,physicalPath:sight}}});
  return {s,move};
}

test('supported scouts can draw, close on an isolated enemy, and strike within three actions',()=>{
  const {s,move}=fixture({loaded:false});s.moves=[move(3,5,{cost:15})];
  const decision=chooseScoutAction(s),plan=decision.chosen.features.plan;
  assert.ok(['drawSword','stride'].includes(decision.chosen.kind));
  assert.ok(plan.some(a=>a.kind==='drawSword'));assert.ok(plan.some(a=>a.kind==='stride'));
  assert.ok(plan.some(a=>a.kind==='strike'&&a.strikeId==='sword'));assert.equal(plan.length,3);
});

test('the first swarm anchor gets no fictitious flanking precision before the ally arrives',()=>{
  const {s,move}=fixture({loaded:false});s.moves=[move(3,5,{cost:15})];
  const chosen=chooseScoutAction(s).chosen;
  const offense=chosen.scoringTerms.find(t=>t.label==='Expected attacks in remaining actions')?.contribution??
    chosen.scoringTerms.filter(t=>['Attack from destination','Further planned attacks'].includes(t.label)).reduce((n,t)=>n+t.contribution,0);
  assert.ok(Math.abs(offense-2.1)<1e-6);
  const sword=s.strikes[1],p={...s.moves[0].targets.ogre.strikes.sword,usable:true};
  assert.ok(scoutAttackValue(s,s.enemies[0],{...p,flanked:true},sword)>scoutAttackValue(s,s.enemies[0],p,sword));
});

test('a scout holding its sword chooses a real flanking square for precision attacks',()=>{
  const {s,move}=fixture({blade:true,actions:2});s.moves=[move(3,5,{cost:15}),move(4,5,{flank:true,cost:20})];
  const chosen=chooseScoutAction(s).chosen;assert.equal(chosen.kind,'stride');assert.deepEqual(chosen.destination,{x:4,y:0});
  assert.equal(chosen.features.groupGoal,'swarm');assert.equal(chosen.features.plan[1].strikeId,'sword');
});

test('a lone unsupported shooter keeps its bow instead of collecting the swarm reward',()=>{
  const {s,move}=fixture({swarm:false});s.moves=[move(3,5,{cost:15})];
  assert.equal(chooseScoutAction(s).chosen.kind,'strike');assert.equal(scoutFutureMoves(s).length,0);
});

test('kite support can plan a shot before backing beyond enemy reach and reloading',()=>{
  const {s,move}=fixture({distance:15,swarm:false,rangedCount:4});s.moves=[move(5,40)];
  const chosen=chooseScoutAction(s).chosen;
  assert.equal(chosen.kind,'strike');assert.deepEqual(new Set(chosen.features.plan.map(a=>a.kind)),new Set(['strike','stride','reload']));
  assert.equal(chosen.features.plan.find(a=>a.kind==='stride').destination.x,5);
});

test('a group already beyond pursuit does not keep retreating for another kite bonus',()=>{
  const {s,move}=fixture({distance:70,swarm:false,rangedCount:4});s.moves=[move(5,95)];
  assert.equal(scoutFutureMoves(s).length,0);assert.equal(chooseScoutAction(s).chosen.kind,'strike');
  assert.equal(scoutGroupPosition(s),scoutGroupPosition(s,[{...s.enemies[0],distance:95,threatDistance:95}]));
});

test('kiting neither grants a shot through a wall nor swarms a flank-immune opponent',()=>{
  const {s,move}=fixture({rangedCount:4});s.enemies[0].flankable=false;s.moves=[move(4,5),move(5,45,{sight:false})];
  assert.equal(scoutFutureMoves(s).length,0);assert.equal(chooseScoutAction(s).chosen.kind,'strike');
});

test('flanking only improves melee, while hiding can still improve the crossbow',()=>{
  const {s}=fixture({blade:true,distance:5}),enemy=s.enemies[0],bow=s.strikes[0],sword=s.strikes[1];
  const p={usable:true,inReach:true,lineOfSight:true,lineOfEffect:true};
  assert.equal(scoutAttackValue(s,enemy,{...p,flanked:true},bow),scoutAttackValue(s,enemy,p,bow));
  assert.ok(scoutAttackValue(s,enemy,{...p,flanked:true},sword)>scoutAttackValue(s,enemy,p,sword));
  assert.ok(scoutAttackValue(s,{...enemy,stealthChance:0.6},p,bow)>scoutAttackValue(s,enemy,p,bow));
});

test('future maneuver choices are bounded, legal native routes with independent weapon and action costs',()=>{
  const {s,move}=fixture({rangedCount:4});s.moves=Array.from({length:30},(_,i)=>move(i+1,i%2?5:40,{flank:i%2===1,cost:20}));
  const future=scoutFutureMoves(s);assert.ok(future.length<=8);assert.ok(future.some(m=>m.swarmTargetId));assert.ok(future.some(m=>!m.swarmTargetId));
  s.actionsRemaining=1;
  for(const option of scoutCandidates(s).filter(c=>c.features?.plan))assert.equal(option.features.plan.length,1);
});

test('coordinated forecast terms add up to the chosen utility and do not use hidden results',()=>{
  const {s,move}=fixture({rangedCount:4});s.moves=[move(3,5,{cost:15}),move(5,45)];
  const options=scoutCandidates(s);
  for(const option of options.filter(c=>c.features?.plan))assert.ok(Math.abs(option.scoringTerms.reduce((n,t)=>n+t.contribution,0)-option.assessment.value)<1e-6);
  Object.assign(s.enemies[0],{secretDie:20,hiddenFrom:true,scoutDetection:'undetected',hp:1,ac:40});
  assert.deepEqual(scoutCandidates(s),options);
});

test('allies unable to shoot the target supply no kite reward and dangerous routes remain costly',()=>{
  const {s,move}=fixture({swarm:false,rangedCount:4,distance:15});s.group.targets.ogre.rangedSupport=0;
  s.moves=[move(5,40)];assert.equal(scoutGroupPosition(s),0);
  assert.equal(scoutGroupPosition(s,[{...s.enemies[0],distance:40,threatDistance:40}]),0);
  const other=fixture();other.s.moves=[other.move(3,5,{cost:15,risk:10})];
  const chosen=chooseScoutAction(other.s).chosen;assert.equal(chosen.kind,'strike');assert.equal(chosen.features.plan.some(a=>a.kind==='stride'),false);
});
