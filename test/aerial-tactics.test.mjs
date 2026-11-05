import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture as eagleFixture} from './helpers/eagle-fixture.mjs';
import {fixture as scorpionFixture} from './helpers/manticore-fixture.mjs';
import {fixture as quillFixture,quillData} from './helpers/quill-fixture.mjs';
import {createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {usePlanningWorker} from './helpers/browser-worker.mjs';
import {detectionFor} from '../src/foundry/stealth-awareness.mjs';
import {stealthBelief} from '../src/foundry/stealth-belief.mjs';
usePlanningWorker();
const ns='foundry-creature-ai';
function airborneOpponent(f,{altitude=20,speed=40,width=1,height=5,reach=5}={}){
 const t=f.player;t.document.elevation=altitude;t.document.width=t.document.height=width;t.w=t.h=width*100;
 t.actor.dimensions={height};t.actor.getReach=()=>reach;
 t.actor.system.attributes.speed={value:25,otherSpeeds:[{type:'fly',value:speed}]};
 Object.defineProperty(t,'mechanicalBounds',{configurable:true,get:()=>new PIXI.Rectangle(t.document.x,t.document.y,t.w,t.h)});
 Object.defineProperty(t,'center',{configurable:true,get:()=>({x:t.document.x+t.w/2,y:t.document.y+t.h/2})});
 return createCreatureAdapter(f.boss,null,{reactions:f.reactions});
}
const snapshot=async ai=>ai.snapshot(await ai.readLedger(ai.turnKey()));
function groundFog(f){
 const shape={type:'rectangle',x:100,y:100,width:400,height:400};
 const r={id:'foliage',name:'Low foliage',parent:canvas.scene,elevation:{bottom:0,top:15},levels:['ground'],_source:{shapes:[shape]},
  flags:{[ns]:{environment:{enabled:true,cover:'none',coverMode:'occupants',concealment:'occupants',firingRadius:0}}},
  testPoint:p=>p.x>=100&&p.x<500&&p.y>=100&&p.y<500&&p.elevation>=0&&p.elevation<15};
 canvas.scene.regions.contents.push(r);
 const get=f.actor.getStatistic;f.actor.getStatistic=slug=>{
  const statistic=get(slug);if(slug==='stealth')statistic.check.roll=async options=>{
   f.calls.push(['hide-roll',options]);return {total:7,dice:[{faces:20,total:1}]};};return statistic;
 };
 return r;
}

test('faster eagle fixes a speed-aware setup height and does not raise it when the slower enemy climbs',async()=>{
 const f=eagleFixture({altitude:5}),ai=airborneOpponent(f,{width:2,height:10});
 const before=await snapshot(ai);assert.equal(before.flight.airCombat.mode,'setup');
 assert.ok(before.flight.airCombat.setupElevation>20+10+40*1.5);
 const first=ai.decide(before).chosen;assert.equal(first.features.aerialSetup,true);
 await new TurnRunner(ai).run({oneAction:true});
 const saved=f.boss.document.getFlag(ns,'aerialPlan');assert.equal(saved.setupActions,1);
 f.player.document.elevation+=40;
 const after=await snapshot(ai);assert.equal(after.flight.airCombat.setupElevation,saved.setupElevation);
 assert.equal(after.flight.hunt,undefined,'airborne enemies must not become an ever-rising ground hunting clearance');
});

test('height preparation has a total action budget and turns into an actual Dive and withdrawal',async()=>{
 const f=eagleFixture({altitude:5}),ai=airborneOpponent(f,{width:2,height:10});
 await new TurnRunner(ai).run();
 const plan=f.boss.document.getFlag(ns,'aerialPlan');assert.ok(plan.setupActions>0&&plan.setupActions<=3);
 assert.ok(f.boss.document.elevation>20);assert.equal(f.calls.filter(c=>c[0]==='attack').length,0);
 game.combat.round++;
 const state=await snapshot(ai);assert.equal(ai.decide(state).chosen.kind,'eagleDive');
 await new TurnRunner(ai).run();assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);
 const after=await snapshot(ai);assert.equal(after.flight.airCombat.mode,'engage');
 assert.equal(after.flight.safety.safe,true);assert.equal(f.boss.document.getFlag(ns,'aerialPlan').attackedRound,2);
});

test('a setup budget already spent cannot restart just because the target climbed higher',async()=>{
 const f=eagleFixture({altitude:95}),ai=airborneOpponent(f,{altitude:125,width:2,height:10});
 await f.boss.document.setFlag(ns,'aerialPlan',{combatId:game.combat.id,targetId:f.player.id,setupElevation:100,setupActions:3,attackedRound:null});
 const s=await snapshot(ai);assert.equal(s.flight.airCombat.mode,'engage');
 assert.equal(s.flight.airCombat.setupElevation,100);
 assert.ok(ai.candidates(s).every(c=>!c.features?.aerialSetup));
});

test('a constrained setup Fly still consumes its finite preparation allowance',async()=>{
 const f=eagleFixture({altitude:5}),ai=airborneOpponent(f,{width:2,height:10});
 const state=await snapshot(ai),choice=ai.decide(state).chosen;
 assert.equal(choice.features.aerialSetup,true);
 const ledger=await ai.readLedger(ai.turnKey());
 await ai.recordOutcome(choice,ledger,{resolved:true,movement:{arrived:false,completed:false}});
 assert.equal(f.boss.document.getFlag(ns,'aerialPlan').setupActions,1);
});

test('the observed 215-foot eagle versus 195-foot Large flyer has an attack plan instead of another climb',async()=>{
 const f=eagleFixture({altitude:215}),ai=airborneOpponent(f,{altitude:195,width:2,height:10,reach:10});
 const s=await snapshot(ai),choice=ai.decide(s).chosen;
 assert.equal(choice.kind,'eagleDive');assert.equal(choice.targetId,f.player.id);
 assert.ok(choice.destination.elevation>=195&&choice.destination.elevation<215);
 assert.equal(s.flight.preferredElevation,5);
});

test('a quill Manticore fires at the higher eagle rather than joining an altitude race',async()=>{
 const f=quillFixture({altitude:195}),ai=airborneOpponent(f,{altitude:215,speed:60});
 const before=await snapshot(ai);assert.equal(before.flight.airCombat.mode,'ranged');
 assert.ok(['strike','spikeVolley'].includes(ai.decide(before).chosen.kind));
 await new TurnRunner(ai).run();assert.ok(f.calls.some(c=>c[0]==='attack'));
 assert.equal(f.boss.document.elevation,195);assert.ok(ai.spikesRemaining<12);
});

test('a slower melee flyer descends, lands in real concealment, rolls Hide, and retains only its estimated result',async()=>{
 const f=scorpionFixture({altitude:40}),ai=airborneOpponent(f,{altitude:120,speed:60});groundFog(f);
 const s=await snapshot(ai);assert.equal(s.flight.airCombat.mode,'disengage');
 assert.equal(ai.decide(s).chosen.kind,'fly');
 assert.ok(ai.decide(s).chosen.destination.elevation<40);
 const result=await new TurnRunner(ai).run();assert.equal(result.uncertain,false);
 assert.equal(f.boss.document.elevation,0);assert.ok(f.calls.some(c=>c[0]==='hide-roll'));
 assert.equal(detectionFor(f.player,f.boss).state,'observed','the actual secret Hide failed');
 assert.ok(stealthBelief(f.boss)[0].unseenChance>0,'planning knows a chance, not the secret failed result');
 game.combat.round++;
 const holding=await snapshot(ai);assert.equal(holding.flight.airCombat.mode,'disengage');
 assert.equal(ai.decide(holding).chosen.kind,'endTurn','a hidden-belief creature does not take off or repeat Hide in place');
});

test('without legitimate protection an unreachable flyer is not granted a free Hide or a fake cover destination',async()=>{
 const f=scorpionFixture({altitude:40}),ai=airborneOpponent(f,{altitude:120,speed:60});
 const s=await snapshot(ai);assert.equal(s.flight.airCombat.mode,'engage');
 assert.deepEqual(s.flight.airCombat.coverGoals,[]);assert.ok(ai.candidates(s).every(c=>c.kind!=='hide'));
});

test('native fallback also offers the bounded setup climb and a legal descent into protection',async()=>{
 for(const kind of ['eagle','manticore']){
  const f=(kind==='eagle'?eagleFixture:scorpionFixture)({altitude:kind==='eagle'?5:40});
  const settings=game.settings.get;game.settings.get=(namespace,key)=>key==='flightPlanningBackend'?'native':settings(namespace,key);
  const ai=airborneOpponent(f,{altitude:kind==='eagle'?20:120,speed:kind==='eagle'?40:60});
  if(kind==='manticore')groundFog(f);
  const state=await snapshot(ai),c=ai.decide(state).chosen;
  assert.equal(state.flight.planning.backend,'native');assert.equal(c.kind,'fly');
  assert.ok(kind==='eagle'?c.destination.elevation>5:c.destination.elevation<40);
  assert.ok(c.movementCost<=state.flight.speed);
 }
});

test('two AI-controlled flyers fight across successive turns without an altitude feedback loop',async()=>{
 const f=eagleFixture({altitude:5,attackDegree:1});
 const m=f.makeActor('manticore',quillData);m.alliance='party';f.player.actor=m;f.player.document.actor=m;f.player.document.actorId=m.id;
 const eagle=airborneOpponent(f,{altitude:20,width:2,height:10,reach:10});
 f.player.measureMovementPath=f.boss.measureMovementPath;
 f.flags.set(`token-${f.player.id}:${ns}:config`,{enabled:true,autoAdvance:false,applyDamage:false,pauseForReactions:true,entertaining:false});
 f.flags.get(`token-boss:${ns}:config`).applyDamage=false;
 const manticore=createCreatureAdapter(f.player,null,{reactions:f.reactions});
 for(let round=1;round<=5;round++){
  game.combat.round=round;game.combat.turn=0;game.combat.combatant=game.combat.combatants[0];
  await new TurnRunner(eagle).run();
  game.combat.turn=1;game.combat.combatant=game.combat.combatants[1];
  await new TurnRunner(manticore).run();
 }
 const attacks=f.calls.filter(c=>c[0]==='attack');
 assert.ok(attacks.some(c=>c[1]==='boss'),'the eagle must attack, not merely prepare');
 assert.ok(attacks.some(c=>c[1]==='manticore'),'the manticore must answer with real attacks');
 assert.ok(f.boss.document.elevation<150&&f.player.document.elevation<150,'both cannot keep ratcheting upward');
 assert.ok(eagle.spikesRemaining===undefined&&manticore.spikesRemaining<12);
});
