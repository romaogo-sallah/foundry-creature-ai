import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { environmentBetween, coverAlongPath, configureZone, zoneConfig, openZones } from '../src/foundry/environment-zones.mjs';
import { applyEnvironmentCover, concealmentCheck, installEnvironmentRolls } from '../src/foundry/environment-rolls.mjs';
import { MODULE_ID } from '../src/foundry/pf2e-adapter.mjs';
import { TurnRunner } from '../src/framework/turn-runner.mjs';

// Deterministic geometry fixture models the native Region API, including
// elevation. Thin obstacles deliberately fall between grid sample points.
function region(f, { x = 450, y = 100, width = 200, height = 400, cover = 'none', coverMode = 'occupants', concealment = 'none',
  bottom = -Infinity, top = Infinity, levels = [], enabled = true } = {}) {
  const r = { id: `r${canvas.scene.regions.contents.length}`, name: 'Terrain <test>', parent: canvas.scene, levels: new Set(levels),
    flags: { [MODULE_ID]: { environment: { enabled, cover, coverMode, concealment } } },
    getFlag(namespace, key) { return this.flags[namespace]?.[key]; },
    async setFlag(namespace, key, value) { this.flags[namespace][key] = structuredClone(value); },
    testPoint: p => p.x >= x && p.x <= x + width && p.y >= y && p.y <= y + height && p.elevation >= bottom && p.elevation < top,
    segmentizeMovementPath: ([a, b], samples) => {
      assert.deepEqual(samples, [{ x: 0, y: 0 }]);
      let lo = 0, hi = 1;
      for (const [axis, min, max] of [['x', x, x+width], ['y', y, y+height], ['elevation', bottom, top]]) {
        const d = b[axis] - a[axis];
        if (d === 0) { if (a[axis] < min || a[axis] >= max) return []; }
        else { const p=(min-a[axis])/d,q=(max-a[axis])/d;lo=Math.max(lo,Math.min(p,q));hi=Math.min(hi,Math.max(p,q)); }
      }
      const point = t => Object.fromEntries(['x','y','elevation'].map(k=>[k,a[k]+(b[k]-a[k])*t]));
      return hi > lo ? [{ type: 0, from: point(lo), to: point(hi) }] : [];
    } };
  canvas.scene.regions.contents.push(r);return r;
}

test('protected cover is directional and lesser cover cannot enable Hide', () => {
  const f=fixture();const r=region(f,{cover:'standard'});
  let e=environmentBetween(f.boss,f.player);assert.equal(e.coverBonus,2);assert.equal(e.canHide,true);assert.equal(e.stealthBonus,2);
  assert.equal(environmentBetween(f.player,f.boss).coverBonus,0);
  f.boss.document.x=450;assert.equal(environmentBetween(f.boss,f.player).coverBonus,0,'sharing cover is not protection against each other');
  f.boss.document.x=200;r.flags[MODULE_ID].environment.cover='lesser';e=environmentBetween(f.boss,f.player);
  assert.equal(e.coverBonus,1);assert.equal(e.canHide,false);assert.equal(e.stealthBonus,0);
});

test('fog conceals across a thin region, in both directions, and within fog', () => {
  const f=fixture();const r=region(f,{x:401,width:2,concealment:'through'});
  assert.equal(environmentBetween(f.boss,f.player).concealed,true);assert.equal(environmentBetween(f.player,f.boss).flatCheckDC,5);
  r.testPoint=()=>true;assert.equal(environmentBetween(f.boss,f.player).concealed,true);
  r.flags[MODULE_ID].environment.concealment='occupants';r.testPoint=p=>p.x>500;
  assert.equal(environmentBetween(f.boss,f.player).concealed,true);assert.equal(environmentBetween(f.player,f.boss).concealed,false);
});

test('intervening obstacle cover protects across its footprint and does not make solid walls passable', async () => {
  const f=fixture();region(f,{x:401,width:2,cover:'greater',coverMode:'intervening'});
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,4);assert.equal(environmentBetween(f.player,f.boss).coverBonus,4);
  f.boss.checkCollision=()=>true;
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies[0].lineOfEffect,false,'cover never authorizes an attack through a blocking wall');
});

test('regions honor native geometry, elevation, levels, disabled flags and highest non-stacking cover', () => {
  const f=fixture();region(f,{cover:'lesser'});region(f,{cover:'standard'});const high=region(f,{cover:'greater',bottom:10});
  region(f,{cover:'greater',levels:['upstairs']});region(f,{cover:'greater',enabled:false});
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,2);
  high.testPoint=p=>p.x>500;assert.equal(environmentBetween(f.boss,f.player).coverBonus,4);
  high.testPoint=()=>false;high.segmentizeMovementPath=()=>[];
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,2,'a native polygon hole excludes a point');
});

test('region settings need GM authority and stay on the selected scene document', async () => {
  const f=fixture(),r=region(f);const value=await configureZone(r,{enabled:true,cover:'standard',concealment:'through'});
  assert.deepEqual(zoneConfig(r),value);assert.equal(r.behaviors,undefined,'no behavior or surface is added');
  game.user.isGM=false;await assert.rejects(configureZone(r,value),/Only the GM/);game.user.isGM=true;
  await assert.rejects(configureZone({...r,parent:{id:'other'}},value),/viewed scene/);
  await assert.rejects(configureZone(r,{...value,cover:'constructor'}),/Invalid/);
});

test('AI snapshots retain concealed targets and attach cover geometry without mutating their conditions', async () => {
  const f=fixture();region(f,{cover:'standard',concealment:'through'});
  const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.equal(state.enemies[0].awareness.state,'observed');assert.equal(state.enemies[0].lineOfEffect,true);
  assert.equal(state.enemies[0].coverBonus,2);assert.equal(state.enemies[0].concealmentDC,5);
  assert.equal(state.diagnostics.environmentTargets.length,1);
  assert.equal(f.player.actor.hasCondition('concealed'),false);assert.ok(state.moves.length>0,'flag-only zones do not block navigation');
});

test('native cover uses PF2e circumstance stacking and keeps the real AC statistic unchanged', () => {
  const f=fixture();region(f,{cover:'greater'});
  let bonus;
  const parent={clone:({modifiers})=>{bonus=modifiers[0].modifier;return {dc:{value:25+Math.max(2,bonus)}};}};
  game.pf2e.Modifier=class {constructor(data){Object.assign(this,data);}};
  const original={value:27,statistic:{parent}};
  const context={type:'attack-roll',createMessage:true,origin:{token:{object:f.boss}},target:{token:{object:f.player}},dc:original};
  assert.equal(applyEnvironmentCover(context).coverBonus,4);assert.equal(bonus,4);assert.equal(context.dc.value,29);
  assert.equal(original.value,27,'existing AC/shield modifiers remain in the native cloned statistic');
  assert.equal(applyEnvironmentCover({...context,isReroll:true}),null,'rerolls preserve the original DC');
  assert.equal(applyEnvironmentCover({...context,type:'saving-throw'}),null,'area saves are not inferred from a creature token');
});

test('missing contextual AC fails clearly rather than inventing an unstacked defense', () => {
  const f=fixture();region(f,{cover:'standard'});
  assert.throws(()=>applyEnvironmentCover({type:'attack-roll',origin:{token:{object:f.boss}},target:{token:{object:f.player}},dc:{value:20}}),/contextual AC/);
});

function flatRoll(total, beforeMessage) {
  globalThis.Roll=class {constructor(formula){assert.equal(formula,'1d20');}async evaluate(){this.total=total;return this;}async toMessage(data){await beforeMessage?.(data);return data;}};
}

test('concealment rolls exactly one unmodified flat check and awaits its chat before continuing', async () => {
  const f=fixture();region(f,{concealment:'through'});region(f,{concealment:'through'});
  let messages=0;flatRoll(4,async data=>{messages++;assert.equal(data.flags[MODULE_ID].concealment.dc,5);});
  assert.equal(await concealmentCheck(f.boss,f.player),false);assert.equal(messages,1);
  flatRoll(5);assert.equal(await concealmentCheck(f.boss,f.player),true);
  await assert.rejects(concealmentCheck(f.boss,f.player,{valid:()=>false}),/stopped/);
});

test('failed concealment consumes the ogre Strike and MAP without damage or a Sweeping Hook opening', async () => {
  const f=fixture();region(f,{concealment:'through'});flatRoll(1);
  const {strike}=f.adapter.parts();const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2,attacksMade:1};
  const result=await f.adapter.execute({kind:'strike',strikeId:strike.item.id,targetId:f.player.id},ledger);
  assert.equal(result.lastAction.hit,false);assert.equal(result.skipped,undefined);
  assert.equal(f.calls.some(c=>c[0]==='attack'||c[0]==='damage-applied'),false);assert.equal(result.pendingSweep,undefined);
});

test('an entire concealed ogre turn spends its reserved actions once and can advance automatically', async () => {
  const f=fixture();region(f,{concealment:'through'});flatRoll(1);
  f.flags.set(`token-boss:${MODULE_ID}:config`,{...f.adapter.config,autoAdvance:true,entertaining:false});
  const ledger=await new TurnRunner(f.adapter).run();
  assert.equal(ledger.actionsRemaining,0);assert.equal(ledger.uncertain,false);
  assert.equal(f.calls.filter(c=>c[0]==='next-turn').length,1);
  assert.equal(f.calls.some(c=>c[0]==='damage-applied'),false);
});

test('a thrown javelin is consumed even when its concealment check fails', async () => {
  const f=fixture();region(f,{concealment:'through'});flatRoll(2);
  const {hook,javelin,thrown}=f.adapter.parts();await hook.update({'system.equipped.handsHeld':1});
  await javelin.update({'system.equipped.carryType':'held','system.equipped.handsHeld':1});
  const count=javelin.system.quantity,ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2,attacksMade:1};
  const result=await f.adapter.execute({kind:'strike',strikeId:thrown.item.id,targetId:f.player.id},ledger);
  assert.equal(result.lastAction.hit,false);assert.equal(javelin.system.quantity,count-1);
  assert.equal(f.calls.some(c=>c[0]==='attack'),false);
});

test('the cover wrapper resolves manual fog attacks and lets AI resolve its own flat check', async () => {
  const f=fixture();region(f,{concealment:'through'});let wrapper,warnings=0,rolls=0;
  globalThis.libWrapper={register:(id,path,fn)=>{assert.equal(path,'game.pf2e.Check.roll');wrapper=fn;}};
  globalThis.ui={notifications:{info:()=>warnings++}};installEnvironmentRolls();
  const context={type:'attack-roll',origin:{token:{object:f.boss}},target:{token:{object:f.player}},options:new Set()};
  flatRoll(5);await wrapper(()=>rolls++,{},context);assert.equal(warnings,0);
  flatRoll(1);assert.equal(await wrapper(()=>rolls++,{},context),null);assert.equal(warnings,1);assert.equal(rolls,1);
  context.options.add(`${MODULE_ID}:managed`);await wrapper(()=>rolls++,{},context);assert.equal(warnings,1);assert.equal(rolls,2);
});

test('zone controls load selected region values and save only the chosen region', async () => {
  const f=fixture(),first=region(f,{cover:'standard'}),second=region(f,{concealment:'through'});let dialogs=0;
  globalThis.ui={notifications:{info:()=>{}}};
  globalThis.foundry={applications:{api:{DialogV2:{wait:async config=>{
    dialogs++;assert.match(config.content,/Terrain &lt;test&gt;/);
    const action=dialogs===1?'load':'save';const form={elements:Object.fromEntries(Object.entries({region:second.id,cover:'greater',coverMode:'occupants',concealment:'through',firingRadius:'10'}).map(([k,value])=>[k,{value}]))};
    form.elements.enabled={checked:true};return config.buttons.find(b=>b.action===action).callback({}, {form});
  }}}}};
  await openZones(first.id);assert.equal(dialogs,2);assert.equal(zoneConfig(first).cover,'standard');assert.equal(zoneConfig(second).cover,'greater');
});

test('disabled zones retain their editable settings and a Sneak path cannot bridge a cover hole',async()=>{
  const f=fixture(),r=region(f,{x:100,width:350,cover:'standard'});
  await configureZone(r,{enabled:false,cover:'greater',coverMode:'occupants',concealment:'through'});
  assert.equal(zoneConfig(r),null);assert.equal(zoneConfig(r,{includeDisabled:true}).cover,'greater');
  await configureZone(r,{enabled:true,cover:'standard',coverMode:'occupants',concealment:'none'});
  const path=[{x:250,y:250},{x:350,y:250}];
  assert.equal(coverAlongPath(f.player,f.boss,path),2);
  r.segmentizeMovementPath=()=>[{type:-1,from:path[0],to:{x:270,y:250}},{type:1,from:{x:330,y:250},to:path[1]}];
  assert.equal(coverAlongPath(f.player,f.boss,path),0,'endpoint cover alone is not continuous cover');
});
