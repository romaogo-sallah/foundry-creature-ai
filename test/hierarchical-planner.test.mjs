import test from 'node:test';
import assert from 'node:assert/strict';
import {BehaviorSystem} from '../src/framework/behavior-system.mjs';
import {analyzeDecisionHierarchy,classifyCandidate,doctrineProfile,weightHierarchicalCandidate} from '../src/framework/hierarchical-planner.mjs';
import {decisionExplanation} from '../src/wolf/decision-explanation.mjs';
import {buildDecisionGraph} from '../src/foundry/decision-graph.mjs';

const action=(id,kind,value,extra={})=>({id,kind,legal:true,actionCost:1,assessment:{value},scoringTerms:[{label:'Base',contribution:value}],...extra});
function state(context={}){return {actionsRemaining:3,nearestEnemy:8,self:{cell:{x:0,y:0},reachSquares:1,speed:25,threatened:false},moves:[],diagnostics:{},
  enemies:[{id:'fighter',name:'Fighter',distance:40,lineOfSight:true,lineOfEffect:true,tactics:{reach:10,speed:25}}],behavior:{context:{health:0.8,
    forceRatio:1,knownEnemies:1,visibleEnemies:1,melee:true,ranged:true,rangedAttackAvailable:true,immediateAttack:true,...context}}};}

test('doctrine remains multi-label and engagement analysis is shared by several hypotheses',()=>{
  const s=state({caster:true,skulk:true,supportRecipients:1});s.behavior.configuration={components:['strikes','spellcasting','spell-control','spell-support','stealth','protection','movement'],plans:[]};
  const doctrine=doctrineProfile(s);
  assert.ok(doctrine.contribution.damage>0.5);assert.ok(doctrine.contribution.control>0.4);assert.ok(doctrine.contribution.support>0.4);
  assert.ok(doctrine.delivery.melee>0);assert.ok(doctrine.delivery.ranged>0);assert.ok(doctrine.delivery.spell>0);
  const plans=new Map([['attack',{intent:'damage',delivery:['ranged']}],['support',{intent:'support',delivery:['spell']}]]);
  const analysis=analyzeDecisionHierarchy(s,[{id:'attack',label:'Attack',applicable:true,value:8,reason:'shot'},
    {id:'support',label:'Support',applicable:true,value:7,reason:'ally'}],plans);
  assert.deepEqual(analysis.survivingPlanIds,['attack','support']);
  assert.equal(analysis.engagements[0].targetId,'fighter');assert.equal(analysis.engagements[0].actionsToAffect,2);
});

test('candidate classification distinguishes immediate payoff, same-turn setup and next-turn setup',()=>{
  const s=state(),selection={planId:'ranged',goal:{targetId:'fighter'},planning:{archetype:{intent:'damage'}}};
  assert.equal(classifyCandidate(action('shot','strike',5,{targetId:'fighter',features:{ranged:true}}),s,selection).timing,'exploit-now');
  assert.equal(classifyCandidate(action('move','stride',4,{features:{rangedFollowUp:true,turnPlan:[{kind:'stride'},{kind:'strike'}]},assessment:{value:4,movement:true}}),s,selection).timing,'setup-this-turn');
  assert.equal(classifyCandidate(action('hide','hide',2),s,selection).timing,'setup-next-turn');
});

test('range penalties are major while a documented range-closing action gains value',()=>{
  const s=state({bestRangePenalty:6}),analysis={survivingPlanIds:['ranged']},selection={planId:'ranged',label:'Ranged',goal:{targetId:'fighter'},
    evaluations:[{id:'ranged',value:7}],scores:[{id:'ranged',value:7}],planning:{archetype:{intent:'damage'}}};
  const shot=weightHierarchicalCandidate(action('shot','strike',10,{targetId:'fighter',features:{ranged:true,rangePenalty:6,rangeClosingAvailable:true}}),s,selection,analysis);
  const close=weightHierarchicalCandidate(action('close','stride',4,{targetId:'fighter',features:{rangeApproach:true,rangedFollowUp:true,
    turnPlan:[{kind:'stride',actionCost:1},{kind:'strike',actionCost:1}]},assessment:{value:4,movement:true,goodAttacksLeft:true}}),s,selection,analysis);
  assert.ok(shot.assessment.value<3);assert.ok(close.assessment.value>7);
  assert.ok(shot.scoringTerms.some(term=>term.label.includes('-6 range penalty')));
});

test('bounded intent portfolio lets a lower abstract hypothesis win through a better concrete method and records a real DAG',()=>{
  const system=new BehaviorSystem()
    .registerComponent({id:'core',label:'Core',kind:'ability',core:true,actionKinds:['strike']})
    .registerComponent({id:'setup-action',label:'Set up shot',kind:'policy',candidates:(_state,selection)=>selection.planId==='setup'?
      [action('close','stride',7,{features:{rangeApproach:true,rangedFollowUp:true,turnPlan:[{kind:'stride',actionCost:1},{kind:'strike',actionCost:1}]},assessment:{value:7,movement:true,fullTurnPlan:true,goodAttacksLeft:true}})]:[]})
    .registerPlan({id:'attack',label:'Attack now',components:[],intent:'damage',delivery:['ranged'],score:()=>({value:10,reason:'Attack is abstractly attractive'})})
    .registerPlan({id:'setup',label:'Set up shot',components:['setup-action'],intent:'damage',delivery:['movement','ranged'],score:()=>({value:8,reason:'A better lane is nearby'})});
  const s=state({bestRangePenalty:6});s.behavior.configuration=system.configuration({}, {components:['core','setup-action'],plans:['attack','setup']});
  const decision=system.decide(s,[action('shot','strike',10,{targetId:'fighter',features:{ranged:true,rangePenalty:6,rangeClosingAvailable:true}})]);
  assert.equal(decision.chosen.id,'close');assert.equal(decision.diagnostics.tactic.planId,'setup');
  const trace=decision.diagnostics.tactic.planningTrace;
  assert.equal(trace.schema,'foundry-creature-ai/planning-trace@1');assert.equal(trace.selectedPlanId,'setup');
  assert.ok(trace.nodes.filter(node=>node.kind==='or'&&node.layer===3).length>=2);
  assert.deepEqual(trace.nodes.filter(node=>node.kind==='or'&&node.layer===3&&node.status==='selected').map(node=>node.detail.planId),['setup']);
  assert.ok(trace.nodes.some(node=>node.kind==='and'&&node.status==='selected'));
  assert.ok(trace.timelines.find(line=>line.selected).steps.length===2);
  assert.ok(trace.nodes.some(node=>node.kind==='engagement'&&node.detail.targetId==='fighter'));
  const graph=buildDecisionGraph(decisionExplanation(decision,{includePlanningTrace:true}));
  assert.ok(graph.nodes.some(node=>node.data.id==='planning-root'));
  assert.ok(graph.nodes.some(node=>node.classes.includes('hypothesis')));
  assert.match(graph.nodes.find(node=>node.data.id==='intent-setup').classes,/selected/);
  assert.doesNotMatch(graph.nodes.find(node=>node.data.id==='intent-attack').classes,/selected/);
  assert.ok(graph.edges.some(edge=>edge.data.label==='alternative-method'));
  assert.doesNotThrow(()=>structuredClone(graph));
});
