/**
 * Packet 0 fixture safety: never start cleanup while concurrent verification
 * requests can still commit changes to their synthetic records.
 *
 * Promise.all rejects on the first failure, even while other tasks are in
 * flight. allSettled waits for every attempt (including its rollback/release)
 * before reporting any error to the enclosing verifier's cleanup block.
 */
export async function settleFixtureAttempts(count, run, label = 'Fixture contention') {
  if (!Number.isSafeInteger(count) || count < 1 || count > 1000 || typeof run !== 'function') {
    throw new Error('Fixture contention requires a bounded count and an attempt function.');
  }

  const outcomes = await Promise.allSettled(
    Array.from({ length: count }, (_, index) => Promise.resolve().then(() => run(index))),
  );
  const failures = outcomes.filter((outcome) => outcome.status === 'rejected');
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((outcome) => outcome.reason),
      `${label}: ${failures.length}/${count} attempts failed; all attempts settled before fixture cleanup.`,
    );
  }
  return outcomes.map((outcome) => outcome.value);
}
