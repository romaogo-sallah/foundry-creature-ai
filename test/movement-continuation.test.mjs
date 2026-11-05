import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/pyro-fixture.mjs';
import {MANAGED_MOVEMENT,REQUESTED_MOVEMENT,inheritManagedMovement} from '../src/foundry/movement-options.mjs';
import {STEALTH_MOVEMENT} from '../src/foundry/stealth-awareness.mjs';
import {ManualMovement} from '../src/foundry/manual-movement.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';

const ns='foundry-creature-ai';
const point=x=>({x,y:200,elevation:0,level:'ground',action:'walk',snapped:true});
function setup(){
  const f=fixture({saveDegree:2});f.player.document.x=1500;
  canvas.scene.regions.contents.push(new f.Region({name:'Grease',
    shapes:[{type:'rectangle',x:400,y:200,width:200,height:100}],
    levels:['ground'],elevation:{bottom:0,top:5},flags:{[ns]:{spellZone:{slug:'grease',dc:16}}}}, {parent:canvas.scene}));
  f.errors=[];
  f.manual=new ManualMovement(f.reactions,{onError:error=>f.errors.push(error.message)});
  return f;
}

test('a native Region continuation inherits managed and Sneak markers but never stale requested waypoints',()=>{
  const document={};
  const initial={[MANAGED_MOVEMENT]:true,[STEALTH_MOVEMENT]:true,[REQUESTED_MOVEMENT]:[point(200),point(400)]};
  assert.equal(inheritManagedMovement(document,{id:'initial',chain:[]},initial),true);
  const continued={};
  assert.equal(inheritManagedMovement(document,{id:'continued',chain:['initial']},continued),true);
  assert.equal(continued[MANAGED_MOVEMENT],true);assert.equal(continued[STEALTH_MOVEMENT],true);
  assert.equal(continued[REQUESTED_MOVEMENT],undefined);
  const next={};
  assert.equal(inheritManagedMovement(document,{id:'next',chain:['continued','initial']},next),true);
  assert.equal(next[STEALTH_MOVEMENT],true);
});

test('a fresh drag and a different token cannot inherit a previous managed action',()=>{
  const document={};inheritManagedMovement(document,{id:'initial'},{[MANAGED_MOVEMENT]:true});
  assert.equal(inheritManagedMovement(document,{id:'new-drag',chain:[]},{}),false);
  assert.equal(inheritManagedMovement({}, {id:'next',chain:['initial']},{}),false);
  assert.equal(inheritManagedMovement(document,{id:'stopped',chain:['unrelated']},{}),false);
});

test('native Region continuations remain recognized across many checkpoints',()=>{
  const document={};inheritManagedMovement(document,{id:'move-0'},{[MANAGED_MOVEMENT]:true});
  for(let i=1;i<=100;i++)assert.equal(inheritManagedMovement(document,{id:`move-${i}`,chain:[`move-${i-1}`]},{}),true);
  assert.equal(inheritManagedMovement(document,{id:'move-101',chain:['move-0']},{}),false,'old entries are bounded');
});

test('a successful Balance move is not intercepted again at its native off-grid boundary checkpoint',async()=>{
  const f=setup(),document=f.boss.document,native=document.move;
  document.move=async(path,options)=>{
    const target=path.at(-1),initial={id:'initial',method:'api',chain:[],origin:point(200),passed:{waypoints:[point(349)]},pending:{waypoints:path}};
    assert.equal(f.manual.intercept(document,initial,options),undefined);
    document.x=349;
    // Native TokenDocument continuations copy only standard update options.
    const continuation={id:'continued',method:'api',chain:['initial'],origin:point(349),passed:{waypoints:[target]},pending:{waypoints:[]}};
    const continuedOptions={};
    const allowed=f.manual.intercept(document,continuation,continuedOptions);
    assert.deepEqual(f.errors,[],'the boundary is not mistaken for an unsnapped user waypoint');
    assert.equal(continuedOptions[MANAGED_MOVEMENT],true);
    if(allowed===false)return false;
    return native(path,continuedOptions);
  };
  f.adapter.decide=state=>{
    const chosen=f.adapter.candidates(state).find(c=>c.kind==='stride'&&c.destination.x===4&&c.destination.y===2);
    assert.ok(chosen);return {chosen,diagnostics:state.diagnostics};
  };
  const ledger=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(document.x,400);assert.equal(ledger.actionsRemaining,2);assert.equal(ledger.uncertain,false);
  assert.equal(f.actor.hasCondition('prone'),false);assert.equal(f.manual.pending.size,0);
  assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,1);
  const report=f.calls.filter(c=>c[0]==='chat').at(-1)[1];
  assert.doesNotMatch(report.content,/stopped or constrained/);assert.match(report.content,/15 ft/);
});

test('a genuine new manual move on Grease is still validated after an automated chain',()=>{
  const f=setup(),document=f.boss.document;
  f.manual.intercept(document,{id:'initial',method:'api',chain:[]},{[MANAGED_MOVEMENT]:true});
  document.x=349;
  const result=f.manual.intercept(document,{id:'new-drag',method:'dragging',chain:[],origin:point(349),
    passed:{waypoints:[point(400)]},pending:{waypoints:[]} },{});
  assert.equal(result,false);assert.match(f.errors[0],/Snap this ground movement/);
});
