import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { installEnvironmentRolls } from '../src/foundry/environment-rolls.mjs';
import { environmentBetween } from '../src/foundry/environment-zones.mjs';
import { EnvironmentAwareness, environmentObserver } from '../src/foundry/environment-awareness.mjs';
import { PlayerStealth } from '../src/foundry/player-stealth.mjs';
import { detectionFor } from '../src/foundry/stealth-awareness.mjs';
import { sneakEffects } from '../src/foundry/sneak-mode.mjs';

const ns='foundry-creature-ai';
function setup({cover='none',concealment='through',withPlayerStealth=false}={}) {
  const f=fixture({footprint:1}),wrappers=new Map(),wrapperTypes=new Map(),events=[];
  const region={id:'terrain',name:'Low obstacle',hidden:false,levels:new Set(['ground']),
    flags:{[ns]:{environment:{enabled:true,cover,coverMode:'intervening',concealment}}},
    testPoint:p=>p.x>=400&&p.x<=410&&p.y>=100&&p.y<=400&&p.elevation>=0&&p.elevation<10,
    segmentizeMovementPath:([a,b])=>a.y>=100&&a.y<=400&&b.y>=100&&b.y<=400&&a.elevation>=0&&a.elevation<10&&
      Math.min(a.x,b.x)<400&&Math.max(a.x,b.x)>410?[{from:{x:400,y:250,elevation:2.5},to:{x:410,y:250,elevation:2.5}}]:[]};
  canvas.scene.regions.contents.push(region);
  globalThis.libWrapper={register:(id,path,fn,type)=>{
    assert.equal(id,ns);assert.equal(wrappers.has(path),false,`libWrapper rejects duplicate registration: ${path}`);
    wrapperTypes.set(path,type);
    // Model the libWrapper contract as well as registration uniqueness. A
    // plain WRAPPER may not cancel the native call, even after an async gate.
    wrappers.set(path,function(wrapped,...args){
      let chained=false;
      const next=(...passed)=>{chained=true;return wrapped(...passed);};
      const verify=result=>{if(type==='WRAPPER')assert.ok(chained,`${path}: WRAPPER must continue the chain`);return result;};
      const result=fn.call(this,next,...args);
      return result?.then?result.then(verify):verify(result);
    });
  }};
  globalThis.ui={notifications:{info:message=>events.push(['notice',message])}};
  globalThis.CONFIG={PF2E:{Actor:{documentClasses:{character:class {consumeAmmo(){}}}}}};
  game.pf2e.Modifier=class {constructor(data){Object.assign(this,data);}};
  const playerStealth=withPlayerStealth?new PlayerStealth():null;
  installEnvironmentRolls({playerStealth});
  playerStealth?.installRolls();
  const flat=(total,{message}={})=>{globalThis.Roll=class{
    constructor(formula){assert.equal(formula,'1d20');}
    async evaluate(){events.push(['flat']);this.total=total;return this;}
    async toMessage(data){events.push(['flat-message',data]);await message?.();}
  };};
  const context=(extra={})=>({type:'attack-roll',origin:{token:{object:f.boss}},target:{token:{object:f.player}},
    dc:{value:25,statistic:{parent:{clone:({modifiers})=>({dc:{value:25+Math.max(0,...modifiers.map(m=>m.modifier))}})}}},
    options:new Set(),...extra});
  return {...f,region,events,flat,context,wrappers,wrapperTypes,playerStealth,wrapper:wrappers.get('game.pf2e.Check.roll')};
}

function playerContext(f,extra={}){
  return f.context({action:'strike',origin:{token:{object:f.player}},target:{token:{object:f.boss}},
    dc:{value:25,statistic:{parent:{clone:({modifiers})=>({dc:{value:25+modifiers.reduce((sum,m)=>sum+m.modifier,0)}})}}},...extra});
}
function enablePlayerQueries(f){
  game.user.active=true;game.users.activeGM=game.user;game.messages=new Map();let next=0;
  globalThis.foundry={utils:{randomID:()=>`roll-${++next}`}};
  const native=f.player.actor.getStatistic;
  f.player.actor.getStatistic=slug=>slug==='stealth'?{check:{roll:()=>assert.fail('native Hide must not roll a second time')}}:native(slug);
  game.modules=new Map([[ns,{api:{stealth:{player:f.playerStealth,revealAction:token=>f.playerStealth.request('reveal-action',token)}}}]]);
}

test('one registered Check wrapper resolves native Hide, terrain concealment, hidden Strike AC and revelation in order',async()=>{
  const f=setup({withPlayerStealth:true});enablePlayerQueries(f);f.flat(20);let nativeRolls=0,callbacks=0;
  const hide=playerContext(f,{type:'skill-check',action:'hide',options:new Set()});
  await f.wrapper(async(check,context,event,callback)=>{
    nativeRolls++;assert.equal(context.messageMode,'blind');
    const roll={total:22,dice:[{faces:20,total:15}]};
    const message={id:'hide-message',author:game.user,speaker:{scene:'scene',token:f.player.id},rolls:[roll],
      flags:{pf2e:{context:{type:'skill-check',options:[...context.options]},modifiers:[]}}};
    game.messages.set(message.id,message);await callback(roll,'success',message,event);return roll;
  },{slug:'stealth'},hide,null,async()=>callbacks++);
  assert.equal(detectionFor(f.boss,f.player).state,'hidden');assert.equal(nativeRolls,1);assert.equal(callbacks,1);
  await f.wrapper(async(check,context)=>{
    nativeRolls++;assert.equal(detectionFor(f.boss,f.player).state,'hidden');assert.equal(context.dc.value,23);
    assert.ok(context.options.has('target:condition:off-guard'));return {total:24};
  },{slug:'attack'},playerContext(f));
  assert.equal(detectionFor(f.boss,f.player).state,'observed');assert.equal(nativeRolls,2);
  assert.equal(f.events.filter(event=>event[0]==='flat').length,1);
  assert.equal([...f.wrappers.keys()].filter(path=>path==='game.pf2e.Check.roll').length,1);
});

test('the single roll wrapper starts persistent Sneak without rolling and keeps it after a failed concealment gate',async()=>{
  const f=setup({withPlayerStealth:true});enablePlayerQueries(f);f.flat(1);
  await f.wrapper(()=>assert.fail('Sneak waits for a movement path'),{slug:'stealth'},playerContext(f,{type:'skill-check',action:'sneak'}));
  assert.equal(sneakEffects(f.player.actor).length,1);assert.equal(f.events.some(event=>event[0]==='flat'),false);
  await f.player.document.setFlag(ns,'stealth',{sceneId:'scene',combatId:game.combat.id,moving:false,entries:[{observerId:f.boss.id,state:'hidden'}]});
  assert.equal(await f.wrapper(()=>assert.fail('no Strike after a failed flat check'),{slug:'attack'},playerContext(f)),null);
  assert.equal(detectionFor(f.boss,f.player).state,'observed');assert.equal(sneakEffects(f.player.actor).length,1);
});

test('ordinary targeted weapon/spell attacks receive crossing cover without creating a global condition',async()=>{
  const f=setup({cover:'standard',concealment:'none'});
  for(const type of ['weapon','spell']){
    const context=f.context({item:{type,isOfType:kind=>kind===type}});
    await f.wrapper((check,received)=>{assert.equal(received.dc.value,27);return 'native-attack';},{},context);
    assert.equal(context.dc.value,27);
  }
  assert.equal(f.player.actor.hasCondition('concealed'),false);
  assert.equal(f.calls.some(call=>['create-effects','delete-items'].includes(call[0])),false);
});

test('manual concealment failure awaits its chat and suppresses the attack and hit callback',async()=>{
  const f=setup();let attack=0,callback=0,release;
  const gate=new Promise(resolve=>release=resolve);
  f.flat(4,{message:()=>gate});
  const pending=f.wrapper(()=>attack++,{},f.context(),undefined,()=>callback++);
  await Promise.resolve();await Promise.resolve();assert.equal(attack,0);
  release();assert.equal(await pending,null);assert.equal(attack,0);assert.equal(callback,0);
  assert.equal(f.events.find(e=>e[0]==='flat-message')[1].flags[ns].concealment.manual,true);
  assert.match(f.events.find(e=>e[0]==='notice')[1],/MAP still count/);
});

test('a spent player attack reveals ordinary hiding even when the flat check suppresses its Strike roll',async()=>{
  const f=setup();f.flat(1);let revealed;
  game.modules=new Map([[ns,{api:{stealth:{player:{supports:token=>token===f.player},reveal:async token=>{revealed=token;}}}}]]);
  const context=f.context({action:'strike',origin:{token:{object:f.player}},target:{token:{object:f.boss}}});
  assert.equal(await f.wrapper(()=>assert.fail('no Strike after failed flat check'),{},context),null);
  assert.equal(revealed,f.player);
});

test('a successful manual flat check runs before exactly one native attack; managed attacks do not repeat it',async()=>{
  const f=setup();f.flat(5);
  assert.equal(await f.wrapper(()=>{f.events.push(['attack']);return 99;},{},f.context()),99);
  assert.deepEqual(f.events.map(e=>e[0]),['flat','flat-message','attack']);
  const context=f.context({options:new Set([`${ns}:managed`])});
  await f.wrapper(()=>f.events.push(['managed-attack']),{},context);
  assert.equal(f.events.filter(e=>e[0]==='flat').length,1);
});

test('repeated failed concealment checks keep the mixed hook active for the next successful Strike',async()=>{
  const f=setup({withPlayerStealth:true});enablePlayerQueries(f);let rolls=0;
  assert.equal(f.wrapperTypes.get('game.pf2e.Check.roll'),'MIXED');
  for(const die of [1,4,2]){
    f.flat(die);
    assert.equal(await f.wrapper(()=>{rolls++;return 'attack';},{slug:'attack'},playerContext(f)),null);
  }
  assert.equal(rolls,0);
  f.flat(5);assert.equal(await f.wrapper(()=>{rolls++;return 'attack';},{slug:'attack'},playerContext(f)),'attack');
  assert.equal(rolls,1);assert.equal(f.events.filter(event=>event[0]==='flat').length,4);
  assert.equal(f.wrapperTypes.get('CONFIG.PF2E.Actor.documentClasses.character.prototype.consumeAmmo'),'WRAPPER');
});

test('native character ammunition is spent on a failed flat check without invoking attack callbacks',async()=>{
  const f=setup();f.flat(1);let ammo=3,callback=0;
  const weapon={ammo:{quantity:3},consumeAmmo:async()=>{ammo--;}};
  const options={callback:()=>callback++},ammoWrapper=f.wrappers.get('CONFIG.PF2E.Actor.documentClasses.character.prototype.consumeAmmo');
  ammoWrapper((item,opts)=>{const previous=opts.callback;opts.callback=async(...args)=>{await previous(...args);await item.consumeAmmo();};return true;},weapon,options);
  await f.wrapper(()=>assert.fail('attack must not roll'),{},f.context({item:weapon}),undefined,options.callback);
  assert.equal(ammo,2);assert.equal(callback,0);
  await f.wrapper(()=>assert.fail('attack must not roll'),{},f.context({item:weapon}),undefined,()=>{});
  assert.equal(ammo,2,'a Strike with native ammo consumption disabled must not consume it');
});

test('a consumable weapon is expended once when concealment prevents its attack',async()=>{
  const f=setup();f.flat(2);
  const item={id:'bomb',isOfType:type=>type==='weapon',traits:new Set(['consumable']),quantity:2,
    actor:{items:new Map([['bomb',{}]])},update:async changes=>item.quantity=changes['system.quantity']};
  await f.wrapper(()=>assert.fail('no bomb attack'),{},f.context({item}));assert.equal(item.quantity,1);
});

test('targeted attack-trait skill actions use concealment without adding cover to their skill DC',async()=>{
  const f=setup({cover:'standard'});f.flat(1);
  const context=f.context({type:'skill-check',action:'trip',traits:[{name:'attack'}],dc:{value:22}});
  assert.equal(await f.wrapper(()=>assert.fail('Trip must not roll'),{},context),null);assert.equal(context.dc.value,22);
});

test('area saves, rerolls and formula-only checks bypass the manual flat-check gate',async()=>{
  const f=setup();f.flat(1);let native=0;
  for(const extra of [{type:'saving-throw'},{isReroll:true},{createMessage:false},{type:'flat-check'}])await f.wrapper(()=>native++,{},f.context(extra));
  assert.equal(native,4);assert.equal(f.events.length,0);
});

test('hidden targets use DC 11 and explicit special-sense overrides bypass concealment or cover',async()=>{
  const f=setup({cover:'standard'});f.player.actor.conditionsSet.add('hidden');f.flat(10);
  assert.equal(await f.wrapper(()=>assert.fail('hidden failure'),{},f.context()),null);
  assert.equal(f.events.find(e=>e[0]==='flat-message')[1].flags[ns].concealment.dc,11);
  const context=f.context({options:new Set([`${ns}:ignore-concealment`,`${ns}:ignore-cover`])});
  await f.wrapper(()=>77,{},context);assert.equal(context.dc.value,25);
  assert.equal(f.events.filter(e=>e[0]==='flat').length,1);
});

test('moving a target during the flat check invalidates the pending attack',async()=>{
  const f=setup();f.flat(20,{message:async()=>{f.player.document.y=900;}});
  await assert.rejects(f.wrapper(()=>assert.fail('stale attack'),{},f.context()),/tokens or zones changed/);
});

test('disabling or hiding an intervening region immediately removes its defenses',async()=>{
  const f=setup({cover:'greater'});
  assert.equal(environmentBetween(f.boss,f.player).coverBonus,4);
  f.region.hidden=true;assert.equal(environmentBetween(f.boss,f.player).coverBonus,0);
  f.region.hidden=false;f.region.flags[ns].environment.enabled=false;
  assert.equal(environmentBetween(f.boss,f.player).concealed,false);
});

test('directional token indicators update only affected pairs and tooltip reads do no geometry work',async()=>{
  const f=setup({cover:'standard'}),other=f.addOgre('other',800,200);let queries=0;
  const awareness=new EnvironmentAwareness({query:(...args)=>{queries++;return environmentBetween(...args);}});
  awareness.install();const tooltip=f.wrappers.get('CONFIG.Token.objectClass.prototype._getTooltipText');
  for(const token of canvas.tokens.placeables)token.renderFlags={set:()=>{}};
  await awareness.schedule();assert.equal(queries,2);assert.match(awareness.label(f.player),/Cover \+2/);
  for(let i=0;i<1000;i++)assert.match(tooltip.call(f.player,()=>'5 ft'),/^5 ft\nCover/);
  assert.equal(queries,2,'no geometry work in native tooltip/render reads');
  await Promise.all([awareness.schedule(f.player.id),awareness.schedule(f.player.id)]);assert.equal(queries,3);
  await awareness.schedule(other.id);assert.equal(queries,4);
  await awareness.schedule(f.boss.id);assert.equal(queries,6,'moving the observer refreshes all its pairs');
  canvas.tokens.controlled=[f.player];await awareness.schedule();assert.equal(awareness.observer,f.player);
  assert.equal(awareness.label(f.player),'');assert.match(awareness.label(f.boss),/Cover \+2/);
});

test('indicators clear for ambiguous observers and use an assigned character when none is selected',()=>{
  const f=setup(),awareness=new EnvironmentAwareness();awareness.refresh();assert.notEqual(awareness.label(f.player),'');
  canvas.tokens.controlled=[f.boss,f.player];awareness.refresh();assert.equal(awareness.entries.size,0);
  canvas.tokens.controlled=[];game.user.character=f.player.actor;assert.equal(environmentObserver(),f.player);
  awareness.refresh();assert.equal(awareness.observer,f.player);
});

test('indicators do not reveal invisible tokens and can be disabled per client',()=>{
  const f=setup();let enabled=true,queries=0;
  const awareness=new EnvironmentAwareness({enabled:()=>enabled,query:(...args)=>{queries++;return environmentBetween(...args);}});
  f.player.isVisible=false;awareness.refresh();assert.equal(awareness.label(f.player),'');assert.equal(queries,0);
  f.player.isVisible=true;awareness.refresh();assert.equal(queries,1);
  enabled=false;awareness.refresh();assert.equal(awareness.entries.size,0);assert.equal(queries,1);
});
