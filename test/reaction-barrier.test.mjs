import test from 'node:test';
import assert from 'node:assert/strict';
import { ReactionBarrier } from '../src/wolf/reaction-barrier.mjs';
import { TurnRunner } from '../src/wolf/turn-runner.mjs';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('AI waiting for an unanswered reaction cannot act until its effects finish', async () => {
  const barrier = new ReactionBarrier(), choice = deferred(), damage = deferred();
  const resolving = barrier.resolve(async () => { await choice.promise; await damage.promise; });
  let resumed = false;
  const waiting = barrier.wait().then(() => { resumed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumed, false);
  choice.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumed, false, 'button selection alone must not release the AI');
  damage.resolve();
  await Promise.all([resolving, waiting]);
  assert.equal(resumed, true);
});

test('nested and overlapping reactions must all resolve before any waiting AI resumes', async () => {
  const barrier = new ReactionBarrier(), first = deferred(), nested = deferred(), other = deferred();
  const resolving = barrier.resolve(async () => {
    await first.promise;
    await barrier.resolve(() => nested.promise);
  });
  const overlapping = barrier.resolve(() => other.promise);
  let resumed = false;
  const waiting = barrier.wait().then(() => { resumed = true; });
  first.resolve();
  other.resolve();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumed, false);
  nested.resolve();
  await Promise.all([resolving, overlapping, waiting]);
  assert.equal(resumed, true);
});

test('Stop cancels a queued AI wait without dismissing another creature reaction', async () => {
  const barrier = new ReactionBarrier(), answer = deferred();
  const resolving = barrier.resolve(() => answer.promise);
  const controller = new AbortController();
  const waiting = barrier.wait({ signal: controller.signal });
  controller.abort();
  assert.equal(await waiting, false);
  assert.equal(barrier.pending, true);
  assert.equal(barrier.waiters.size, 0);
  answer.resolve();
  await resolving;
});

test('a rejected reaction releases its waiters and keeps the failure visible', async () => {
  const barrier = new ReactionBarrier(), answer = deferred();
  const resolving = barrier.resolve(async () => { await answer.promise; throw new Error('interrupted reaction'); });
  const failed = assert.rejects(resolving, /interrupted reaction/);
  const waiting = barrier.wait();
  answer.resolve();
  await failed;
  assert.equal(await waiting, true);
  assert.equal(barrier.pending, false);
});

test('two AI runners wait without spending actions, and Stop cancels the queued one', async () => {
  const barrier = new ReactionBarrier(), answer = deferred();
  const resolving = barrier.resolve(() => answer.promise);
  const actions = [];
  function runner(name) {
    const ledger = { turn: name, actionsRemaining: 3, attacksMade: 0, visited: [], uncertain: false };
    return new TurnRunner({
      turnKey: () => name,
      waitForReactions: options => barrier.wait(options),
      readLedger: async () => ledger,
      saveLedger: async value => Object.assign(ledger, value),
      assertReady: async () => {}, snapshot: async () => ({}),
      decide: async () => ({ chosen: { id: 'bite', kind: 'strike', actionCost: 1 } }),
      revalidate: async () => {},
      execute: async () => { actions.push(name); return {}; }, report: async () => {},
    });
  }
  const a = runner('wolf-a'), b = runner('wolf-b');
  const first = a.run({ oneAction: true }), second = b.run({ oneAction: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(actions, []);
  b.cancel();
  assert.equal((await second).actionsRemaining, 3);
  assert.deepEqual(actions, []);
  answer.resolve();
  await resolving;
  assert.equal((await first).actionsRemaining, 2);
  assert.deepEqual(actions, ['wolf-a']);
});
