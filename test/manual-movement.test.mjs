import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { ManualMovement, MOVEMENT_QUERY } from '../src/foundry/manual-movement.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';
import { combatStamp } from '../src/foundry/reaction-prompts.mjs';
import { MANAGED_MOVEMENT } from '../src/foundry/movement-options.mjs';

function setup({ answer = 'stride', attackDegree = 2 } = {}) {
  const f = fixture({ attackDegree });
  game.user.active = true; game.users.activeGM = game.user;
  f.combat.turn = 1; f.combat.combatant = f.combat.combatants[1];
  f.player.actor.system.attributes.speed = { total: 25 };
  f.player.actor.testUserPermission = user => user.id === 'owner';
  f.reactions.automaticReactiveStrike = token => token === f.boss && token.document.getFlag(MODULE_ID, 'config')?.autoReactions !== false;
  f.reactions.prompts.ask = async request => { f.prompts.push(request); return request.kind === 'movement' ? answer : 'pass'; };
  canvas.grid.getDirectPath = points => {
    const offsets = [canvas.grid.getOffset(points[0])];
    for (const point of points.slice(1)) {
      const end = canvas.grid.getOffset(point); let previous = offsets.at(-1);
      while (previous.i !== end.i || previous.j !== end.j) {
        previous = { i: previous.i + Math.sign(end.i - previous.i), j: previous.j + Math.sign(end.j - previous.j) }; offsets.push(previous);
      }
    }
    return offsets;
  };
  const errors = [], notices = [];
  globalThis.ui = { notifications: { warn: message => notices.push(message), error: message => errors.push(message) } };
  const movement = new ManualMovement(f.reactions, { onError: error => errors.push(error.message) });
  const point = (x, y = f.player.document.y) => ({ x, y, elevation: 0, level: 'ground', action: 'walk' });
  const data = (...points) => ({ sceneId: 'scene', tokenId: 'fighter', origin: point(f.player.document.x),
    path: [point(f.player.document.x), ...points], stamp: combatStamp(), expires: Date.now() + 120000 });
  return { ...f, movement, data, point, errors, notices };
}

test('manual Stride rolls the taught ogre reaction automatically before the threatened departure', async () => {
  const f = setup();
  assert.equal(await f.movement.receive(f.data(f.point(700)), game.user), true);
  assert.equal(f.prompts.length, 1, 'only the movement action is asked, not the NPC reaction');
  assert.equal(f.prompts[0].kind, 'movement');
  assert.equal(f.calls.filter(call => call[0] === 'attack').length, 1);
  assert.equal(f.calls.find(call => call[0] === 'attack')[3], 0, 'off-turn Strike has no MAP');
  assert.equal(f.calls.find(call => call[0] === 'attack')[4].event.shiftKey, true, 'bypass configured GM roll dialog');
  assert.ok(f.calls.findIndex(call => call[0] === 'damage-applied') < f.calls.findIndex(call => call[0] === 'move'));
  assert.equal(f.player.actor.hitPoints.value, 90);
  assert.equal(f.player.document.x, 700);
  assert.equal(f.reactions.available(f.boss), false);
});

test('automatic NPC reaction intent holds the shared barrier before reservation and pauses again before movement resumes',async()=>{
  const f=setup();let release;
  f.reactions.presentation={beforeAction:frame=>{
    assert.equal(frame.decision.chosen.kind,'reactiveStrike');return new Promise(resolve=>release=resolve);
  },afterAction:async()=>{f.calls.push(['reaction-result-pause']);return true;}};
  const running=f.movement.receive(f.data(f.point(600)),game.user);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.reactions.barrier.pending,true);assert.equal(f.reactions.available(f.boss),true);
  assert.equal(f.calls.some(call=>call[0]==='attack'||call[0]==='move'),false);
  release(true);assert.equal(await running,true);
  assert.ok(f.calls.findIndex(call=>call[0]==='damage-applied')<f.calls.findIndex(call=>call[0]==='reaction-result-pause'));
  assert.ok(f.calls.findIndex(call=>call[0]==='reaction-result-pause')<f.calls.findIndex(call=>call[0]==='move'));
});

test('stopping during automatic NPC reaction intent preserves the unused reaction and departure square',async()=>{
  const f=setup();let release;
  f.reactions.presentation={beforeAction:()=>new Promise(resolve=>release=resolve)};
  const running=f.movement.receive(f.data(f.point(600)),game.user);
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  f.movement.cancel();release(false);assert.equal(await running,false);
  assert.equal(f.player.document.x,500);assert.equal(f.reactions.available(f.boss),true);
  assert.equal(f.calls.some(call=>call[0]==='attack'||call[0]==='damage-applied'),false);
});

test('manual Step avoids Reactive Strike and does not spend the ogre reaction', async () => {
  const f = setup({ answer: 'step' });
  assert.equal(await f.movement.receive(f.data(f.point(600)), game.user), true);
  assert.equal(f.calls.some(call => call[0] === 'attack'), false);
  assert.equal(f.player.document.x, 600);
  assert.equal(f.reactions.available(f.boss), true);
});

test('the live Stadium region boundary is not treated as an unsnapped player waypoint',()=>{
  const f=setup(),grid=canvas.grid;grid.size=70;
  grid.getOffset=p=>({i:Math.floor(p.y/70),j:Math.floor(p.x/70)});
  grid.getTopLeftPoint=p=>({x:p.j*70,y:p.i*70});
  Object.assign(f.player.document,{x:2590,y:1260,level:'defaultLevel0000'});
  f.player.document.getSnappedPosition=p=>({x:Math.round(p.x/70)*70,y:Math.round(p.y/70)*70});
  const origin={x:2590,y:1260,elevation:0,level:'defaultLevel0000',action:'walk'};
  const points=[origin,{...origin,x:2624,snapped:false,intermediate:true,explicit:true,checkpoint:false},
    {...origin,x:2660,snapped:true,intermediate:false}];
  const before=structuredClone(points),path=f.movement.path(f.player,points);
  assert.deepEqual(path.map(p=>[p.x,p.y]),[[2590,1260],[2660,1260]]);
  assert.deepEqual(points,before,'native waypoint data remains unchanged');
});

test('requested corners are preserved while generated boundary points are regenerated',()=>{
  const f=setup();
  const path=f.movement.path(f.player,[f.point(500),{...f.point(542.4),intermediate:true},
    {...f.point(600),explicit:true},{...f.point(600,242.4),intermediate:true},f.point(600,300)]);
  assert.deepEqual(path.map(p=>[p.x,p.y]),[[500,200],[600,200],[600,300]]);
});

test('partial native API waypoints inherit unchanged position and level fields before traversal',()=>{
  const f=setup();let received;
  f.player.document.getCompleteMovementPath=points=>{received=points;return points;};
  const path=f.movement.path(f.player,[f.point(500),{x:600}]);
  assert.equal(received[1].y,200);assert.equal(received[1].elevation,0);assert.equal(received[1].level,'ground');
  assert.deepEqual(path.map(p=>[p.x,p.y]),[[500,200],[600,200]]);
});

test('token-aware native snapping permits a Tiny footprint offset with integer-rounded coordinates',()=>{
  const f=setup();Object.assign(f.player.document,{x:18,y:18,width:0.5,height:0.5});
  f.player.document.getSnappedPosition=p=>({x:Math.round((p.x-17.5)/70)*70+17.5,y:Math.round((p.y-17.5)/70)*70+17.5});
  f.player.document.getCompleteMovementPath=points=>points;
  canvas.grid.getDirectPath=()=>assert.fail('use the native token traversal for footprint offsets');
  const origin={x:18,y:18,elevation:0,level:'ground'};
  assert.deepEqual(f.movement.path(f.player,[origin,{...origin,x:88}]).map(p=>p.x),[18,88]);
});

test('explicit unsnapped destinations, corners and checkpoints still require manual handling',()=>{
  const f=setup();
  for(const path of [[f.point(500),f.point(542.4)],
    [f.point(500),{...f.point(542.4),intermediate:false,explicit:true},f.point(600)],
    [f.point(500),{...f.point(542.4),intermediate:false,checkpoint:true},f.point(600)]]){
    assert.throws(()=>f.movement.path(f.player,path),/Snap this ground movement/);
  }
});

test('generated points cannot conceal a change in elevation, level or token dimensions',()=>{
  const f=setup();
  for(const changed of [{elevation:5},{level:'upstairs'},{width:2},{height:2}]){
    const path=[f.point(500),{...f.point(542.4),intermediate:true,...changed},f.point(600)];
    assert.throws(()=>f.movement.path(f.player,path),/one elevation\/level without resizing/);
  }
});

test('Define Surface geometry does not disable an otherwise legal manual Step',async()=>{
  const f=setup({answer:'step'});
  canvas.scene.regions.contents=[{name:'Floor',behaviors:{contents:[{type:'defineSurface',disabled:false}]}}];
  assert.equal(await f.movement.receive(f.data(f.point(600)),game.user),true);
  assert.ok(f.prompts[0].choices.some(choice=>choice.id==='step'));
  assert.equal(f.calls.some(call=>call[0]==='attack'),false);
});

test('disabled automatic reactions, a spent Sweep and an unready hook never intercept manual movement', async () => {
  for (const mode of ['disabled', 'sweep', 'one-handed']) {
    const f = setup(); await f.adapter.configure();
    if (mode === 'disabled') f.flags.set(`token-boss:${MODULE_ID}:config`, { enabled: true, autoReactions: false });
    if (mode === 'sweep') {
      const state = await f.reactions.reserve(f.boss, 'sweeping-hook', () => true);
      await f.reactions.confirm(f.boss, state);
    }
    if (mode === 'one-handed') f.adapter.parts().hook.system.equipped.handsHeld = 1;
    const request = { method: 'dragging', origin: f.point(500), passed: { waypoints: [f.point(600)] }, pending: { waypoints: [] } };
    assert.equal(f.movement.intercept(f.player.document, request), undefined);
    assert.equal(f.calls.some(call => call[0] === 'attack'), false);
    if (mode === 'one-handed') {
      assert.match(f.reactions.inspectReactiveStrike(f.boss).reason, /requires two hands/);
      assert.match(f.notices[0], /cannot Reactive Strike.*Regrip costs one Interact/);
      f.movement.intercept(f.player.document, request);
      assert.equal(f.notices.length,1,'warn once for the same readiness state and turn');
    }
  }
});

test('Step is not offered for a longer path, low Speed or uncertain terrain', async () => {
  for (const mode of ['long', 'slow', 'terrain']) {
    const f = setup({ answer: 'step' });
    if (mode === 'slow') f.player.actor.system.attributes.speed.total = 5;
    if (mode === 'terrain') canvas.scene.regions.contents = [{ behaviors: { contents: [{ disabled: false }] } }];
    assert.equal(await f.movement.receive(f.data(f.point(mode === 'long' ? 700 : 600)), game.user), false);
    assert.equal(f.prompts[0].choices.some(choice => choice.id === 'step'), false);
    assert.equal(f.calls.some(call => call[0] === 'move'), false);
  }
});

test('path entering and later leaving reach reacts at the threatened square rather than the start', async () => {
  const f = setup(); f.player.document.x = 700;
  let attackX;
  const strike = f.actor.system.actions[0], nativeRoll = strike.variants[0].roll;
  strike.variants[0].roll = async options => { attackX = f.player.document.x; return nativeRoll(options); };
  const points = [f.point(500), f.point(500, 400), f.point(700, 400)];
  // Use a 35-ft stride for this deliberately longer, bent path.
  f.player.actor.system.attributes.speed.total = 35;
  assert.equal(await f.movement.receive(f.data(...points), game.user), true);
  assert.equal(attackX, 500);
  assert.equal(f.calls.filter(call => call[0] === 'attack').length, 1);
});

test('lethal automatic reaction stops the mover in the departure square', async () => {
  const f = setup(); f.player.actor.hitPoints.value = 10;
  assert.equal(await f.movement.receive(f.data(f.point(700)), game.user), false);
  assert.equal(f.player.document.x, 500);
  assert.equal(f.player.actor.hitPoints.value, 0);
  assert.equal(f.calls.some(call => call[0] === 'move'), false);
  assert.equal(f.actor.getFlag(MODULE_ID, 'reaction').uncertain, false);
});

test('automatic NPC roll still waits for the player Shield Block decision and native damage', async () => {
  const f = setup();
  f.player.actor.items.set('shield-block', { id: 'shield-block', type: 'feat', slug: 'shield-block' });
  f.player.actor.attributes.shield = { itemId: 'shield', raised: true, hardness: 5, broken: false, destroyed: false };
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  f.reactions.prompts.ask = async request => {
    f.prompts.push(request); return request.kind === 'movement' ? 'stride' : pending;
  };
  const result = f.movement.receive(f.data(f.point(700)), game.user);
  for (let i = 0; i < 20 && f.prompts.length < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.match(f.prompts[1].title, /Shield Block/);
  assert.equal(f.reactions.barrier.pending, true);
  assert.equal(f.calls.some(call => call[0] === 'move' || call[0] === 'damage-applied'), false);
  release('block'); assert.equal(await result, true);
  assert.equal(f.calls.find(call => call[0] === 'damage-applied')[2].shieldBlockRequest, true);
});

test('owner-authenticated movement rejects other actors, stale positions and changed turns', async () => {
  const f = setup(); const data = f.data(f.point(600));
  await assert.rejects(f.movement.receive(data, { id: 'stranger', active: true }), /do not own/);
  await assert.rejects(f.movement.receive({ ...data, origin: { ...data.origin, x: 0 } }, game.user), /trigger changed/);
  f.combat.round++;
  await assert.rejects(f.movement.receive(data, { id: 'owner', active: true }), /trigger changed/);
  assert.equal(f.calls.some(call => call[0] === 'attack' || call[0] === 'move'), false);
});

test('changing turns or stopping while movement choice is open cannot move or spend a reaction', async () => {
  for (const change of ['turn', 'stop']) {
    const f = setup();
    f.reactions.prompts.ask = async () => { if (change === 'turn') f.combat.round++; else f.movement.cancel(); return 'stride'; };
    assert.equal(await f.movement.receive(f.data(f.point(600)), game.user), false);
    assert.equal(f.calls.some(call => call[0] === 'attack' || call[0] === 'move'), false);
    assert.equal(f.reactions.available(f.boss), true);
  }
});

test('manual reactions preserve the shared ordinary pool and rolls-only configuration', async () => {
  const f = setup();
  f.flags.set(`token-boss:${MODULE_ID}:config`, { enabled: true, applyDamage: false });
  assert.equal(await f.movement.receive(f.data(f.point(600)), game.user), false);
  assert.equal(f.calls.some(call => call[0] === 'damage-roll'), true);
  assert.equal(f.calls.some(call => call[0] === 'damage-applied' || call[0] === 'move'), false);
  assert.match(f.notices[0], /damage manually/);
  assert.equal(f.reactions.available(f.boss), false);
});

test('pre-move hook cancels native drag before any changes, then resolves on authenticated GM', async () => {
  const f = setup();
  const request = { method: 'dragging', origin: f.point(500), passed: { waypoints: [f.point(600)] }, pending: { waypoints: [] } };
  assert.equal(f.movement.intercept(f.player.document, request, { [MANAGED_MOVEMENT]: true }), undefined);
  assert.equal(f.movement.intercept(f.player.document, request), false);
  assert.equal(f.player.document.x, 500);
  for (let i = 0; i < 25 && f.movement.pending.size; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(f.errors, []);
  assert.equal(f.player.document.x, 600);
  assert.equal(f.calls.filter(call => call[0] === 'attack').length, 1);
});

test('walking submitted through the native movement API gets the same pre-departure reaction as dragging', async () => {
  const f = setup();
  const request = { method: 'api', origin: f.point(500), passed: { waypoints: [f.point(600)] }, pending: { waypoints: [] } };
  assert.equal(f.movement.intercept(f.player.document, request), false);
  for (let i = 0; i < 25 && f.movement.pending.size; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.deepEqual(f.errors, []);
  assert.equal(f.player.document.x,600);
  assert.equal(f.calls.filter(call=>call[0]==='attack').length,1);
});

test('a player drag delegates through User.query and sends no arbitrary roll or update instructions', async () => {
  const f = setup(); let request;
  const gm = game.user;
  game.user = { id: 'owner', active: true, isGM: false };
  game.users.activeGM = { ...gm, query: async (name, data) => { request = { name, data }; return false; } };
  const movement = { method: 'keyboard', origin: f.point(500), passed: { waypoints: [f.point(600)] }, pending: { waypoints: [] } };
  assert.equal(f.movement.intercept(f.player.document, movement), false);
  for (let i = 0; i < 25 && f.movement.pending.size; i++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(request.name, MOVEMENT_QUERY);
  assert.equal(request.data.tokenId, 'fighter');
  assert.equal('options' in request.data, false);
  assert.equal(f.player.document.x, 500);
});

test('Stop cancels a queued drag before its delayed GM workflow starts', async () => {
  const f = setup();
  const request = { method: 'dragging', origin: f.point(500), passed: { waypoints: [f.point(600)] }, pending: { waypoints: [] } };
  assert.equal(f.movement.intercept(f.player.document, request), false);
  f.movement.cancel();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(f.prompts.length, 0);
  assert.equal(f.player.document.x, 500);
  assert.equal(f.movement.pending.size, 0);
});

test('swimming, displace, off-turn and out-of-reach manual movement keep their existing workflow', () => {
  for (const mode of ['swim', 'displace', 'off-turn', 'out-of-reach']) {
    const f = setup();
    if (mode === 'off-turn') { f.combat.turn = 0; f.combat.combatant = f.combat.combatants[0]; }
    if (mode === 'out-of-reach') f.player.document.x = 900;
    const origin = f.point(f.player.document.x);
    const request = { method: 'dragging', origin, passed: { waypoints: [{ ...f.point(origin.x + 100),
      action: ['swim', 'displace'].includes(mode) ? mode : 'walk' }] }, pending: { waypoints: [] } };
    assert.equal(f.movement.intercept(f.player.document, request), undefined);
    assert.equal(f.movement.pending.size, 0);
    assert.deepEqual(f.errors, []);
  }
});
