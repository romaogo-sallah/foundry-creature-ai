import test from 'node:test';
import assert from 'node:assert/strict';
import {renderTacticalMap} from '../src/foundry/tactical-map-view.mjs';
test('the GM field view uses snapshot coordinates and escapes untrusted creature names',()=>{
  const field={bounds:{first:{x:0,y:0},last:{x:4,y:4}},round:2,
    origin:{x:2,y:2},cells:new Map([['2,2',{x:2,y:2,enemyArrival:Infinity,safeSpace:12,exits:3,positionValue:1.5}]]),
    barriers:[[1,1,1,2]],threats:[{id:'ogre',cell:{x:0,y:0},width:2,height:2}]};
  const html=renderTacticalMap(field,()=>'<script>bad</script>');
  assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/beyond the forecast horizon/);
  assert.match(html,/Round 2/);assert.match(html,/Last calculated snapshot/);
});
