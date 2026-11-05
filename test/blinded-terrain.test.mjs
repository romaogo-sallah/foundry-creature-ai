import test from 'node:test';
import assert from 'node:assert/strict';
import {installFlightCosts} from '../src/foundry/flight-costs.mjs';

test('Blinded composes native difficult terrain for AI and manual rulers without stacking terrain twice',()=>{
  let wrapper;
  globalThis.libWrapper={register:(_id,path,fn)=>{assert.equal(path,'CONFIG.Token.objectClass.prototype._getMovementCostFunction');wrapper=fn;}};
  globalThis.canvas={grid:{type:1,distance:5}};
  installFlightCosts();
  const conditions=new Set(['blinded']);
  const actor={hasCondition:slug=>conditions.has(slug),system:{movement:{speeds:{fly:{value:60}}}}};
  const native=()=> (_from,_to,distance,segment)=>segment.teleport?0:distance+((segment.terrain?.difficulty??1)-1)*5;
  const cost=wrapper.call({document:{actor}},native);
  const from={i:0,j:0,k:0},to={i:1,j:0,k:0};
  assert.equal(cost(from,to,5,{action:'walk'}),10);
  assert.equal(cost(from,to,10,{action:'walk'}),15,'an expensive diagonal adds one square of difficulty');
  assert.equal(cost(from,to,5,{action:'walk',terrain:{difficulty:2}}),10);
  assert.equal(cost(from,to,5,{action:'walk',terrain:{difficulty:3}}),15);
  assert.equal(cost(from,to,5,{action:'walk',teleport:true}),0);
  assert.equal(cost(from,to,5,{action:'displace'}),5);
  assert.equal(cost(from,{i:0,j:0,k:1},5,{action:'fly'}),10,'ascending difficulty does not stack with blindness');
  assert.equal(cost(from,{i:0,j:0,k:-1},5,{action:'fly'}),5,'descent discount still applies');
  conditions.clear();assert.equal(cost(from,to,5,{action:'walk'}),5);
});
