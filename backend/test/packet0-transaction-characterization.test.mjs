import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresCompatPool } from '../src/infrastructure/postgres/compat-pool.js';
import { runWithDatabaseActor, currentDatabaseActor } from '../src/infrastructure/postgres/context.js';

// Characterization-only: exercises the actual adapter with a recording transport.
// A fake transport CANNOT establish database RLS, pool isolation, or Supabase parity.
function recordingPool({ failOn = null } = {}) {
  const calls = [];
  const pool = {
    async query(sql, params) { return this.client.query(sql, params); },
    async connect() { return this.client; },
    client: {
      async query(sql, params = []) {
        calls.push({ sql: String(sql), params });
        if (failOn && String(sql).includes(failOn)) throw new Error('recorded transport failure');
        return { rows: [{ value: 1 }], rowCount: 1 };
      },
      release() { calls.push({ sql: 'RELEASE', params: [] }); },
    },
  };
  return { calls, adapter: createPostgresCompatPool(pool) };
}

function statements(calls) {
  return calls.map(({ sql }) => sql.includes("set_config('app.user_id'") ? 'SET LOCAL ACTOR' : sql);
}

test('one-shot compatibility query sets verified actor inside its own transaction before selecting', async () => {
  const { calls, adapter } = recordingPool();
  const result = await runWithDatabaseActor({ userId: 43, role: 'partner' }, () =>
    adapter.query('SELECT ? AS value', [1]));
  assert.equal(result[0][0].value, 1);
  assert.deepEqual(statements(calls), ['BEGIN', 'SET LOCAL ACTOR', 'SELECT $1 AS value', 'COMMIT', 'RELEASE']);
  assert.deepEqual(calls[1].params, ['43', 'partner', '']);
  assert.deepEqual(calls[2].params, [1]);
});

test('database failure rolls back and releases the connection, never commits', async () => {
  const { calls, adapter } = recordingPool({ failOn: 'SELECT $1 AS value' });
  await assert.rejects(
    runWithDatabaseActor({ userId: 44, role: 'customer' }, () => adapter.query('SELECT ? AS value', [1])),
    /recorded transport failure/,
  );
  assert.deepEqual(statements(calls), ['BEGIN', 'SET LOCAL ACTOR', 'SELECT $1 AS value', 'ROLLBACK', 'RELEASE']);
});

test('a transaction-scoped capability is set from the repository rather than the caller', async () => {
  const { calls } = recordingPool();
  const pool = {
    async connect() { return this.client; },
    async query(sql, params) { return this.client.query(sql, params); },
    client: {
      async query(sql, params = []) { calls.push({ sql: String(sql), params }); return { rows: [], rowCount: 0 }; },
      release() {},
    },
  };
  const adapter = createPostgresCompatPool(pool, { capability: 'catalog_read' });
  await runWithDatabaseActor({ userId: 10, role: 'customer', capability: 'payment_mutation' }, () =>
    adapter.query('SELECT 1'));
  const set = calls.find(({ sql }) => sql.includes("set_config('app.capability'"));
  assert.deepEqual(set.params, ['10', 'customer', 'catalog_read']);
});

test('explicit transaction facade sets local actor after BEGIN and commits before releasing', async () => {
  const { calls, adapter } = recordingPool();
  await runWithDatabaseActor({ userId: 21, role: 'admin' }, async () => {
    const connection = await adapter.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('SELECT 1 AS value');
      await connection.commit();
    } finally {
      connection.release();
    }
  });
  assert.deepEqual(statements(calls), ['BEGIN', 'SET LOCAL ACTOR', 'SELECT 1 AS value', 'COMMIT', 'RELEASE']);
});

test('asynchronous actor context does not merge identities of concurrent requests', async () => {
  const seen = await Promise.all([31, 32].map((userId) => runWithDatabaseActor({ userId, role: 'customer' }, async () => {
    await Promise.resolve();
    return currentDatabaseActor();
  })));
  assert.deepEqual(seen.map((actor) => actor.userId), [31, 32]);
  assert.deepEqual(seen.map((actor) => actor.role), ['customer', 'customer']);
  assert.equal(currentDatabaseActor().userId, null);
});

// Pool-cleanup regression: a failed transaction may retain the previous
// transaction's actor or an open transaction. The transport recording below
// is NOT a substitute for real app-role Supabase RLS/connection tests.
test('one-shot query discards the pooled connection when rollback fails', async () => {
  const released = [];
  const statementsSeen = [];
  const client = {
    async query(sql) {
      statementsSeen.push(String(sql));
      if (sql === 'ROLLBACK') throw new Error('rollback transport failure');
      if (sql === 'SELECT $1 AS value') throw new Error('original query failure');
      return { rows: [], rowCount: 0 };
    },
    release(destroy) { released.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  await assert.rejects(adapter.query('SELECT ? AS value', [1]), /original query failure/);
  assert.ok(statementsSeen.includes('ROLLBACK'));
  assert.deepEqual(released, [true], 'rollback failure must never recycle a tainted connection');
});

test('explicit transaction release discards an uncommitted connection', async () => {
  const released = [];
  const client = {
    async query() { return { rows: [], rowCount: 0 }; },
    release(destroy) { released.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const connection = await adapter.getConnection();
  await connection.beginTransaction();
  connection.release();
  assert.deepEqual(released, [true], 'uncommitted transaction must be physically discarded');
});

test('explicit transaction release discards a connection after context setup failure', async () => {
  const released = [];
  const client = {
    async query(sql) {
      if (String(sql).includes("set_config('app.user_id'")) throw new Error('actor context failure');
      return { rows: [], rowCount: 0 };
    },
    release(destroy) { released.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const connection = await adapter.getConnection();
  await assert.rejects(connection.beginTransaction(), /actor context failure/);
  connection.release();
  assert.deepEqual(released, [true], 'failed actor setup must never put an open transaction back in the pool');
});

test('explicit transaction release discards a connection after failed rollback', async () => {
  const released = [];
  const client = {
    async query(sql) {
      if (sql === 'ROLLBACK') throw new Error('rollback transport failure');
      return { rows: [], rowCount: 0 };
    },
    release(destroy) { released.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const connection = await adapter.getConnection();
  await connection.beginTransaction();
  await assert.rejects(connection.rollback(), /rollback transport failure/);
  connection.release();
  assert.deepEqual(released, [true]);
});

test('successful one-shot query and explicitly committed transaction reuse clean connections', async () => {
  const released = [];
  const client = {
    async query() { return { rows: [], rowCount: 0 }; },
    release(destroy) { released.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  await adapter.query('SELECT 1');
  const connection = await adapter.getConnection();
  await connection.beginTransaction();
  await connection.commit();
  connection.release();
  assert.deepEqual(released, [false, false], 'known clean transactions should remain reusable');
});

test('an ambiguous failed COMMIT destroys the one-shot connection even if rollback appears to succeed', async () => {
  const released = [];
  const client = {
    async query(sql) {
      if (sql === 'COMMIT') throw new Error('unknown commit outcome');
      return { rows: [], rowCount: 0 };
    },
    release(destroy) { released.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  await assert.rejects(adapter.query('SELECT 1'), /unknown commit outcome/);
  assert.deepEqual(released, [true]);
});

test('one-shot query discards a connection after BEGIN transport failure', async () => {
  const released = [];
  const client = {
    async query(sql) {
      if (sql === 'BEGIN') throw new Error('begin transport failure');
      return { rows: [], rowCount: 0 };
    },
    release(destroy) { released.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  await assert.rejects(adapter.query('SELECT 1'), /begin transport failure/);
  assert.deepEqual(released, [true], 'failed BEGIN must not return an uncertain connection to the pool');
});

// Lifecycle characterization: after a physical pool release, the borrowed
// client may belong to another request/tenant. A stale facade must not issue
// *any* SQL on it, regardless of whether its previous transaction committed.
test('released transaction facade cannot query on a client potentially reused by another actor', async () => {
  const statementsSeen = [];
  let releaseCalls = 0;
  const client = {
    async query(sql) {
      statementsSeen.push(String(sql));
      return { rows: [], rowCount: 0 };
    },
    release() { releaseCalls += 1; },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const connection = await adapter.getConnection();
  await connection.beginTransaction();
  await connection.commit();
  connection.release();
  const before = statementsSeen.length;
  await assert.rejects(connection.query('SELECT 1'), /released/i);
  assert.equal(statementsSeen.length, before, 'no SQL may reach a post-release pooled client');
  assert.equal(releaseCalls, 1);
});

test('released facade rejects transaction control after release without running SQL', async () => {
  const statementsSeen = [];
  const client = {
    async query(sql) { statementsSeen.push(String(sql)); return { rows: [], rowCount: 0 }; },
    release() {},
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const connection = await adapter.getConnection();
  connection.release();
  for (const operation of ['beginTransaction', 'commit', 'rollback']) {
    await assert.rejects(connection[operation](), /released/i, `${operation} must fail closed`);
  }
  assert.deepEqual(statementsSeen, [], 'no transaction command may reach the released client');
});

test('double release is rejected and does not release a pooled client twice', async () => {
  let releaseCalls = 0;
  const client = {
    async query() { return { rows: [], rowCount: 0 }; },
    release() { releaseCalls += 1; },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const connection = await adapter.getConnection();
  connection.release();
  assert.throws(() => connection.release(), /released/i);
  assert.equal(releaseCalls, 1);
});

test('repeated BEGIN cannot discard trusted actor context within an active transaction', async () => {
  const statementsSeen = [];
  const releases = [];
  const client = {
    async query(sql) { statementsSeen.push(String(sql)); return { rows: [], rowCount: 0 }; },
    release(destroy) { releases.push(Boolean(destroy)); },
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const connection = await adapter.getConnection();
  await connection.beginTransaction();
  await assert.rejects(connection.beginTransaction(), /already active|transaction/i);
  await connection.rollback();
  connection.release();
  assert.equal(statementsSeen.filter((sql) => sql === 'BEGIN').length, 1);
  assert.deepEqual(releases, [false], 'a rejected duplicate BEGIN must not taint an otherwise clean rollback');
});

// SQL conversion characterization: literal text, quoted identifiers and comments
// must retain their contents while legacy ? bind markers are converted.
// This is a recording-transport regression; live PG semantics remain unverified.
test('placeholder conversion preserves question marks and LIKE within string literals', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query("SELECT '?' AS literal, ? AS value, 'a LIKE b?' AS label", [19]);
  const sql = calls.find(({ sql }) => sql.startsWith('SELECT ') && !sql.includes('set_config('))?.sql;
  assert.equal(sql, "SELECT '?' AS literal, $1 AS value, 'a LIKE b?' AS label");
});

test('placeholder conversion does not rewrite SQL comments or quoted identifiers', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query('SELECT ? AS "field? LIKE x" /* ? LIKE ? */ -- ? LIKE ?\n', [20]);
  const sql = calls.find(({ sql }) => sql.startsWith('SELECT ') && !sql.includes('set_config('))?.sql;
  assert.equal(sql, 'SELECT $1 AS "field? LIKE x" /* ? LIKE ? */ -- ? LIKE ?');
});

test('placeholder conversion preserves PostgreSQL dollar-quoted content', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query('SELECT $notice$? LIKE ?$notice$ AS literal, ? AS value', [21]);
  const sql = calls.find(({ sql }) => sql.startsWith('SELECT ') && !sql.includes('set_config('))?.sql;
  assert.equal(sql, 'SELECT $notice$? LIKE ?$notice$ AS literal, $1 AS value');
});

test('placeholder conversion retains escaped quotes and existing password CAS behavior', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query("SELECT 'it''s ? LIKE ?' AS caption, ? AS value", [22]);
  const sql = calls.find(({ sql }) => sql.startsWith('SELECT ') && !sql.includes('set_config('))?.sql;
  assert.equal(sql, "SELECT 'it''s ? LIKE ?' AS caption, $1 AS value");
  const special = recordingPool();
  await special.adapter.query('UPDATE users SET password = ? WHERE CAST(password AS BINARY) = CAST(? AS BINARY)', ['new','old']);
  assert.equal(special.calls.find(({ sql: stmt }) => stmt.startsWith('UPDATE'))?.sql,
    'UPDATE users SET password = $1 WHERE password = $2');
});

test('INSERT RETURNING detection ignores quoted text and comments', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query("INSERT INTO audit_logs (action, description) VALUES (?, 'RETURNING ?') /* RETURNING */", ['created']);
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO'))?.sql;
  assert.equal(insert, "INSERT INTO audit_logs (action, description) VALUES ($1, 'RETURNING ?') /* RETURNING */ RETURNING id");
  const explicit = recordingPool();
  await explicit.adapter.query('INSERT INTO audit_logs (action) VALUES (?) RETURNING id', ['created']);
  assert.equal(explicit.calls.find(({ sql }) => sql.startsWith('INSERT INTO'))?.sql,
    'INSERT INTO audit_logs (action) VALUES ($1) RETURNING id');
});

// A facade can be retained while an asynchronous query is still executing.
// Releasing it early returns a live connection (and its transaction-local actor)
// to the pool while another request may borrow it. The mock only proves that
// the adapter prevents overlapping operations; live Supabase/RLS still needs
// verification with the non-BYPASSRLS application role.
function stalledSqlClient(stallCommand = 'SELECT 1') {
  const calls = [];
  let signalEntered;
  let resume;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  const blocked = new Promise((resolve) => { resume = resolve; });
  const client = {
    async query(sql) {
      calls.push(String(sql));
      if (sql === stallCommand) {
        signalEntered();
        await blocked;
      }
      return { rows: [{ value: 1 }], rowCount: 1 };
    },
    release(destroy) { calls.push(`RELEASE:${Boolean(destroy)}`); },
  };
  return {
    calls, entered, resume,
    adapter: createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client }),
  };
}

test('release cannot return a connection to the pool during a pending SELECT', async () => {
  const { calls, entered, resume, adapter } = stalledSqlClient();
  const connection = await adapter.getConnection();
  const pending = connection.query('SELECT 1');
  await entered;
  try {
    assert.throws(() => connection.release(), /in progress|busy|pending/i);
    assert.equal(calls.filter((entry) => entry.startsWith('RELEASE')).length, 0);
  } finally { resume(); }
  await pending;
  await connection.commit();
  connection.release();
  assert.equal(calls.filter((entry) => entry.startsWith('RELEASE')).length, 1);
});

test('concurrent operations on one transaction facade cannot interleave queries or COMMIT', async () => {
  const { calls, entered, resume, adapter } = stalledSqlClient();
  const connection = await adapter.getConnection();
  const pending = connection.query('SELECT 1');
  await entered;
  try {
    await assert.rejects(connection.query('SELECT 2'), /in progress|busy|pending/i);
    await assert.rejects(connection.commit(), /in progress|busy|pending/i);
    await assert.rejects(connection.rollback(), /in progress|busy|pending/i);
    assert.equal(calls.filter((entry) => entry === 'SELECT 2' || entry === 'COMMIT' || entry === 'ROLLBACK').length, 0);
  } finally { resume(); }
  await pending;
  await connection.rollback();
  connection.release();
});

test('connection cannot be released while BEGIN/actor setup is in progress', async () => {
  const { calls, entered, resume, adapter } = stalledSqlClient('BEGIN');
  const connection = await adapter.getConnection();
  const pending = connection.beginTransaction();
  await entered;
  try {
    assert.throws(() => connection.release(), /in progress|busy|pending/i);
    assert.equal(calls.filter((entry) => entry.startsWith('RELEASE')).length, 0);
  } finally { resume(); }
  await pending;
  await connection.rollback();
  connection.release();
});

// Packet 0 SQL result-shape characterization: the compatibility layer must
// classify the first SQL keyword outside comments and never infer result
// aliases from string/comment content. This is a recording transport only.
test('a leading SQL block comment does not turn a SELECT into a mutation result', async () => {
  const { calls, adapter } = recordingPool();
  const [rows] = await adapter.query('/* NearPill actor trace */ SELECT ? AS value', [23]);
  assert.equal(rows[0].value, 1, 'SELECT must retain the read-row contract');
  assert.ok(calls.some(({ sql }) => sql === '/* NearPill actor trace */ SELECT $1 AS value'));
});

test('a leading SQL line comment does not suppress INSERT RETURNING id', async () => {
  const statementsSeen = [];
  const client = {
    async query(sql) {
      statementsSeen.push(String(sql));
      return { rows: [{ id: 93 }], rowCount: 1 };
    },
    release() {},
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const [result] = await adapter.query('-- audit scope\nINSERT INTO audit_logs (action) VALUES (?)', ['created']);
  assert.equal(result.insertId, 93);
  assert.ok(statementsSeen.includes('-- audit scope\nINSERT INTO audit_logs (action) VALUES ($1) RETURNING id'));
});

test('AS words inside SQL literals and comments do not rename actual returned columns', async () => {
  const client = {
    async query() { return { rows: [{ status: 'ready', label: 'literal' }], rowCount: 1 }; },
    release() {},
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const [rows] = await adapter.query("SELECT 'AS Status' AS label, status FROM orders /* AS Status */");
  assert.deepEqual(rows, [{ status: 'ready', label: 'literal' }]);
});

// The SQL result mapper must preserve arbitrary database column names as data.
// An own column called __proto__ must not disappear or become the prototype of
// the returned row. These recording-pool tests do not establish live RLS.
test('SQL result mapping preserves an own __proto__ string column', async () => {
  const row = Object.defineProperty({ value: 7 }, '__proto__', {
    value: 'database-column', enumerable: true, configurable: true,
  });
  const client = {
    async query() { return { rows: [row], rowCount: 1 }; },
    release() {},
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const [rows] = await adapter.query('SELECT 7 AS value, 1 AS __proto__');
  assert.equal(Object.hasOwn(rows[0], '__proto__'), true);
  assert.equal(rows[0].__proto__, 'database-column');
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
  assert.equal(rows[0].value, 7);
});

test('SQL result mapping never adopts a database value object as a row prototype', async () => {
  const injectedValue = { suspicious: 'database data, not inheritance' };
  const row = Object.defineProperty({ status: 'ready' }, '__proto__', {
    value: injectedValue, enumerable: true, configurable: true,
  });
  const client = {
    async query() { return { rows: [row], rowCount: 1 }; },
    release() {},
  };
  const adapter = createPostgresCompatPool({ query: client.query.bind(client), connect: async () => client });
  const [rows] = await adapter.query('SELECT status, 1 AS __proto__ FROM orders');
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
  assert.equal(Object.hasOwn(rows[0], '__proto__'), true);
  assert.strictEqual(rows[0].__proto__, injectedValue);
  assert.equal(Object.hasOwn(rows[0], 'suspicious'), false);
  assert.equal(rows[0].status, 'ready');
});

// Trailing SQL trivia must never swallow an implicit RETURNING clause. In
// particular, '-- ...' comments extend to newline/end-of-input, and SQL
// statement terminators belong after RETURNING, not before it.
test('implicit INSERT RETURNING remains executable ahead of a trailing line comment', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query('INSERT INTO audit_logs (action) VALUES (?) -- audited action', ['created']);
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO'))?.sql;
  assert.equal(insert, 'INSERT INTO audit_logs (action) VALUES ($1) RETURNING id -- audited action');
});

test('implicit INSERT RETURNING precedes a terminating semicolon and subsequent comment', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query('INSERT INTO audit_logs (action) VALUES (?); /* audit note */', ['created']);
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO'))?.sql;
  assert.equal(insert, 'INSERT INTO audit_logs (action) VALUES ($1) RETURNING id; /* audit note */');
});

test('explicit INSERT RETURNING is not duplicated when followed by comments', async () => {
  const { calls, adapter } = recordingPool();
  await adapter.query('INSERT INTO audit_logs (action) VALUES (?) RETURNING id; -- retained', ['created']);
  const insert = calls.find(({ sql }) => sql.startsWith('INSERT INTO'))?.sql;
  assert.equal(insert, 'INSERT INTO audit_logs (action) VALUES ($1) RETURNING id; -- retained');
});

// Identity/session persistence uses its own transaction wrapper rather than
// compat-pool. A rollback/commit failure must never return an ambiguous
// session-bearing connection to a different actor through the reusable pool.
// These transport recordings are NOT a real Supabase application-role RLS test.
function securityRepositoryRecording({ failAt = null, failRollback = false, stalePassword = false } = {}) {
  const calls = [];
  const released = [];
  const client = {
    async query(sql, params = []) {
      const statement = String(sql);
      calls.push({ sql: statement, params });
      if ((failAt && statement.includes(failAt)) || (failRollback && statement === 'ROLLBACK')) {
        throw new Error(statement === 'ROLLBACK' ? 'rollback transport failure' : `failed at ${failAt}`);
      }
      if (stalePassword && statement.includes('FOR SHARE')) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
    release(discard) { released.push(Boolean(discard)); },
  };
  return { calls, released, pool: { connect: async () => client } };
}

async function issueRecordedSecurityCredentials(pool, verifiedPasswordHash) {
  const { createPostgresSecurityRepository } = await import('../src/infrastructure/postgres/security-repository.js');
  return createPostgresSecurityRepository(pool).issueCredentialSet({
    userId: 7,
    verifiedPasswordHash,
    familyId: 'family-test',
    accessHash: 'access-hash',
    refreshHash: 'refresh-hash',
    accessExpiresAt: new Date('2026-10-30T00:00:00Z'),
    refreshExpiresAt: new Date('2026-11-30T00:00:00Z'),
  });
}

test('identity repository declines session issuance after the verified password changes', async () => {
  const record = securityRepositoryRecording({ stalePassword: true });
  assert.equal(await issueRecordedSecurityCredentials(record.pool, 'old-hash'), false);
  assert.deepEqual(record.calls.find(({ sql }) => sql.includes('FOR SHARE'))?.params, [7, 'old-hash']);
  assert.ok(!record.calls.some(({ sql }) => sql.startsWith('INSERT INTO auth_session')));
});

test('identity repository commits cleanly and reuses only a safe connection', async () => {
  const record = securityRepositoryRecording();
  assert.equal(await issueRecordedSecurityCredentials(record.pool), true);
  assert.equal(record.calls[0].sql, 'BEGIN');
  assert.ok(record.calls[1].sql.includes("set_config('app.user_id'"));
  assert.equal(record.calls.at(-1).sql, 'COMMIT');
  assert.deepEqual(record.released, [false]);
});

test('identity repository rolls back a statement error and may safely reuse the clean connection', async () => {
  const record = securityRepositoryRecording({ failAt: 'INSERT INTO auth_session_families' });
  await assert.rejects(issueRecordedSecurityCredentials(record.pool), /failed at INSERT INTO auth_session_families/);
  assert.equal(record.calls.at(-1).sql, 'ROLLBACK');
  assert.deepEqual(record.released, [false]);
});

for (const [label, options, expected] of [
  ['BEGIN failure', { failAt: 'BEGIN' }, /failed at BEGIN/],
  ['ROLLBACK failure', { failAt: 'INSERT INTO auth_session_families', failRollback: true }, /failed at INSERT INTO auth_session_families/],
  ['COMMIT failure', { failAt: 'COMMIT' }, /failed at COMMIT/],
]) {
  test(`identity repository discards pooled connection after ${label}`, async () => {
    const record = securityRepositoryRecording(options);
    await assert.rejects(issueRecordedSecurityCredentials(record.pool), expected);
    assert.deepEqual(record.released, [true], 'uncertain identity transaction must not be reused');
    assert.ok(record.calls.some(({ sql }) => sql === 'ROLLBACK'), 'cleanup attempted');
  });
}
