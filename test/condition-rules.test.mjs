import test from 'node:test';
import assert from 'node:assert/strict';
import {conditionViolation,conditionFlatChecks,filterConditionActions} from '../src/framework/condition-rules.mjs';

test('Restrained forbids attack and manipulate actions while preserving Escape and Force Open',()=>{
  for(const kind of ['strike','trip','knockdown','reload','castSpell'])assert.match(conditionViolation({restrained:true},{kind}),/Restrained/);
  for(const kind of ['escape','force-open','seek','retch'])assert.equal(conditionViolation({restrained:true},{kind}),null);
});
test('Immobilized and Prone restrict move-trait actions without banning stationary Strikes',()=>{
  for(const kind of ['stand','stride','fly','sneak','eagleDive'])assert.match(conditionViolation({immobilized:true},{kind}),/Immobilized/);
  for(const kind of ['stride','step','fly','sneak'])assert.match(conditionViolation({prone:true},{kind}),/Prone/);
  for(const kind of ['stand','crawl','strike'])assert.equal(conditionViolation({prone:true},{kind}),null);
});
test('Fascinated restricts concentration to its configured subject; Sickened blocks ingestion',()=>{
  const facts={fascinated:true,fascinationSubjects:['subject']};
  assert.equal(conditionViolation(facts,{kind:'castSpell',targetId:'subject'}),null);
  assert.match(conditionViolation(facts,{kind:'castSpell',targetId:'other'}),/Fascinated/);
  assert.equal(conditionViolation(facts,{kind:'strike',targetId:'other'}),null);
  assert.equal(conditionViolation(facts,{kind:'seek',relatedToFascination:true}),null);
  assert.match(conditionViolation({sickened:true},{kind:'consume',ingest:true}),/Sickened/);
});
test('condition action risks compose independently and reduce AI utility without consulting secret outcomes',()=>{
  const facts={grabbed:true,deafened:true,stupefied:2,synesthesia:true};
  const action={id:'cast',kind:'castSpell',traits:['concentrate','manipulate','auditory'],legal:true,assessment:{value:10}};
  assert.deepEqual(conditionFlatChecks(facts,action).map(c=>c.dc),[5,5,7,5]);
  const [candidate]=filterConditionActions([action],facts);
  assert.ok(Math.abs(candidate.assessment.value-10*0.8*0.8*0.7*0.8)<1e-8);
  assert.equal(filterConditionActions([action],{restrained:true})[0].legal,false);
  assert.equal(conditionFlatChecks({grabbed:true},{kind:'castSpell',traits:['concentrate']}).length,0,'non-manipulate spells retain their actual traits');
});
