import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseOption } from '../src/dawnsbury/chooser.mjs';
import { decisionExplanation } from '../src/wolf/decision-explanation.mjs';
import { renderDecisionExplanation } from '../src/foundry/pf2e-adapter.mjs';

test('the explanation records the actual random tie winner without sampling again', () => {
  let samples = 0;
  const candidates = ['fighter', 'magus'].map(id => ({ id, kind: 'strike', targetId: id, legal: true, actionCost: 1,
    assessment: { value: 5 }, scoringTerms: [{ label: 'Attack', contribution: 5 }] }));
  const decision = chooseOption(candidates, { actionsRemaining: 3, random: () => { samples++; return 0.9; } });
  const record = decisionExplanation(decision);
  assert.equal(samples, 1);
  assert.equal(record.chosenId, 'magus');
  assert.equal(record.options.find(option => option.selected).targetId, 'magus');
  assert.deepEqual(record.options[0].terms, [{ label: 'Attack', contribution: 5 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(record)), record);
});

test('the chosen movement survives log trimming even when a creature override chooses a lower-ranked option', () => {
  const candidates = Array.from({ length: 30 }, (_, i) => ({ id: `move-${i}`, kind: 'stride', legal: true, actionCost: 1,
    assessment: { value: 30 - i, movement: true, goodAttacksLeft: true } }));
  const decision = chooseOption(candidates, { actionsRemaining: 3, override: options => options[29] });
  const record = decisionExplanation(decision);
  assert.equal(record.totalOptions, 30);
  assert.equal(record.options.length, 10);
  assert.equal(record.options.find(option => option.selected).id, 'move-29');
});

test('rendered decisions include rejection reasons and escape untrusted token names and labels', () => {
  const decision = { chosen: { id: 'bite' }, reason: 'ranked', ranked: [{ candidate: {
    id: 'bite', kind: 'strike', targetId: 'enemy', assessment: { value: 4 }, features: { packAllies: 2 },
  }, layer: 6, utility: 4, terms: [{ label: '<script>bad</script>', contribution: 4 }] }],
    rejected: [{ kind: 'knockdown', targetId: 'enemy', reason: 'target is already prone' }],
    diagnostics: { rejectedTargets: [{ id: 'hidden', name: '<img src=x>', reason: 'token is hidden' }] } };
  const html = renderDecisionExplanation(decisionExplanation(decision), () => '<b>enemy</b>');
  assert.match(html, /target is already prone/);
  assert.match(html, /Nearby supporting allies: 2/);
  assert.match(html, /&lt;b&gt;enemy&lt;\/b&gt;/);
  assert.ok(!html.includes('<script>') && !html.includes('<img src=x>'));
});

test('the explanation distinguishes pursuing a known enemy from an unavailable attack',()=>{
  const record=decisionExplanation({reason:'dawnsbury ranking',diagnostics:{pursuitTargets:[{id:'enemy',name:'<enemy>'}]}});
  assert.deepEqual(record.pursuitTargets,[{id:'enemy',name:'<enemy>'}]);
  const html=renderDecisionExplanation(record);
  assert.match(html,/Remembered enemy positions/);assert.match(html,/&lt;enemy&gt;/);
  assert.ok(!html.includes('<enemy>'));
});
