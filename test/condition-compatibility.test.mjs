import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionAutomationOwners,applyConditionCompatibility} from '../src/foundry/condition-compatibility.mjs';
test('one existing module owns Frightened; duplicate client reduction is backed up and disabled once',async()=>{
 const data=new Map([['pf2e-automations.decreaseFrightened',true],['pf2e-automations.flatCheck','all'],
  ['xdy-pf2e-workbench.decreaseFrightenedConditionEachTurn',true],['xdy-pf2e-workbench.autoReduceStunned',true],['xdy-pf2e-workbench.applyPersistentDamage',true]]),writes=[];
 globalThis.game={modules:new Map([['pf2e-automations',{active:true}],['xdy-pf2e-workbench',{active:true}]]),
  settings:{get:(module,key)=>data.get(module+'.'+key),set:async(module,key,value)=>{data.set(module+'.'+key,value);writes.push([module,key,value]);}}};
 assert.equal(conditionAutomationOwners().duplicateFrightened,true);
 const owners=await applyConditionCompatibility();assert.equal(owners.duplicateFrightened,false);assert.equal(owners.frightened,'pf2e-automations');
 assert.equal(owners.stunned,'xdy-pf2e-workbench');assert.equal(owners.persistentDamage,'xdy-pf2e-workbench');
 assert.equal(data.get('foundry-creature-ai.conditionAutomationBackup').workbenchFrightened,true);
 await applyConditionCompatibility();assert.equal(writes.length,2);
});
