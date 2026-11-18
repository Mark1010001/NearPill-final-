import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { settleFixtureAttempts } from '../scripts/lib/verify-concurrent-attempts.mjs';

test('successful fixture contention preserves attempt order after every worker settles', async () => {
  const results = await settleFixtureAttempts(4, async (index) => index % 2 === 0, 'Inventory contention');
  assert.deepEqual(results, [true, false, true, false]);
});

test('a rejected attempt cannot trigger fixture cleanup before slower in-flight attempts finish', async () => {
  let releaseSlow;
  let signalStarted;
  let slowFinished = false;
  const slowStarted = new Promise((resolve) => { signalStarted = resolve; });
  const slowGate = new Promise((resolve) => { releaseSlow = resolve; });
  const attempts = settleFixtureAttempts(2, async (index) => {
    if (index === 0) {
      signalStarted();
      try { await slowGate; } finally { slowFinished = true; }
      return 1;
    }
    throw new Error('synthetic transaction failed');
  }, 'Order contention');
  await slowStarted;
  let completed = false;
  void attempts.then(() => { completed = true; }, () => { completed = true; });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(completed, false, 'the verifier must not clean up while a worker is still running');
  releaseSlow();
  await assert.rejects(attempts, (error) =>
    error instanceof AggregateError &&
    error.errors.length === 1 &&
    error.errors[0].message === 'synthetic transaction failed' &&
    /all attempts settled before fixture cleanup/.test(error.message));
  assert.equal(slowFinished, true);
  assert.equal(completed, true);
});

test('multiple failures are reported only after every attempt and its simulated rollback completes', async () => {
  const events = [];
  await assert.rejects(settleFixtureAttempts(3, async (index) => {
    try {
      if (index === 1) throw new Error('query failed');
      if (index === 2) throw new Error('connection rejected');
      return 'success';
    } finally {
      await Promise.resolve();
      events.push(`released-${index}`);
    }
  }), (error) => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(events.sort(), ['released-0', 'released-1', 'released-2']);
});

test('invalid attempt configuration refuses execution', async () => {
  let called = false;
  for (const count of [0, -1, 1.1, 1001, NaN]) {
    await assert.rejects(settleFixtureAttempts(count, () => { called = true; }), /bounded count/);
  }
  await assert.rejects(settleFixtureAttempts(1, null), /attempt function/);
  assert.equal(called, false);
});

test('both live verifiers use the settled helper before counting results and fixture cleanup', async () => {
  for (const script of ['verify-postgres-security.mjs', 'verify-order-inventory.mjs']) {
    const source = await readFile(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ settleFixtureAttempts \} from '\.\/lib\/verify-concurrent-attempts\.mjs'/);
    assert.match(source, /const attempts = await settleFixtureAttempts\(100,/);
    assert.doesNotMatch(source, /const attempts = await Promise\.all\(/);
    assert.ok(source.indexOf('const attempts = await settleFixtureAttempts') < source.indexOf('const successes ='));
  }
});
