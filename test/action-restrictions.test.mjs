import test from 'node:test';
import assert from 'node:assert/strict';
import {actionRestriction,reactionRestriction,checkRestriction,guardCast,guardItemMessage,guardShieldDamage,blockedVoluntaryMovement} from '../src/foundry/action-restrictions.mjs';
import {ReactionEngine,canReact} from '../src/foundry/reactions.mjs';
import {fixture} from './helpers/ogre-fixture.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
const ns='foundry-creature-ai';
function setup(){const f=fixture();f.actor.flags={pf2e:{}};f.notices=[];globalThis.ui={notifications:{warn:m=>f.notices.push(m)}};return f;}
test('PF2e Automations no-reaction and no-action flags are distinct and do not consume a reaction',async()=>{
 const f=setup(),engine=new ReactionEngine();assert.equal(canReact(f.actor),true);
 f.actor.flags.pf2e.noUseReactions=true;assert.ok(reactionRestriction(f.actor));assert.equal(actionRestriction(f.actor),null);
 assert.equal(engine.available(f.boss),false);assert.equal(f.actor.getFlag(ns,'reaction'),undefined);
 delete f.actor.flags.pf2e.noUseReactions;assert.equal(engine.available(f.boss),true);
 await engine.setSpent(f.boss,true);f.actor.flags.pf2e.noUseReactions=true;delete f.actor.flags.pf2e.noUseReactions;
 assert.equal(engine.available(f.boss),false,'ending a restriction does not refund a spent reaction');
 f.actor.flags.pf2e.noActions=true;assert.ok(actionRestriction(f.actor));assert.ok(reactionRestriction(f.actor));
});
test('an expired parent cannot keep an unlimited granted reaction-denial marker active',()=>{
 const f=setup();f.actor.flags.pf2e.noUseReactions=true;
 const parent={id:'parent',name:'Laughing Fit',type:'effect',isExpired:false,system:{rules:[]}};
 const child={id:'child',name:'No Reactions',type:'effect',flags:{pf2e:{grantedBy:{id:'parent'}}},system:{rules:[{key:'ActiveEffectLike',path:'flags.pf2e.noUseReactions',value:true}]}};
 f.actor.items.set(parent.id,parent);f.actor.items.set(child.id,child);
 assert.match(reactionRestriction(f.actor).reason,/Laughing Fit/);
 parent.isExpired=true;assert.equal(reactionRestriction(f.actor),null);
});
test('manual action checks are denied while compulsory saves, flat checks, initiative and rerolls remain available',()=>{
 const f=setup();f.actor.flags.pf2e.noActions=true;
 for(const type of ['attack-roll','skill-check'])assert.ok(checkRestriction({}, {actor:f.actor,type,action:'trip'}));
 for(const type of ['saving-throw','flat-check','initiative','perception-check'])assert.equal(checkRestriction({}, {actor:f.actor,type}),null);
 assert.equal(checkRestriction({}, {actor:f.actor,type:'attack-roll',isReroll:true}),null);
 assert.ok(checkRestriction({}, {origin:{token:f.boss.document},type:'skill-check',options:new Set(['action:hide'])}));
});
test('reaction denial blocks explicit manual reactions but allows ordinary attacks',()=>{
 const f=setup();f.actor.flags.pf2e.noUseReactions=true;
 assert.equal(checkRestriction({}, {actor:f.actor,type:'attack-roll',action:'strike'}),null);
 assert.ok(checkRestriction({}, {actor:f.actor,type:'attack-roll',options:[`${ns}:reaction`]}));
 assert.ok(checkRestriction({}, {actor:f.actor,type:'attack-roll',action:'reactive-strike'}));
});
test('manual casting is blocked before the native slot-consuming cast begins, while browsing cards remains possible',async()=>{
 const f=setup();f.actor.flags.pf2e.noActions=true;let calls=0;const cast=()=>calls++;
 await guardCast.call({actor:f.actor},cast,{actionCost:{type:'action'}},{});assert.equal(calls,0);
 await guardItemMessage.call({actor:f.actor},cast,null,{actualUse:true});assert.equal(calls,0);
 await guardItemMessage.call({actor:f.actor},cast,null,{});assert.equal(calls,1);
 f.actor.flags.pf2e.noActions=false;await guardCast.call({actor:f.actor},cast,{},{});assert.equal(calls,2);
});
test('an unavailable manual Shield Block is removed without cancelling incoming damage',async()=>{
 const f=setup();f.actor.flags.pf2e.noUseReactions=true;
 const original={damage:7,shieldBlockRequest:true},seen=[];
 await guardShieldDamage.call(f.actor,options=>seen.push(options),original);
 assert.equal(seen[0].damage,7);assert.equal(seen[0].shieldBlockRequest,false);assert.equal(original.shieldBlockRequest,true);
});
test('no-actions movement denial keeps displacement, falling and explicit GM teleport available',()=>{
 const f=setup();f.actor.flags.pf2e.noActions=true;
 const move=action=>({passed:{waypoints:[]},pending:{waypoints:[{action,x:300,y:200}]}});
 assert.equal(blockedVoluntaryMovement(f.boss.document,move('walk')),true);
 assert.equal(blockedVoluntaryMovement(f.boss.document,move('fly')),true);
 for(const action of ['displace','fall'])assert.equal(blockedVoluntaryMovement(f.boss.document,move(action)),false);
  assert.equal(blockedVoluntaryMovement(f.boss.document,{passed:{waypoints:[{action:'walk'}]},pending:{waypoints:[{action:'displace'}]}}),false);
 assert.equal(blockedVoluntaryMovement(f.boss.document,move('walk'),{teleport:true}),false);
});
test('an NPC with a temporary No Actions effect ends its turn without declaring the battle won',async()=>{
 const f=setup();f.actor.flags.pf2e.noActions=true;f.adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const ledger=await new TurnRunner(f.adapter).run();
 assert.equal(ledger.completionReason,'incapacitated');assert.equal(ledger.actionsRemaining,3);
 assert.equal(f.adapter.encounterOutcome(),null);assert.equal(f.calls.some(c=>c[0]==='attack'||c[0]==='move'),false);
 delete f.actor.flags.pf2e.noActions;assert.equal(f.adapter.turnEndReason(),null);
});
