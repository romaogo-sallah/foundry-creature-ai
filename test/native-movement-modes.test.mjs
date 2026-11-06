import test from 'node:test';
import assert from 'node:assert/strict';
import {registerMovementModes,selectedGroundAction} from '../src/foundry/native-movement-modes.mjs';
import {fixture} from './helpers/ogre-fixture.mjs';
import {ManualMovement} from '../src/foundry/manual-movement.mjs';

test('Step and Sneak register as ordinary native movement choices with walking terrain',()=>{
 const f=fixture(),actions={walk:{label:'Walk'}};globalThis.CONFIG={Token:{movement:{actions}}};
 registerMovementModes();assert.equal(actions.step.terrainAction,'walk');assert.equal(actions.sneak.terrainAction,'walk');
 f.player.actor.system.attributes.speed={total:25};assert.equal(actions.step.canSelect(f.player.document),true);assert.equal(actions.sneak.canSelect(f.player.document),true);
 assert.equal(actions.sneak.canSelect(f.boss.document),true,'NPCs can choose Sneak too');
 assert.equal(actions.sneak.canSelect({actor:{isOfType:()=>false}}),false,'non-creature tokens stay excluded');
 f.player.actor.conditionsSet.add('prone');assert.equal(actions.step.canSelect(f.player.document),false);assert.equal(actions.sneak.canSelect(f.player.document),false);
 f.player.actor.conditionsSet.clear();f.player.actor.system.attributes.speed.total=5;assert.equal(actions.step.canSelect(f.player.document),false);
 const previous=actions.step;registerMovementModes();assert.equal(actions.step,previous);
});
test('native modes choose a single movement action and reject mixed actions without reinterpreting flight',()=>{
 assert.equal(selectedGroundAction({},[{action:'walk'},{action:'step'}]),'step');
 assert.equal(selectedGroundAction({movementAction:'sneak'},[]),'sneak');
 assert.equal(selectedGroundAction({},[{action:'walk'},{action:'fly'}]),'fly');
 assert.throws(()=>selectedGroundAction({},[{}, {action:'step'},{action:'sneak'}]),/one movement mode/);
});
test('a real native Step request is intercepted even without enemies, combat or reaction automation',async()=>{
 const f=fixture();game.combat=null;game.user.active=true;game.users.activeGM=game.user;f.player.document.object=f.player;
 f.player.actor.system.attributes.speed={total:25};f.player.document.getCompleteMovementPath=points=>points;
 let prompts=0;f.reactions.prompts.ask=async()=>{prompts++;throw new Error('movement must not ask');};
 const errors=[],manual=new ManualMovement(f.reactions,{enabled:()=>false,onError:error=>errors.push(error.message)});
 const start={x:500,y:200,elevation:0,level:'ground',action:'step'},end={...start,x:600};
 assert.equal(manual.intercept(f.player.document,{method:'dragging',origin:start,passed:{waypoints:[]},pending:{waypoints:[end]}}),false);
 for(let i=0;i<30&&manual.pending.size;i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.deepEqual(errors,[]);assert.equal(prompts,0);assert.equal(f.player.document.x,600);
});
