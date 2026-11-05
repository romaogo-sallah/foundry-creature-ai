import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/ogre-fixture.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {guardCast,guardItemMessage,guardConsumable,checkRestriction,blockedVoluntaryMovement,actionRestriction,reactionRestriction} from '../src/foundry/action-restrictions.mjs';
import {withConditionActivity} from '../src/foundry/condition-activity.mjs';
import {resolveConditionChecks} from '../src/foundry/condition-actions.mjs';
import {initialActionBudget} from '../src/foundry/action-economy.mjs';
import {executeRetch,retchSource} from '../src/foundry/manual-condition-actions.mjs';
import {breakFascination} from '../src/foundry/fascination.mjs';
const ns='foundry-creature-ai';
function setup(){
 const f=fixture();globalThis.ui={notifications:{warn:message=>f.calls.push(['warn',message]),info:message=>f.calls.push(['notice',message])}};
 const values=new Map(),native=f.actor.getCondition;
 f.actor.getCondition=(slug,{all=false}={})=>{
  if(!f.actor.hasCondition(slug))return all?[]:null;
  const condition={...native(slug),value:values.get(slug)??1,getFlag:(namespace,key)=>f.flags.get(`condition-${slug}:${namespace}:${key}`)};
  return all?[condition]:condition;
 };
 f.actor.decreaseCondition=async(condition,{forceRemove=false}={})=>{
  const slug=typeof condition==='string'?condition:condition.slug,value=values.get(slug)??1;
  if(forceRemove||value<=1){f.actor.conditionsSet.delete(slug);values.delete(slug);}else values.set(slug,value-1);
  f.calls.push(['reduce',slug]);
 };
 return {...f,values};
}
test('manual Restrained casting and Sickened consumption stop before slots or consumables change',async()=>{
 const f=setup();let native=0;const wrapped=()=>native++;
 f.actor.conditionsSet.add('restrained');
 await guardCast.call({actor:f.actor},wrapped,{type:'spell',traits:new Set(['concentrate','manipulate'])},{});
 assert.equal(native,0);
 assert.equal(checkRestriction({}, {actor:f.actor,type:'skill-check',action:'escape',traits:['attack']}),null);
 f.actor.conditionsSet.clear();f.actor.conditionsSet.add('sickened');
 guardConsumable.call({actor:f.actor,type:'consumable',system:{category:'potion'}},wrapped);
 assert.equal(native,0);
});
test('manual movement cannot bypass Immobilized or Prone by choosing another mode; displacement is preserved',()=>{
 const f=setup(),movement=action=>({pending:{waypoints:[{action}]}});
 f.actor.conditionsSet.add('grabbed');assert.equal(blockedVoluntaryMovement(f.boss.document,movement('fly')),true);
 assert.equal(blockedVoluntaryMovement(f.boss.document,movement('displace')),false);
 f.actor.conditionsSet.clear();f.actor.conditionsSet.add('prone');
 assert.equal(blockedVoluntaryMovement(f.boss.document,movement('step')),true);
 assert.equal(blockedVoluntaryMovement(f.boss.document,movement('crawl')),false);
});
test('manual Fascinated casting can relate to the recorded subject; unrelated casting is blocked',async()=>{
 const f=setup();f.actor.conditionsSet.add('fascinated');await f.actor.setFlag(ns,'conditionContext',{fascinationSubjects:[f.player.id]});
 let native=0;const spell={type:'spell',traits:new Set(['concentrate'])};
 await guardCast.call({actor:f.actor},()=>native++,spell,{});assert.equal(native,0);
 game.user.targets.add(f.player);await guardCast.call({actor:f.actor},()=>native++,spell,{});assert.equal(native,1);
});
test('enabled PF2e Automations owns manual card flat checks; disabled module falls back to awaited checks',async()=>{
 const f=setup();f.actor.conditionsSet.add('grabbed');let rolled=0,cards=0;
 globalThis.Roll=class{async evaluate(){rolled++;this.total=1;return this;}async toMessage(){}};
 game.modules=new Map([['pf2e-automations',{active:true}]]);game.settings.get=(module,key)=>module==='pf2e-automations'&&key==='flatCheck'?'all':undefined;
 const item={actor:f.actor,type:'action',traits:new Set(['manipulate'])};
 await guardItemMessage.call(item,()=>cards++,null,{actualUse:true});assert.equal(rolled,0);assert.equal(cards,1);
 game.modules.get('pf2e-automations').active=false;
 await guardItemMessage.call(item,()=>cards++,null,{actualUse:true});assert.equal(rolled,1);assert.equal(cards,1);
});
test('managed action checks remain awaited when another module owns manual flat checks',async()=>{
 const f=setup();f.actor.conditionsSet.add('deafened');let release;
 globalThis.Roll=class{async evaluate(){await new Promise(resolve=>release=resolve);this.total=1;return this;}async toMessage(){}};
 const resolving=resolveConditionChecks(f.actor,{kind:'bellow'},{token:f.boss});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(typeof release,'function');release();assert.equal(await resolving,false);
});
test('Stunned and Slowed overlap; valued Stunned pays once before AI acts',async()=>{
 const f=setup();f.actor.conditionsSet.add('stunned');f.values.set('stunned',1);f.actor.conditionsSet.add('slowed');f.values.set('slowed',2);
 const preview=await f.adapter.readLedger(f.adapter.turnKey());assert.equal(preview.actionsRemaining,1);assert.equal(f.actor.hasCondition('stunned'),true,'preview is read-only');
 const result=await new TurnRunner(f.adapter).run();assert.equal(result.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='reduce'&&c[1]==='stunned').length,1);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);
});
test('Workbench Stunned payment is reused without a second condition reduction',async()=>{
 const f=setup();game.modules=new Map([['xdy-pf2e-workbench',{active:true}]]);
 game.settings.get=(module,key)=>module==='xdy-pf2e-workbench'&&key==='autoReduceStunned'?true:undefined;
 f.actor.conditionsSet.add('slowed');f.values.set('slowed',2);
 await f.actor.setFlag('xdy-pf2e-workbench','stunReduction',{combat:f.combat.id,round:f.combat.round,reducedBy:1});
 const budget=await initialActionBudget(f.actor);assert.equal(budget.actionsRemaining,1);assert.equal(budget.pendingStunned,0);
 const result=await new TurnRunner(f.adapter).run();assert.equal(result.actionsRemaining,0);assert.equal(f.calls.some(c=>c[0]==='reduce'),false);
});
test('valued Stunned gained mid-turn finishes the current activity then consumes remaining actions (2026 errata)',async()=>{
 const f=setup(),strike=f.actor.system.actions[0],roll=strike.variants[0].roll;
 const decide=f.adapter.decide.bind(f.adapter);f.adapter.decide=state=>({...decide(state),
  chosen:f.adapter.candidates(state).find(action=>action.kind==='strike'&&action.strikeId===strike.item.id)});
 strike.variants[0].roll=async options=>{f.actor.conditionsSet.add('stunned');f.values.set('stunned',2);
   assert.equal(actionRestriction(f.actor),null,'current activity is allowed to finish');assert.equal(reactionRestriction(f.actor).kind,'stunned');return roll(options);};
 const result=await new TurnRunner(f.adapter).run();assert.equal(result.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);assert.ok(f.calls.some(c=>c[0]==='damage-applied'));
 assert.equal(f.actor.hasCondition('stunned'),false);assert.equal(f.calls.filter(c=>c[0]==='reduce').length,2);
});
test('Retch uses the recorded source DC and native Fortitude degree; critical success removes two levels',async()=>{
 const f=setup();f.actor.conditionsSet.add('sickened');f.values.set('sickened',2);f.flags.set('condition-sickened:'+ns+':dc',21);
 const original=f.actor.getStatistic;f.actor.getStatistic=slug=>slug==='fortitude'?{check:{mod:12,roll:async options=>{assert.equal(options.dc.value,21);return {degreeOfSuccess:3};}}}:original(slug);
 assert.equal(retchSource(f.actor).available,true);await executeRetch(f.boss);assert.equal(f.actor.hasCondition('sickened'),false);
});
test('hostile actions break ordinary Fascinated on the victim and its allies without removing locked effects',async()=>{
 const f=setup();f.actor.conditionsSet.add('fascinated');await breakFascination(f.actor);
 assert.equal(f.actor.hasCondition('fascinated'),false);
 f.actor.conditionsSet.add('fascinated');const native=f.actor.getCondition;f.actor.getCondition=(slug,options)=>{
  const conditions=native(slug,options);return options?.all?conditions.map(c=>({...c,isLocked:true})):conditions;
 };
 await breakFascination(f.actor);assert.equal(f.actor.hasCondition('fascinated'),true);
});
