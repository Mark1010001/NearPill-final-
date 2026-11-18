import assert from 'node:assert/strict';
import test from 'node:test';
import { withReadOnlyReconciliationSnapshot, closeReconciliationPools } from '../scripts/lib/read-only-reconciliation-snapshot.mjs';
import { assertZeroInvalidRows } from '../scripts/lib/reconcile-count.mjs';

function recordingPool({ failOn = null } = {}) {
  const events = [];
  const client = {
    async query(sql) {
      events.push(sql);
      if (sql === failOn) throw new Error(`simulated ${sql} failure`);
      if (sql.includes("current_setting('transaction_read_only')")) {
        return { rows: [{ read_only: 'on', isolation_level: 'repeatable read', statement_timeout_ms: '120000', lock_timeout_ms: '5000', idle_timeout_ms: '30000' }] };
      }
      return { rows: [{ count: 0 }] };
    },
    release(destroy = false) { events.push(destroy ? 'DESTROY' : 'RELEASE'); },
  };
  return { events, async connect() { events.push('CONNECT'); return client; } };
}

test('all reconciliation reads use the same read-only repeatable-read transaction and one checked-out client', async () => {
  const pool = recordingPool();
  const returned = await withReadOnlyReconciliationSnapshot(pool, async (client) => {
    assertZeroInvalidRows('inventory', await client.query('SELECT inventory'));
    assertZeroInvalidRows('orders', await client.query('SELECT orders'));
    return 'accepted';
  });
  assert.equal(returned, 'accepted');
  assert.deepEqual(pool.events, [
    'CONNECT', 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    "SET LOCAL statement_timeout = '120s'", "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    pool.events.find((event) => typeof event === 'string' && event.includes("current_setting('transaction_read_only')")),
    'SELECT inventory', 'SELECT orders', 'COMMIT', 'RELEASE',
  ]);
});

test('timeout configuration is transaction-local, bounded, and applied before any integrity SELECT', async () => {
  const pool = recordingPool();
  await withReadOnlyReconciliationSnapshot(pool, (client) => client.query('SELECT reconcile_inventory'));
  assert.deepEqual(pool.events, [
    'CONNECT', 'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    "SET LOCAL statement_timeout = '120s'", "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    pool.events.find((event) => typeof event === 'string' && event.includes("current_setting('transaction_read_only')")),
    'SELECT reconcile_inventory', 'COMMIT', 'RELEASE',
  ]);
  assert.equal(pool.events.some((event) => /^SET (?!LOCAL)/.test(event)), false);
});


test('read-only reconciliation caps idle-in-transaction time before any inspection query', async () => {
  const pool = recordingPool();
  await withReadOnlyReconciliationSnapshot(pool, (client) => client.query('SELECT reconcile_inventory'));
  const timeout = "SET LOCAL idle_in_transaction_session_timeout = '30s'";
  assert.ok(pool.events.includes(timeout), 'staging reconciliation must not leave a snapshot idle indefinitely');
  assert.ok(pool.events.indexOf('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY') < pool.events.indexOf(timeout));
  assert.ok(pool.events.indexOf(timeout) < pool.events.indexOf('SELECT reconcile_inventory'));
  assert.ok(pool.events.indexOf(timeout) < pool.events.indexOf('COMMIT'));
});

test('rejected idle transaction limit rolls back before any integrity read', async () => {
  const timeout = "SET LOCAL idle_in_transaction_session_timeout = '30s'";
  const pool = recordingPool({ failOn: timeout });
  let inspected = false;
  await assert.rejects(withReadOnlyReconciliationSnapshot(pool, async () => { inspected = true; }), /simulated SET LOCAL .* failure/);
  assert.equal(inspected, false);
  assert.deepEqual(pool.events.slice(-2), ['ROLLBACK', 'RELEASE']);
  assert.ok(!pool.events.includes('COMMIT'));
});

test('failed transaction-local timeout setup fails closed before inspection and rolls back', async () => {
  for (const setting of ["SET LOCAL statement_timeout = '120s'", "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'"]) {
    const pool = recordingPool({ failOn: setting });
    let inspected = false;
    await assert.rejects(
      withReadOnlyReconciliationSnapshot(pool, async () => { inspected = true; }),
      /simulated SET LOCAL .* failure/,
    );
    assert.equal(inspected, false, `integrity checks must not run after ${setting} fails`);
    assert.deepEqual(pool.events.slice(-2), ['ROLLBACK', 'RELEASE']);
    assert.ok(!pool.events.includes('COMMIT'));
  }
});



test('read-only staging reconciliation verifies actual transaction flags before reading data', async () => {
  const pool = recordingPool();
  let inspected = false;
  await withReadOnlyReconciliationSnapshot(pool, async () => { inspected = true; });
  const probe = "current_setting('transaction_read_only')";
  const boundary = pool.events.find((sql) => typeof sql === 'string' && sql.includes(probe));
  assert.ok(boundary, 'read-only and isolation session state must be independently attested');
  assert.ok(pool.events.indexOf(boundary) < pool.events.indexOf('COMMIT'));
  assert.equal(inspected, true);
});

test('unexpected writable or weak-isolation transaction aborts before integrity inspection', async () => {
  const probe = "current_setting('transaction_read_only')";
  for (const flags of [
    { read_only: 'off', isolation_level: 'repeatable read', statement_timeout_ms: '120000', lock_timeout_ms: '5000', idle_timeout_ms: '30000' },
    { read_only: 'on', isolation_level: 'read committed', statement_timeout_ms: '120000', lock_timeout_ms: '5000', idle_timeout_ms: '30000' },
    { read_only: 'on', isolation_level: 'serializable', statement_timeout_ms: '120000', lock_timeout_ms: '5000', idle_timeout_ms: '30000' },
    null,
  ]) {
    const events = [];
    const pool = {
      async connect() {
        return {
          async query(sql) {
            events.push(sql);
            if (sql.includes(probe)) return flags ? { rows: [flags] } : { rows: [] };
            return { rows: [{ count: 0 }] };
          },
          release(destroy = false) { events.push(destroy ? 'DESTROY' : 'RELEASE'); },
        };
      },
    };
    let inspected = false;
    await assert.rejects(withReadOnlyReconciliationSnapshot(pool, async () => { inspected = true; }),
      /transaction must be read-only and repeatable-read/);
    assert.equal(inspected, false);
    assert.ok(events.includes('ROLLBACK'));
    assert.ok(!events.includes('COMMIT'));
  }
});

test('failed integrity check rolls back and releases connection, without committing', async () => {
  const pool = recordingPool({ failOn: 'SELECT orders' });
  await assert.rejects(withReadOnlyReconciliationSnapshot(pool, async (client) => {
    await client.query('SELECT inventory');
    await client.query('SELECT orders');
  }), /simulated SELECT orders failure/);
  assert.deepEqual(pool.events.slice(-2), ['ROLLBACK', 'RELEASE']);
  assert.ok(!pool.events.includes('COMMIT'));
});

test('commit failure is not reported as success and triggers rollback and release', async () => {
  const pool = recordingPool({ failOn: 'COMMIT' });
  await assert.rejects(withReadOnlyReconciliationSnapshot(pool, (client) => client.query('SELECT inventory')), /simulated COMMIT failure/);
  assert.deepEqual(pool.events.slice(-3), ['COMMIT', 'ROLLBACK', 'RELEASE']);
});

test('rollback errors preserve the original error and destroy a potentially unclean client', async () => {
  const pool = recordingPool({ failOn: 'ROLLBACK' });
  await assert.rejects(withReadOnlyReconciliationSnapshot(pool, async () => { throw new Error('invalid stock'); }), /invalid stock/);
  assert.deepEqual(pool.events.slice(-2), ['ROLLBACK', 'DESTROY']);
  assert.ok(!pool.events.includes('COMMIT'));
});

test('failed BEGIN followed by failed ROLLBACK must not return an unknown-state client to pool', async () => {
  const events = [];
  const pool = {
    async connect() {
      return {
        async query(sql) {
          events.push(sql);
          throw new Error(sql === 'ROLLBACK' ? 'simulated rollback failure' : 'simulated begin failure');
        },
        release(destroy = false) { events.push(destroy ? 'DESTROY' : 'RELEASE'); },
      };
    },
  };
  await assert.rejects(withReadOnlyReconciliationSnapshot(pool, () => 'never reached'), /simulated begin failure/);
  assert.deepEqual(events, [
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'ROLLBACK', 'DESTROY',
  ]);
});

test('cleanup release failure never masks the original failed integrity query', async () => {
  const primary = new Error('violated inventory invariant');
  const cleanup = new Error('pool release unavailable');
  const events = [];
  const pool = {
    async connect() {
      return {
        async query(sql) {
          events.push(sql);
          if (sql.includes("current_setting('transaction_read_only')")) {
            return { rows: [{ read_only: 'on', isolation_level: 'repeatable read', statement_timeout_ms: '120000', lock_timeout_ms: '5000', idle_timeout_ms: '30000' }] };
          }
          return { rows: [{ count: 0 }] };
        },
        release(destroy) {
          events.push(destroy ? 'DESTROY' : 'RELEASE');
          throw cleanup;
        },
      };
    },
  };
  await assert.rejects(
    withReadOnlyReconciliationSnapshot(pool, async () => { throw primary; }),
    (error) => error === primary,
    'the integrity failure must remain the caller-visible cause even if pool cleanup throws',
  );
  assert.deepEqual(events, ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    "SET LOCAL statement_timeout = '120s'", "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    events.find((event) => typeof event === 'string' && event.includes("current_setting('transaction_read_only')")), 'ROLLBACK', 'RELEASE']);
});

test('failed rollback plus failed destroy still reports the original inspection error', async () => {
  const primary = new Error('invalid tenant data');
  const events = [];
  const pool = {
    async connect() {
      return {
        async query(sql) {
          events.push(sql);
          if (sql === 'ROLLBACK') throw new Error('rollback failed');
          if (sql.includes("current_setting('transaction_read_only')")) {
            return { rows: [{ read_only: 'on', isolation_level: 'repeatable read', statement_timeout_ms: '120000', lock_timeout_ms: '5000', idle_timeout_ms: '30000' }] };
          }
          return { rows: [{ count: 0 }] };
        },
        release(destroy) {
          events.push(destroy ? 'DESTROY' : 'RELEASE');
          throw new Error('destroy failed');
        },
      };
    },
  };
  await assert.rejects(withReadOnlyReconciliationSnapshot(pool, async () => { throw primary; }),
    (error) => error === primary);
  assert.deepEqual(events, ['BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    "SET LOCAL statement_timeout = '120s'", "SET LOCAL lock_timeout = '5s'",
    "SET LOCAL idle_in_transaction_session_timeout = '30s'",
    events.find((event) => typeof event === 'string' && event.includes("current_setting('transaction_read_only')")), 'ROLLBACK', 'DESTROY']);
});

test('pool cleanup failure after successful reconciliation remains a failure', async () => {
  const primary = new Error('pool release failed');
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes("current_setting('transaction_read_only')")) {
            return { rows: [{ read_only: 'on', isolation_level: 'repeatable read', statement_timeout_ms: '120000', lock_timeout_ms: '5000', idle_timeout_ms: '30000' }] };
          }
          return { rows: [{ count: 0 }] };
        },
        release() { throw primary; },
      };
    },
  };
  await assert.rejects(withReadOnlyReconciliationSnapshot(pool, async () => 'valid'),
    (error) => error === primary);
});

test('rejects invalid reconciliation clients without connecting', async () => {
  await assert.rejects(withReadOnlyReconciliationSnapshot(null, () => {}), TypeError);
  await assert.rejects(withReadOnlyReconciliationSnapshot({ connect() {} }, null), TypeError);
});

test('live reconciler runs every data/RLS/extension check inside the shared snapshot after authorization preflight', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const preflight = source.indexOf('await assertSafeLiveFixtureConnections(');
  const snapshot = source.indexOf('await withReadOnlyReconciliationSnapshot(');
  const policy = source.indexOf('assertActualRlsPolicyInventory(');
  const rls = source.indexOf('const rls = await client.query(');
  const appRole = source.indexOf('const appRole = await client.query(');
  const counts = source.indexOf('for (const [name, sql] of checks)');
  const vector = source.indexOf('const vector = await client.query(');
  const reporting = source.indexOf('for (const name of summary.passed)');
  assert.ok(preflight >= 0 && preflight < snapshot);
  assert.ok(snapshot < policy && policy < rls && rls < appRole && appRole < counts && counts < vector && vector < reporting);
  assert.doesNotMatch(source, /await migratorPool\.query\(sql\)/);
});


test('reconciliation only completes after both PostgreSQL pools close successfully', async () => {
  const events = [];
  const pools = [
    { async end() { events.push('app closed'); } },
    { async end() { events.push('migrator closed'); } },
  ];
  await closeReconciliationPools(pools);
  assert.deepEqual(events, ['app closed', 'migrator closed']);
});

test('reconciliation fails closed when either or both pool shutdowns reject', async () => {
  const events = [];
  const pools = [
    { async end() { events.push('app end'); throw new Error('app shutdown failed'); } },
    { end() { events.push('migrator end'); throw new Error('migrator shutdown failed'); } },
  ];
  await assert.rejects(closeReconciliationPools(pools), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 2);
    assert.match(error.errors[0].message, /app shutdown failed/);
    assert.match(error.errors[1].message, /migrator shutdown failed/);
    return true;
  });
  assert.deepEqual(events, ['app end', 'migrator end'], 'even a failed close must not skip the other pool');
});

test('pool shutdown failure never masks the primary reconciliation rejection', async () => {
  const primary = new Error('invalid payment ledger');
  await assert.doesNotReject(closeReconciliationPools([
    { async end() { throw new Error('app shutdown failed'); } },
    { async end() {} },
  ], { originalError: primary }));
});

test('live reconciliation does not print PASS until all PostgreSQL pools shut down', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  assert.match(source, /await closeReconciliationPools\(\[appPool, migratorPool\]/);
  assert.ok(source.indexOf('await closeReconciliationPools(') < source.indexOf('for (const name of summary.passed)'),
    'PASS reports must happen only after both pool shutdowns succeed');
  assert.doesNotMatch(source, /Promise\.allSettled\(\[appPool\.end\(\), migratorPool\.end\(\)\]\)/,
    'unexamined allSettled shutdown failures must not be ignored');
});

// PostgreSQL SET LOCAL timeouts protect an already established transaction,
// not a stalled pool.connect() or preflight pool.query(). Both verification
// connections must have bounded connection acquisition, including the direct
// migrator endpoint used for the full read-only reconciliation.
test('reconciliation bounds app and migrator connection acquisition before SQL preflight', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const options = source.match(/const connection = \{([\s\S]*?)\n\};/);
  assert.ok(options, 'reconciliation must share a common reviewed connection config');
  assert.match(options[1], /connectionTimeoutMillis:\s*10_000\b/,
    'the default node-postgres timeout of zero can hang indefinitely before any SET LOCAL');
  const poolConfigs = [...source.matchAll(/new Pool\(\{([\s\S]*?)\n\}\)/g)];
  assert.equal(poolConfigs.length, 2, 'one app-role and one direct migrator pool must be present');
  for (const [index, pool] of poolConfigs.entries()) {
    assert.match(pool[1], /\.\.\.connection\s*,/,
      `pool ${index} must inherit the bounded connection config`);
    assert.doesNotMatch(pool[1], /connectionTimeoutMillis\s*:/,
      `pool ${index} must not override the bounded setting with a different value`);
  }
  assert.ok(source.indexOf('assertApprovedFixtureTarget(process.env)') < source.indexOf('new Pool('),
    'operator approval must still precede both pool constructions');
});

// SET LOCAL success alone does not prove the effective timeout values on the
// same selected connection. Malformed/missing/disabled settings must fail
// before any tenant/financial reconciliation is allowed to execute.
test('effective verification timeouts are attested in the same transaction before inspection', async () => {
  const pool = recordingPool();
  let inspected = false;
  await withReadOnlyReconciliationSnapshot(pool, async () => { inspected = true; });
  const boundarySql = pool.events.find((e) => typeof e === 'string' && e.includes("current_setting('transaction_read_only')"));
  assert.match(boundarySql, /pg_settings/);
  for (const [setting, alias] of [['statement_timeout', 'statement_timeout_ms'],
    ['lock_timeout', 'lock_timeout_ms'], ['idle_in_transaction_session_timeout', 'idle_timeout_ms']]) {
    assert.ok(boundarySql.includes(`name = '${setting}'`), `missing ${setting} actual-value check`);
    assert.ok(boundarySql.includes(alias), `missing ${setting} alias`);
  }
  assert.equal(inspected, true);
});

test('missing, disabled, relaxed or malformed effective timeouts fail before reconciliation reads', async () => {
  const valid = { read_only: 'on', isolation_level: 'repeatable read', statement_timeout_ms: '120000',
    lock_timeout_ms: '5000', idle_timeout_ms: '30000' };
  for (const bad of [
    { statement_timeout_ms: '0' }, { statement_timeout_ms: '121000' },
    { lock_timeout_ms: '0' }, { lock_timeout_ms: '6000' },
    { idle_timeout_ms: '0' }, { idle_timeout_ms: '31000' },
    { statement_timeout_ms: null }, { lock_timeout_ms: '5s' },
  ]) {
    const events = [];
    const pool = { async connect() { return {
      async query(sql) {
        events.push(sql);
        if (sql.includes("current_setting('transaction_read_only')")) return { rows: [{ ...valid, ...bad }] };
        return { rows: [{ count: 0 }] };
      },
      release(destroy) { events.push(destroy ? 'DESTROY' : 'RELEASE'); },
    }; } };
    let inspected = false;
    await assert.rejects(withReadOnlyReconciliationSnapshot(pool, async () => { inspected = true; }),
      /transaction.*timeouts|reconciliation.*timeouts|verification timeouts/i, JSON.stringify(bad));
    assert.equal(inspected, false, `integrity data was inspected for ${JSON.stringify(bad)}`);
    assert.deepEqual(events.slice(-2), ['ROLLBACK', 'RELEASE']);
  }
});
