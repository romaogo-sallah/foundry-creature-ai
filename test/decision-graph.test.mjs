import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionGraph,layeredGraphPositions,renderDecisionGraphShell,relativeWheelZoom} from '../src/foundry/decision-graph.mjs';
import {BehaviorSystem} from '../src/framework/behavior-system.mjs';

test('behavior selection records applicable and inactive plan evaluations',()=>{
  const system=new BehaviorSystem()
    .registerComponent({id:'core',label:'Core',kind:'ability',core:true,actionKinds:['strike']})
    .registerComponent({id:'policy',label:'Policy',kind:'policy'})
    .registerPlan({id:'attack',label:'Attack',components:['policy'],score:()=>({value:4,reason:'Target in reach'})})
    .registerPlan({id:'wait',label:'Wait',components:[],score:()=>null});
  const selection=system.select({behavior:{configuration:{plans:['attack','wait'],components:['core','policy'],preferredPlan:null},context:{},previous:null}});
  assert.equal(selection.planId,'attack');
  assert.deepEqual(selection.evaluations.map(({id,applicable})=>[id,applicable]),[['attack',true],['wait',false]]);
  assert.match(selection.evaluations[1].reason,/do not activate/);
});

test('decision graph exposes tactic, component, ranking, terms and rejection path',()=>{
  const record={chosenId:'bite',reason:'dawnsbury ranking',tiedIds:[],randomizedIds:['bite','stride'],
    selection:{mode:'weighted',variation:0.5,roll:0.2,maxGap:1,candidates:[{id:'bite',probability:0.8},{id:'stride',probability:0.2}]},totalOptions:2,
    tactic:{planId:'aggressive',label:'Aggressive',reason:'A useful attack is available',goal:{kind:'engage',label:'Engage Fighter'},
      context:{health:0.75,knownEnemies:2,visibleEnemies:1,forceRatio:0.8,immediateAttack:true},
      configuration:{plans:['aggressive','hiding'],components:['strikes','pressure','protection']},activeComponents:['strikes','pressure'],
      scores:[{id:'aggressive',label:'Aggressive',value:5,reason:'A useful attack is available'}],
      evaluations:[{id:'aggressive',label:'Aggressive',applicable:true,value:5,baseValue:5,reason:'A useful attack is available',continuity:0,preference:0},
        {id:'hiding',label:'Hiding',applicable:false,value:null,reason:'Current tactical conditions do not activate this plan'}]},
    options:[{id:'bite',kind:'strike',targetId:'fighter',selected:true,layer:6,value:7.4,actionCost:1,selectionProbability:0.8,terms:[{label:'Attack',contribution:7},{label:'Aggressive: Press the attack',contribution:0.4}]},
      {id:'stride',kind:'stride',selected:false,layer:6,value:7,actionCost:1,selectionProbability:0.2,terms:[]}],
    rejected:[{id:'trip',kind:'trip',reason:'target is already prone'}]};
  const catalog={components:[{id:'strikes',label:'Strikes',kind:'ability',actionKinds:['strike']},{id:'pressure',label:'Press the attack',kind:'policy',actionKinds:[]},
    {id:'protection',label:'Use protection',kind:'policy',actionKinds:[]}],plans:[{id:'aggressive',label:'Aggressive'},{id:'hiding',label:'Hiding'}]};
  const graph=buildDecisionGraph(record,catalog,{nameOf:id=>id==='fighter'?'Fighter':id});
  const node=id=>graph.nodes.find(entry=>entry.data.id===id);
  assert.match(node('plan-aggressive').classes,/selected/);
  assert.match(node('plan-hiding').classes,/inactive/);
  assert.match(node('component-protection').classes,/inactive/);
  assert.match(node('option-bite').classes,/chosen/);
  assert.match(node('option-stride').classes,/randomized/);
  assert.match(node('option-stride').data.label,/20%/);
  assert.match(node('term-bite-1').data.label,/Press the attack/);
  assert.match(node('rejected-trip-0').data.label,/already prone/);
  assert.ok(graph.edges.some(edge=>edge.data.source==='option-bite'&&edge.data.target==='term-bite-1'));
  assert.doesNotThrow(()=>structuredClone(graph));
});

test('decision graph shows preferred, backup and desperate tactic cards including ranged engagement',()=>{
  const record={chosenId:'move',reason:'ranked',totalOptions:1,tactic:{planId:'ranged',label:'Ranged engagement',reason:'Close first',
    goal:{kind:'effective-range'},context:{},configuration:{plans:['ranged','aggressive'],components:[]},activeComponents:[],
    hierarchy:{preferred:{planId:'ranged',label:'Ranged engagement',source:'ranked'},backup:{planId:'aggressive',label:'Aggressive',source:'next-best'},
      desperate:{planId:'aggressive',label:'Aggressive',source:'engagement-fallback'},used:'preferred'},
    evaluations:[{id:'ranged',label:'Ranged engagement',applicable:true,value:7,reason:'Close first'},
      {id:'aggressive',label:'Aggressive',applicable:true,value:5,reason:'Engage'}]},
    options:[{id:'move',kind:'stride',selected:true,layer:6,value:5,actionCost:1,terms:[]}],rejected:[]};
  const graph=buildDecisionGraph(record,{plans:[{id:'ranged',label:'Ranged engagement'},{id:'aggressive',label:'Aggressive'}]});
  const node=id=>graph.nodes.find(entry=>entry.data.id===id);
  assert.match(node('tactic-stage-preferred').data.label,/Ranged engagement/);
  assert.match(node('tactic-stage-backup').data.label,/Aggressive/);
  assert.ok(node('tactic-stage-desperate'));assert.ok(node('plan-ranged'));
  assert.ok(graph.edges.some(edge=>edge.data.source==='tactic-stage-preferred'&&edge.data.target==='plan-ranged'));
});

test('decision graph shell escapes diagnostics and provides filters and export controls',()=>{
  const graph={summary:{reason:'<script>bad</script>',optionCount:1,totalOptions:1,rejectedCount:0}};
  const html=renderDecisionGraphShell(graph);
  assert.ok(!html.includes('<script>'));
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html,/data-graph-control="png"/);
  assert.match(html,/data-graph-filter="rejected"/);
  assert.match(html,/data-graph-search/);
  assert.match(html,/Weighted roll candidate/);
  assert.doesNotMatch(html,/data-graph-filter="inactive" checked/);
});

test('causal trace v2 uses semantic columns and accepts shared final selection',()=>{
  const trace={schema:'foundry-creature-ai/planning-trace@2',selectedPlanId:'ranged',budget:{displayedFinalists:2},nodes:[
    {id:'planning-root',kind:'situation',layer:0,label:'Decision',status:'selected'},
    {id:'intent-ranged',kind:'or',layer:2,label:'Ranged',status:'selected',detail:{planId:'ranged'}},
    {id:'primitive-shot',kind:'primitive',layer:5,label:'Strike',status:'selected',detail:{selectionProbability:0.7}},
    {id:'competitive-choice',kind:'or',layer:7,label:'Weighted choice',status:'selected'},
    {id:'selected-outcome',kind:'outcome',layer:8,label:'Execute strike',status:'selected'},
  ],edges:[
    {id:'a',source:'planning-root',target:'intent-ranged',relation:'compares'},
    {id:'b',source:'intent-ranged',target:'primitive-shot',relation:'alternative-action'},
    {id:'c',source:'primitive-shot',target:'competitive-choice',relation:'weighted 70%'},
    {id:'d',source:'competitive-choice',target:'selected-outcome',relation:'executes'},
  ]};
  const graph=buildDecisionGraph({chosenId:'shot',reason:'weighted',tactic:{planningTrace:trace}});
  assert.match(graph.nodes.find(node=>node.data.id==='primitive-shot').classes,/randomized/);
  const positions=layeredGraphPositions(graph.nodes);
  assert.ok(positions.get('planning-root').x<positions.get('intent-ranged').x);
  assert.ok(positions.get('intent-ranged').x<positions.get('primitive-shot').x);
  assert.ok(positions.get('primitive-shot').x<positions.get('selected-outcome').x);
});

test('vendored Cytoscape loads the decision graph with its directed layout',async()=>{
  const {default:cytoscape}=await import('../src/vendor/cytoscape.esm.min.mjs');
  const cy=cytoscape({headless:true,elements:[
    {data:{id:'situation',label:'Situation'}},{data:{id:'choice',label:'Choice'}},
    {data:{id:'edge',source:'situation',target:'choice'}},
  ],layout:{name:'breadthfirst',directed:true,roots:'#situation'}});
  assert.equal(cy.nodes().length,2);
  assert.equal(cy.edges().length,1);
  assert.doesNotThrow(()=>cy.layout({name:'breadthfirst',directed:true,roots:'#situation'}).run());
  cy.destroy();
});

test('vendored Cytoscape tolerates Foundry read-only Array prototype helpers',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(Array.prototype,'equals');
  Object.defineProperty(Array.prototype,'equals',{value(){return false;},writable:false,configurable:true});
  try{
    const {default:cytoscape}=await import(`../src/vendor/cytoscape.esm.min.mjs?foundry-array=${Date.now()}`);
    const cy=cytoscape({headless:true,elements:[{data:{id:'root'}},{data:{id:'child'}},{data:{id:'edge',source:'root',target:'child'}}],
      layout:{name:'breadthfirst',directed:true,roots:'#root'}});
    assert.equal(cy.nodes().length,2);
    assert.equal(cy.edges().length,1);
    cy.destroy();
  }finally{
    if(descriptor)Object.defineProperty(Array.prototype,'equals',descriptor);
    else delete Array.prototype.equals;
  }
});

test('wheel zoom scales relative to the current level and respects bounds',()=>{
  const closer=relativeWheelZoom({zoom:1,deltaY:-100});
  const closerFromTwo=relativeWheelZoom({zoom:2,deltaY:-100});
  assert.ok(closer>1);
  assert.equal(closerFromTwo/2,closer);
  assert.ok(relativeWheelZoom({zoom:1,deltaY:100})<1);
  assert.equal(relativeWheelZoom({zoom:2.9,deltaY:-10000}),3);
  assert.equal(relativeWheelZoom({zoom:0.2,deltaY:10000}),0.15);
  assert.equal(relativeWheelZoom({zoom:1,deltaY:1,deltaMode:2,pageSize:100}),relativeWheelZoom({zoom:1,deltaY:100}));
});
