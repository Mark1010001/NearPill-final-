import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { executeReviewedMigration } from '../scripts/lib/execute-reviewed-migration.mjs';

const filename = '0001_core.sql';
const sql = 'CREATE TABLE synthetic_fixture_only (id integer)';
const sha256 = createHash('sha256').update(sql).digest('hex');
const reviewedMigrations = [{ filename, sha256 }];

function recordingClient({ existing = [], failOn = null, lockGate = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(query, params = []) {
      const statement = String(query).trim();
      calls.push({ statement, params });
      if (failOn && statement.includes(failOn)) throw new Error('synthetic database failure');
      if (statement.includes('pg_advisory_xact_lock') && lockGate) await lockGate();
      if (statement.startsWith('SELECT filename, sha256 FROM nearpill_schema_migrations')) {
        return { rows: existing };
      }
      return { rows: [] };
    },
  };
}

function position(calls, substring) {
  return calls.findIndex(({ statement }) => statement.includes(substring));
}

test('canonical runner delegates to one serialized migration executor after role verification', async () => {
  const source = await readFile(new URL('../scripts/migrate-postgres.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('assertApprovedMigrationTarget(process.env)') < source.indexOf('new Pool('));
  assert.ok(source.indexOf('assertSafeMigrationSession(client, process.env)') < source.indexOf('executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations })'));
  assert.match(source, /createHash\('sha256'\)/);
  assert.doesNotMatch(source, /await client\.query\(sql\)/);
});

test('lock is acquired inside transaction before touching journal or executing SQL', async () => {
  const client = recordingClient();
  assert.equal(await executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }), 'applied');
  const calls = client.calls;
  assert.equal(calls[0].statement, 'BEGIN');
  assert.equal(calls[1].statement, "SET LOCAL lock_timeout = '30s'");
  assert.ok(position(calls, 'SET LOCAL lock_timeout') < position(calls, 'pg_advisory_xact_lock'));
  assert.ok(position(calls, 'pg_advisory_xact_lock') < position(calls, 'CREATE TABLE IF NOT EXISTS nearpill_schema_migrations'));
  assert.ok(position(calls, 'pg_advisory_xact_lock') < position(calls, 'SELECT filename, sha256 FROM nearpill_schema_migrations'));
  assert.ok(position(calls, 'SELECT filename, sha256 FROM nearpill_schema_migrations') < position(calls, sql));
  assert.ok(position(calls, sql) < position(calls, 'INSERT INTO nearpill_schema_migrations'));
  assert.deepEqual(calls.filter(({ statement }) => statement.includes('pg_advisory_xact_lock')).map(({ params }) => params), [[1313886796,1296646725]]);
  assert.equal(calls.at(-1).statement, 'COMMIT');
  assert.equal(position(calls, 'ROLLBACK'), -1);
});

test('existing matching migration skips DDL and commits the lock transaction', async () => {
  const client = recordingClient({ existing: [{ filename, sha256 }] });
  assert.equal(await executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }), 'skipped');
  assert.equal(position(client.calls, sql), -1);
  assert.equal(position(client.calls, 'INSERT INTO nearpill_schema_migrations'), -1);
  assert.equal(client.calls.at(-1).statement, 'COMMIT');
});

test('checksum mismatch refuses without running DDL and rolls back', async () => {
  const client = recordingClient({ existing: [{ filename, sha256: 'b'.repeat(64) }] });
  await assert.rejects(executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }), /migration journal drift/);
  assert.equal(position(client.calls, sql), -1);
  assert.equal(client.calls.at(-1).statement, 'ROLLBACK');
});

test('failed lock timeout setup, lock acquisition or DDL rolls back without journal commit', async () => {
  for (const failOn of ['SET LOCAL lock_timeout', 'pg_advisory_xact_lock', sql, 'INSERT INTO nearpill_schema_migrations']) {
    const client = recordingClient({ failOn });
    await assert.rejects(executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }), /synthetic database failure/);
    assert.equal(client.calls.at(-1).statement, 'ROLLBACK');
    assert.equal(position(client.calls, 'COMMIT'), -1);
  }
});

test('invalid SQL migration input fails before opening a transaction', async () => {
  for (const item of [
    { filename: '../malicious.sql', sql, sha256 },
    { filename: 'malicious.sql', sql, sha256 },
    { filename, sql: '  ', sha256 },
    { filename, sql, sha256: 'invalid' },
  ]) {
    const client = recordingClient();
    await assert.rejects(executeReviewedMigration(client, { ...item, reviewedMigrations }), /Migration refused/);
    assert.equal(client.calls.length, 0);
  }
});

test('refuses SQL bytes that do not match the claimed reviewed SHA-256 before BEGIN', async () => {
  for (const changedSql of [
    `${sql}\n-- unexpected change`,
    'DROP TABLE synthetic_fixture_only',
  ]) {
    for (const existing of [[], [{ filename, sha256 }]]) {
      const client = recordingClient({ existing });
      await assert.rejects(
        executeReviewedMigration(client, { filename, sql: changedSql, sha256, reviewedMigrations }),
        /invalid reviewed SQL migration input/,
      );
      assert.equal(client.calls.length, 0, 'checksum mismatch must be refused before BEGIN even on a skip');
    }
  }
});

test('refuses matching but fabricated manifest and argument digests for altered SQL', async () => {
  const spoofed = 'f'.repeat(64);
  const client = recordingClient();
  await assert.rejects(
    executeReviewedMigration(client, { filename, sql, sha256: spoofed,
      reviewedMigrations: [{ filename, sha256: spoofed }] }),
    /invalid reviewed SQL migration input/,
  );
  assert.equal(client.calls.length, 0);
});

test('runner waits for migration lock before even reading journal', async () => {
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const lockGate = () => { entered(); return new Promise((resolve) => { release = resolve; }); };
  const client = recordingClient({ lockGate });
  const running = executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations });
  await enteredPromise;
  assert.equal(position(client.calls, 'SELECT filename, sha256 FROM nearpill_schema_migrations'), -1);
  assert.equal(position(client.calls, sql), -1);
  release();
  assert.equal(await running, 'applied');
});

test('malformed migration journal results are rejected, not mistaken for an unapplied file', async () => {
  for (const existing of [null, [{filename, sha256}, {filename, sha256}]]) {
    const client = recordingClient({ existing });
    await assert.rejects(executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }), /journal result/);
    assert.equal(client.calls.at(-1).statement, 'ROLLBACK');
    assert.equal(position(client.calls, sql), -1);
  }
});


test('lock-timeout failure propagates and rolls back without applying SQL or persisting session settings', async () => {
  const calls = [];
  const timeoutError = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
  const client = {
    async query(statement, params = []) {
      calls.push({ statement: String(statement).trim(), params });
      if (String(statement).includes('pg_advisory_xact_lock')) throw timeoutError;
      return { rows: [] };
    },
  };
  await assert.rejects(executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }), (error) =>
    error === timeoutError && error.code === '55P03');
  assert.deepEqual(calls.map((entry) => entry.statement), [
    'BEGIN',
    "SET LOCAL lock_timeout = '30s'",
    'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
    'ROLLBACK',
  ]);
  assert.equal(calls.some(({ statement }) => /^SET lock_timeout\b/i.test(statement)), false);
});

test('refuses an unknown or renamed migration already present in the journal', async () => {
  const client = recordingClient({ existing: [{ filename: '0001_unreviewed.sql', sha256 }] });
  await assert.rejects(
    executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }),
    /journal drift/,
  );
  assert.equal(position(client.calls, sql), -1);
  assert.equal(client.calls.at(-1).statement, 'ROLLBACK');
});

test('refuses a journal gap or changed checksum in a later reviewed migration', async () => {
  const second = { filename: '0002_catalog.sql', sha256: 'b'.repeat(64) };
  const fullBatch = [...reviewedMigrations, second];
  for (const existing of [
    [second], // migration 0002 present without its predecessor
    [{ filename, sha256 }, { ...second, sha256: 'c'.repeat(64) }],
  ]) {
    const client = recordingClient({ existing });
    await assert.rejects(
      executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations: fullBatch }),
      /journal drift/,
    );
    assert.equal(position(client.calls, sql), -1);
    assert.equal(client.calls.at(-1).statement, 'ROLLBACK');
  }
});

test('prevents skipping a missing predecessor and accepts a complete reviewed prefix', async () => {
  const secondSql = 'CREATE TABLE synthetic_catalog_fixture (id integer)';
  const second = { filename: '0002_catalog.sql', sha256: createHash('sha256').update(secondSql).digest('hex') };
  const fullBatch = [...reviewedMigrations, second];
  const gap = recordingClient();
  await assert.rejects(
    executeReviewedMigration(gap, { ...second, sql: secondSql, reviewedMigrations: fullBatch }),
    /earlier reviewed migration/,
  );
  assert.equal(position(gap.calls, secondSql), -1);
  assert.equal(gap.calls.at(-1).statement, 'ROLLBACK');

  const prefix = recordingClient({ existing: [{ filename, sha256 }] });
  assert.equal(await executeReviewedMigration(prefix,
    { ...second, sql: secondSql, reviewedMigrations: fullBatch }), 'applied');
  assert.ok(position(prefix.calls, 'SELECT filename, sha256 FROM nearpill_schema_migrations') <
    position(prefix.calls, secondSql));
  assert.equal(prefix.calls.at(-1).statement, 'COMMIT');
});

test('checks the full reviewed source manifest before touching PostgreSQL', async () => {
  for (const manifest of [
    undefined,
    [],
    [{ filename, sha256: 'wrong' }],
    [{ filename: '0002_future.sql', sha256 }],
    [{ filename, sha256 }, { filename: '0001_duplicate.sql', sha256 }],
  ]) {
    const client = recordingClient();
    await assert.rejects(
      executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations: manifest }),
      /Migration refused/,
    );
    assert.equal(client.calls.length, 0);
  }
});
