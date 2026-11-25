import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionGraph,renderDecisionGraphShell} from '../src/foundry/decision-graph.mjs';
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
  const record={chosenId:'bite',reason:'dawnsbury ranking',tiedIds:['bite'],totalOptions:2,
    tactic:{planId:'aggressive',label:'Aggressive',reason:'A useful attack is available',goal:{kind:'engage',label:'Engage Fighter'},
      context:{health:0.75,knownEnemies:2,visibleEnemies:1,forceRatio:0.8,immediateAttack:true},
      configuration:{plans:['aggressive','hiding'],components:['strikes','pressure','protection']},activeComponents:['strikes','pressure'],
      scores:[{id:'aggressive',label:'Aggressive',value:5,reason:'A useful attack is available'}],
      evaluations:[{id:'aggressive',label:'Aggressive',applicable:true,value:5,baseValue:5,reason:'A useful attack is available',continuity:0,preference:0},
        {id:'hiding',label:'Hiding',applicable:false,value:null,reason:'Current tactical conditions do not activate this plan'}]},
    options:[{id:'bite',kind:'strike',targetId:'fighter',selected:true,layer:6,value:7.4,actionCost:1,terms:[{label:'Attack',contribution:7},{label:'Aggressive: Press the attack',contribution:0.4}]},
      {id:'stride',kind:'stride',selected:false,layer:5,value:3,actionCost:1,terms:[]}],
    rejected:[{id:'trip',kind:'trip',reason:'target is already prone'}]};
  const catalog={components:[{id:'strikes',label:'Strikes',kind:'ability',actionKinds:['strike']},{id:'pressure',label:'Press the attack',kind:'policy',actionKinds:[]},
    {id:'protection',label:'Use protection',kind:'policy',actionKinds:[]}],plans:[{id:'aggressive',label:'Aggressive'},{id:'hiding',label:'Hiding'}]};
  const graph=buildDecisionGraph(record,catalog,{nameOf:id=>id==='fighter'?'Fighter':id});
  const node=id=>graph.nodes.find(entry=>entry.data.id===id);
  assert.match(node('plan-aggressive').classes,/selected/);
  assert.match(node('plan-hiding').classes,/inactive/);
  assert.match(node('component-protection').classes,/inactive/);
  assert.match(node('option-bite').classes,/chosen/);
  assert.match(node('term-bite-1').data.label,/Press the attack/);
  assert.match(node('rejected-trip-0').data.label,/already prone/);
  assert.ok(graph.edges.some(edge=>edge.data.source==='option-bite'&&edge.data.target==='term-bite-1'));
  assert.doesNotThrow(()=>structuredClone(graph));
});

test('decision graph shell escapes diagnostics and provides filters and export controls',()=>{
  const graph={summary:{reason:'<script>bad</script>',optionCount:1,totalOptions:1,rejectedCount:0}};
  const html=renderDecisionGraphShell(graph);
  assert.ok(!html.includes('<script>'));
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.match(html,/data-graph-control="png"/);
  assert.match(html,/data-graph-filter="rejected"/);
  assert.match(html,/data-graph-search/);
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
