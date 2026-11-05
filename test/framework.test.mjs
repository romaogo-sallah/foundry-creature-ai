import test from 'node:test';
import assert from 'node:assert/strict';
import { CapabilityRegistry } from '../src/framework/registry.mjs';
import { chooseOption } from '../src/dawnsbury/chooser.mjs';
import { creatureProfile } from '../src/foundry/creature-profiles.mjs';

test('profiles compose shared capabilities without granting unregistered actions', () => {
  const registry=new CapabilityRegistry().registerCapability('strike',state=>[{id:'strike',kind:'strike',actionCost:1,legal:true,assessment:{value:state.damage}}])
    .registerCapability('end',()=>[{id:'end',kind:'endTurn',actionCost:0,legal:true,assessment:{value:0}}])
    .registerProfile({id:'bruiser',roles:['bruiser'],capabilities:['strike','end']});
  assert.equal(registry.decide('bruiser',{actionsRemaining:1,self:{},damage:8}).chosen.kind,'strike');
  assert.equal(registry.decide('bruiser',{actionsRemaining:0,self:{},damage:8}).chosen.kind,'endTurn');
  assert.throws(()=>registry.registerProfile({id:'caster',capabilities:['unknown-spell']}),/Unknown capability/);
  assert.throws(()=>registry.registerCapability('strike',()=>[]),/duplicate/);
  assert.throws(()=>creatureProfile({type:'npc',system:{traits:{value:['undead']}}}),/No taught creature/);
});

test('a restricted extra action never funds a Strike, Trip, Escape, Crawl or command', () => {
  for(const kind of ['strike','trip','escape','crawl','bellow','drawJavelin']) {
    const decision=chooseOption([{id:'bad',kind,actionCost:0,bonusActionCost:1,legal:true,assessment:{value:100}}],
      {actionsRemaining:0,bonusMovementActions:1});
    assert.equal(decision.chosen,null,kind);
    assert.match(decision.rejected[0].reason,/only Step or Stride/);
  }
  for(const kind of ['stride','step']) {
    const candidate={id:'move',kind,actionCost:0,bonusActionCost:1,legal:true,assessment:{value:1}};
    assert.equal(chooseOption([candidate],{actionsRemaining:0,bonusMovementActions:1}).chosen,candidate);
    assert.equal(chooseOption([candidate],{actionsRemaining:0,bonusMovementActions:0}).chosen,null);
  }
});
