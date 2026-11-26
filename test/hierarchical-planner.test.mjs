import test from 'node:test';
import assert from 'node:assert/strict';
import {BehaviorSystem} from '../src/framework/behavior-system.mjs';
import {analyzeDecisionHierarchy,classifyCandidate,doctrineProfile,planningTrace,weightHierarchicalCandidate} from '../src/framework/hierarchical-planner.mjs';
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

test('a weighted winner promotes its shared timing branch even when a higher-ranked alternative created it first',()=>{
  const selection={planId:'ranged',label:'Ranged',goal:{label:'Take the lane'},planning:{archetype:{intent:'damage'}}};
  const candidate=id=>action(id,'stride',5,{features:{planning:{planId:'ranged',timing:'setup-next-turn',method:'move',plan:[]}}});
  const first=candidate('first'),chosen=candidate('chosen'),analysis={mandatoryDirective:null,doctrine:{},facts:[],engagements:[],
    hypotheses:[{id:'intent-ranged',planId:'ranged',label:'Ranged',intent:'damage',delivery:['movement'],posture:'position',score:5,status:'selected'}]};
  const trace=planningTrace(state(),analysis,[{selection,candidates:[first,chosen]}],{chosen,reason:'weighted',rejected:[],tiedIds:[],randomizedIds:['first','chosen'],
    selection:{mode:'weighted',candidates:[{id:'first',probability:0.6},{id:'chosen',probability:0.4}]},ranked:[
      {candidate:first,utility:5,layer:6,terms:[]},{candidate:chosen,utility:4.9,layer:6,terms:[]},
    ]},selection);
  assert.equal(trace.nodes.find(node=>node.id==='timing-ranged-setup-next-turn').status,'selected');
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
  assert.equal(trace.schema,'foundry-creature-ai/planning-trace@2');assert.equal(trace.selectedPlanId,'setup');
  assert.ok(trace.nodes.filter(node=>node.kind==='or'&&node.layer===2).length>=2);
  assert.deepEqual(trace.nodes.filter(node=>node.kind==='or'&&node.layer===2&&node.status==='selected').map(node=>node.detail.planId),['setup']);
  assert.ok(trace.nodes.some(node=>node.kind==='and'&&node.status==='selected'));
  assert.ok(trace.timelines.find(line=>line.selected).steps.length===2);
  assert.equal(trace.nodes.find(node=>node.id==='planning-root').detail.engagements[0].targetId,'fighter');
  assert.equal(trace.nodes.some(node=>node.kind==='fact'||node.kind==='engagement'),false,'non-causal state stays in root details');
  assert.ok(trace.nodes.filter(node=>node.kind==='and').every(node=>node.detail.timeline.length>1),'AND nodes only represent real decompositions');
  const incoming=new Map(),reachable=new Set(['planning-root']);
  for(const edge of trace.edges)incoming.set(edge.target,(incoming.get(edge.target)??0)+1);
  for(let changed=true;changed;){changed=false;for(const edge of trace.edges)if(reachable.has(edge.source)&&!reachable.has(edge.target)){reachable.add(edge.target);changed=true;}}
  assert.ok(trace.nodes.every(node=>node.id==='planning-root'||incoming.has(node.id)),'there are no structurally orphaned nodes');
  assert.equal(reachable.size,trace.nodes.length,'every node is reachable from the decision root');
  const graph=buildDecisionGraph(decisionExplanation(decision,{includePlanningTrace:true}));
  assert.ok(graph.nodes.some(node=>node.data.id==='planning-root'));
  assert.ok(graph.nodes.some(node=>node.classes.includes('hypothesis')));
  assert.match(graph.nodes.find(node=>node.data.id==='intent-setup').classes,/selected/);
  assert.doesNotMatch(graph.nodes.find(node=>node.data.id==='intent-attack').classes,/selected/);
  assert.ok(graph.edges.some(edge=>edge.data.label==='alternative-method'));
  assert.doesNotThrow(()=>structuredClone(graph));
});
