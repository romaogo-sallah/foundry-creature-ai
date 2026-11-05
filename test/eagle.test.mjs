import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/eagle-fixture.mjs';
import {creatureProfile,createCreatureAdapter} from '../src/foundry/creature-profiles.mjs';
import {flightStepCost} from '../src/foundry/flight-costs.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {resolveFlightFall} from '../src/foundry/flight-falling.mjs';
import {flightThreats,flightSafety} from '../src/foundry/flight-safety.mjs';
const ns='foundry-creature-ai';
test('the supplied Eagle binds native Beak, agile Talon, 60-foot flight and two-action Dive',()=>{
 const f=fixture();assert.equal(creatureProfile(f.actor).id,'eagle');
 const parts=f.adapter.parts();assert.equal(parts.talon.item.name,'Talon');assert.equal(parts.dive.actionCost.value,2);
 assert.equal(parts.unsupported.length,0);assert.equal(parts.talon.variants[1].penalty,-4);
 assert.equal(createCreatureAdapter(f.boss).profileId,'eagle');
});
test('saved behavior choices from the ground-only fallback adopt the intrinsic flight capability',async()=>{
 const f=fixture();
 f.flags.set('token-boss:foundry-creature-ai:behaviors',{components:['recovery','movement','strikes']});
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions}),state=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
 assert.ok(state.behavior.configuration.components.includes('flight'));
 assert.ok(state.behavior.configuration.components.includes('diving'));
 assert.equal(adapter.decide(state).chosen.kind,'fly');
});
test('flight cost adds difficult terrain upward, discounts only straight downward, and preserves terrain costs',()=>{
 const from={i:0,j:0,k:0};
 assert.equal(flightStepCost(5,from,{i:0,j:0,k:1},5),10);
 assert.equal(flightStepCost(10,from,{i:1,j:0,k:1},10),15,'alternating uphill diagonal adds five, rather than doubling');
 assert.equal(flightStepCost(15,from,{i:1,j:0,k:1},10),15,'difficulty is not stacked twice');
 assert.equal(flightStepCost(5,from,{i:0,j:0,k:-1},5),2.5);
 assert.equal(flightStepCost(2.5,from,{i:0,j:0,k:-1},5),2.5,'another provider already applying the discount is not halved again');
 assert.equal(flightStepCost(5,from,{i:1,j:0,k:-1},5),5);
 assert.equal(flightStepCost(Infinity,from,{i:0,j:0,k:-1},5),Infinity);
});
test('the complete controller first stages at altitude, then attacks and escapes on the next turn',async()=>{
 const f=fixture();f.player.document.x=1000;
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const ledger=await adapter.readLedger(adapter.turnKey()),state=await adapter.snapshot(ledger);
 const offered=adapter.candidates(state);
 assert.ok(!offered.some(c=>['stride','step','crawl'].includes(c.kind)));
 assert.equal(adapter.decide(state).chosen.kind,'fly');
 const result=await new TurnRunner(adapter).run();
 assert.equal(result.done,true);assert.equal(result.uncertain,false);
 assert.equal(f.calls.some(c=>c[0]==='attack'),false,'the opening turn builds a hunting position');
 assert.ok(f.boss.document.elevation>=15,'the Eagle finishes above the known threat height and reach');
 const moves=f.calls.filter(c=>c[0]==='move');assert.ok(moves.length);
 assert.ok(moves.every(c=>c[2].every(p=>p.action==='fly')));
 game.combat.round++;
 assert.equal(adapter.decide(await adapter.snapshot(await adapter.readLedger(adapter.turnKey()))).chosen.kind,'eagleDive');
 const next=await new TurnRunner(adapter).run();
 assert.equal(next.uncertain,false);assert.ok(f.calls.some(c=>c[0]==='attack'));
 assert.ok(f.boss.document.elevation>=15);
});
test('a grounded Eagle gets 3D flight routes including ascent and approach',async()=>{
 const f=fixture(),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 assert.equal(state.flight.speed,60);assert.ok(state.flight.moves.some(move=>move.elevation>=10));
 assert.ok(f.adapter.candidates(state).some(c=>c.kind==='fly'));assert.equal(f.calls.length,0,'preview has no rolls, moves or resource mutations');
});
test('an airborne Eagle can see ground targets, reserves its last action for Fly and cannot Stride in midair',async()=>{
 const f=fixture({altitude:15}),ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1};
 const state=await f.adapter.snapshot(ledger);assert.equal(state.enemies.length,1);assert.equal(state.moves.length,0);
 const choice=f.adapter.decide(state).chosen;
 assert.equal(choice.kind,'fly');assert.ok(choice.destination.elevation>=15);
 await f.adapter.saveLedger(ledger);
 const result=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(result.actionsRemaining,0);
 assert.equal(f.boss.document.getFlag(ns,'flight').round,game.combat.round);
});
test('Eagle Dive requires a ten-foot descent and executes movement before one native agile Talon Strike',async()=>{
 const f=fixture({altitude:15}),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 const dive=f.adapter.candidates(state).find(c=>c.kind==='eagleDive');assert.ok(dive);
 assert.ok(dive.path[0].elevation-dive.destination.elevation>=10);assert.equal(dive.actionCost,2);assert.equal(dive.mapIncreases,1);
 f.adapter.decide=s=>({chosen:f.adapter.candidates(s).find(c=>c.id===dive.id),diagnostics:s.diagnostics});
 const result=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(result.actionsRemaining,1);assert.equal(result.attacksMade,1);
 const attack=f.calls.find(c=>c[0]==='attack');assert.ok(attack);assert.equal(attack[2],f.adapter.parts().talon.item.id);
 assert.ok(f.calls.findIndex(c=>c[0]==='move')<f.calls.indexOf(attack));
 assert.equal(f.boss.document.getFlag(ns,'flight').round,game.combat.round);
});
test('a stopped Dive spends two actions but does not roll or spend MAP for its unattempted Talon Strike',async()=>{
 const f=fixture({altitude:15}),ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger);
 const dive=f.adapter.candidates(state).find(c=>c.kind==='eagleDive');assert.ok(dive);
 f.boss.document.move=async()=>false;
 f.adapter.decide=s=>({chosen:f.adapter.candidates(s).find(c=>c.id===dive.id),diagnostics:s.diagnostics});
 const result=await new TurnRunner(f.adapter).run({oneAction:true});
 assert.equal(result.actionsRemaining,1);assert.equal(result.attacksMade,0);assert.equal(result.uncertain,false);
 assert.equal(f.calls.some(c=>c[0]==='attack'),false);
});
test('lethal flight loss lands the corpse and reports falling damage without granting another action',async()=>{
 const f=fixture({altitude:15});f.actor.hitPoints.value=0;
 const result=await resolveFlightFall(f.boss,{reactions:f.reactions,applyDamage:true});
 assert.equal(result.fall,true);assert.equal(f.boss.document.elevation,0);assert.equal(f.calls.some(c=>c[0]==='arrest'),false);
 assert.equal(f.calls.find(c=>c[0]==='fall-damage')[1],7);
});
test('Arrest a Fall uses the shared reaction and prevents damage on a successful native Acrobatics check',async()=>{
 const f=fixture({altitude:15});f.actor.conditionsSet.add('prone');
 const result=await resolveFlightFall(f.boss,{reactions:f.reactions,applyDamage:true});
 assert.equal(result.fall,true);assert.equal(f.boss.document.elevation,0);
 assert.equal(f.calls.filter(c=>c[0]==='arrest').length,1);assert.equal(f.calls.some(c=>c[0]==='fall-damage'),false);
 assert.equal(f.actor.getFlag(ns,'reaction').kind,'arrest-a-fall');assert.equal(f.reactions.available(f.boss),false);
});

function tallEnemy(f){
 f.player.actor.dimensions.height=10;f.player.actor.getReach=()=>10;
}

test('flight clearance includes enemy elevation, body height and ordinary melee reach without needing a reaction',async()=>{
 const f=fixture({altitude:10});tallEnemy(f);
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 const threats=flightThreats(f.adapter,state,()=>f.player);
 assert.equal(threats[0].safeElevation,25);
 const point={...f.player.document};
 assert.equal(flightSafety(f.adapter,{...point,elevation:20},threats).safe,false);
 assert.equal(flightSafety(f.adapter,{...point,elevation:25},threats).safe,true);
 f.player.document.elevation=10;
 assert.equal(flightThreats(f.adapter,state,()=>f.player)[0].safeElevation,35,'a raised enemy raises the safe altitude');
});

test('the last action climbs to 25 feet after attacking a ten-foot-tall reach-ten enemy, even after Fly was used',async()=>{
 const f=fixture({altitude:10});tallEnemy(f);f.boss.document.x=400;
 await f.boss.document.setFlag(ns,'flight',{combatId:game.combat.id,round:game.combat.round});
 const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1};
 const state=await f.adapter.snapshot(ledger),choice=f.adapter.decide(state).chosen;
 assert.equal(choice.kind,'fly');assert.equal(choice.features.flightRetreat,true);
 assert.equal(choice.destination.elevation,25);
 assert.equal(state.flight.moves.find(m=>m.x===choice.destination.x&&m.y===choice.destination.y&&m.elevation===25).safety.safe,true);
 const result=await f.adapter.execute(choice,ledger,{valid:()=>true});
 assert.equal(Boolean(result.pause),false);assert.equal(f.boss.document.elevation,25);
});

test('a complete Eagle turn Dives, attacks, then ends above the ogre reach instead of attacking twice',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 const adapter=createCreatureAdapter(f.boss,null,{reactions:f.reactions});
 const opening=await adapter.snapshot(await adapter.readLedger(adapter.turnKey()));
 const choice=adapter.decide(opening).chosen;
 assert.equal(choice.kind,'eagleDive','start with the two-action activity instead of a Fly/Beak substitution');
 assert.equal(choice.features.turnPlan.actionCost,3);
 assert.deepEqual(choice.features.turnPlan.steps.map(step=>[step.kind,step.actionCost]),[['eagleDive',2],['fly',1]]);
 const result=await new TurnRunner(adapter).run();
 assert.equal(result.uncertain,false);assert.equal(result.actionsRemaining,0);
 assert.equal(f.calls.filter(c=>c[0]==='attack').length,1);
 assert.equal(f.boss.document.elevation,25);
 assert.equal(f.calls.find(c=>c[0]==='attack')[2],adapter.parts().talon.item.id);
 const last=f.calls.filter(c=>['attack','move'].includes(c[0])).at(-1);
 assert.equal(last[0],'move','the last action retreats after the attack');
});

test('a low ceiling produces a sideways escape rather than an illegal climb or an unsafe hover',async()=>{
 const f=fixture({altitude:10});tallEnemy(f);f.boss.document.x=400;
 canvas.scene.levels={get:()=>({elevation:{bottom:0,top:20}})};
 const ledger={...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:1,attacksMade:1};
 const state=await f.adapter.snapshot(ledger),choice=f.adapter.decide(state).chosen;
 assert.equal(choice.kind,'fly');assert.equal(choice.features.flightRetreat,true);
 assert.ok(choice.destination.elevation<=20);
 const move=state.flight.moves.find(m=>m.x===choice.destination.x&&m.y===choice.destination.y&&m.elevation===choice.destination.elevation);
 assert.equal(move.safety.safe,true);
 assert.ok(Math.abs(choice.destination.x-state.flight.origin.x)>0||Math.abs(choice.destination.y-state.flight.origin.y)>0);
});

test('a safe flyer does not spend its last two actions on a Dive that leaves it in melee reach',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 const state=await f.adapter.snapshot({...await f.adapter.readLedger(f.adapter.turnKey()),actionsRemaining:2});
 assert.equal(state.flight.safety.safe,true);
 assert.notEqual(f.adapter.decide(state).chosen.kind,'eagleDive');
});

test('all four corners of a Large ten-foot-tall enemy use native three-axis reach at elevations ten and fifteen',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.player.document.width=2;f.player.document.height=2;f.player.w=200;f.player.h=200;
 Object.defineProperty(f.player,'mechanicalBounds',{get:()=>new PIXI.Rectangle(f.player.document.x,f.player.document.y,200,200)});
 const cell=f.adapter.cell(f.player.document);
 for(const [dx,dy] of [[-1,-1],[2,-1],[-1,2],[2,2]]){
  const point={x:cell.x+dx,y:cell.y+dy};
  const near=f.adapter.targetAt(point,f.player,[],{...f.adapter.topLeft(point),elevation:10});
  const far=f.adapter.targetAt(point,f.player,[],{...f.adapter.topLeft(point),elevation:15});
  assert.equal(near.distance,5);assert.equal(near.inReach,true);
  assert.equal(far.distance,10);assert.equal(far.inReach,false);
 }
});

test('Dive endpoints include the east and south sides of a Large footprint',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.player.document.width=2;f.player.document.height=2;f.player.w=200;f.player.h=200;
 Object.defineProperty(f.player,'mechanicalBounds',{get:()=>new PIXI.Rectangle(f.player.document.x,f.player.document.y,200,200)});
 f.boss.document.x=1000;
 f.boss.constrainMovementPath=path=>[path,path.at(-1).x<700];
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.ok(state.flight.dives.some(d=>d.destination.x===7),'the east perimeter is two cells beyond the top-left, not one');
 assert.ok(state.flight.dives.some(d=>d.destination.y===4),'the south perimeter is also enumerated');
});

test('a reduced Fly speed refuses a Dive whose return climb cannot fit one Fly action',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.actor.system.attributes.speed.otherSpeeds.find(s=>s.type==='fly').value=20;
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.equal(state.flight.speed,20);assert.equal(state.flight.dives.length,0);
 const result=await new TurnRunner(f.adapter).run();
 assert.equal(result.uncertain,false);assert.equal(f.calls.some(c=>c[0]==='attack'),false);
 assert.ok(f.boss.document.elevation>=25);
});

test('blocked escape routes reject an otherwise clear Dive before actions or rolls are spent',async()=>{
 const f=fixture({altitude:25});tallEnemy(f);
 f.boss.constrainMovementPath=path=>[path,path.at(-1).elevation>path[0].elevation];
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
 assert.equal(state.flight.dives.length,0);
 assert.notEqual(f.adapter.decide(state).chosen.kind,'eagleDive');
 assert.equal(f.calls.length,0);
});
