import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/ogre-fixture.mjs';
import { investigationCandidates } from '../src/framework/pursuit.mjs';
import { seekCandidates } from '../src/framework/perception.mjs';
import { chooseOption } from '../src/dawnsbury/chooser.mjs';

test('a Large creature routes around intervening occupants even when its first Stride increases direct enemy distance',async()=>{
  const f=fixture();f.player.document.x=900;
  for(let y=0;y<10;y++){
    const actor=f.makeActor(`blocker-${y}`,{type:'character',name:'Bystander',system:{traits:{size:{value:'med'},value:[]},details:{level:{value:1}},attributes:{hp:{value:20,max:20}}}});
    actor.alliance='neutral';f.token(`blocker-${y}`,actor,500,y*100,1);
  }
  const l=await f.adapter.readLedger(f.adapter.turnKey()),s=await f.adapter.snapshot(l);
  // No immediate melee attack is possible through the occupied column. A useful
  // route initially runs south, away from the enemy's horizontal coordinate.
  const moves=f.adapter.candidates(s).filter(c=>c.assessment.movement);
  assert.ok(moves.length);assert.ok(moves.some(c=>c.assessment.nearestEnemy<s.nearestEnemy));
  const move=moves.sort((a,b)=>a.assessment.nearestEnemy-b.assessment.nearestEnemy)[0];
  assert.ok(move.destination.y>s.self.cell.y);
  assert.ok(move.path.every(cell=>cell.x<4||cell.y>=10),'the Large footprint cannot pass through the blocker column');
});

test('a Large creature can cross and stop over an opposing corpse in a narrow corridor',async()=>{
  const f=fixture();f.player.document.x=1100;
  canvas.dimensions.sceneRect.contains=(x,y)=>x>=0&&x<1400&&y>=200&&y<400;
  const corpse=f.addOgre('corpse',500,200);corpse.actor.alliance='party';corpse.actor.hitPoints.value=0;
  const l=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(l);
  const over=state.moves.find(m=>m.x===5&&m.y===2);assert.ok(over,'corpse squares can be destinations');
  assert.ok(state.moves.some(m=>m.x>=7&&m.y===2),'the full footprint can pass through the corpse');
  assert.ok(state.moves.every(m=>m.y===2));
  corpse.actor.hitPoints.value=20;
  const revived=await f.adapter.snapshot(l);
  assert.ok(revived.moves.every(m=>m.x<4),'a revived opposing creature blocks the corridor again');
});

test('dead, zero-HP or defeated creatures do not block, but prone living creatures still occupy space',async()=>{
  for(const reason of ['dead','zero','defeated','prone']){
    const f=fixture();f.player.document.x=1100;
    canvas.dimensions.sceneRect.contains=(x,y)=>x>=0&&x<1400&&y>=200&&y<400;
    const other=f.addOgre('fallen',500,200);other.actor.alliance='party';
    if(reason==='zero')other.actor.hitPoints.value=0;
    else if(reason==='defeated')f.combat.combatants.find(c=>c.tokenId===other.id).defeated=true;
    else other.actor.conditionsSet.add(reason);
    const state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
    assert.equal(state.moves.some(m=>m.x>=7&&m.y===2),reason!=='prone',reason);
  }
});

test('corpse traversal still respects actual walls and living allies still reserve destinations',async()=>{
  const f=fixture();f.player.document.x=1100;
  canvas.dimensions.sceneRect.contains=(x,y)=>x>=0&&x<1400&&y>=200&&y<400;
  const ally=f.addOgre('ally',500,200);
  let state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.ok(state.moves.some(m=>m.x>=7&&m.y===2));assert.equal(state.moves.some(m=>m.x===5&&m.y===2),false);
  ally.actor.hitPoints.value=0;f.walls.add('5,2');f.walls.add('5,3');
  state=await f.adapter.snapshot(await f.adapter.readLedger(f.adapter.turnKey()));
  assert.ok(state.moves.every(m=>m.x<4),'a wall at the corpse remains a wall');
});

test('native Stride execution follows the planned route across a corpse',async()=>{
  const f=fixture();f.player.document.x=1100;
  canvas.dimensions.sceneRect.contains=(x,y)=>x>=0&&x<1400&&y>=200&&y<400;
  const corpse=f.addOgre('corpse',500,200);corpse.actor.alliance='party';corpse.actor.hitPoints.value=0;
  const l=await f.adapter.readLedger(f.adapter.turnKey()),state=await f.adapter.snapshot(l);
  const route=state.moves.find(m=>m.x===7&&m.y===2);assert.ok(route);
  const result=await f.adapter.execute({...route,kind:'stride',destination:{x:7,y:2},actionCost:1},{...l,actionsRemaining:2});
  assert.equal(f.boss.document.x,700);assert.equal(result.pause,false);assert.equal(f.prompts.length,0);
});

function stuckState(){
  const reference={id:'hidden',distance:20,lineOfSight:true,lineOfEffect:true,inReach:false,
    awareness:{state:'known-square',detection:'hidden',searchRequired:true,position:{x:400,y:0,width:1,height:1,elevation:0,level:'ground'}},strikes:{axe:{usable:false}}};
  const visible={...reference,id:'visible',awareness:{state:'observed'},distance:25};
  return {actionsRemaining:1,bonusMovementActions:1,self:{averageDamage:9.5,referenceAC:19,cell:{x:0,y:0},reachSquares:2},
    seek:{available:true,bonus:5,scope:'field'},enemies:[reference,visible],strikes:[{id:'axe'}],nearestEnemy:4,visited:[],
    moves:[{x:0,y:2,kind:'stride',cost:10,path:[{x:0,y:0},{x:0,y:1},{x:0,y:2}],nearestEnemy:4,targets:{hidden:{distance:20,lineOfSight:true},visible:{distance:25,lineOfSight:true}}},
      {x:1,y:2,kind:'stride',cost:10,path:[{x:0,y:0},{x:0,y:1},{x:1,y:2}],nearestEnemy:5,targets:{hidden:{distance:20,lineOfSight:true},visible:{distance:25,lineOfSight:true}}}]};
}

test('Seek remains available when observed foes exist but no attack or productive approach is available',()=>{
  const s=stuckState(),seeks=seekCandidates(s);assert.equal(seeks.length,1);assert.equal(seeks[0].kind,'seek');
  s.enemies[1].strikes.axe={usable:true};assert.equal(seekCandidates(s).length,0);
});

test('known search squares can be investigated after movement, but a field search is not treated as seeing through a wall',()=>{
  const s=stuckState();s.enemies=s.enemies.slice(0,1);s.enemies[0].lineOfSight=false;s.moves=[];
  assert.deepEqual(seekCandidates(s),[]);
  s.enemies[0].lineOfSight=true;assert.equal(seekCandidates(s).length,1);
});

test('a restricted Stride can investigate a different known enemy vantage and leave the ordinary action for Seek',()=>{
  const s=stuckState(),moves=investigationCandidates(s,[...seekCandidates(s),{kind:'endTurn',legal:true,assessment:{value:0}}]);
  assert.equal(moves.length,2);
  for(const move of moves){assert.equal(move.actionCost,0);assert.equal(move.bonusActionCost,1);assert.equal(move.features.investigation,true);
    assert.equal(move.targetId,'hidden');assert.equal(move.assessment.goodAttacksLeft,true);}
  const decision=chooseOption(moves,{actionsRemaining:1,bonusMovementActions:1,random:()=>0.9});
  assert.ok(decision.tiedIds.length>1,'equally useful search positions can be chosen randomly');
  const next={...s,actionsRemaining:s.actionsRemaining-decision.chosen.actionCost,bonusMovementActions:0,moves:[]};
  assert.equal(seekCandidates(next)[0].actionCost,1);assert.equal(next.actionsRemaining,1,'the ordinary action is still available for Seek');
});

test('investigation never grants a Strike with a movement-only action or chases live Undetected coordinates',()=>{
  const s=stuckState();s.actionsRemaining=0;
  const moves=investigationCandidates(s,[]);assert.ok(moves.length);assert.ok(moves.every(c=>c.kind==='stride'&&c.actionCost===0&&c.bonusActionCost===1));
  s.enemies[0].awareness.position.x=99999;
  assert.deepEqual(investigationCandidates(s,[]),moves,'only already-measured known-area geometry supplies destinations');
  s.self.immobile=true;assert.deepEqual(investigationCandidates(s,[]),[]);
});
