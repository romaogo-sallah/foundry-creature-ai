import test from 'node:test';
import assert from 'node:assert/strict';
import {scoutCandidates,chooseScoutAction,scoutAttackValue} from '../src/profiles/kobold-scout.mjs';

function state({detection='hidden',usable=false,loaded=true}={}){
  const shot={id:'bow',ranged:true,bonus:9,damage:4.5,mapPenalties:[0,-5,-10]};
  const enemy={id:'fighter',stealthChance:detection==='observed'?0:1,undetectedChance:detection==='undetected'?1:0,distance:30,lineOfEffect:true,prone:false,offGuard:false,
    strikes:{bow:{usable,inReach:true,lineOfEffect:true,rangePenalty:0}}};
  const s={actionsRemaining:2,attacksMade:0,self:{cell:{x:0,y:0},referenceAC:18,attackBonus:9,averageDamage:4.5,mapPenalties:[0,-5,-10],
    restrained:false,immobile:false,prone:false,unable:false,threatened:false},
    enemies:[enemy],strikes:[shot],sneakDamage:3.5,bowReady:true,bladeReady:false,loaded,bolts:20,
    speed:25,adjacent:false,hideTargets:[],hideAttempts:1,sneakAttempts:0,style:{enabled:false},protection:0,visited:[],nearestEnemy:6,moves:[],diagnostics:{}};
  s.moves=[{x:1,y:0,kind:'stride',cost:5,path:[{x:0,y:0},{x:1,y:0}],nearestEnemy:5,protection:1,
    sneakObservers:detection==='observed'?[]:[enemy.id],sneakChances:[{observerId:enemy.id,unseenChance:enemy.stealthChance,undetectedChance:enemy.stealthChance}],
    stepChances:[{observerId:enemy.id,unseenChance:enemy.stealthChance,undetectedChance:enemy.undetectedChance}],
    targets:{fighter:{distance:25,lineOfEffect:true,lineOfSight:true,strikes:{bow:{usable:loaded,inReach:true,rangePenalty:0}}}}}];
  return s;
}

test('a successfully hidden scout chooses a covered Sneak over revealing movement to the same firing position',()=>{
  const s=state();assert.equal(chooseScoutAction(s).chosen.kind,'sneak');
  const options=scoutCandidates(s),sneak=options.find(c=>c.kind==='sneak'),stride=options.find(c=>c.kind==='stride');
  assert.ok(sneak.assessment.value>stride.assessment.value);assert.equal(sneak.features.stealthPreserved,1);assert.equal(stride.features.stealthLost,1);
});

test('Stride lookahead loses hidden precision while Sneak lookahead retains it',()=>{
  const s=state(),options=scoutCandidates(s),get=kind=>options.find(c=>c.kind===kind).scoringTerms.find(term=>term.label==='Attack from destination').contribution;
  const shot=s.strikes[0],position=s.moves[0].targets.fighter.strikes.bow;
  assert.equal(get('stride'),scoutAttackValue(s,{...s.enemies[0],stealthChance:0},position,shot));
  assert.equal(get('sneak'),scoutAttackValue(s,s.enemies[0],position,shot));assert.ok(get('sneak')>get('stride'));
});

test('a previous Sneak this turn does not ban another useful legal Sneak',()=>{
  const s=state({detection:'undetected'});s.sneakAttempts=2;
  assert.equal(chooseScoutAction(s).chosen.kind,'sneak');
});

test('an already undetected scout does not shuffle between equally useful protected squares',()=>{
  const s=state({detection:'undetected',usable:true});s.moves[0].protection=s.protection;
  const options=scoutCandidates(s);assert.equal(options.some(c=>c.assessment.movement),false);assert.equal(chooseScoutAction(s).chosen.kind,'strike');
});

test('no prior hiding attempt and an uncovered endpoint cannot produce a Sneak option',()=>{
  for(const kind of ['no-attempt','open-endpoint']){
    const s=state({detection:kind==='no-attempt'?'observed':'hidden'});s.moves[0].sneakObservers=[];
    assert.equal(scoutCandidates(s).some(c=>c.kind==='sneak'),false);assert.equal(chooseScoutAction(s).chosen.kind,'stride');
  }
});

test('a full-Speed Stride remains possible but cannot masquerade as half-Speed Sneak',()=>{
  const s=state();Object.assign(s.moves[0],{x:5,cost:25,path:[0,1,2,3,4,5].map(x=>({x,y:0}))});
  assert.equal(scoutCandidates(s).some(c=>c.kind==='sneak'),false);assert.equal(chooseScoutAction(s).chosen.kind,'stride');
  assert.equal(chooseScoutAction(s).chosen.features.stealthLost,1);
});

test('Step preserves hiding against observers still screened at its destination',()=>{
  const s=state();s.moves[0].kind='step';const step=scoutCandidates(s).find(c=>c.kind==='step');
  assert.equal(step.features.stealthPreserved,1);assert.equal(step.features.stealthLost,0);
  assert.equal(step.scoringTerms.find(term=>term.label==='Attack from destination').contribution,
    scoutAttackValue(s,s.enemies[0],s.moves[0].targets.fighter.strikes.bow,s.strikes[0]));
});

test('a useful Sneak must preserve detection against each observer independently',()=>{
  const s=state();s.enemies.push({...s.enemies[0],id:'aisa',stealthChance:0,undetectedChance:0});
  s.moves[0].targets.aisa=structuredClone(s.moves[0].targets.fighter);
  const sneak=scoutCandidates(s).find(c=>c.kind==='sneak');assert.equal(sneak.features.stealthPreserved,1);
});

test('an unloaded scout prepares its weapon before Hide, while last-action defensive Hide remains available',()=>{
  const s=state({detection:'observed',loaded:false});s.moves=[];s.actionsRemaining=3;s.hideTargets=['fighter'];s.hideAttempts=0;
  assert.equal(scoutCandidates(s).some(c=>c.kind==='hide'),false);assert.equal(chooseScoutAction(s).chosen.kind,'reload');
  s.actionsRemaining=1;assert.ok(scoutCandidates(s).some(c=>c.kind==='hide'));
});

test('Reload lookahead does not retain the hidden-attack bonus that reloading removes',()=>{
  const s=state({loaded:false});const value=scoutCandidates(s).find(c=>c.kind==='reload').scoringTerms.find(t=>t.label==='Expected attacks in remaining actions').contribution;
  const expected=scoutAttackValue(s,{...s.enemies[0],stealthChance:0},{...s.enemies[0].strikes.bow,usable:true},s.strikes[0]);
  assert.equal(value,expected);
});

test('scout attack value weights uncertain hiding and ignores leaked secret state fields',()=>{
  const s=state({usable:true}),enemy=s.enemies[0],position=enemy.strikes.bow,shot=s.strikes[0];
  const plain=scoutAttackValue(s,{...enemy,stealthChance:0},position,shot),hidden=scoutAttackValue(s,enemy,position,shot);
  assert.equal(scoutAttackValue(s,{...enemy,stealthChance:0.4},position,shot),plain*0.6+hidden*0.4);
  const baseline=scoutCandidates(s);
  for(const actual of ['observed','hidden','undetected']){
    enemy.hiddenFrom=actual!=='observed';enemy.scoutDetection=actual;
    assert.deepEqual(scoutCandidates(s),baseline,'actual secret outcomes cannot affect candidates or scores');
  }
});

test('scout target scoring accounts for cover, concealment and known off-guard separately',()=>{
  const s=state({usable:true,detection:'observed'}),enemy=s.enemies[0],position=enemy.strikes.bow,shot=s.strikes[0];
  const normal=scoutAttackValue(s,enemy,position,shot);
  assert.ok(scoutAttackValue(s,enemy,{...position,coverBonus:2},shot)<normal);
  assert.ok(scoutAttackValue(s,enemy,{...position,concealmentDC:5},shot)<normal);
  assert.equal(scoutAttackValue(s,{...enemy,prone:true,stealthChance:0.1},position,shot),
    scoutAttackValue(s,{...enemy,prone:true,stealthChance:0.9},position,shot));
});

test('cover and stealth bonuses cannot lure a firing scout into a square with no sight of any target',()=>{
  const s=state({usable:true});s.moves[0].protection=100;
  Object.assign(s.moves[0].targets.fighter,{lineOfSight:false,lineOfEffect:false});
  Object.assign(s.moves[0].targets.fighter.strikes.bow,{lineOfSight:false,lineOfEffect:false,usable:true});
  assert.equal(scoutAttackValue(s,s.enemies[0],s.moves[0].targets.fighter.strikes.bow,s.strikes[0]),0,'stale readiness cannot imply a shot through a wall');
  assert.equal(scoutCandidates(s).some(c=>c.assessment.movement),false);assert.equal(chooseScoutAction(s).chosen.kind,'strike');
});

test('an uncovered search route can pass out of sight while making progress, without blind cover or stealth rewards',()=>{
  const s=state({detection:'observed'});s.enemies[0].lineOfSight=false;
  const move=s.moves[0];move.protection=100;move.targets.fighter.lineOfSight=false;move.targets.fighter.lineOfEffect=false;move.targets.fighter.strikes.bow.usable=false;
  const options=scoutCandidates(s),stride=options.find(c=>c.kind==='stride');assert.ok(stride);
  assert.equal(stride.assessment.value,0);assert.equal(stride.assessment.goodAttacksLeft,false);
  assert.equal(chooseScoutAction(s).chosen.kind,'stride','multi-move routes around obstacles remain possible');
  s.nearestEnemy=move.nearestEnemy;move.nearestEnemy++;
  assert.equal(scoutCandidates(s).some(c=>c.assessment.movement),false,'a blind detour must make progress');
});

test('an emergency Scamper may deliberately break sight to escape melee, with an explicit sight-loss cost',()=>{
  const s=state({usable:true});s.adjacent=true;s.enemies[0].distance=5;
  Object.assign(s.moves[0].targets.fighter,{distance:15,lineOfSight:false,lineOfEffect:false});s.moves[0].targets.fighter.strikes.bow.usable=false;
  const scamper=scoutCandidates(s).find(c=>c.kind==='scamper');assert.ok(scamper);
  assert.equal(scamper.features.visibility.losesAll,true);assert.ok(scamper.scoringTerms.find(t=>t.label==='Losing sight of every known target').contribution<0);
});

test('a hidden scout shoots instead of Sneaking solely to gain Undetected before the same shot',()=>{
  const s=state({usable:true});s.moves[0].protection=s.protection;
  assert.equal(chooseScoutAction(s).chosen.kind,'strike');
  assert.equal(scoutCandidates(s).some(c=>c.kind==='sneak'),false,'Hidden already supplies the off-guard opening');
});

test('Undetected retains a defensive use as the last action, without another offensive precision bonus',()=>{
  const s=state({loaded:false});s.actionsRemaining=1;s.moves[0].protection=s.protection;
  const sneak=scoutCandidates(s).find(c=>c.kind==='sneak');assert.ok(sneak);
  assert.ok(sneak.scoringTerms.find(t=>t.label==='Expected end-of-turn exposure change').contribution>0);
  const enemy=s.enemies[0],strike=s.strikes[0],position={...enemy.strikes.bow,usable:true};
  assert.equal(scoutAttackValue(s,{...enemy,undetectedChance:1},position,strike),scoutAttackValue(s,{...enemy,undetectedChance:0},position,strike));
});

test('a target already off-guard gives offensive Hide no new precision benefit or showcase reward',()=>{
  const s=state({detection:'observed',usable:true});s.enemies[0].prone=true;s.hideTargets=['fighter'];s.hideEstimates=[{observerId:'fighter',unseenChance:0.7}];
  s.moves=[];
  s.hideAttempts=0;s.style={enabled:true,showcaseBonus:4};
  const options=scoutCandidates(s),hide=options.find(c=>c.kind==='hide');
  assert.ok(hide.assessment.value<options.find(c=>c.kind==='strike').assessment.value);
  assert.equal(hide.scoringTerms.find(t=>t.label==='Show useful stealth').contribution,0);
  assert.ok(hide.scoringTerms.find(t=>t.label==='Already has the advantage').contribution<0);
  assert.equal(chooseScoutAction(s).chosen.kind,'strike');
});

test('returning to the turn starting square is penalized without banning a useful tactical return',()=>{
  const s=state({usable:true});s.startCell={x:1,y:0};s.visited=['2,0'];s.moves[0].protection=2;
  s.moves[0].targets.fighter.incoming={coverBonus:4};
  const move=scoutCandidates(s).find(c=>c.kind==='sneak');assert.ok(move);
  assert.ok(move.scoringTerms.find(t=>t.label==='Returning to the turn starting square').contribution<0);
});
