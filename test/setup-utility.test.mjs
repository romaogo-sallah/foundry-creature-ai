import test from 'node:test';
import assert from 'node:assert/strict';
import { setupUtility } from '../src/framework/setup-utility.mjs';

test('a setup scores marginal benefit and pays an explicit cost; an existing advantage cannot provide positive utility',()=>{
  const s={self:{averageDamage:5}};
  const useful=setupUtility(s,{gain:3,retained:10}),redundant=setupUtility(s,{gain:0,retained:10});
  assert.equal(useful.value,2.5);assert.equal(useful.redundantPenalty,0);
  assert.equal(redundant.value,-1);assert.equal(redundant.redundantPenalty,0.5);
});
