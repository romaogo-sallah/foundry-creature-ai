import test from 'node:test';
import assert from 'node:assert/strict';
import {activityPlan,gateActivityGoal} from '../src/framework/activity-plan.mjs';

test('a preferred useful complete activity keeps its first step ahead of tempting atomic setup actions',()=>{
  const plan=activityPlan({id:'cast-and-retreat',label:'Cast, then retreat',value:4,steps:[{kind:'castSpell',actionCost:2},{kind:'stride',actionCost:1}]});
  const cast={id:'cast',kind:'castSpell',actionCost:2,legal:true,features:{turnPlan:plan}},move={id:'move',kind:'stride',actionCost:1,legal:true};
  const state={actionsRemaining:3,activityGoal:{kind:'castSpell'}};
  assert.deepEqual(gateActivityGoal(state,[move,cast]),[cast]);
  assert.deepEqual(gateActivityGoal({...state,actionsRemaining:2},[move,cast]),[move,cast],'the entire turn budget must fit');
  assert.deepEqual(gateActivityGoal({...state,behavior:{context:{emergency:true}}},[move,cast]),[move,cast],'an emergency can supersede the goal');
});

test('an activity that offers no useful benefit cannot monopolize action selection',()=>{
  const plan=activityPlan({id:'bad',label:'No benefit',value:0,steps:[{kind:'castSpell',actionCost:2}]});
  const offered=[{id:'cast',kind:'castSpell',actionCost:2,legal:true,features:{turnPlan:plan}},{id:'move',kind:'stride'}];
  assert.equal(gateActivityGoal({actionsRemaining:3,activityGoal:{kind:'castSpell'}},offered),offered);
});
