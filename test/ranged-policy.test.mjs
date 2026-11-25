import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedStrikeCandidates} from '../src/framework/strike-capability.mjs';

function state({penalty=2,moves=true}={}){
  const blade={id:'blade',ranged:false,bonus:18,damage:14,mapPenalties:[0,-5,-10]};
  const bow={id:'bow',ranged:true,bonus:18,damage:10,mapPenalties:[0,-5,-10]};
  const positions={blade:{usable:false,inReach:false,lineOfEffect:true},bow:{usable:true,inReach:true,lineOfEffect:true,rangePenalty:penalty}};
  return {actionsRemaining:3,attacksMade:0,self:{referenceAC:24,mapPenalties:[0,-5,-10]},strikes:[blade,bow],
    enemies:[{id:'target',distance:60,lineOfSight:true,strikes:positions}],moves:moves?[{cost:25,targets:{target:{distance:35,lineOfSight:true,
      lineOfEffect:true,strikes:{blade:{inReach:false},bow:{inReach:true,rangePenalty:Math.max(0,penalty-2)}}}}}]:[]};
}

const shot=s=>preparedStrikeCandidates(s).find(candidate=>candidate.strikeId==='bow');

test('the first ranged increment is a major cost when a useful approach exists',()=>{
  const clear=shot(state({penalty:0})),penalized=shot(state({penalty:2}));
  assert.ok(penalized.assessment.value<clear.assessment.value*0.35);
  assert.equal(penalized.features.rangeClosingAvailable,true);
  assert.ok(penalized.scoringTerms.some(term=>/Close or use melee/.test(term.label)&&term.contribution<0));
});

test('maximum range is a desperation shot and remains legal when no approach exists',()=>{
  const maximum=shot(state({penalty:10,moves:false}));
  assert.ok(maximum.assessment.value>0);assert.ok(maximum.assessment.value<1);
  assert.equal(maximum.features.rangeClosingAvailable,false);
  assert.ok(maximum.scoringTerms.some(term=>/desperation shot/.test(term.label)));
});
