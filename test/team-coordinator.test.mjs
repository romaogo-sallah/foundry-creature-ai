import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTeamBoard} from '../src/framework/team-coordinator.mjs';
import {buildBattlefieldModel} from '../src/framework/battlefield-state.mjs';

const distance=(a,b)=>Math.hypot(a.position.x-b.position.x,a.position.y-b.position.y)*5;
const actor=(id,team,x,y,extra={})=>({id,team,position:{x,y},hp:30,maxHp:30,speed:25,reach:5,role:'melee',melee:true,ranged:false,
  expectedDamage:10,alive:true,...extra});

test('a protected skulk line completes its opening ambush before considering force-based withdrawal',()=>{
  const actors=[...Array.from({length:4},(_,index)=>actor(`k${index+1}`,'kobolds',1,index*2,{role:'ranged',melee:true,ranged:true,skulk:true,
    protected:true,expectedDamage:7})),...Array.from({length:3},(_,index)=>actor(`o${index+1}`,'ogres',20,index*3,{hp:59,maxHp:59,expectedDamage:12}))];
  const board=buildTeamBoard({actors,round:1,distance},{teamId:'kobolds',subjectId:'k1'});
  assert.equal(board.activeScenarios[0].id,'opening-ambush');
  assert.ok(board.assignments.every(entry=>entry.preferredPlans.includes('hiding')));
  assert.equal(board.assignments.every(entry=>entry.coordinationStrength===1),true);
  assert.equal(board.roleBids.filter(entry=>entry.selected).length,board.assignments.length);
  assert.ok(board.assignments.every(entry=>board.roleBids.some(bid=>bid.id===entry.winningBidId&&bid.selected)));
});

test('a pressured ranged line alternates withdrawing actors and rear guards with distinct lanes',()=>{
  const actors=[...Array.from({length:4},(_,index)=>actor(`r${index+1}`,'ranged',2,index*2,{role:'ranged',melee:false,ranged:true,expectedDamage:7})),
    ...Array.from({length:3},(_,index)=>actor(`m${index+1}`,'melee',7,index*2,{role:'melee',speed:30,reach:10}))];
  const board=buildTeamBoard({actors,round:2,distance},{teamId:'ranged',subjectId:'r1'}),roles=board.assignments.map(entry=>entry.role);
  assert.equal(board.activeScenarios[0].id,'ranged-line-under-approach');
  assert.ok(roles.includes('withdraw'));assert.ok(roles.includes('rear-guard'));
  assert.equal(new Set(board.reservations.filter(entry=>entry.kind==='lane').map(entry=>entry.laneIndex)).size,4);
  for(const entry of board.assignments)assert.deepEqual(entry.preferredPlans,entry.role==='withdraw'?['kiting']:['ranged','hiding']);
  assert.ok(board.roleBids.every(entry=>Number.isFinite(entry.total)));
});

test('a distant melee formation receives charge lanes instead of weak ranged substitutions',()=>{
  const actors=[actor('a','melee',0,0),actor('b','melee',0,2),actor('x','ranged',20,0,{role:'ranged',melee:false,ranged:true})];
  const board=buildTeamBoard({actors,round:1,distance},{teamId:'melee',subjectId:'a'});
  assert.equal(board.activeScenarios[0].id,'distant-melee-approach');
  assert.ok(board.assignments.every(entry=>entry.role==='charge-lane'&&entry.preferredPlans[0]==='charge'));
});

test('engagement budgets redirect excess attackers instead of assigning universal dog-piling',()=>{
  const actors=[...Array.from({length:6},(_,index)=>actor(`a${index}`,'allies',index,0,{expectedDamage:12})),
    actor('weak','enemies',5,2,{hp:15,maxHp:15}),actor('other','enemies',8,4,{hp:60,maxHp:60})];
  const board=buildTeamBoard({actors,round:1,distance},{teamId:'allies',subjectId:'a0'}),budget=board.engagementBudgets[0];
  assert.ok(budget);assert.ok(budget.contributors.length<6);assert.ok(budget.reservedEffect<=budget.expectedHp*1.2+12);
  assert.ok(board.assignments.some(entry=>entry.role==='reserve'&&entry.targetId===null));
});

test('actor battlefield state keeps simultaneous scenarios and binds its team assignment',()=>{
  const state={actionsRemaining:3,self:{id:'archer',speed:25,reachSquares:1},enemies:[{id:'brute',distance:30,lineOfSight:true,lineOfEffect:true,
    tactics:{role:'melee',speed:25,reach:10},alliesInReach:0}],behavior:{context:{health:1,knownEnemies:1,visibleEnemies:1,rangedPrimary:true,
    ranged:true,melee:false,immediateAttack:true,rangedAttackAvailable:true,bestRangePenalty:0,canCloseRange:false,nearbyProtection:true,closingMelee:true,
    kiteRetreatAvailable:true,forceRatio:1,ownCount:3,enemyCount:3,ownAoeClustered:true,ownAoeClusterSize:3,enemyAoeClustered:true,enemyAoeClusterSize:3}}};
  state.teamBoard={teamId:'allies',subjectId:'archer',activeScenarios:[],assignments:[{id:'assignment:archer',actorId:'archer',objectiveId:'ranged-line-under-approach',
    objectiveLabel:'Trade space',role:'withdraw',preferredPlans:['kiting'],fallbackPlans:['ranged'],priority:0.9,coordinationStrength:1}],reservations:[],engagementBudgets:[]};
  const model=buildBattlefieldModel(state),ids=new Set(model.activeScenarios.map(entry=>entry.id));
  assert.equal(model.assignment.role,'withdraw');
  for(const id of ['ranged-line-under-approach','friendly-area-vulnerability','enemy-area-opportunity','focus-isolated-enemy'])assert.ok(ids.has(id),id);
  assert.equal(model.evidence.find(entry=>entry.id==='evidence-enemy-pressure').active,true);
  assert.ok(model.evidence.every(entry=>entry.scope&&entry.provenance?.kind&&entry.observedAt!==undefined&&entry.age>=0));
  assert.ok(model.activeScenarios.every(entry=>entry.entryThreshold>entry.exitThreshold&&entry.provenance?.kind));
});

