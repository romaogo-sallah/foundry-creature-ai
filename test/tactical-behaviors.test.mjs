import test from 'node:test';
import assert from 'node:assert/strict';
import { tacticalBehaviors as system, defaultBehaviorConfiguration } from '../src/framework/tactical-behaviors.mjs';
import { BehaviorSystem } from '../src/framework/behavior-system.mjs';
import { decisionExplanation } from '../src/wolf/decision-explanation.mjs';

function state(context={}){
  return {actionsRemaining:3,attacksMade:0,nearestEnemy:4,self:{cell:{x:1,y:1},reachSquares:1},moves:[],
    enemies:[{id:'fighter',name:'Fighter',distance:20}],diagnostics:{},behavior:{
      configuration:system.configuration({},defaultBehaviorConfiguration('wolf')),
      context:{health:1,forceRatio:1,visibleEnemies:1,knownEnemies:1,melee:true,ranged:false,immediateAttack:true,
        allies:0,pack:true,swarmOpportunity:false,closingMelee:false,supportRecipients:0,hideUseful:false,hiddenBelief:false,emergency:false,...context}}};
}
const action=(id,kind,value,cost=1)=>({id,kind,legal:true,actionCost:cost,assessment:{value},scoringTerms:[{label:'Base',contribution:value}]});

test('plans respond to the global situation rather than the creature name',()=>{
  for(const [context,expected]of [
    [{},'aggressive'],[{immediateAttack:false},'charge'],[{caster:true,melee:false},'defensive'],
    [{ranged:true,closingMelee:true,allies:2},'kiting'],[{pack:true,allies:2,swarmOpportunity:true},'swarming'],
    [{supportRecipients:2},'supporting'],[{hideUseful:true,immediateAttack:false,caster:true},'hiding'],
    [{health:0.2,emergency:true},'avoiding'],
  ])assert.equal(system.select(state(context)).planId,expected);
});

test('continuity prevents plan flicker but critical danger immediately permits a switch',()=>{
  const s=state({caster:true,melee:false,hideUseful:true,immediateAttack:false});
  s.behavior.previous={planId:'defensive'};
  assert.equal(system.select(s).planId,'defensive');
  s.behavior.context.emergency=true;s.behavior.context.health=0.2;
  s.behavior.configuration.preferredPlan='aggressive';
  assert.equal(system.select(s).planId,'avoiding');
});

test('a viable goal retains its target and retargets when that opponent disappears from knowledge',()=>{
  const s=state();s.enemies.push({id:'magus',name:'Magus',distance:25});
  s.behavior.previous={planId:'aggressive',goal:{targetId:'magus'}};
  assert.equal(system.select(s).goal.targetId,'magus');
  s.enemies=s.enemies.filter(enemy=>enemy.id!=='magus');
  assert.equal(system.select(s).goal.targetId,'fighter');
});

test('plan selection activates different policy components while retaining essential abilities',()=>{
  const aggressive=system.select(state()),defensive=system.select(state({caster:true}));
  assert.ok(aggressive.activeComponents.includes('pressure'));assert.ok(!aggressive.activeComponents.includes('protection'));
  assert.ok(defensive.activeComponents.includes('protection'));assert.ok(!defensive.activeComponents.includes('pressure'));
  for(const plan of [aggressive,defensive])for(const id of ['recovery','perception','strikes','movement'])assert.ok(plan.activeComponents.includes(id));
});

test('component attachments gate actions, but cannot remove core recovery or bypass costs',()=>{
  const s=state();s.behavior.configuration=system.configuration({components:[],plans:['aggressive']},defaultBehaviorConfiguration('wolf'));
  const result=system.decide(s,[action('cast','castSpell',100,2),action('hit','strike',3),action('stand','stand',2**30),action('end','endTurn',0,0)]);
  assert.equal(result.chosen.kind,'stand');assert.ok(result.rejected.some(option=>option.id==='cast'));
  s.actionsRemaining=0;
  const empty=system.decide(s,[action('attack','strike',3),action('end','endTurn',0,0)]);
  assert.equal(empty.chosen.kind,'endTurn');
});

test('tactics preserve priority recovery and negative risk and keep score terms consistent',()=>{
  const s=state(),stand=action('stand','stand',2**30),risky=action('risky','strike',-2),hit=action('hit','strike',4);
  const result=system.decide(s,[stand,risky,hit]);
  assert.equal(result.chosen.id,'stand');assert.equal(result.ranked.find(entry=>entry.candidate.id==='risky').utility,-2);
  for(const entry of result.ranked)assert.ok(Math.abs(entry.utility-entry.terms.reduce((sum,term)=>sum+term.contribution,0))<1e-8);
});

test('hiding beliefs retain the goal briefly but do not create an endless standoff or stall LOS pursuit',()=>{
  const s=state({caster:true,immediateAttack:false,hiddenBelief:true});
  assert.equal(system.select(s).planId,'hiding');
  s.behavior.context.planAge=2;assert.notEqual(system.select(s).planId,'hiding');
  s.behavior.context.planAge=0;s.behavior.context.visibleEnemies=0;assert.notEqual(system.select(s).planId,'hiding');
});

test('a hiding tactic does not advance into an exposed square merely to unlock an attack',()=>{
  const s=state({caster:true,immediateAttack:false,hideUseful:true});
  s.moves=[{x:2,y:1,targets:{fighter:{distance:10}}}];
  const move={...action('move','stride',8),destination:{x:2,y:1},assessment:{value:8,movement:true}};
  const hide=action('hide','hide',0.8),result=system.decide(s,[move,hide,action('end','endTurn',0,0)]);
  assert.equal(result.chosen.kind,'hide');assert.ok(result.rejected.some(entry=>entry.id==='move'));
});

test('an avoiding tactic can create a legal retreat and does not immediately approach again',()=>{
  const s=state({health:0.2,emergency:true});
  s.moves=[{kind:'stride',x:0,y:1,cost:5,path:[{x:1,y:1},{x:0,y:1}],targets:{fighter:{distance:30}},nearestEnemy:6},
    {kind:'stride',x:2,y:1,cost:5,path:[{x:1,y:1},{x:2,y:1}],targets:{fighter:{distance:10}},nearestEnemy:2}];
  const attackMove={...action('forward','stride',0),destination:{x:2,y:1},assessment:{value:0,movement:true,nearestEnemy:2,currentNearestEnemy:4}};
  const result=system.decide(s,[attackMove,action('end','endTurn',0,0)]);
  assert.equal(result.chosen.features.avoidance,true);assert.equal(result.chosen.destination.x,0);
});

test('custom components and plans compose without evaluating actor text',()=>{
  const custom=new BehaviorSystem().registerComponent({id:'core',core:true})
    .registerComponent({id:'signal',candidates:()=>[action('signal','signal',2)]})
    .registerPlan({id:'coordinate',label:'Coordinate',components:[],requires:['signal'],score:()=>({value:2,reason:'A signal helps'})});
  const s=state();s.behavior.configuration=custom.configuration({parameters:{signal:{phrase:'data only'}}},{components:['signal'],plans:['coordinate']});
  assert.equal(custom.decide(s,[action('end','endTurn',0,0)]).chosen.kind,'signal');
  assert.throws(()=>custom.configuration({components:['alert(1)']},{components:[],plans:['coordinate']}),/Unknown behavior/);
  assert.throws(()=>custom.configuration({parameters:{signal:()=>true}},{components:['signal'],plans:['coordinate']}),/JSON data/);
  assert.throws(()=>custom.registerComponent({id:'signal'}),/duplicate/);
  assert.throws(()=>custom.registerPlan({id:'bad',components:['missing'],score:()=>1}),/Unknown behavior/);
});

test('tactic records and goals are serializable and explaining the choice does not select again',()=>{
  const s=state(),decision=system.decide(s,[action('one','strike',4),action('two','strike',3)]);
  const record=decisionExplanation(decision);
  assert.equal(record.tactic.planId,'aggressive');assert.equal(record.tactic.goal.targetId,'fighter');
  assert.deepEqual(JSON.parse(JSON.stringify(record)),record);
});

test('opposing policy adjustments may cancel without producing NaN explanations',()=>{
  const custom=new BehaviorSystem().registerComponent({id:'plus',kind:'policy',adjust:()=>1})
    .registerComponent({id:'minus',kind:'policy',adjust:()=>-1})
    .registerPlan({id:'balanced',label:'Balanced',components:['plus','minus'],score:()=>({value:1})});
  const s=state();s.behavior.configuration=custom.configuration({}, {components:['plus','minus'],plans:['balanced']});
  const result=custom.decide(s,[action('hit','strike',4)]);
  assert.equal(result.ranked[0].utility,4);assert.ok(result.ranked[0].terms.every(term=>Number.isFinite(term.contribution)));
});

test('invalid assessments are rejected by the shared legality gate rather than scored by a tactic',()=>{
  const s=state(),bad={id:'bad',kind:'strike',legal:true,actionCost:1};
  const result=system.decide(s,[bad,action('end','endTurn',0,0)]);
  assert.equal(result.chosen.kind,'endTurn');assert.match(result.rejected.find(entry=>entry.id==='bad').reason,/assessment/);
});
