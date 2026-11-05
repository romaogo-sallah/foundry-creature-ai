import test from 'node:test';
import assert from 'node:assert/strict';
import { encounterOutcome } from '../src/foundry/combat-state.mjs';

function fixture() {
  const scene={id:'scene'}, values=new Map(), combat={id:'combat',started:true,combatants:[]};
  const add=(id,alliance,{hp=10,conditions=[],config={},sceneId='scene'}={})=>{
    const actor={alliance,hitPoints:{value:hp},hasCondition:slug=>conditions.includes(slug)};
    const token={id,actor,document:{parent:scene,getFlag:()=>config}};
    values.set(id,token);combat.combatants.push({tokenId:id,sceneId});return token;
  };
  return {add,combat,values,outcome:()=>encounterOutcome({combat,scene,tokens:values})};
}

test('victory uses every opposing combatant, including untaught and hidden enemies',()=>{
  const f=fixture();f.add('ogre','party');f.add('fallen','opposition',{hp:0});
  const hidden=f.add('hidden','opposition');hidden.document.hidden=true;
  assert.equal(f.outcome(),null);
  hidden.actor.hitPoints.value=0;
  assert.deepEqual(f.outcome().survivorIds,['ogre']);assert.equal(f.outcome().reason,'victory');
});

test('one exhausted manual roster cannot end another creature’s ongoing fight',()=>{
  const f=fixture();f.add('wolf','party',{config:{targetMode:'manual',targetIds:['first']}});
  f.add('first','opposition',{hp:0});f.add('second','opposition');assert.equal(f.outcome(),null);
});

test('neutral hostility needs an explicit roster; unconscious opponents end that fight',()=>{
  const f=fixture();f.add('wolf',null,{config:{targetIds:['neutral']}});
  f.add('neutral',null,{conditions:['unconscious']});assert.equal(f.outcome().reason,'victory');
  const g=fixture();g.add('neutral',null);g.add('party','party');assert.equal(g.outcome(),null);
});

test('missing tokens, no hostile pairs and unstarted combat do not imply victory',()=>{
  const f=fixture();f.add('party','party');f.add('enemy','opposition',{hp:0});
  f.values.delete('enemy');assert.equal(f.outcome(),null);
  const g=fixture();g.add('party','party');g.add('ally','party',{hp:0});assert.equal(g.outcome(),null);
  const h=fixture();h.add('party','party');h.add('enemy','opposition',{hp:0});h.combat.started=false;assert.equal(h.outcome(),null);
});

test('defeated, dying and dead states count, other scenes do not, recovery reopens the fight',()=>{
  for(const condition of ['dying','dead']){
    const f=fixture();f.add('party','party');f.add('enemy','opposition',{conditions:[condition]});assert.ok(f.outcome());
  }
  const f=fixture();f.add('party','party');f.add('enemy','opposition');f.add('elsewhere','opposition',{sceneId:'other'});
  f.combat.combatants[1].defeated=true;assert.ok(f.outcome());
  f.combat.combatants[1].defeated=false;assert.equal(f.outcome(),null);
  f.values.get('party').actor.hitPoints.value=0;f.values.get('enemy').actor.hitPoints.value=0;
  assert.equal(f.outcome().reason,'draw');
});

test('a third active hostile faction prevents declaring an early victory',()=>{
  const f=fixture();f.add('party','party');f.add('enemy','opposition',{hp:0});
  f.add('neutral',null,{config:{targetIds:['party']}});assert.equal(f.outcome(),null);
});
