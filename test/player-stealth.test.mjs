import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { PlayerStealth, PLAYER_STEALTH_QUERY, HIDDEN_STRIKE, playerSneakSpeed } from '../src/foundry/player-stealth.mjs';
import { ManualMovement } from '../src/foundry/manual-movement.mjs';
import { detectionFor, stealthRecord } from '../src/foundry/stealth-awareness.mjs';
import { combatStamp } from '../src/foundry/reaction-prompts.mjs';
import { MANAGED_MOVEMENT, REQUESTED_MOVEMENT } from '../src/foundry/movement-options.mjs';
import { sneakEffects, setSneakMode } from '../src/foundry/sneak-mode.mjs';

const ns='foundry-creature-ai';
function setup({die=15,answer='sneak'}={}){
  const f=fixture();let next=0;
  game.user.active=true;game.users.activeGM=game.user;game.messages=new Map();
  f.combat.turn=1;f.combat.combatant=f.combat.combatants[1];
  f.player.actor.system.attributes.speed={total:25};f.player.actor.testUserPermission=user=>user.id==='owner';
  const get=f.player.actor.getStatistic;
  f.player.actor.getStatistic=slug=>slug!=='stealth'?get(slug):{check:{modifiers:[],roll:async options=>{
    f.calls.push(['stealth',options]);return {total:die+7,dice:[{faces:20,total:die}]};
  }}};
  canvas.tokens.controlled=[f.player];
  for(const token of canvas.tokens.placeables)token.document.object=token;
  canvas.grid.getDirectPath=points=>{
    const offsets=[canvas.grid.getOffset(points[0])];
    for(const point of points.slice(1)){
      const end=canvas.grid.getOffset(point);let previous=offsets.at(-1);
      while(previous.i!==end.i||previous.j!==end.j){
        previous={i:previous.i+Math.sign(end.i-previous.i),j:previous.j+Math.sign(end.j-previous.j)};offsets.push(previous);
      }
    }
    return offsets;
  };
  const errors=[],notices=[],dialogs=[],wrappers=[];
  globalThis.ui={notifications:{warn:message=>notices.push(message),info:message=>notices.push(message),error:message=>errors.push(message)}};
  globalThis.foundry={utils:{randomID:()=>`id-${++next}`},applications:{api:{DialogV2:{wait:async data=>{dialogs.push(data);return 'hide';}}}}};
  globalThis.libWrapper={register:(...args)=>wrappers.push(args)};
  globalThis.CONFIG={queries:{}};
  const controller=new PlayerStealth({onError:error=>errors.push(error.message)});
  f.reactions.automaticReactiveStrike=()=>false;
  f.reactions.prompts.ask=async request=>{f.prompts.push(request);return answer;};
  const movement=new ManualMovement(f.reactions,{playerStealth:controller,enabled:()=>false,onError:error=>errors.push(error.message)});
  const point=(x,y=f.player.document.y)=>({x,y,elevation:0,level:'ground',action:'walk'});
  const data=(...points)=>({sceneId:'scene',tokenId:f.player.id,origin:point(f.player.document.x),path:[point(f.player.document.x),...points],stamp:combatStamp(),expires:Date.now()+120000});
  const rollWrapper=()=>controller.wrapRoll.bind(controller);
  return {...f,controller,movement,point,data,errors,notices,dialogs,rollWrapper};
}
function fog({left=450,right=850}={}){
  const region={id:'fog',parent:canvas.scene,flags:{[ns]:{environment:{enabled:true,cover:'none',coverMode:'occupants',concealment:'occupants'}}},
    testPoint:p=>p.x>=left&&p.x<=right&&p.y>=100&&p.y<=600,
    segmentizeMovementPath:()=>[]};
  canvas.scene.regions.contents.push(region);return region;
}
async function hidden(f){
  await f.player.document.setFlag(ns,'stealth',{combatId:f.combat.started?f.combat.id:null,sceneId:'scene',moving:false,
    entries:canvas.tokens.placeables.filter(t=>t.actor.type==='npc').map(token=>({observerId:token.id,state:'hidden',knownPosition:{x:500,y:200,elevation:0,level:'ground'}}))});
}
const state=f=>detectionFor(f.boss,f.player).state;
const perception=observer=>observer.document.getFlag(ns,'perception');

test('one secret Hide roll yields different enemy results and saves both sides without global Hidden',async()=>{
  const f=setup();fog();const second=f.addOgre('watcher');second.actor.perception={dc:{value:35}};
  await f.controller.request('hide');
  assert.equal(state(f),'hidden');assert.equal(detectionFor(second,f.player).state,'observed');
  assert.deepEqual(perception(f.boss).entries.map(e=>[e.subjectId,e.state]),[['fighter','hidden']]);
  assert.deepEqual(perception(second).entries.map(e=>[e.subjectId,e.state]),[['fighter','observed']]);
  assert.equal(f.calls.filter(c=>c[0]==='stealth').length,1);
  const options=f.calls.find(c=>c[0]==='stealth')[1];
  assert.ok(options.extraRollOptions.includes('secret'));assert.ok(options.extraRollOptions.includes('skip-handling-message'));
  assert.equal(f.player.actor.hasCondition('hidden'),false);
});

test('hiding in the open cannot create Hidden; an already hidden character does not lose it on failed Hide',async()=>{
  const f=setup({die:1});await f.controller.request('hide');assert.equal(state(f),'observed');
  fog();await hidden(f);await f.controller.request('hide');assert.equal(state(f),'hidden');
});

test('concurrent character mirrors preserve each character in the shared enemy record',async()=>{
  const f=setup();fog();const other=f.token('other',f.makeActor('other',{type:'character',name:'Ally',system:{traits:{size:{value:'med'}},details:{level:{value:1}},attributes:{hp:{value:20,max:20}}}}),600,200);
  f.combat.combatants.push({tokenId:other.id,sceneId:'scene'});
  await hidden(f);await other.document.setFlag(ns,'stealth',{combatId:'combat',sceneId:'scene',moving:false,entries:[{observerId:f.boss.id,state:'hidden'}]});
  await Promise.all([f.controller.mirror(f.player),f.controller.mirror(other)]);
  assert.deepEqual(perception(f.boss).entries.map(e=>e.subjectId).sort(),['fighter','other']);
});

test('native sheet Hide rolls once, preserves the native callback, and validates the persisted blind message',async()=>{
  const f=setup();fog();const wrapper=f.rollWrapper();let rolled=0,callback=0;
  const context={origin:{token:f.player.document},type:'skill-check',action:'hide',options:new Set()};
  const native=async(check,ctx,event,cb)=>{
    rolled++;assert.equal(ctx.messageMode,'blind');assert.ok(ctx.options.has('secret'));
    const roll={total:22,dice:[{faces:20,total:15}]};
    const message={id:'native-message',author:game.user,speaker:{scene:'scene',token:'fighter'},rolls:[roll],flags:{pf2e:{context:{type:'skill-check',options:[...ctx.options]},modifiers:[]}}};
    game.messages.set(message.id,message);await cb(roll,'success',message,event);return roll;
  };
  const result=await wrapper(native,{slug:'stealth'},context,null,async()=>callback++);
  assert.equal(result.total,22);assert.equal(rolled,1);assert.equal(callback,1);
  assert.equal(f.calls.some(c=>c[0]==='stealth'),false,'the GM reuses the genuine sheet roll');
  assert.equal(state(f),'hidden');
});

test('native Hide rejects unvalidated messages and never accepts an arbitrary supplied total',async()=>{
  const f=setup();fog();
  await assert.rejects(f.controller.request('resolve-hide-roll',f.player,{messageId:'missing',nonce:'fake',total:100}),/validate/);
  assert.equal(stealthRecord(f.player),null);assert.equal(perception(f.boss),undefined);
});

test('player queries authenticate ownership, stale scenes, origin, combat and expiry',async()=>{
  const f=setup();f.controller.install();const receive=CONFIG.queries[PLAYER_STEALTH_QUERY];
  const request={action:'hide',sceneId:'scene',tokenId:'fighter',origin:f.point(500),stamp:combatStamp(),expires:Date.now()+120000,requestId:'request'};
  await assert.rejects(receive(request,{user:{id:'stranger',active:true}}),/do not own/);
  await assert.rejects(receive({...request,origin:{...request.origin,x:100}},{user:{id:'owner',active:true}}),/stale/);
  await assert.rejects(receive({...request,stamp:'old'},{user:{id:'owner',active:true}}),/stale/);
  await assert.rejects(receive({...request,expires:Date.now()-1},{user:{id:'owner',active:true}}),/stale/);
  await assert.rejects(receive({...request,sceneId:'elsewhere'},{user:{id:'owner',active:true}}),/do not own/);
  fog();await receive(request,{user:{id:'owner',active:true}});await receive(request,{user:{id:'owner',active:true}});
  assert.equal(f.calls.filter(c=>c[0]==='stealth').length,1,'duplicate transport request does not reroll');
});

test('plain Stealth asks its purpose and sheet Sneak arms movement without rolling prematurely',async()=>{
  const f=setup();const wrapper=f.rollWrapper();let rolls=0;
  foundry.applications.api.DialogV2.wait=async data=>{f.dialogs.push(data);return 'sneak';};
  assert.equal(await wrapper(async()=>{rolls++;},{slug:'stealth'},{type:'skill-check',token:f.player.document,options:[]}),null);
  assert.equal(rolls,0);assert.equal(f.controller.armed(f.player),true);assert.equal(f.dialogs.length,1);
  assert.deepEqual(f.dialogs[0].buttons.map(b=>b.action),['hide','sneak','roll']);
});

test('sheet Sneak keeps consecutive moves sneaking without a purpose or movement popup, with one roll per action',async()=>{
  const f=setup();fog();await hidden(f);const wrapper=f.rollWrapper();
  await wrapper(()=>assert.fail('Sneak waits for its movement path'),{slug:'stealth'},
    {type:'skill-check',action:'sneak',token:f.player.document,options:new Set(['action:sneak'])});
  assert.equal(f.controller.armed(f.player),true);
  assert.equal(f.dialogs.length,0);
  assert.equal(f.calls.some(call=>call[0]==='stealth'),false);
  assert.equal(await f.movement.receive(f.data(f.point(600)),game.user),true);
  assert.equal(f.prompts.length,0,'the declared Sneak skips the movement choice');
  assert.equal(f.calls.filter(call=>call[0]==='stealth').length,1);
  assert.equal(f.controller.armed(f.player),true,'the visible mode persists after moving');
  assert.equal(await f.movement.receive(f.data(f.point(700)),game.user),true);
  assert.equal(f.prompts.length,0,'later moves still use the chosen Sneak mode');
  assert.equal(f.calls.filter(call=>call[0]==='stealth').length,2,'each Sneak action rolls separately');
  assert.equal(sneakEffects(f.player.actor).length,1);
});

test('ordinary Stealth and cancelled purpose prompts preserve their native/manual behavior',async()=>{
  const f=setup(),wrapper=f.rollWrapper();let rolls=0;
  const native=async()=>{rolls++;return 'native-roll';},context={type:'skill-check',token:f.player.document,options:[]};
  foundry.applications.api.DialogV2.wait=async()=>null;
  assert.equal(await wrapper(native,{slug:'stealth'},context),null);assert.equal(rolls,0);
  foundry.applications.api.DialogV2.wait=async()=> 'roll';
  assert.equal(await wrapper(native,{slug:'stealth'},context),'native-roll');assert.equal(rolls,1);
});

test('Swift and Legendary Sneak allow full prepared ground Speed',()=>{
  const f=setup();assert.equal(playerSneakSpeed(f.player.actor),12.5);
  f.player.actor.items.set('swift',{type:'feat',slug:'swift-sneak'});assert.equal(playerSneakSpeed(f.player.actor),25);
  f.player.actor.items.set('swift',{type:'feat',slug:'legendary-sneak'});assert.equal(playerSneakSpeed(f.player.actor),25);
});

test('native path cost includes alternating diagonals in the half-Speed budget',async()=>{
  for(const swift of [false,true]){
    const f=setup();fog();await hidden(f);
    if(swift)f.player.actor.items.set('swift',{type:'feat',slug:'swift-sneak'});
    const completed=await f.movement.receive(f.data(f.point(700,400)),game.user);
    assert.equal(completed,swift);assert.equal(f.prompts[0].choices.some(c=>c.id==='sneak'),swift);
  }
});

test('player movement offers Stride, Sneak and Step even with automated reactions disabled',async()=>{
  const f=setup();fog();await hidden(f);
  assert.equal(await f.movement.receive(f.data(f.point(600)),game.user),true);
  assert.deepEqual(f.prompts[0].choices.map(c=>c.id),['stride','sneak','step']);
  assert.equal(state(f),'undetected');assert.equal(f.player.document.x,600);
  assert.equal(stealthRecord(f.player).moving,false);assert.equal(perception(f.boss).entries[0].knownPosition.x,500);
  assert.equal(f.calls.filter(c=>c[0]==='stealth').length,1);
});

test('Sneak result is present before each movement step, with failure Hidden and critical failure Observed',async()=>{
  for(const [die,expected]of [[15,'undetected'],[8,'hidden'],[1,'observed']]){
    const f=setup({die});fog();await hidden(f);let during;
    const move=f.player.document.move;f.player.document.move=async(...args)=>{during=state(f);return move(...args);};
    assert.equal(await f.movement.receive(f.data(f.point(600)),game.user),true);
    assert.equal(during,expected);assert.equal(state(f),expected);assert.equal(f.calls.filter(c=>c[0]==='stealth').length,1);
  }
});

test('Sneak cannot grant detection protection against an enemy who observed the character at the start',async()=>{
  const f=setup();fog();await f.movement.receive(f.data(f.point(600)),game.user);assert.equal(state(f),'observed');
});

test('Sneak ends Observed without endpoint protection, except for Legendary Sneak',async()=>{
  for(const legendary of [false,true]){
    const f=setup();fog({right:580});await hidden(f);
    if(legendary)f.player.actor.items.set('legendary',{type:'feat',slug:'legendary-sneak'});
    await f.movement.receive(f.data(f.point(600)),game.user);
    assert.equal(state(f),legendary?'undetected':'observed');
  }
});

test('a zone-generated Concealed icon cannot authorize an uncovered Sneak endpoint',async()=>{
  const f=setup();fog({right:580});await hidden(f);
  f.player.actor.conditionsSet.add('concealed');
  f.player.actor.getCondition=()=>[{type:'condition',slug:'concealed',flags:{[ns]:{zoneConcealment:{source:'zone-concealment'}}}}];
  await f.movement.receive(f.data(f.point(600)),game.user);
  assert.equal(state(f),'observed');
});

test('invisibility retains Hidden after a critically failed Sneak',async()=>{
  const f=setup({die:1});f.player.actor.conditionsSet.add('invisible');
  await f.movement.receive(f.data(f.point(600)),game.user);assert.equal(state(f),'hidden');
});

test('half-Speed budget omits Sneak for a long path and rejects a forged choice without moving or rolling',async()=>{
  const f=setup();fog();await hidden(f);
  assert.equal(await f.movement.receive(f.data(f.point(800)),game.user),false);
  assert.equal(f.prompts[0].choices.some(c=>c.id==='sneak'),false);
  assert.equal(f.player.document.x,500);assert.equal(f.calls.some(c=>c[0]==='stealth'),false);
});

test('armed Sneak skips the duplicate movement prompt, but an excessive path is rejected without movement',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');
  await assert.rejects(f.movement.receive(f.data(f.point(800)),game.user),/Sneak path exceeds/);
  assert.equal(f.controller.armed(f.player),true);assert.equal(f.calls.some(c=>c[0]==='stealth'),false);
  assert.equal(await f.movement.receive(f.data(f.point(600)),game.user),true);
  assert.equal(f.prompts.length,0);assert.equal(f.controller.armed(f.player),true);
});

test('Sneak creates one removable native effect with a token icon without changing prepared Speed or granting Hidden',async()=>{
  const f=setup();await Promise.all([setSneakMode(f.player,true),setSneakMode(f.player,true)]);
  const effects=sneakEffects(f.player.actor);assert.equal(effects.length,1);assert.equal(effects[0].name,'Sneak');
  assert.equal(effects[0].system.tokenIcon.show,true);assert.equal(effects[0].system.duration.unit,'unlimited');
  assert.deepEqual(effects[0].system.rules,[]);assert.equal(f.player.actor.system.attributes.speed.total,25);
  assert.equal(f.player.actor.hasCondition('hidden'),false);assert.equal(f.controller.armed(f.player),true);
});

test('persistent Sneak rechecks Swift Sneak when feats change between moves',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');
  await assert.rejects(f.movement.receive(f.data(f.point(800)),game.user),/Sneak path exceeds/);
  f.player.actor.items.set('swift',{type:'feat',slug:'swift-sneak'});
  assert.equal(await f.movement.receive(f.data(f.point(800)),game.user),true);
  f.player.actor.items.delete('swift');
  await assert.rejects(f.movement.receive(f.data(f.point(1100)),game.user),/Sneak path exceeds/);
  assert.equal(f.controller.armed(f.player),true);assert.equal(f.player.document.x,800);
});

test('persistent Sneak rechecks Legendary Sneak instead of keeping an old cover exemption',async()=>{
  const f=setup();await hidden(f);f.player.actor.items.set('legendary',{type:'feat',slug:'legendary-sneak'});
  await f.controller.request('arm-sneak');await f.movement.receive(f.data(f.point(600)),game.user);
  assert.equal(state(f),'undetected');f.player.actor.items.delete('legendary');
  await f.movement.receive(f.data(f.point(700)),game.user);
  assert.equal(state(f),'observed');assert.equal(f.controller.armed(f.player),true);
});

test('linked tokens share one Sneak effect and clear all old pending flags before owner removal',async()=>{
  const f=setup();const other=f.token('linked',f.player.actor,700,200);
  await f.player.document.setFlag(ns,'sneakNextMove',true);await other.document.setFlag(ns,'sneakNextMove',true);
  await Promise.all([setSneakMode(f.player,true),setSneakMode(other,true)]);
  assert.equal(sneakEffects(f.player.actor).length,1);assert.equal(other.document.getFlag(ns,'sneakNextMove'),false);
  await setSneakMode(other,false);assert.equal(f.controller.armed(f.player),false);assert.equal(f.controller.armed(other),false);
});

test('owners can stop Sneak by removing its effect without instantly revealing their character',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');
  await f.player.actor.deleteEmbeddedDocuments('Item',sneakEffects(f.player.actor).map(effect=>effect.id));
  assert.equal(f.controller.armed(f.player),false);assert.equal(state(f),'hidden');
  assert.equal(f.player.document.getFlag(ns,'sneakNextMove')??false,false);
  await f.controller.refresh();assert.equal(sneakEffects(f.player.actor).length,0,'refresh never restores a removed mode');
});

test('Stop Sneak preserves detection and unrelated effects; explicit Reveal stops the mode and reveals',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');
  f.player.actor.items.set('other',{id:'other',type:'effect',name:'Sneak',system:{rules:[]},flags:{}});
  await f.controller.request('stop-sneak');assert.equal(f.controller.armed(f.player),false);assert.equal(state(f),'hidden');
  assert.ok(f.player.actor.items.has('other'));
  await f.controller.request('arm-sneak');await f.controller.request('reveal');
  assert.equal(f.controller.armed(f.player),false);assert.equal(state(f),'observed');assert.ok(f.player.actor.items.has('other'));
});

test('an attack reveals the character while preserving their chosen Sneak mode',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');const wrapper=f.rollWrapper();
  await wrapper(async()=>({total:22}),{slug:'attack'},{type:'attack-roll',action:'strike',token:f.player.document,options:[]});
  assert.equal(state(f),'observed');assert.equal(f.controller.armed(f.player),true);
});

test('the old pending flag migrates once to a visible effect, and deleting it cannot reactivate Sneak',async()=>{
  const f=setup();await f.player.document.setFlag(ns,'sneakNextMove',true);
  await f.controller.refresh();assert.equal(sneakEffects(f.player.actor).length,1);
  assert.equal(f.player.document.getFlag(ns,'sneakNextMove'),false);
  await f.player.actor.deleteEmbeddedDocuments('Item',sneakEffects(f.player.actor).map(effect=>effect.id));
  await f.controller.refresh();assert.equal(f.controller.armed(f.player),false);
});

test('expired owned Sneak effects do not activate the mode and are replaced when explicitly enabled',async()=>{
  const f=setup();await f.controller.request('arm-sneak');const effect=sneakEffects(f.player.actor)[0];effect.isExpired=true;
  assert.equal(f.controller.armed(f.player),false);await f.controller.request('arm-sneak');
  assert.equal(sneakEffects(f.player.actor).length,1);assert.equal(f.controller.armed(f.player),true);
});

test('removing Sneak during a secret roll cancels movement without recreating the effect',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');
  f.player.actor.getStatistic=()=>({check:{roll:async()=>{
    await f.player.actor.deleteEmbeddedDocuments('Item',sneakEffects(f.player.actor).map(effect=>effect.id));
    return {total:22,dice:[{faces:20,total:15}]};
  }}});
  await assert.rejects(f.movement.receive(f.data(f.point(600)),game.user),/changed while Stealth/);
  assert.equal(f.player.document.x,500);assert.equal(f.controller.armed(f.player),false);
});

test('removing Sneak after one square stops the remaining path and finalizes its actual endpoint',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');
  const move=f.player.document.move;f.player.document.move=async(...args)=>{
    const result=await move(...args);await f.player.actor.deleteEmbeddedDocuments('Item',sneakEffects(f.player.actor).map(effect=>effect.id));return result;
  };
  assert.equal(await f.movement.receive(f.data(f.point(700)),game.user),false);
  assert.equal(f.player.document.x,600);assert.equal(f.controller.armed(f.player),false);
  assert.equal(stealthRecord(f.player).moving,false);assert.equal(f.calls.filter(c=>c[0]==='stealth').length,1);
});

test('cancelled Stealth roll leaves the token in place and keeps Sneak armed',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.request('arm-sneak');
  f.player.actor.getStatistic=()=>({check:{roll:async()=>null}});
  await assert.rejects(f.movement.receive(f.data(f.point(600)),game.user),/cancelled/);
  assert.equal(f.player.document.x,500);assert.equal(f.controller.armed(f.player),true);assert.equal(state(f),'hidden');
});

test('interrupted Sneak resolves the actual covered stopping square with the same roll',async()=>{
  const f=setup();fog({right:580});await hidden(f);
  f.player.document.move=async()=>false;
  assert.equal(await f.movement.receive(f.data(f.point(600)),game.user),false);
  assert.equal(f.player.document.x,500);assert.equal(state(f),'undetected');assert.equal(stealthRecord(f.player).moving,false);
  assert.equal(f.calls.filter(c=>c[0]==='stealth').length,1);
});

test('Step retains covered Hidden and updates its known square; Stride reveals before moving',async()=>{
  for(const answer of ['step','stride']){
    const f=setup({answer});fog();await hidden(f);let during;
    const move=f.player.document.move;f.player.document.move=async(...args)=>{during=state(f);return move(...args);};
    await f.movement.receive(f.data(f.point(600)),game.user);
    assert.equal(during,answer==='step'?'hidden':'observed');
    assert.equal(perception(f.boss).entries[0].state,answer==='step'?'hidden':'observed');
    if(answer==='step')assert.equal(perception(f.boss).entries[0].knownPosition.x,600);
    assert.equal(f.calls.some(c=>c[0]==='stealth'),false);
  }
});

test('observer movement persists a revelation so old Hidden cannot return when cover returns',async()=>{
  const f=setup();fog();await hidden(f);await f.controller.mirror(f.player);
  canvas.scene.regions.contents=[];await f.controller.refresh();
  assert.equal(stealthRecord(f.player).entries[0].state,'observed');assert.equal(perception(f.boss).entries[0].state,'observed');
  fog();assert.equal(state(f),'observed');
});

test('movement hooks do not reconcile provisional Sneak results before its endpoint',async()=>{
  const f=setup();await hidden(f);const saved=stealthRecord(f.player);await f.player.document.setFlag(ns,'stealth',{...saved,moving:true,entries:saved.entries.map(e=>({...e,state:'undetected'}))});
  await f.controller.refresh();assert.equal(stealthRecord(f.player).moving,true);assert.equal(state(f),'undetected');
});

test('Strike reveals after rolling; spell attacks and other action checks reveal before rolling',async()=>{
  for(const [type,action,expected]of [['attack-roll','strike','hidden'],['attack-roll','spell-attack-roll','observed'],['skill-check','trip','observed']]){
    const f=setup();fog();await hidden(f);const wrapper=f.rollWrapper();let during;
    await wrapper(async()=>{during=state(f);return {total:22};},{slug:'attack'},{type,action,token:f.player.document,options:[]});
    assert.equal(during,expected);assert.equal(state(f),'observed');assert.equal(perception(f.boss).entries[0].state,'observed');
  }
});

test('damage retains only its saved hidden Strike off-guard predicate after the attacker reveals',async()=>{
  const f=setup();let rolled;
  const strike={damage:async options=>{rolled=options;return 'damage';},critical:async options=>{rolled=options;return 'critical';}};
  f.controller.prepareDamage(strike);
  assert.equal(await strike.damage({checkContext:{options:[HIDDEN_STRIKE]},options:['damage']}),'damage');
  assert.ok(rolled.options.has('target:condition:off-guard'));assert.ok(rolled.options.has('damage'));
  assert.equal(f.player.actor.hasCondition('off-guard'),false);
  await strike.critical({checkContext:{options:[]},options:['damage']});
  assert.deepEqual(rolled.options,['damage'],'a later ordinary Strike cannot inherit the previous bonus');
  await strike.damage({getFormula:true,checkContext:{options:[HIDDEN_STRIKE]},options:[]});assert.deepEqual(rolled.options,[]);
});

test('outside combat player Hide/Sneak still use separate scene observer results',async()=>{
  const f=setup();game.combat=null;fog();await f.controller.request('hide');assert.equal(state(f),'hidden');
  assert.equal(stealthRecord(f.player).combatId,null);
  assert.equal(await f.movement.receive(f.data(f.point(600)),game.user),true);assert.equal(state(f),'undetected');
  assert.equal(perception(f.boss).combatId,null);
});

test('native hazard checkpoints do not replace the original snapped player movement request',async()=>{
  const f=setup({answer:'stride'});fog();
  const initial=[f.point(500),f.point(600)];
  const movement={method:'dragging',origin:initial[0],passed:{waypoints:[f.point(542.4)]},pending:{waypoints:[]}};
  assert.equal(f.movement.intercept(f.player.document,movement,{[MANAGED_MOVEMENT]:true}),undefined);
  assert.equal(f.movement.intercept(f.player.document,movement,{[REQUESTED_MOVEMENT]:initial}),false);
  for(let i=0;i<30&&f.movement.pending.size;i++)await new Promise(resolve=>setTimeout(resolve,1));
  assert.deepEqual(f.errors,[]);assert.equal(f.player.document.x,600);assert.equal(f.prompts.length,1);
});
