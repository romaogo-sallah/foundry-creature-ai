import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/modular-caster-fixture.mjs';
import {pitAt,pitWalkable,pitBlocksRay,PIT_BEHAVIOR_TYPE} from '../src/foundry/pit-geometry.mjs';
import {pitActionChoices,executePitAction} from '../src/foundry/pit-actions.mjs';
import {resolveFlightFall} from '../src/foundry/flight-falling.mjs';
function setup({width=100,x=400}={}){
 const f=fixture(),scene=canvas.scene;scene.grid={size:100,distance:5};
 const Base=CONFIG.Dice.rolls[0];CONFIG.Dice.rolls=[class DamageRoll extends Base{constructor(formula){super(formula);if(/^\d+\[bludgeoning\]$/.test(formula)){this.total=Number.parseInt(formula);this.instances=[{type:'bludgeoning',total:this.total}];}}}];
 const region={id:'pit',elevation:{bottom:-10,top:1},behaviors:{contents:[{type:PIT_BEHAVIOR_TYPE,system:{rim:0,depth:10,climbDC:20}}]},testPoint:p=>p.x>=x&&p.x<x+width&&p.y>=100&&p.y<300&&p.elevation>=-10&&p.elevation<1};
 scene.regions.contents.push(region);f.boss.document.x=300;f.boss.document.y=100;f.boss.document.elevation=0;
 f.actor.system.attributes.speed.value=25;f.actor.system.attributes.speed.total=25;return f;
}
test('pit Regions define an open rim and bottom; walking cannot bridge them, but a floor occupant can move within',()=>{
 const f=setup();assert.equal(pitAt(f.boss.document),null);assert.equal(pitWalkable(f.boss.document,{x:400,y:100}),false);
 f.boss.document.x=400;f.boss.document.elevation=-10;assert.equal(pitAt(f.boss.document).bottom,-10);
 assert.equal(pitWalkable(f.boss.document,{x:400,y:200}),true);assert.equal(pitWalkable(f.boss.document,{x:500,y:200}),false);
});
test('a normal Leap clears a five-foot pit without an Athletics check',async()=>{
 const f=setup(),choice=pitActionChoices(f.boss).find(c=>c.kind==='jump'&&c.destination.x===500&&c.destination.y===100);assert.ok(choice);assert.equal(choice.actionCost,1);
 await executePitAction(f.boss,choice,{reactions:f.reactions});assert.equal(f.boss.document.x,500);assert.equal(f.boss.document.elevation,0);assert.equal(f.calls.filter(c=>c[0]==='spell-save').length,0);
});
test('a failed Long Jump lands in the pit and applies falling damage rather than granting the chosen distance',async()=>{
 const f=setup({width:200});f.boss.document.x=100;f.actor.getStatistic=()=>({check:{roll:async()=>({degreeOfSuccess:1,total:12})}});
 const choice=pitActionChoices(f.boss).find(c=>c.kind==='jump'&&c.destination.x===600&&c.destination.y===100);assert.ok(choice);assert.equal(choice.actionCost,2);
 const hp=f.actor.hitPoints.value;await executePitAction(f.boss,choice,{reactions:f.reactions});assert.equal(f.boss.document.elevation,-10);assert.equal(f.actor.hitPoints.value,hp-5);assert.equal(f.actor.hasCondition('prone'),true);
});

test('Long Jump waits for an animated run-up before checking takeoff and making the jump',async()=>{
 const f=setup({width:200});f.boss.document.x=100;let checks=0,moves=0;
 f.actor.getStatistic=()=>({check:{roll:async()=>{checks++;return {degreeOfSuccess:2,total:25};}}});
 const choice=pitActionChoices(f.boss).find(c=>c.kind==='jump'&&c.destination.x===600&&c.destination.y===100);
 const move=f.boss.document.move.bind(f.boss.document);
 f.boss.document.move=async(points,options)=>{
  if(++moves===1){f.boss.movementAnimationPromise=new Promise(resolve=>setTimeout(async()=>{await move(points,options);resolve();},15));return true;}
  return move(points,options);
 };
 const result=await executePitAction(f.boss,choice,{reactions:f.reactions});assert.equal(checks,1);assert.equal(f.boss.document.x,600);assert.match(result.note,/opposite bank/);
});

test('Long Jump still stops when native movement genuinely fails to reach takeoff',async()=>{
 const f=setup({width:200});f.boss.document.x=100;
 const choice=pitActionChoices(f.boss).find(c=>c.kind==='jump'&&c.destination.x===600&&c.destination.y===100);
 f.actor.getStatistic=()=>({check:{roll:async()=>assert.fail('no jump after a stopped run-up')}});
 f.boss.document.move=async()=>false;
 const result=await executePitAction(f.boss,choice,{reactions:f.reactions});assert.match(result.note,/run-up stopped/);assert.equal(f.boss.document.x,100);
});
test('Climb makes five-foot progress per ordinary success, then exits onto the bank',async()=>{
 const f=setup();f.boss.document.x=400;f.boss.document.elevation=-10;
 for(const weapon of f.actor.itemTypes.weapon)weapon.system.equipped.carryType='worn';
 f.actor.getStatistic=()=>({check:{roll:async()=>({degreeOfSuccess:2,total:25})}});
 let c=pitActionChoices(f.boss).find(c=>c.kind==='climb');assert.ok(c);await executePitAction(f.boss,c,{reactions:f.reactions});assert.equal(f.boss.document.elevation,-5);
 c=pitActionChoices(f.boss).find(c=>c.kind==='climb');await executePitAction(f.boss,c,{reactions:f.reactions});assert.equal(f.boss.document.elevation,0);assert.equal(pitAt(f.boss.document),null);assert.equal(f.actor.itemTypes.effect.some(e=>e.flags?.['foundry-creature-ai']?.pitClimb),false);
});
test('pit walls block rays through earth below the rim but allow an upward ray through the opening',()=>{
 const f=setup();const from={x:450,y:150,elevation:-5};
 assert.equal(pitBlocksRay(f.boss,f.player,from,{x:800,y:150,elevation:0}),true);
 assert.equal(pitBlocksRay(f.boss,f.player,from,{x:450,y:150,elevation:20}),false);
});

test('Climb handles native prepared movement data with no legacy attributes.speed object',async()=>{
 const f=setup();f.boss.document.x=400;f.boss.document.elevation=-10;
 f.actor.system.movement={speeds:{land:{value:25}}};delete f.actor.system.attributes.speed;
 for(const weapon of f.actor.itemTypes.weapon)weapon.system.equipped.carryType='worn';
 f.actor.getStatistic=()=>({check:{roll:async()=>({degreeOfSuccess:2,total:25})}});
 const choice=pitActionChoices(f.boss).find(c=>c.kind==='climb');assert.ok(choice);
 await executePitAction(f.boss,choice,{reactions:f.reactions});assert.equal(f.boss.document.elevation,-5);
});
