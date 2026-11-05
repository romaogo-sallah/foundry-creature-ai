import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/ogre-fixture.mjs';
import {actionIntent} from '../src/framework/action-intent.mjs';
import {AIPresentation,registerPresentationSettings,waitForPresentation,applyAIRollPrivacy,applyAIDiceSuppression} from '../src/foundry/ai-presentation.mjs';

const ns='foundry-creature-ai';
function setup(settings={}){
  const f=fixture(),events=[];game.users.activeGM=game.user;
  canvas.hud={bubbles:{broadcast:async(...args)=>events.push(['public',...args]),say:async(...args)=>events.push(['local',...args])}};
  const presentation=new AIPresentation({setting:key=>settings[key],wait:async(ms,options)=>{events.push(['wait',ms]);return !options.signal?.aborted&&options.valid();},onError:error=>events.push(['error',error.message])});
  const frame={adapter:f.adapter,decision:{chosen:{kind:'trip',targetId:f.player.id}},state:{enemies:[{id:f.player.id}]},signal:new AbortController().signal,canContinue:()=>true};
  return {...f,events,presentation,frame};
}

test('world settings enable a readable pace with independent narration and NPC roll privacy',()=>{
  setup();const registered=new Map();game.settings={register:(namespace,key,data)=>{assert.equal(namespace,ns);registered.set(key,data);}};
  registerPresentationSettings();assert.equal(registered.get('actionPause').default,1.5);assert.equal(registered.get('resultPause').default,0.75);
  assert.equal(registered.get('intentAudience').default,'public');assert.deepEqual(Object.keys(registered.get('intentAudience').choices),['public','gm','off']);
  assert.equal(registered.get('aiRollVisibility').default,'default');
  assert.equal(registered.get('suppressAI3DDice').default,false);assert.equal(registered.get('suppressAI3DDice').scope,'world');
});

test('action intent follows actual pack, flank, recovery, retreat and skulk choices without statistics',()=>{
  const wolf=choice=>actionIntent({profileId:'wolf',choice});
  assert.match(wolf({kind:'strike',packAttack:true}),/pack/);assert.match(wolf({kind:'stride',intent:'flank'}),/circles/);
  assert.match(wolf({kind:'knockdown'}),/feet/);assert.match(wolf({kind:'stride',intent:'retreat'}),/way out/);
  assert.match(actionIntent({profileId:'ogre-boss',choice:{kind:'trip'}}),/back.*hook/);
  assert.match(actionIntent({profileId:'kobold-scout',choice:{kind:'hide'}}),/sight/);
  assert.equal(actionIntent({profileId:'wolf',choice:{kind:'endTurn'}}),null);
  assert.doesNotMatch(wolf({kind:'strike'}),/AC|HP|MAP|utility|Dawnsbury|\+\d/);
});

test('narrative variation does not consume randomness used for AI decision ties',t=>{
  setup();t.mock.method(Math,'random',()=>assert.fail('presentation must not change random decision ties'));
  const base={profileId:'wolf',choice:{kind:'strike'}};
  assert.notEqual(actionIntent({...base,state:{attacksMade:0}}),actionIntent({...base,state:{attacksMade:1}}));
});

test('public intentions use native synchronized bubbles before the configured action pause',async()=>{
  const f=setup({intentAudience:'public',actionPause:1.5,resultPause:0.75});
  assert.equal(await f.presentation.beforeAction(f.frame),true);
  assert.deepEqual(f.events.map(event=>event[0]),['public','wait']);
  assert.equal(f.events[0][1],f.boss);assert.deepEqual(f.events[0][3],{requireVisible:true,pan:false});
  assert.equal(f.events[1][1],1500);await f.presentation.afterAction(f.frame);assert.equal(f.events.at(-1)[1],750);
});

test('GM-only intent never uses the public bubble socket and whispers its text to GM recipients',async()=>{
  const f=setup({intentAudience:'gm'});await f.presentation.beforeAction(f.frame);
  assert.equal(f.events.some(event=>event[0]==='public'),false);assert.equal(f.events[0][0],'local');
  const message=f.calls.find(call=>call[0]==='chat')[1];assert.deepEqual(message.whisper,['gm']);assert.equal(message.flags[ns].intent,true);
});

test('GM-hidden and observer-hidden speakers cannot leak their position through public intent bubbles',async()=>{
  for(const kind of ['token-hidden','hidden','undetected','invisible']){
    const f=setup({intentAudience:'public'});
    if(kind==='token-hidden')f.boss.document.hidden=true;
    else if(kind==='invisible')f.actor.conditionsSet.add('invisible');
    else await f.boss.document.setFlag(ns,'stealth',{combatId:'combat',sceneId:'scene',entries:[{observerId:f.player.id,state:kind}]});
    await f.presentation.beforeAction(f.frame);
    assert.equal(f.events.some(event=>event[0]==='public'),false,kind);assert.equal(f.calls.filter(call=>call[0]==='chat').length,1);
  }
});

test('turn changes, pause, scene changes and a GM handoff prevent presentation and action continuation',async()=>{
  for(const change of ['turn','pause','scene','gm']){
    const f=setup({intentAudience:'public',actionPause:1.5});
    if(change==='turn')f.frame.canContinue=()=>false;
    if(change==='pause')game.paused=true;
    if(change==='scene')canvas.scene={id:'other'};
    if(change==='gm')game.users.activeGM={id:'other'};
    assert.equal(await f.presentation.beforeAction(f.frame),false);assert.deepEqual(f.events,[]);
  }
});

test('off disables narration while retaining the requested pause; invalid delays do not block execution',async()=>{
  const f=setup({intentAudience:'off',actionPause:1.5,resultPause:Infinity});
  await f.presentation.beforeAction(f.frame);assert.deepEqual(f.events,[['wait',1500]]);
  await f.presentation.afterAction(f.frame);assert.deepEqual(f.events.at(-1),['wait',0]);
});

test('bubble failures do not consume actions or stop an otherwise valid AI turn',async()=>{
  const f=setup({intentAudience:'public',actionPause:0.5});canvas.hud.bubbles.broadcast=async()=>{throw new Error('render failed');};
  assert.equal(await f.presentation.beforeAction(f.frame),true);assert.deepEqual(f.events,[['error','render failed'],['wait',500]]);
});

test('missing GM recipients cannot turn private intent into a public chat message',async()=>{
  const f=setup({intentAudience:'gm'});ChatMessage.getWhisperRecipients=()=>[];
  assert.equal(await f.presentation.beforeAction(f.frame),true);
  assert.equal(f.calls.some(call=>call[0]==='chat'),false);assert.equal(f.events.some(event=>event[0]==='public'),false);
  assert.match(f.events[0][1],/no GM recipient/);
});

test('presentation wait cancels immediately through Stop instead of waiting out the timer',async()=>{
  const signal=new AbortController();const result=waitForPresentation(5000,{signal:signal.signal});signal.abort();
  assert.equal(await result,false);
  assert.equal(await waitForPresentation(0,{valid:()=>true}),true);assert.equal(await waitForPresentation(0,{valid:()=>false}),false);
});

test('GM-only rolls apply only to managed NPC checks and preserve player and ordinary roll visibility',()=>{
  const f=setup();
  for(const type of ['attack-roll','damage-roll','skill-check','flat-check']){
    const updates=[],message={actor:f.actor,speaker:{token:f.boss.id},flags:{pf2e:{context:{type,options:[`${ns}:managed`]}}},updateSource:update=>updates.push(update)};
    assert.equal(applyAIRollPrivacy(message,'gm'),true);assert.deepEqual(updates,[{whisper:['gm'],blind:true}]);
    message.actor=f.player.actor;assert.equal(applyAIRollPrivacy(message,'gm'),false);assert.equal(updates.length,1);
    message.actor=f.actor;message.flags.pf2e.context.options=[];assert.equal(applyAIRollPrivacy(message,'gm'),false);
    message.flags.pf2e.context.options=[`${ns}:managed`];assert.equal(applyAIRollPrivacy(message,'default'),false);
  }
});

test('AI dice suppression stamps Dice So Nice skip without changing dice, chat visibility or the result',()=>{
  const f=setup(),updates=[],rolls=[{total:24}],message={actor:f.actor,speaker:{scene:'scene',token:f.boss.id},
    flags:{pf2e:{context:{options:[`${ns}:managed`]}}},rolls,whisper:['gm'],blind:true,updateSource:changes=>updates.push(changes)};
  assert.equal(applyAIDiceSuppression(message,true),true);
  assert.deepEqual(updates,[{'flags.dice-so-nice.skip':true}]);assert.equal(message.rolls,rolls);assert.equal(message.rolls[0].total,24);
  assert.deepEqual(message.whisper,['gm']);assert.equal(message.blind,true);
  updates.length=0;assert.equal(applyAIDiceSuppression(message,false),false);assert.deepEqual(updates,[]);
});

test('AI-enabled NPC tokens suppress ordinary rolls too; players and unrelated NPCs keep their animation choice',()=>{
  const f=setup(),updates=[],message={speaker:{scene:'scene',token:f.boss.id},flags:{},updateSource:changes=>updates.push(changes)};
  assert.equal(applyAIDiceSuppression(message,true),true,'the setting follows the controlled actor, not only managed roll markers');
  updates.length=0;message.speaker.token=f.player.id;message.flags={pf2e:{context:{options:[`${ns}:managed`]}}};
  assert.equal(applyAIDiceSuppression(message,true),false);assert.deepEqual(updates,[]);
  message.speaker.token=f.boss.id;message.flags={};f.flags.set(`token-${f.boss.id}:${ns}:config`,{enabled:false});
  assert.equal(applyAIDiceSuppression(message,true),false);assert.deepEqual(updates,[]);
});

test('off-scene speaker resolution uses the actual scene token rather than the viewed canvas',()=>{
  const f=setup(),updates=[],other={id:'other',tokens:{get:id=>id===f.boss.id?{actor:f.player.actor,getFlag:()=>({enabled:true})}:null}};
  game.scenes.get=id=>id==='other'?other:canvas.scene;
  const message={speaker:{scene:'other',token:f.boss.id},flags:{pf2e:{context:{options:[`${ns}:managed`]}}},updateSource:changes=>updates.push(changes)};
  assert.equal(applyAIDiceSuppression(message,true),false);assert.deepEqual(updates,[]);
  other.tokens.get=()=>({actor:f.actor,getFlag:()=>({enabled:true})});
  assert.equal(applyAIDiceSuppression(message,true),true);assert.deepEqual(updates,[{'flags.dice-so-nice.skip':true}]);
});
