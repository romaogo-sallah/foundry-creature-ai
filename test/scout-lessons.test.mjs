import test from 'node:test';
import assert from 'node:assert/strict';
import { scoutCandidates,chooseScoutAction } from '../src/profiles/kobold-scout.mjs';
import { scoutExposure,scoutPositionPlan } from '../src/profiles/scout-tactics.mjs';
import { priorityLayer } from '../src/dawnsbury/chooser.mjs';

function fixture({count=4,actions=3,distance=70,loaded=true}={}){
  const s={actionsRemaining:actions,attacksMade:0,self:{cell:{x:0,y:0},averageDamage:3.5,referenceAC:18,reachSquares:1,threatened:false,mapPenalties:[0,-5,-10]},
    strikes:[{id:'bow',ranged:true,bonus:9,damage:4.5,mapPenalties:[0,-5,-10]}],sneakDamage:3.5,speed:25,
    bowReady:true,bladeReady:false,loaded,bolts:20,hideTargets:[],hideAttempts:0,style:{enabled:false},visited:[],nearestEnemy:14,moves:[],diagnostics:{}};
  s.enemies=Array.from({length:count},(_,i)=>({id:`ogre-${i}`,distance,lineOfSight:true,lineOfEffect:true,physicalPath:true,
    awareness:{state:'observed'},threat:{reach:10,speed:25,ranged:false},incoming:{coverBonus:0,concealed:false},
    stealthChance:0,undetectedChance:0,strikes:{bow:{usable:loaded,geometryUsable:true,inReach:true,lineOfSight:true,lineOfEffect:true}}}));
  s.hideEstimates=s.freshHideEstimates=s.enemies.map(e=>({observerId:e.id,unseenChance:0.6,undetectedChance:0}));
  return s;
}
function move(s,{kind='stride',x=1,cost=5,distance=s.enemies[0].distance,cover=2,sight=true}={}){
  return {x,y:0,kind,cost,path:[{x:0,y:0},{x,y:0}],nearestEnemy:s.nearestEnemy,protection:100,
    reactionRisk:0,terrainRisk:0,provokes:false,destinationThreatened:false,sneakObservers:[],sneakChances:[],stepChances:[],
    hideEstimates:s.freshHideEstimates,
    targets:Object.fromEntries(s.enemies.map(e=>[e.id,{distance,threatDistance:distance,lineOfSight:sight,lineOfEffect:sight,physicalPath:sight,
      incoming:{coverBonus:cover,concealed:false},strikes:{bow:{...e.strikes.bow,usable:s.loaded&&sight,geometryUsable:sight,lineOfEffect:sight,lineOfSight:sight}}}]))};
}

test('four distant cover bonuses cannot displace an available shot with cover shopping',()=>{
  for(const actions of [2,3]){
    const s=fixture({actions});s.moves=[move(s,{cover:2})];
    assert.equal(chooseScoutAction(s).chosen.kind,'strike');
    const plan=chooseScoutAction(s).chosen.features.plan;
    assert.equal(plan[0].kind,'strike');assert.ok(plan.length<=actions);
  }
});

test('shoot, reload, shoot beats spending the turn moving between small cover improvements',()=>{
  const s=fixture();s.moves=[move(s,{cover:2}),move(s,{x:2,cost:10,cover:4})];
  const sequence=[];
  for(let i=0;i<3;i++){
    const chosen=chooseScoutAction(s).chosen;sequence.push(chosen.kind);s.actionsRemaining--;
    if(chosen.kind==='strike'){s.attacksMade++;s.loaded=false;s.bolts--;for(const e of s.enemies){e.stealthChance=0;e.strikes.bow.usable=false;}}
    else if(chosen.kind==='reload'){s.loaded=true;for(const e of s.enemies)e.strikes.bow.usable=true;}
  }
  assert.deepEqual(sequence,['strike','reload','strike']);assert.equal(s.bolts,18);
});

test('an unloaded entertaining scout forecasts Reload then useful Hide then Strike',()=>{
  const s=fixture({loaded:false});s.style={enabled:true,showcaseBonus:4};
  const chosen=chooseScoutAction(s).chosen;assert.equal(chosen.kind,'reload');
  assert.deepEqual(chosen.features.plan.map(a=>a.kind),['reload','hide','strike']);
});

test('a short forecast never borrows ammunition, actions or a precision bonus after Reload',()=>{
  const s=fixture({count:1});s.bolts=1;s.enemies[0].stealthChance=0.6;s.hideAttempts=1;
  const plan=scoutPositionPlan(s).best();assert.equal(plan.sequence.filter(a=>a.kind==='strike').length,1);
  assert.ok(plan.sequence.length<=3);assert.equal(plan.sequence.some(a=>a.kind==='reload'),false);
  const u=fixture({count:1,actions:2,loaded:false});u.enemies[0].stealthChance=1;u.hideAttempts=1;
  const reload=scoutPositionPlan(u).first({kind:'reload'});
  assert.equal(reload.offense,2.700000047683716);assert.deepEqual(reload.sequence.map(a=>a.kind),['reload','strike']);
});

test('reach-aware escape can Step out of a ten-foot threat before shooting without requiring adjacency',()=>{
  const s=fixture({count:1,actions:2,distance:10});s.adjacent=false;
  s.moves=[move(s,{kind:'step',distance:15,cover:0})];
  const chosen=chooseScoutAction(s).chosen;assert.equal(chosen.kind,'step');assert.equal(chosen.intent,'escape melee');
  assert.deepEqual(chosen.features.plan.map(a=>a.kind),['step','strike']);
  assert.equal(scoutCandidates(s).some(c=>c.kind==='scamper'),false,'reach does not grant Scamper adjacency');
});

test('a cover gain cannot lure a firing scout into a new enemy reach',()=>{
  const s=fixture({count:1,distance:20});s.moves=[move(s,{distance:5,cover:4})];
  assert.equal(scoutCandidates(s).some(c=>c.assessment.movement),false);assert.equal(chooseScoutAction(s).chosen.kind,'strike');
});

test('a longer escape beyond one enemy Stride beats a nearby equally covered endpoint',()=>{
  const s=fixture({count:1,actions:2,distance:10});s.enemies[0].threat.speed=15;
  s.moves=[move(s,{kind:'step',distance:15,cover:0}),move(s,{x:5,cost:25,distance:35,cover:0})];
  const chosen=chooseScoutAction(s).chosen;assert.equal(chosen.kind,'stride');assert.deepEqual(chosen.destination,{x:5,y:0});
});

test('a last-action emergency escape competes with a shot without claiming attacks remain',()=>{
  const s=fixture({count:4,actions:1,distance:10});
  s.moves=[move(s,{cost:25,distance:35,cover:0,sight:false})];
  const chosen=chooseScoutAction(s).chosen;assert.equal(chosen.kind,'stride');
  assert.equal(chosen.assessment.goodAttacksLeft,false);assert.equal(priorityLayer(chosen.assessment),6);
  assert.equal(chosen.features.plan.length,1);
});

test('cover against an immediate threat matters more than the same cover against distant observers',()=>{
  const near=fixture({count:1,distance:10}),far=fixture({count:4,distance:100});
  const improvement=s=>scoutExposure(s)-scoutExposure(s,s.enemies.map(e=>({...e,incoming:{coverBonus:2}})));
  assert.ok(improvement(near)>improvement(far)*5);
});

test('focus-fire preference is bounded and cannot compensate for a much worse shot',()=>{
  const s=fixture({count:2,actions:1});s.enemies[1].focusFire=true;
  assert.equal(chooseScoutAction(s).chosen.targetId,'ogre-1');
  s.enemies[1].strikes.bow.coverBonus=4;s.enemies[1].strikes.bow.concealmentDC=11;
  assert.equal(chooseScoutAction(s).chosen.targetId,'ogre-0');
});

test('GM-only HP, defenses and actual secret results cannot alter the forecast',()=>{
  const s=fixture();s.moves=[move(s)];const before=scoutCandidates(s);
  for(const enemy of s.enemies)Object.assign(enemy,{hp:1,ac:40,perceptionDC:40,hiddenFrom:true,scoutDetection:'undetected',secretDie:20});
  assert.deepEqual(scoutCandidates(s),before);
});

test('each forecast term sums to the actual decision score',()=>{
  const s=fixture({distance:20});s.moves=[move(s,{distance:30,cover:2})];
  for(const option of scoutCandidates(s).filter(c=>c.features?.plan)){
    const total=option.scoringTerms.reduce((sum,term)=>sum+term.contribution,0);
    assert.ok(Math.abs(total-option.assessment.value)<1e-7,`${option.id}: ${total} versus ${option.assessment.value}`);
  }
});

test('restoring a crossbow grip forecasts both hand actions before promising a shot',()=>{
  const s=fixture({count:1});s.bowReady=false;s.bladeReady=true;s.enemies[0].strikes.bow.usable=false;
  const chosen=chooseScoutAction(s).chosen;assert.equal(chosen.kind,'stowSword');
  assert.deepEqual(chosen.features.plan.map(a=>a.kind),['stowSword','gripBow','strike']);
  s.actionsRemaining=2;const preparing=chooseScoutAction(s).chosen;
  assert.equal(preparing.kind,'stowSword');assert.deepEqual(preparing.features.plan.map(a=>a.kind),['stowSword','gripBow']);
  s.bolts=0;assert.equal(scoutCandidates(s).some(c=>c.kind==='stowSword'),false);
});

test('unready geometry and physical barriers cannot become forecast attacks or ranged threats',()=>{
  const s=fixture({count:1});s.enemies[0].strikes.bow.geometryUsable=false;s.enemies[0].strikes.bow.usable=false;
  assert.equal(scoutPositionPlan(s).best().sequence.some(a=>a.kind==='strike'),false);
  s.enemies[0].threat.ranged=true;s.enemies[0].physicalPath=false;
  assert.equal(scoutExposure(s),0);
});

test('recent destinations can change a repeated move choice without prohibiting legitimate returns',()=>{
  const s=fixture({count:1,actions:2});s.enemies[0].strikes.bow.usable=false;s.enemies[0].strikes.bow.geometryUsable=false;
  s.moves=[move(s,{x:1,cover:0}),move(s,{x:2,cover:0})];s.round=3;s.motionMemory=[{cell:{x:1,y:0},round:2}];
  const chosen=chooseScoutAction(s).chosen;assert.equal(chosen.kind,'stride');assert.equal(chosen.destination.x,2);
  const revisited=scoutCandidates(s).find(c=>c.destination?.x===1);assert.ok(revisited);
  assert.ok(revisited.scoringTerms.find(t=>t.label==='Recent movement destinations across turns').contribution<0);
});

test('a losing approach with a reaction or hazard is not clamped to zero to outrank End turn',()=>{
  const s=fixture({count:1,actions:1});s.loaded=false;s.bolts=0;s.bladeReady=true;s.bowReady=false;
  s.enemies[0].strikes.bow.usable=false;s.moves=[move(s,{distance:20,cover:0})];
  s.moves[0].nearestEnemy=s.nearestEnemy-1;s.moves[0].reactionRisk=20;
  const candidate=scoutCandidates(s).find(c=>c.destination);assert.ok(candidate.assessment.value<0);
});
