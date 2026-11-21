/**
 * Packet 0 only: best-effort, fail-closed cleanup of the synthetic order
 * verifier's own records. Never take an ID from a request or a real account.
 * Attempt all independent deletions even if a preceding step fails so an
 * isolated local test database is not left with avoidable fixture residue.
 */
export async function cleanupSyntheticOrderVerifierFixtures({ migratorPool, fixture }) {
  if (typeof migratorPool?.query !== 'function') {
    throw new Error('Order fixture cleanup requires a migration-role query adapter.');
  }
  if (!fixture || typeof fixture !== 'object') {
    throw new Error('Order fixture cleanup requires recorded synthetic IDs.');
  }

  for (const key of ['userId', 'inventoryId', 'medicineId', 'storeId']) {
    const value = fixture[key];
    if (value !== undefined && value !== null && value !== 0 &&
        (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`Order fixture cleanup received an invalid synthetic ${key}.`);
    }
  }

  // The verifier knows there must be exactly three orders after a successful
  // 100-way reservation. An interrupted run may have created fewer records,
  // so only enforce the exact count when those successes were characterized.
  if (fixture.expectedOrderCount !== undefined &&
      (!Number.isSafeInteger(fixture.expectedOrderCount) ||
       fixture.expectedOrderCount < 0 || fixture.expectedOrderCount > 100 ||
       !Number.isSafeInteger(fixture.userId) || fixture.userId <= 0)) {
    throw new Error('Order fixture cleanup received an invalid expected order count.');
  }

  const steps = [
    ['orders', 'DELETE FROM orders WHERE user_id = $1', fixture.userId],
    ['stock', 'DELETE FROM stock WHERE id = $1', fixture.inventoryId],
    ['medicines', 'DELETE FROM medicines WHERE id = $1', fixture.medicineId],
    ['pharmacies', 'DELETE FROM pharmacies WHERE id = $1', fixture.storeId],
    ['users', 'DELETE FROM users WHERE id = $1', fixture.userId],
  ];
  const failures = [];
  for (const [name, sql, id] of steps) {
    if (!id) continue;
    try {
      const result = await migratorPool.query(sql, [id]);
      const affected = result?.rowCount;
      const expected = name === 'orders' ? fixture.expectedOrderCount : 1;
      // Every recorded singleton is committed by the verifier's individual
      // INSERT query. The order count is exact only after the 100-way test
      // proves 3 successes; interrupted tests still reject malformed counts
      // or an unexpectedly broad DELETE affecting more than 100 orders.
      if (!Number.isSafeInteger(affected) || affected < 0 ||
          (name === 'orders'
            ? (affected > 100 || (expected !== undefined && affected !== expected))
            : affected !== expected)) {
        throw new Error(`Expected ${name} cleanup to delete ${expected === undefined ? '0..100' : expected} rows, received ${String(affected)}.`);
      }
    } catch (error) {
      failures.push(new Error(`Could not clean synthetic ${name} fixture`, { cause: error }));
    }
  }
  if (failures.length) {
    const names = failures.map((error) => error.message.replace('Could not clean synthetic ', '').replace(' fixture', ''));
    throw new AggregateError(failures, `Order verifier fixture cleanup incomplete: ${names.join(', ')}`);
  }
}
