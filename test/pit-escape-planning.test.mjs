import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {PIT_BEHAVIOR_TYPE,pitAt} from '../src/foundry/pit-geometry.mjs';
import {pitFlightSpellValue} from '../src/framework/pit-escape.mjs';
import {TurnRunner} from '../src/framework/turn-runner.mjs';
import {BrowserWorker} from './helpers/browser-worker.mjs';
import {decisionWorker} from '../src/foundry/decision-runtime.mjs';
const lich=JSON.parse(await readFile(new URL('./fixtures/lich-mechanics.json',import.meta.url))),ns='foundry-creature-ai';
function setup({depth=10,fly=false,ceiling=false}={}){
 const f=fixture({npcData:lich,size:12}),scene=canvas.scene;scene.grid={size:100,distance:5};
 scene.regions.contents.push({id:'pit',elevation:{bottom:-depth,top:1},behaviors:{contents:[{type:PIT_BEHAVIOR_TYPE,system:{rim:0,depth,climbDC:20}}]},
  testPoint:p=>p.x>=400&&p.x<600&&p.y>=100&&p.y<300&&p.elevation>=-depth&&p.elevation<1});
 f.boss.document.x=500;f.boss.document.y=100;f.boss.document.elevation=-depth;
 f.player.document.x=900;f.player.document.y=700;
 f.actor.system.attributes.speed.value=25;f.actor.system.attributes.speed.total=25;
 const statistic=f.actor.getStatistic;f.actor.getStatistic=slug=>slug==='athletics'?{mod:0,check:{mod:0,roll:async()=>assert.fail('use the prepared Fly spell instead of +0 Climb')}}:statistic(slug);
 const create=f.actor.createEmbeddedDocuments;f.actor.createEmbeddedDocuments=async(type,rows)=>{
  const result=await create(type,rows);if(rows.some(r=>r.flags?.[ns]?.supportSpell?.slug==='fly'))f.actor.system.attributes.speed.otherSpeeds=[{type:'fly',value:25}];return result;
 };
 if(fly)f.actor.system.attributes.speed.otherSpeeds=[{type:'fly',value:25}];
 if(ceiling)scene.testSurfaceCollision=(from,to)=>Math.min(from.elevation,to.elevation)<-5&&Math.max(from.elevation,to.elevation)>=-5;
 f.boss.measureMovementPath=path=>{
  let cost=0,diagonals=0;for(let i=1;i<path.length;i++){
   const a=path[i-1],b=path[i],dx=Math.abs(b.x-a.x)/100,dy=Math.abs(b.y-a.y)/100,dz=((b.elevation??0)-(a.elevation??0))/5;
   if(dz)cost+=Math.abs(dz)*(b.action==='fly'?(dz>0?10:2.5):5);
   else if(dx||dy)cost+=dx&&dy?(++diagonals%2?5:10):5;
  }return {cost};
 };
 for(const item of f.actor.itemTypes.spell)item.loadVariant=({castRank})=>({...item,rank:castRank});
 return f;
}
function nativeEffects(t){const previous=globalThis.fromUuid;globalThis.fromUuid=async()=>({toObject:()=>({name:'Native Fly effect',type:'effect',system:{slug:'spell-effect-fly',rules:[{key:'BaseSpeed',selector:'fly',value:25}],duration:{value:5,unit:'minutes'},level:{value:4}}})});
 t.after(()=>{if(previous)globalThis.fromUuid=previous;else delete globalThis.fromUuid;});}

test('Fly escape evaluation compares its casting and uphill movement costs with own Climb ability',()=>{
 const state={pitEscape:{height:10,dc:20,climbBonus:0,climbSpeed:0,landSpeed:25,heldItems:1,flySpeed:0,flightExitCost:25}};
 assert.ok(pitFlightSpellValue(state,{slug:'fly',actionCost:2})>30);
 state.pitEscape.climbSpeed=25;assert.equal(pitFlightSpellValue(state,{slug:'fly',actionCost:2}),0);
 state.pitEscape.flightExitCost=null;assert.equal(pitFlightSpellValue(state,{slug:'fly',actionCost:2}),0);
});

for(const backend of ['native','worker'])test(`${backend}: Lich casts Fly, then ascends and reaches a bank in its third action`,async t=>{
 const f=setup();nativeEffects(t);
 if(backend==='worker'){
  const previous=globalThis.Worker;globalThis.Worker=BrowserWorker;decisionWorker.failed=false;
  const get=game.settings.get;game.settings.get=(ns,key)=>key==='decisionPlanningBackend'?'worker':get(ns,key);
  t.after(()=>{decisionWorker.close();if(previous)globalThis.Worker=previous;else delete globalThis.Worker;});
 }
 const reports=[],report=f.adapter.report.bind(f.adapter);f.adapter.report=async(d,l,r)=>{reports.push(d.chosen);return report(d,l,r);};
 const result=await new TurnRunner(f.adapter).run();
 assert.equal(reports[0].spellSlug,'fly');assert.equal(reports[1].kind,'fly');assert.equal(reports[1].features.pitEscape,true);
 assert.equal(f.calls.filter(c=>c[0]==='consume-spell'&&c[1]==='fly').length,1);
 assert.equal(result.actionsRemaining,0);assert.equal(result.uncertain,false);assert.equal(pitAt(f.boss.document),null);assert.equal(f.boss.document.elevation,0);
 assert.ok(reports[1].path.slice(0,-1).every(p=>p.x===5&&p.y===1),'ascend through the opening before moving onto the bank');
 assert.equal(reports[1].movementCost,25,'10 feet of ascent costs 20 feet, plus 5 feet to the bank');
});

test('an existing fly Speed escapes with no enemy in sight and no spell resource',async()=>{
 const f=setup({fly:true});game.combat.combatants=game.combat.combatants.slice(0,1);
 const ledger=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(ledger,{movement:false}),choice=f.adapter.decide(state).chosen;
 assert.equal(state.enemies.length,0);assert.equal(choice.kind,'fly');assert.equal(choice.features.pitEscape,true);assert.ok(choice.movementCost<=25);
});

test('a deep pit produces affordable upward progress instead of requiring the full escape in one Fly',async()=>{
 const f=setup({depth:30,fly:true}),state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false}),choice=f.adapter.decide(state).chosen;
 assert.equal(choice.kind,'fly');assert.equal(choice.destination.elevation,-20);assert.equal(choice.movementCost,20);
});

test('an obstructing ceiling prevents a promised Fly escape',async()=>{
 const f=setup({ceiling:true}),state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false});
 assert.equal(state.pitEscape.flightExitCost,null);assert.equal(pitFlightSpellValue(state,{slug:'fly',actionCost:2}),0);
 assert.equal(state.pitEscape.flightMoves.length,0);
});

test('an unavailable Fly slot leaves Climb preparation available',async()=>{
 const f=setup();for(const spell of f.actor.itemTypes.spell.filter(s=>s.slug==='fly'))f.actor.items.delete(spell.id);
 const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()),{movement:false});
 assert.ok(state.pitActions.some(c=>c.kind==='pitStow'));
});
