import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/pyro-fixture.mjs';
import {settleGreaseSlip,installGreaseLandingHooks,GREASE_SNAP} from '../src/foundry/grease-landing.mjs';
import {inGrease} from '../src/foundry/spell-zones.mjs';
import {ManualMovement} from '../src/foundry/manual-movement.mjs';
import {combatStamp} from '../src/foundry/reaction-prompts.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {MANAGED_MOVEMENT} from '../src/foundry/movement-options.mjs';

const ns='foundry-creature-ai';
const point=x=>({x,y:200,elevation:0,level:'ground',action:'walk'});
function setup(options){
  const f=fixture(options);f.player.document.x=1500;
  canvas.scene.regions.contents.push(new f.Region({name:'Grease',
    shapes:[{type:'rectangle',x:400,y:200,width:200,height:100}],
    levels:['ground'],elevation:{bottom:0,top:5},flags:{[ns]:{spellZone:{slug:'grease',dc:16}}}}, {parent:canvas.scene}));
  return f;
}
function interruptedMove(f,token,{prone=true,stop=349}={}){
  const native=token.document.move;
  token.document.move=async(path,options)=>{
    if(path.at(-1).action==='displace'){
      assert.equal(options[GREASE_SNAP],true);
      f.calls.push(['snap',token.id]);return native(path,options);
    }
    token.document.x=stop;
    if(prone)token.actor.conditionsSet.add('prone');
    token.document.movement={passed:{cost:0}};
    f.calls.push(['interrupted',token.id]);return false;
  };
}

test('a slip snaps inward onto Grease even when the nearest ordinary grid square is before it',async()=>{
  const f=setup();f.boss.document.x=349;f.actor.conditionsSet.add('prone');
  const result=await settleGreaseSlip(f.boss,{path:[point(300),point(400)]});
  assert.equal(result.settled,true);assert.equal(result.corrected,true);assert.equal(f.boss.document.x,400);
  assert.ok(inGrease(f.boss).length);
  assert.equal(f.calls.filter(call=>call[0]==='move').length,1);
  assert.equal(f.calls.find(call=>call[0]==='move')[2][0].action,'displace');
  await settleGreaseSlip(f.boss);
  assert.equal(f.calls.filter(call=>call[0]==='move').length,1,'repair is idempotent');
  assert.equal(f.calls.filter(call=>call[0]==='spell-save').length,0,'no second Balance roll');
});

test('a native interrupted AI move resolves the landing and records its actual nonzero distance without forfeiting unrelated actions',async()=>{
  const f=setup({saveDegree:2});interruptedMove(f,f.boss);
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const result=await f.adapter.execute({kind:'stride',path:[{x:2,y:2},{x:3,y:2},{x:4,y:2}],destination:{x:4,y:2}},
    {...ledger,actionsRemaining:2});
  assert.equal(result.pause,false);assert.equal(result.forfeitActions,false);
  assert.equal(result.movement.completed,true);assert.equal(result.movement.cost,15);
  assert.deepEqual(result.destination,{x:4,y:2});assert.equal(f.boss.document.x,400);
  assert.equal(f.calls.filter(call=>call[0]==='spell-save').length,1);
  assert.equal(f.calls.filter(call=>call[0]==='snap').length,1);
});

test('critical Balance failure moves only to the first Grease square, then applies Prone and ends the turn',async()=>{
  const f=setup({saveDegree:0}),native=f.boss.document.move;
  f.boss.document.move=async(path,options)=>{
    assert.equal(f.actor.hasCondition('prone'),false,'the walking path runs before Prone is applied');
    return native(path,options);
  };
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const result=await f.adapter.execute({kind:'stride',path:[{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2}],destination:{x:5,y:2}},ledger);
  assert.equal(result.forfeitActions,true);assert.equal(result.pause,false);
  assert.equal(f.boss.document.x,400);assert.equal(f.actor.hasCondition('prone'),true);
  assert.deepEqual(result.destination,{x:4,y:2});assert.equal(result.movement.cost,15);
  assert.equal(f.calls.filter(call=>call[0]==='condition'&&call[2]==='prone').length,1);
});

test('an interrupted Grease landing spends exactly one action and reports actual distance in the turn ledger',async()=>{
  const f=setup({saveDegree:2});interruptedMove(f,f.boss);
  f.adapter.decide=state=>{
    const chosen=f.adapter.candidates(state).find(choice=>choice.kind==='stride'&&choice.destination.x===4&&choice.destination.y===2);
    assert.ok(chosen);return {chosen,diagnostics:state.diagnostics};
  };
  const ledger=await new TurnRunner(f.adapter).run({oneAction:true});
  assert.equal(ledger.actionsRemaining,2);assert.equal(ledger.uncertain,false);
  assert.ok(ledger.visited.includes('4,2'));
  const report=f.calls.filter(call=>call[0]==='chat').at(-1)[1];
  assert.match(report.content,/15 ft/);assert.doesNotMatch(report.content,/stopped or constrained/);
});

test('manual movement settles a failed Balance entry on Grease without a second action prompt',async()=>{
  const f=setup({saveDegree:0});game.user.active=true;game.users.activeGM=game.user;
  game.combat.turn=1;game.combat.combatant=game.combat.combatants[1];
  f.player.document.x=200;f.boss.document.y=1000;
  f.player.actor.system.attributes.speed={total:25};f.player.document.getCompleteMovementPath=points=>points;
  let prompts=0,moves=0;
  f.reactions.prompts.ask=async request=>{assert.equal(request.kind,'movement');prompts++;return 'stride';};
  const movement=new ManualMovement(f.reactions,{enabled:()=>false,onMoveAction:async()=>{moves++;}});
  const result=await movement.receive({sceneId:'scene',tokenId:f.player.id,origin:point(200),
    path:[point(200),point(300),point(400),point(500)],stamp:combatStamp(),expires:Date.now()+120000},game.user);
  assert.equal(result,true);assert.equal(f.player.document.x,400);
  assert.equal(f.player.actor.hasCondition('prone'),true);assert.equal(prompts,0);assert.equal(moves,1);
  assert.equal(f.calls.filter(call=>call[0]==='spell-save').length,1);
});

test('manual movement also repairs a native stop at a Grease boundary',async()=>{
  const f=setup({saveDegree:2});game.user.active=true;game.users.activeGM=game.user;
  game.combat.turn=1;game.combat.combatant=game.combat.combatants[1];
  f.player.document.x=300;f.boss.document.y=1000;
  f.player.actor.system.attributes.speed={total:25};f.player.document.getCompleteMovementPath=points=>points;
  f.reactions.prompts.ask=async()=> 'stride';interruptedMove(f,f.player);
  const movement=new ManualMovement(f.reactions,{enabled:()=>false});
  const result=await movement.receive({sceneId:'scene',tokenId:f.player.id,origin:point(300),
    path:[point(300),point(400)],stamp:combatStamp(),expires:Date.now()+120000},game.user);
  assert.equal(result,true);assert.equal(f.player.document.x,400);assert.equal(f.calls.filter(call=>call[0]==='snap').length,1);
});

test('a native wall stop without a fall spends the action and requests reassessment',async()=>{
  const f=setup({saveDegree:2});interruptedMove(f,f.boss,{prone:false,stop:300});
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const result=await f.adapter.execute({kind:'stride',path:[{x:2,y:2},{x:3,y:2},{x:4,y:2}],destination:{x:4,y:2}},ledger);
  assert.equal(result.pause,false);assert.equal(result.pauseReason,null);assert.match(result.note,/reassessing the turn/);
  assert.equal(f.calls.filter(call=>call[0]==='snap').length,0);
});

test('a reaction before entering Grease never snaps the creature forward into the unattempted square',async()=>{
  const f=setup({saveDegree:0});f.reactions.hasMovementReactors=()=>true;
  f.reactions.movement=async()=>{f.actor.conditionsSet.add('prone');return {pause:true,pauseReason:'Trip reaction'};};
  const ledger=await f.adapter.readLedger(f.adapter.turnKey());
  const result=await f.adapter.execute({kind:'stride',path:[{x:2,y:2},{x:3,y:2},{x:4,y:2}],destination:{x:4,y:2}},ledger);
  assert.equal(result.pause,true);assert.equal(result.forfeitActions,false);assert.equal(f.boss.document.x,200);
  assert.equal(f.calls.filter(call=>call[0]==='move').length,0);
});

test('correction respects walls, occupied cells, death, cancellation, pause and levels',async()=>{
  for(const obstacle of ['wall','occupied','dead','cancelled','paused','level']){
    const f=setup();f.boss.document.x=349;f.actor.conditionsSet.add('prone');
    if(obstacle==='wall'){f.walls.add('4,2');f.walls.add('5,2');}
    if(obstacle==='occupied'){f.player.document.x=400;f.addEnemy('blocker',500,200);}
    if(obstacle==='dead')f.actor.hitPoints.value=0;
    if(obstacle==='paused')game.paused=true;
    if(obstacle==='level')f.boss.document.level='other';
    const result=await settleGreaseSlip(f.boss,{path:[point(300),point(400)],valid:()=>obstacle!=='cancelled'});
    assert.equal(result.settled,false,obstacle);assert.equal(f.boss.document.x,349,obstacle);
    assert.equal(f.calls.filter(call=>call[0]==='move').length,0,obstacle);
  }
});

test('landing uses native token-specific snapping for Tiny offsets and Large footprints',async()=>{
  for(const width of [0.5,2]){
    const f=setup();Object.assign(f.boss.document,{x:width===2?249:349,width,height:width});f.boss.w=f.boss.h=100*width;
    f.actor.conditionsSet.add('prone');
    const offset=width===0.5?25:0;
    f.boss.document.getSnappedPosition=p=>({x:Math.round((p.x-offset)/100)*100+offset,y:Math.round((p.y-offset)/100)*100+offset});
    if(width===0.5)f.boss.document.y=225;
    const result=await settleGreaseSlip(f.boss,{path:[point(400)]});
    assert.equal(result.settled,true);assert.equal(f.boss.document.x,width===2?300:400+offset);
    assert.ok(inGrease(f.boss).length);
  }
});

test('the native stop hook defers its repair until animation finishes and ignores correction movements',async()=>{
  const f=setup();let hook,finish;
  globalThis.Hooks={on:(event,callback)=>{assert.equal(event,'stopToken');hook=callback;}};
  installGreaseLandingHooks();f.boss.document.object=f.boss;
  f.boss.document.x=349;f.actor.conditionsSet.add('prone');
  f.boss.document.movement={passed:{waypoints:[point(300),point(400)]}};
  f.boss.movementAnimationPromise=new Promise(resolve=>{finish=resolve;});
  hook(f.boss.document);assert.equal(f.boss.document.x,349);finish();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.boss.document.x,400);
  const before=f.calls.length;f.boss.document.movement={updateOptions:{[GREASE_SNAP]:true}};
  hook(f.boss.document);await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls.length,before);
  f.boss.document.x=349;f.boss.document.movement={updateOptions:{[MANAGED_MOVEMENT]:true},passed:{waypoints:[point(300),point(400)]}};
  hook(f.boss.document);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.boss.document.x,349,'managed movements use their own cancellation guards');
});
