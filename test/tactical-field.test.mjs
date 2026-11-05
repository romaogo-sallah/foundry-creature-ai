import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTacticalField,backtrackCost,gridDistances} from '../src/framework/tactical-field.mjs';

function grid(width,height,{floor=()=>true,wall=()=>false,terrain=()=>1}={}){
  const graph=new Map();for(let x=0;x<width;x++)for(let y=0;y<height;y++)if(floor(x,y))graph.set(`${x},${y}`,{x,y,edges:[]});
  for(const node of graph.values())for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
    if(!dx&&!dy)continue;const next=graph.get(`${node.x+dx},${node.y+dy}`);if(!next||wall(node,next))continue;
    if(dx&&dy&&(!graph.has(`${node.x+dx},${node.y}`)||!graph.has(`${node.x},${node.y+dy}`)||wall(node,{x:node.x+dx,y:node.y})||wall(node,{x:node.x,y:node.y+dy})))continue;
    node.edges.push({to:`${next.x},${next.y}`,cost:(dx&&dy?7.5:5)*terrain(next)});
  }return graph;
}
const threat=(extra={})=>({id:'ogre',cell:{x:3,y:2},width:1,height:1,reach:5,speed:10,...extra});

test('enemy arrival uses a route around walls instead of straight-line distance',()=>{
  const graph=grid(12,7,{wall:(a,b)=>(a.x<6)!==(b.x<6)&&a.y<6&&b.y<6});
  const field=buildTacticalField(graph,{origin:{x:7,y:2},speed:10,needed:[{x:7,y:2},{x:3,y:5}],threats:[threat()]});
  assert.ok(field.cells.get('7,2').enemyArrival>field.cells.get('3,5').enemyArrival);
  assert.equal(field.cells.get('3,5').enemyArrival,1);
});

test('Large pursuers cannot follow through a one-square passage, but can reach its mouth',()=>{
  const graph=grid(12,7,{floor:(x,y)=>x<4||x>=8||y===3});
  const needed=[{x:4,y:3},{x:7,y:3}],options={origin:needed[1],needed,speed:10};
  const large=buildTacticalField(graph,{...options,threats:[threat({cell:{x:1,y:2},width:2,height:2,speed:25})]});
  const small=buildTacticalField(graph,{...options,threats:[threat({cell:{x:1,y:2},speed:25})]});
  assert.ok(Number.isFinite(large.cells.get('4,3').enemyArrival));
  assert.equal(large.cells.get('7,3').enemyArrival,Infinity);assert.ok(Number.isFinite(small.cells.get('7,3').enemyArrival));
});

test('a distant dead end controlled at its mouth scores below open escape space',()=>{
  const graph=grid(12,9,{floor:(x,y)=>x<7||y===4});
  const needed=[{x:10,y:4},{x:1,y:1}];
  const field=buildTacticalField(graph,{origin:needed[0],needed,speed:10,threats:[threat({cell:{x:4,y:4}})]});
  const pocket=field.cells.get('10,4'),open=field.cells.get('1,1');
  assert.ok(pocket.enemyArrival>1);assert.ok(pocket.safeSpace<open.safeSpace);
  assert.ok(pocket.positionValue<open.positionValue);
});

test('difficult terrain delays a pursuer and impassable walls remain impassable',()=>{
  const options={origin:{x:7,y:0},needed:[{x:7,y:0}],speed:10,threats:[threat({cell:{x:0,y:0}})]};
  const normal=buildTacticalField(grid(9,1),options),slow=buildTacticalField(grid(9,1,{terrain:n=>n.x>=3?2:1}),options);
  assert.ok(slow.origin.enemyArrival>normal.origin.enemyArrival);
  assert.equal(gridDistances(grid(9,1,{wall:(a,b)=>a.x===3&&b.x===4||a.x===4&&b.x===3}),['0,0']).has('8,0'),false);
});

test('recent destinations carry across rounds, expire by context in the adapter, and never ban a return',()=>{
  const state={round:5,self:{averageDamage:3.5},motionMemory:[{cell:{x:2,y:3},round:5},{cell:{x:2,y:3},round:4}]};
  assert.ok(backtrackCost(state,{x:2,y:3})>backtrackCost(state,{x:4,y:3}));
  assert.ok(backtrackCost(state,{x:2,y:3})<=2.5);
});

test('map cropping or invalid footprints do not imply that an unmodelled enemy cannot reach you',()=>{
  const field=buildTacticalField(grid(5,5),{origin:{x:2,y:2},threats:[threat({cell:{x:30,y:30}})]});
  assert.deepEqual(field.unmappedThreatIds,['ogre']);
});
