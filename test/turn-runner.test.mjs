import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnRunner } from '../src/wolf/turn-runner.mjs';

function fixture() {
  let turn = 'turn1';
  let ledger = { turn, actionsRemaining: 3, attacksMade: 0, lastAction: null, visited: [], uncertain: false, done: false };
  const calls = [];
  const adapter = {
    turnKey: () => turn,
    readLedger: async () => structuredClone(ledger),
    saveLedger: async value => { ledger = structuredClone(value); calls.push(['save', structuredClone(value)]); },
    assertReady: async () => {}, snapshot: async value => value,
    decide: async () => ({ chosen: { id: 'jaws', kind: 'strike', actionCost: 1 }, reason: 'test' }),
    revalidate: async () => {},
    execute: async () => { calls.push(['execute', structuredClone(ledger)]); return { lastAction: { kind: 'strike', hit: false } }; },
    report: async () => {},
  };
  return { runner: new TurnRunner(adapter), adapter, calls, ledger: () => ledger, changeTurn: () => { turn = 'turn2'; } };
}

test('battle victory stops before preparation, preserves actions and never advances',async()=>{
  const f=fixture();let notified=0;
  f.adapter.encounterOutcome=()=>({message:'Battle won',combatId:'combat'});
  f.adapter.prepareTurn=async()=>assert.fail('no command or other preparation after victory');
  f.adapter.finishTurn=async()=>assert.fail('victory must not advance combat');
  f.runner.onEncounterComplete=()=>{notified++;};
  const result=await f.runner.run();
  assert.equal(result.completionReason,'battle-over');assert.equal(result.actionsRemaining,3);
  assert.equal(f.calls.some(c=>c[0]==='execute'),false);assert.equal(notified,1);
});

test('a final kill stops before the next action or auto advancement, even in One action mode',async()=>{
  for(const oneAction of [false,true]){
    const f=fixture();let won=false,notified=0;
    f.adapter.encounterOutcome=()=>won?{message:'Battle won',combatId:'combat'}:null;
    f.adapter.execute=async()=>{won=true;f.calls.push(['execute']);return {};};
    f.adapter.finishTurn=async()=>assert.fail('no post-victory turn advancement');
    f.runner.onEncounterComplete=()=>{notified++;};
    const result=await f.runner.run({oneAction});
    assert.equal(result.completionReason,'battle-over');assert.equal(result.actionsRemaining,2);
    assert.equal(result.attacksMade,1);assert.equal(result.uncertain,false);assert.equal(notified,1);
    assert.equal(f.calls.filter(c=>c[0]==='execute').length,1);
  }
});

test('victory during the intent or reaction wait prevents a queued action',async()=>{
  for(const when of ['intent','reaction']){
    const f=fixture();let won=false;
    f.adapter.encounterOutcome=()=>won?{message:'Battle won',combatId:'combat'}:null;
    if(when==='intent')f.runner.presentation={beforeAction:async()=>{won=true;return true;}};
    else f.adapter.waitForReactions=async()=>{won=true;return true;};
    const result=await f.runner.run();assert.equal(result.completionReason,'battle-over');
    assert.equal(result.actionsRemaining,3);assert.equal(f.calls.some(c=>c[0]==='execute'),false);
  }
});

test('recovery permits resuming a stopped battle with its saved budget',async()=>{
  const f=fixture();let won=true;
  f.adapter.encounterOutcome=()=>won?{message:'Battle won',combatId:'combat'}:null;
  await f.runner.run();won=false;await f.runner.run({oneAction:true});
  assert.equal(f.ledger().completionReason,null);assert.equal(f.ledger().actionsRemaining,2);
});

test('victory invalidating preparation or revalidation ends cleanly without spending actions',async()=>{
  for(const when of ['prepare','ready','revalidate']){
    const f=fixture();let won=false;
    f.adapter.encounterOutcome=()=>won?{message:'Battle won',combatId:'combat'}:null;
    if(when==='prepare')f.adapter.prepareTurn=async()=>{won=true;return false;};
    else f.adapter[when==='ready'?'assertReady':'revalidate']=async()=>{won=true;throw new Error('target unavailable');};
    const result=await f.runner.run();assert.equal(result.completionReason,'battle-over');
    assert.equal(result.actionsRemaining,3);assert.equal(f.calls.some(c=>c[0]==='execute'),false);
  }
});

test('victory during action reservation releases only that known-unexecuted cost',async()=>{
  const f=fixture();let won=false;const save=f.adapter.saveLedger;
  f.adapter.encounterOutcome=()=>won?{message:'Battle won',combatId:'combat'}:null;
  f.adapter.saveLedger=async value=>{await save(value);if(value.uncertain)won=true;};
  const result=await f.runner.run();assert.equal(result.completionReason,'battle-over');
  assert.equal(result.actionsRemaining,3);assert.equal(result.attacksMade,0);assert.equal(result.uncertain,false);
  assert.equal(f.calls.some(c=>c[0]==='execute'),false);
});

test('turn uses at most three actions and persists MAP across a second invocation', async () => {
  const f = fixture();
  await f.runner.run();
  assert.equal(f.ledger().actionsRemaining, 0);
  assert.equal(f.ledger().attacksMade, 3);
  assert.equal(f.calls.filter(c => c[0] === 'execute').length, 3);
  await f.runner.run();
  assert.equal(f.calls.filter(c => c[0] === 'execute').length, 3);
});

test('a premature done marker from an earlier blocked turn can retry only its unspent actions', async () => {
  const f = fixture();
  await f.adapter.saveLedger({ ...f.ledger(), done: true, actionsRemaining: 2, attacksMade: 1 });
  await f.runner.run();
  assert.equal(f.ledger().actionsRemaining, 0);
  assert.equal(f.ledger().attacksMade, 3);
  assert.equal(f.calls.filter(call => call[0] === 'execute').length, 2);
});

test('a recovered NPC clears old death reasons while preserving remaining actions and MAP', async () => {
  for (const done of [true, false]) {
    const f = fixture(), reports = [];
    f.adapter.turnEndReason = () => null;
    f.adapter.report = async (decision, ledger) => reports.push(structuredClone(ledger));
    await f.adapter.saveLedger({ ...f.ledger(), done, actionsRemaining: 2, attacksMade: 1,
      completionReason: 'incapacitated', incapacitationReason: 'dead' });
    await f.runner.run({ oneAction: true });
    assert.equal(f.ledger().actionsRemaining, 1);
    assert.equal(f.ledger().attacksMade, 2);
    assert.equal(f.ledger().done, false);
    assert.equal(f.ledger().completionReason, null);
    assert.equal(f.ledger().incapacitationReason, null);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].incapacitationReason, null);
  }
});

test('recovery with no actions left clears the reason without granting another action', async () => {
  const f = fixture();
  f.adapter.turnEndReason = () => null;
  await f.adapter.saveLedger({ ...f.ledger(), done: true, actionsRemaining: 0, attacksMade: 2,
    completionReason: 'incapacitated', incapacitationReason: 'dead' });
  await f.runner.run();
  assert.equal(f.ledger().actionsRemaining, 0);
  assert.equal(f.ledger().attacksMade, 2);
  assert.equal(f.ledger().done, true);
  assert.equal(f.ledger().completionReason, null);
  assert.equal(f.ledger().incapacitationReason, null);
  assert.equal(f.calls.some(call => call[0] === 'execute'), false);
});

test('incapacitation forfeits pending optional Escape movement before a later recovery', async () => {
  const f = fixture();
  let dead = true;
  f.adapter.turnEndReason = () => dead ? 'dead' : null;
  await f.adapter.saveLedger({ ...f.ledger(), actionsRemaining: 0, freeEscapeStride: true });
  await f.runner.run();
  assert.equal(f.ledger().freeEscapeStride, false);
  dead = false;
  await f.runner.run();
  assert.equal(f.ledger().freeEscapeStride, false);
  assert.equal(f.ledger().actionsRemaining, 0);
  assert.equal(f.calls.some(call => call[0] === 'execute'), false);
});

test('healing while waiting for turn context prevents an obsolete death decision', async () => {
  const f = fixture();
  let dead = true;
  f.adapter.turnEndReason = () => dead ? 'dead' : null;
  f.adapter.assertTurnContext = async () => { dead = false; };
  const reports = [];
  f.adapter.report = async decision => reports.push(decision);
  await f.runner.run({ oneAction: true });
  assert.equal(f.ledger().actionsRemaining, 2);
  assert.equal(f.ledger().done, false);
  assert.equal(reports.some(report => report.reason === 'incapacitated'), false);
});

test('a live actor overrides a cached death result if healing resolved before the runner resumed', async () => {
  const f = fixture();
  f.adapter.turnEndReason = () => null;
  f.adapter.execute = async () => ({ endTurn: true, incapacitationReason: 'dead' });
  await f.runner.run({ oneAction: true });
  assert.equal(f.ledger().actionsRemaining, 2);
  assert.equal(f.ledger().done, false);
  assert.equal(f.ledger().completionReason, null);
  assert.equal(f.ledger().incapacitationReason, null);
});

test('an action is reserved before execution; failed execution remains uncertain', async () => {
  const f = fixture();
  f.adapter.execute = async () => { assert.equal(f.ledger().actionsRemaining, 2); assert.equal(f.ledger().uncertain, true); throw new Error('interrupted'); };
  await assert.rejects(f.runner.run(), /interrupted/);
  assert.equal(f.ledger().actionsRemaining, 2);
  await assert.rejects(f.runner.run(), /previous action/);
});

test('intent and pause happen before reservation, and the original choice is revalidated before acting',async()=>{
  const f=fixture();let release,validated=0;
  f.adapter.revalidate=async()=>{validated++;};
  f.runner.presentation={beforeAction:()=>new Promise(resolve=>release=resolve)};
  const running=f.runner.run({oneAction:true});
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.ledger().actionsRemaining,3);assert.equal(f.ledger().uncertain,false);assert.equal(f.calls.some(call=>call[0]==='execute'),false);
  release(true);await running;assert.equal(validated,2);assert.equal(f.ledger().actionsRemaining,2);
});

test('Stop or a changed turn during the pre-action pause spends no action or MAP',async()=>{
  for(const reason of ['stop','turn']){
    const f=fixture();let release;
    f.runner.presentation={beforeAction:()=>new Promise(resolve=>release=resolve)};
    const running=f.runner.run();while(!release)await new Promise(resolve=>setImmediate(resolve));
    if(reason==='stop')f.runner.cancel();else f.changeTurn();release(true);await running;
    assert.equal(f.calls.some(call=>call[0]==='execute'),false);assert.equal(f.ledger().actionsRemaining,3);
    assert.equal(f.ledger().attacksMade,0);assert.equal(f.ledger().uncertain,false);
  }
});

test('a choice invalidated while players read its intent never reserves or executes its action',async()=>{
  const f=fixture();let checks=0;
  f.adapter.revalidate=async()=>{if(++checks===2)throw new Error('Target moved during pause');};
  f.runner.presentation={beforeAction:async()=>true};
  await assert.rejects(f.runner.run(),/Target moved/);assert.equal(f.ledger().actionsRemaining,3);assert.equal(f.ledger().uncertain,false);
  assert.equal(f.calls.some(call=>call[0]==='execute'),false);
});

test('incapacitation during the intent pause completes the turn without executing the queued action',async()=>{
  const f=fixture();let dead=false;
  f.adapter.turnEndReason=()=>dead?'dead':null;
  f.runner.presentation={beforeAction:async()=>{dead=true;return true;}};
  const result=await f.runner.run();assert.equal(result.completionReason,'incapacitated');
  assert.equal(f.ledger().actionsRemaining,3);assert.equal(f.calls.some(call=>call[0]==='execute'),false);
});

test('the result pause holds the next action and can stop safely after a resolved action',async()=>{
  const f=fixture();let release;
  f.runner.presentation={beforeAction:async()=>true,afterAction:()=>new Promise(resolve=>release=resolve)};
  const running=f.runner.run();while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.filter(call=>call[0]==='execute').length,1);assert.equal(f.ledger().actionsRemaining,2);assert.equal(f.ledger().uncertain,false);
  f.runner.cancel();release(false);await running;assert.equal(f.calls.filter(call=>call[0]==='execute').length,1);
});

test('turn changes and cancellation stop execution after the current awaited operation', async () => {
  const f = fixture();
  f.adapter.revalidate = async () => f.changeTurn();
  await f.runner.run();
  assert.equal(f.calls.filter(c => c[0] === 'execute').length, 0);
  const g = fixture();
  g.adapter.execute = async () => { g.runner.cancel(); return {}; };
  await g.runner.run();
  assert.equal(g.ledger().actionsRemaining, 2);
});

test('Knockdown consumes an action without increasing MAP', async () => {
  const f = fixture();
  f.adapter.decide = async () => ({ chosen: { id: 'kd', kind: 'knockdown', actionCost: 1 } });
  await f.runner.run({ oneAction: true });
  assert.equal(f.ledger().actionsRemaining, 2);
  assert.equal(f.ledger().attacksMade, 0);
});

test('a known-unexecuted action restores its reservation and recomputes the next choice', async () => {
  const f = fixture();
  let first = true;
  const execute = f.adapter.execute;
  f.adapter.decide=async state=>({chosen:{id:state.rejectedActionIds?.includes('jaws')?'alternative-jaws':'jaws',kind:'strike',actionCost:1}});
  f.adapter.execute = async () => {
    if (first) { first = false; return { skipped: true }; }
    return execute();
  };
  await f.runner.run();
  assert.equal(f.ledger().actionsRemaining, 0);
  assert.equal(f.ledger().attacksMade, 3);
  assert.equal(f.calls.filter(c => c[0] === 'execute').length, 3);
  assert.equal(f.ledger().uncertain, false);
});

test('a chooser ignoring rejected candidates cannot loop on an unchanged skipped action',async()=>{
 const f=fixture();let tries=0;
 f.adapter.execute=async()=>{tries++;return {skipped:true,skipReason:'Effect is no longer a legal target'};};
 const ledger=await f.runner.run();assert.equal(tries,1);assert.equal(ledger.actionsRemaining,3);assert.equal(ledger.attacksMade,0);
 assert.deepEqual(ledger.rejectedActionIds,['jaws']);assert.equal(ledger.uncertain,false);
 await f.runner.run();assert.equal(tries,1,'an automatic retry in the same turn cannot repeat the rejected action');
});

test('a stopped Stride records the actual destination without marking the planned goal visited', async () => {
  const f = fixture();
  f.adapter.decide = async () => ({ chosen: { id: 'stride', kind: 'stride', actionCost: 1, destination: { x: 5, y: 0 } } });
  f.adapter.execute = async () => ({ destination: { x: 2, y: 0 }, pause: true });
  await f.runner.run();
  assert.deepEqual(f.ledger().visited, ['2,0']);
  assert.equal(f.ledger().actionsRemaining, 2);
  assert.equal(f.ledger().uncertain, false);
});

test('rolls-only execution pauses; concurrent runs cannot duplicate actions', async () => {
  const f = fixture();
  let release;
  f.adapter.execute = () => new Promise(resolve => { release = () => resolve({ pause: true }); });
  const running = f.runner.run();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.runner.run(), /already acting/);
  release(); await running;
  assert.equal(f.ledger().actionsRemaining, 2);
});
