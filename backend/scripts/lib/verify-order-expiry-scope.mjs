/**
 * Packet 0: fail-closed guard for the LOCAL-ONLY order contention verifier.
 * Its canonical expireOldOrders() use case intentionally processes ALL eligible
 * orders; the verifier may exercise that use case only in an empty, disposable
 * order database and only when its own order is the sole expiry candidate.
 * These read-only checks do not prevent concurrent external writers: the
 * operator must still guarantee a dedicated, quiescent local test database.
 */
function assertQueryRows(result, label) {
  if (!Array.isArray(result?.rows)) {
    throw new Error(`${label}: PostgreSQL returned an invalid result.`);
  }
  return result.rows;
}

function assertMigrator(migratorPool) {
  if (typeof migratorPool?.query !== 'function') {
    throw new Error('Order expiry verification requires the authorized migrator query adapter.');
  }
}

export async function assertEmptyOrderBaseline(migratorPool) {
  assertMigrator(migratorPool);
  const result = await migratorPool.query('SELECT id FROM orders ORDER BY id ASC LIMIT 1');
  const rows = assertQueryRows(result, 'Order baseline');
  if (rows.length !== 0) {
    throw new Error('Order expiry verifier requires an empty disposable order database; pre-existing orders were found.');
  }
}

export async function assertOnlyFixtureExpiryCandidate(migratorPool, expectedOrderId) {
  assertMigrator(migratorPool);
  if (!Number.isSafeInteger(expectedOrderId) || expectedOrderId <= 0) {
    throw new Error('Order expiry verifier requires a valid recorded synthetic order ID.');
  }
  const result = await migratorPool.query(
    `SELECT id FROM orders
     WHERE expires_at IS NOT NULL AND expires_at < NOW()
       AND status IN ('reserved','awaiting_payment')
     ORDER BY id ASC LIMIT 2`,
  );
  const rows = assertQueryRows(result, 'Expiry candidates');
  if (rows.length !== 1 || !Number.isSafeInteger(Number(rows[0]?.id)) ||
      Number(rows[0]?.id) !== expectedOrderId) {
    throw new Error('Order expiry verifier refused global expiry: candidates are not exactly its synthetic order.');
  }
}

/** Refuse a second global expiry sweep if any due orders remain or appeared. */
export async function assertNoExpiryCandidates(migratorPool) {
  assertMigrator(migratorPool);
  const result = await migratorPool.query(
    `SELECT id FROM orders
     WHERE expires_at IS NOT NULL AND expires_at < NOW()
       AND status IN ('reserved','awaiting_payment')
     ORDER BY id ASC LIMIT 1`,
  );
  if (assertQueryRows(result, 'Repeat expiry candidates').length !== 0) {
    throw new Error('Order expiry verifier refused repeat global expiry: another eligible order exists.');
  }
}
