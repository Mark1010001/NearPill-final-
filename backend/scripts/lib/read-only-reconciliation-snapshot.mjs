/**
 * Run read-only reconciliation against one consistent PostgreSQL snapshot.
 * A series of pool.query() calls can observe different database states while
 * concurrent order/stock/payment writes are committing. REPEATABLE READ gives
 * every integrity SELECT the same snapshot; READ ONLY prevents writes through
 * this verifier even when the reviewed migrator role can write migrations.
 *
 * The caller must independently approve the target and verify its actual
 * application/migration roles and migration history before invoking this.
 */
export async function withReadOnlyReconciliationSnapshot(pool, inspect) {
  if (!pool || typeof pool.connect !== 'function' || typeof inspect !== 'function') {
    throw new TypeError('Reconciliation requires a pooled PostgreSQL client and an inspection callback.');
  }
  const client = await pool.connect();
  let discardClient = false;
  let inspectionFailed = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    // Limit the lifetime of a blocking staging integrity query without
    // changing the PostgreSQL role, global defaults, or pooled session state.
    // SET LOCAL expires on both COMMIT and ROLLBACK; a failed SET aborts the
    // inspection before any tenant or financial data is read.
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    // A client-side pause between SELECTs can otherwise keep the snapshot
    // open indefinitely even though each individual statement is bounded.
    // PostgreSQL may terminate an idle transaction; rollback/discard handles
    // the resulting broken connection without reusing it.
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    // The BEGIN options are necessary but do not attest the effective
    // transaction state exposed by the selected PostgreSQL connection.
    // Fail closed before any protected reconciliation SELECT if a pooler,
    // wrapper, or unreviewed server configuration changed this boundary.
    // SET LOCAL can succeed without proving that a connection wrapper, pooler,
    // or subsequent session policy has kept the effective timeouts. pg_settings
    // exposes canonical millisecond values on THIS transaction connection.
    // The unit predicate makes a changed server representation fail closed.
    const boundary = await client.query(`
      SELECT current_setting('transaction_read_only') AS read_only,
             current_setting('transaction_isolation') AS isolation_level,
             (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout' AND unit = 'ms') AS statement_timeout_ms,
             (SELECT setting::bigint FROM pg_settings WHERE name = 'lock_timeout' AND unit = 'ms') AS lock_timeout_ms,
             (SELECT setting::bigint FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout' AND unit = 'ms') AS idle_timeout_ms
    `);
    if (boundary?.rows?.length !== 1 || boundary.rows[0]?.read_only !== 'on' ||
        boundary.rows[0]?.isolation_level !== 'repeatable read') {
      throw new Error('Reconciliation transaction must be read-only and repeatable-read.');
    }
    const effective = boundary.rows[0];
    if (String(effective.statement_timeout_ms) !== '120000' ||
        String(effective.lock_timeout_ms) !== '5000' ||
        String(effective.idle_timeout_ms) !== '30000') {
      throw new Error('Reconciliation verification timeouts do not match effective PostgreSQL transaction settings.');
    }
    const result = await inspect(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    inspectionFailed = true;
    try {
      await client.query('ROLLBACK');
    } catch {
      // The transaction state is unknown. Never return this connection to
      // the pool: it could retain the failed read-only transaction/session.
      // Keep the original failure as the caller-visible diagnostic.
      discardClient = true;
    }
    throw error;
  } finally {
    try {
      client.release(discardClient);
    } catch (cleanupError) {
      // Pool cleanup must not replace the original integrity/transaction
      // failure. A cleanup error after otherwise successful verification is
      // still fatal: do not report reconciliation success in that case.
      if (!inspectionFailed) throw cleanupError;
    }
  }
}


/**
 * Close both reconciliation pools before reporting integrity PASS.
 * Inspect every shutdown result: an unhandled/ignored Pool.end() rejection
 * cannot be treated as a successful completion. A pre-existing integrity
 * failure remains the primary diagnostic even if cleanup also fails.
 * Pool.end() may throw synchronously or return a rejected Promise.
 */
export async function closeReconciliationPools(pools, { originalError = null } = {}) {
  if (!Array.isArray(pools) || pools.length === 0 ||
      pools.some((pool) => !pool || typeof pool.end !== 'function')) {
    throw new TypeError('Reconciliation cleanup requires PostgreSQL pools with end() methods.');
  }
  const results = await Promise.allSettled(
    pools.map((pool) => Promise.resolve().then(() => pool.end())),
  );
  const failures = results.filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length && !originalError) {
    throw new AggregateError(failures, 'Reconciliation PostgreSQL pool shutdown failed.');
  }
}

/**
 * Attest the identity of the exact checked-out client executing protected
 * reconciliation SELECTs, not only an earlier pooled preflight connection.
 * Session-role changes or row_security=off must not produce a false PASS.
 * Staging must also prove TLS on this backend connection. No secrets logged.
 */
export function assertReconciliationPrincipal(result, expectedRole, { requireTls = false } = {}) {
  const rows = result?.rows;
  const identity = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (typeof expectedRole !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(expectedRole) ||
      !identity || identity.role_name !== expectedRole || identity.session_role_name !== expectedRole ||
      identity.row_security !== 'on' || identity.is_superuser !== false ||
      identity.bypass_rls !== false || (requireTls && identity.tls_active !== true)) {
    throw new Error('Reconciliation principal attestation failed on the active transaction connection.');
  }
}

/**
 * Re-attest the complete protected relation set on the exact transaction
 * connection used for reconciliation. An earlier pooled preflight may have
 * used a different server session. In particular, `users` must not silently
 * remain outside the forced-RLS acceptance boundary (NP-031).
 *
 * This is a read-only acceptance check; it does not install a policy or
 * authorize accessing the table with privileged credentials.
 */
export function assertForcedReconciliationRls(result, expectedTableNames) {
  const fail = () => { throw new Error('Reconciliation forced RLS table attestation failed.'); };
  if (!Array.isArray(expectedTableNames) || expectedTableNames.length === 0 ||
      expectedTableNames.some((name) => typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name))) {
    fail();
  }
  const expected = new Set(expectedTableNames);
  if (expected.size !== expectedTableNames.length) fail();
  const rows = result?.rows;
  if (!Array.isArray(rows) || rows.length !== expected.size) fail();
  const seen = new Set();
  for (const row of rows) {
    if (!row || !expected.has(row.relname) || seen.has(row.relname) ||
        !['r', 'p'].includes(row.relkind) || row.relrowsecurity !== true ||
        row.relforcerowsecurity !== true) fail();
    seen.add(row.relname);
  }
}
