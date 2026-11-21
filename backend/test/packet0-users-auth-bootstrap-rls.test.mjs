import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresIdentityRepository } from '../src/infrastructure/postgres/identity-repository.js';
import { createPostgresSecurityRepository } from '../src/infrastructure/postgres/security-repository.js';
import { createPostgresOrderRepository } from '../src/infrastructure/postgres/order-repository.js';
import { createPostgresReportRepository } from '../src/infrastructure/postgres/report-repository.js';
import { createPostgresPaymentSubscriptionRepository } from '../src/infrastructure/postgres/payment-subscription-repository.js';
import { runWithDatabaseActor } from '../src/infrastructure/postgres/context.js';

// Packet 0 characterization only: these recording clients reveal which
// *current* users-table operations precede verified identity. No RLS/grant,
// migration, role or real PostgreSQL behavior is being certified here.
function recordingPool(resolveRows = () => []) {
  const calls = [];
  let releases = 0;
  const pool = {
    async query() { throw new Error('Repository unexpectedly bypassed its transaction client'); },
    async connect() {
      return {
        async query(sql, params = []) {
          calls.push({ sql: String(sql), params });
          const rows = resolveRows(String(sql), params);
          return { rows, rowCount: rows.length || (String(sql).includes('INSERT INTO users') ? 1 : 0) };
        },
        release(discard = false) { calls.push({ sql: 'RELEASE', discard }); releases += 1; },
      };
    },
  };
  return { pool, calls, get releases() { return releases; } };
}

function expectTransaction(calls) {
  assert.equal(calls[0].sql, 'BEGIN', 'Postgres actor state must be transaction-local');
  assert.match(calls[1].sql, /set_config\('app\.user_id',\s*\$1,\s*true\)/);
  assert.match(calls[1].sql, /set_config\('app\.role',\s*\$2,\s*true\)/);
  assert.match(calls[1].sql, /set_config\('app\.capability',\s*\$3,\s*true\)/);
  assert.equal(calls.at(-2).sql, 'COMMIT');
  assert.equal(calls.at(-1).sql, 'RELEASE');
  assert.equal(calls.at(-1).discard, false);
}

test('NP-031 baseline: login and recovery users reads happen before a verified actor exists', async () => {
  const observed = recordingPool((sql) => sql.includes('FROM users')
    ? [{ id: 17, email: 'fixture@example.invalid', role: 'customer' }] : []);
  const repo = createPostgresIdentityRepository(observed.pool);
  const result = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.findAuthUserByEmail('fixture@example.invalid'));
  assert.equal(result.id, 17);
  const recovery = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.findRecoveryAccountByEmail('fixture@example.invalid'));
  assert.equal(recovery.id, 17);
  assert.equal(observed.releases, 2);
  for (const chunk of [observed.calls.slice(0, 5), observed.calls.slice(5)]) {
    expectTransaction(chunk);
    assert.deepEqual(chunk[1].params, ['', 'anonymous', 'identity_lookup:fixture@example.invalid']);
    assert.match(chunk[2].sql, /FROM users WHERE email = \$1 LIMIT 1/);
    assert.deepEqual(chunk[2].params, ['fixture@example.invalid']);
  }
});

test('NP-031 baseline: account creation writes users within an unverified-actor transaction', async () => {
  const observed = recordingPool((sql) => sql.includes('INSERT INTO users') ? [{ id: 29 }] : []);
  const repo = createPostgresIdentityRepository(observed.pool);
  const id = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.createCustomer({ name: 'Fixture', email: 'fixture@example.invalid', passwordHash: 'nonsecret-test-hash' }));
  assert.equal(id, 29);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'anonymous', 'identity_register:fixture@example.invalid']);
  assert.match(observed.calls[2].sql, /INSERT INTO users[\s\S]*RETURNING id/i);
  assert.deepEqual(observed.calls[2].params.slice(0, 2), ['Fixture', 'fixture@example.invalid']);
});

test('NP-031 baseline: hashed session lookup joins users under system capability before assigning the proven actor', async () => {
  const observed = recordingPool((sql) => {
    if (sql.includes('FROM auth_sessions s') && sql.includes('INNER JOIN users u')) {
      return [{ id: 1, user_id: 17, token_kind: 'web', family_id: null,
        csrf_hash: 'nonsecret-csrf-hash', expires_at: new Date('2030-01-01T00:00:00Z'),
        name: 'Fixture', email: 'fixture@example.invalid', role: 'customer' }];
    }
    return [];
  });
  const repo = createPostgresSecurityRepository(observed.pool);
  const result = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.findActiveSession('synthetic-hashed-token', ['web']));
  assert.equal(result?.userId, 17);
  assert.equal(result?.user?.role, 'customer');
  assert.equal(observed.releases, 1);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'system', 'identity_security'],
    'pre-actor identity bootstrap currently requires a system capability');
  assert.match(observed.calls[2].sql, /INNER JOIN users u ON u\.id = s\.user_id/);
  assert.deepEqual(observed.calls[2].params, ['synthetic-hashed-token', ['web']]);
  assert.deepEqual(observed.calls[3].params, ['17', 'customer', 'identity_security'],
    'request actor must not be installed before the credential lookup resolves');
  assert.match(observed.calls[4].sql, /FROM pharmacy_memberships/);
});

test('NP-031 baseline: registration/OTP uniqueness probes query users before identity verification', async () => {
  const observed = recordingPool((sql) => sql.includes('SELECT id FROM users') ? [{ id: 17 }] : []);
  const repo = createPostgresIdentityRepository(observed.pool);
  const account = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.findIdByEmail('fixture@example.invalid'));
  assert.equal(account?.id, 17);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'anonymous', 'identity_lookup:fixture@example.invalid']);
  assert.match(observed.calls[2].sql, /^SELECT id FROM users WHERE email = \$1 LIMIT 1$/);
  assert.deepEqual(observed.calls[2].params, ['fixture@example.invalid']);
});

test('NP-031 baseline: legacy hash upgrade uses compare-and-swap users UPDATE before login actor is verified', async () => {
  const observed = recordingPool((sql) => sql.startsWith('UPDATE users SET password') ? [{ id: 17 }] : []);
  const repo = createPostgresIdentityRepository(observed.pool);
  const affected = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.replacePasswordIfCurrent({
      userId: 17,
      newPasswordHash: 'synthetic-new-hash',
      currentPasswordHash: 'synthetic-prior-hash',
    }));
  assert.equal(affected, 1);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'anonymous', 'identity_password:17']);
  assert.match(observed.calls[2].sql, /UPDATE users SET password = \$1 WHERE id = \$2 AND password = \$3/i);
  assert.deepEqual(observed.calls[2].params, ['synthetic-new-hash', 17, 'synthetic-prior-hash']);
});

test('NP-031 baseline: token-verified recovery updates users under the backend identity capability and revokes sessions atomically', async () => {
  const observed = recordingPool((sql) => {
    if (sql.includes('FROM reset_links') && sql.includes('FOR UPDATE')) {
      return [{ id: 4, user_id: 17, email: 'fixture@example.invalid',
        expires_at: new Date('2030-01-01T00:00:00Z'), consumed_at: null }];
    }
    if (sql.includes('UPDATE users SET password')) return [{ id: 17 }];
    return [];
  });
  const repo = createPostgresSecurityRepository(observed.pool);
  const result = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.resetPasswordWithChallenge({ tokenHash: 'synthetic-reset-hash', passwordHash: 'synthetic-password-hash' }));
  assert.deepEqual(result, { status: 'reset', userId: 17, email: 'fixture@example.invalid' });
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'system', 'identity_security']);
  assert.match(observed.calls[2].sql, /FROM reset_links WHERE token_hash = \$1 FOR UPDATE/);
  assert.deepEqual(observed.calls[2].params, ['synthetic-reset-hash']);
  assert.match(observed.calls[3].sql, /UPDATE users SET password = \$2 WHERE id = \$1/);
  assert.deepEqual(observed.calls[3].params, [17, 'synthetic-password-hash']);
  assert.match(observed.calls[4].sql, /UPDATE reset_links SET consumed_at/);
  assert.match(observed.calls[5].sql, /UPDATE auth_session_families SET revoked_at/);
  assert.match(observed.calls[6].sql, /UPDATE auth_sessions SET revoked_at/);
  assert.equal(observed.calls.filter(({ sql }) => sql.includes("set_config('app.user_id'")).length, 1,
    'the reset transaction must not impersonate a verified session actor');
});


test('NP-031 negative baseline: membership lookup failure rolls back the verified-actor session transaction', async () => {
  const observed = recordingPool((sql) => {
    if (sql.includes('FROM auth_sessions s') && sql.includes('INNER JOIN users u')) {
      return [{ id: 8, user_id: 17, token_kind: 'web', family_id: null,
        csrf_hash: 'fixture-csrf-hash', expires_at: new Date('2030-01-01T00:00:00Z'),
        name: 'Fixture', email: 'fixture@example.invalid', role: 'customer' }];
    }
    if (sql.includes('FROM pharmacy_memberships')) throw new Error('synthetic membership lookup failure');
    return [];
  });
  const repo = createPostgresSecurityRepository(observed.pool);
  await assert.rejects(
    runWithDatabaseActor({ role: 'anonymous' }, () => repo.findActiveSession('synthetic-hashed-token', ['web'])),
    /synthetic membership lookup failure/,
  );
  assert.deepEqual(observed.calls.slice(-2).map((call) => call.sql), ['ROLLBACK', 'RELEASE']);
  assert.equal(observed.calls.at(-1).discard, false,
    'a successful rollback cleans transaction-local identity even after a verified actor was installed');
  assert.equal(observed.calls.some(({ sql }) => sql === 'COMMIT'), false,
    'failed authorization membership loading must never commit a partial session');
  assert.deepEqual(observed.calls[1].params, ['', 'system', 'identity_security']);
  assert.deepEqual(observed.calls[3].params, ['17', 'customer', 'identity_security']);
});

test('NP-031 negative baseline: password reset session-revocation failure rolls back all identity writes', async () => {
  const observed = recordingPool((sql) => {
    if (sql.includes('FROM reset_links') && sql.includes('FOR UPDATE')) {
      return [{ id: 4, user_id: 17, email: 'fixture@example.invalid',
        expires_at: new Date('2030-01-01T00:00:00Z'), consumed_at: null }];
    }
    if (sql.startsWith('UPDATE users SET password')) return [{ id: 17 }];
    if (sql.startsWith('UPDATE auth_sessions SET revoked_at')) {
      throw new Error('synthetic session revocation failure');
    }
    return [];
  });
  const repo = createPostgresSecurityRepository(observed.pool);
  await assert.rejects(
    runWithDatabaseActor({ role: 'anonymous' }, () => repo.resetPasswordWithChallenge({
      tokenHash: 'synthetic-reset-hash', passwordHash: 'synthetic-password-hash',
    })),
    /synthetic session revocation failure/,
  );
  assert.ok(observed.calls.some(({ sql }) => sql.startsWith('UPDATE users SET password')));
  assert.ok(observed.calls.some(({ sql }) => sql.startsWith('UPDATE reset_links SET consumed_at')));
  assert.ok(observed.calls.some(({ sql }) => sql.startsWith('UPDATE auth_session_families SET revoked_at')));
  assert.deepEqual(observed.calls.slice(-2).map((call) => call.sql), ['ROLLBACK', 'RELEASE']);
  assert.equal(observed.calls.at(-1).discard, false, 'successful rollback permits connection reuse');
  assert.equal(observed.calls.some(({ sql }) => sql === 'COMMIT'), false,
    'password update/challenge consumption/family revocation must not commit if session revocation fails');
  const actorWrites = observed.calls.filter(({ sql }) => sql.includes("set_config('app.user_id'"));
  assert.equal(actorWrites.length, 1);
  assert.deepEqual(actorWrites[0].params, ['', 'system', 'identity_security']);
});

// Refresh-token authorization also reads users before the token has been
// validated. A users RLS remedy must preserve this narrow backend-owned
// bootstrap while preventing broad reads by an unverified caller.
test('NP-031 baseline: refresh rotation joins users under identity_security before token verification', async () => {
  const observed = recordingPool((sql) => {
    if (sql.includes('FROM auth_sessions s') && sql.includes('INNER JOIN users u') && sql.includes('FOR UPDATE OF s, f')) {
      return [{ id: 6, user_id: 17, family_id: 'synthetic-family',
        expires_at: new Date('2030-01-01T00:00:00Z'), consumed_at: null,
        revoked_at: null, family_revoked_at: null, role: 'customer' }];
    }
    return [];
  });
  const repo = createPostgresSecurityRepository(observed.pool);
  const result = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.rotateRefreshToken({ tokenHash: 'synthetic-old-refresh-hash',
      newAccessHash: 'synthetic-new-access-hash', newRefreshHash: 'synthetic-new-refresh-hash',
      accessExpiresAt: new Date('2030-01-01T00:00:00Z'),
      refreshExpiresAt: new Date('2030-02-01T00:00:00Z') }));
  assert.deepEqual(result, { status: 'rotated', userId: 17,
    familyId: 'synthetic-family', role: 'customer' });
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'system', 'identity_security']);
  assert.match(observed.calls[2].sql, /INNER JOIN users u ON u\.id = s\.user_id/);
  assert.match(observed.calls[2].sql, /FOR UPDATE OF s, f/);
  assert.deepEqual(observed.calls[2].params, ['synthetic-old-refresh-hash']);
  assert.match(observed.calls[3].sql, /UPDATE auth_sessions SET consumed_at/);
  assert.match(observed.calls[4].sql, /INSERT INTO auth_sessions/);
  assert.equal(observed.calls.filter(({ sql }) => sql.includes("set_config('app.user_id'")).length, 1,
    'the refresh path must not promote the unverified request to user context');
});

test('NP-031 negative baseline: replayed refresh token revokes its family under system capability', async () => {
  const observed = recordingPool((sql) => {
    if (sql.includes('FROM auth_sessions s') && sql.includes('INNER JOIN users u') && sql.includes('FOR UPDATE OF s, f')) {
      return [{ id: 6, user_id: 17, family_id: 'synthetic-family',
        expires_at: new Date('2030-01-01T00:00:00Z'),
        consumed_at: new Date('2026-01-01T00:00:00Z'),
        revoked_at: null, family_revoked_at: null, role: 'customer' }];
    }
    return [];
  });
  const repo = createPostgresSecurityRepository(observed.pool);
  const result = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.rotateRefreshToken({ tokenHash: 'synthetic-used-refresh-hash',
      newAccessHash: 'synthetic-unused-access', newRefreshHash: 'synthetic-unused-refresh',
      accessExpiresAt: new Date('2030-01-01T00:00:00Z'),
      refreshExpiresAt: new Date('2030-02-01T00:00:00Z') }));
  assert.deepEqual(result, { status: 'replay' });
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'system', 'identity_security']);
  assert.match(observed.calls[3].sql, /UPDATE auth_session_families SET revoked_at/);
  assert.match(observed.calls[4].sql, /UPDATE auth_sessions SET revoked_at/);
  assert.equal(observed.calls.some(({ sql }) => sql.includes('INSERT INTO auth_sessions')), false,
    'a replayed credential cannot create a new token');
});

test('NP-031 negative baseline: unknown refresh credential never installs a customer actor or creates sessions', async () => {
  const observed = recordingPool();
  const repo = createPostgresSecurityRepository(observed.pool);
  const result = await runWithDatabaseActor({ role: 'anonymous' }, () =>
    repo.rotateRefreshToken({ tokenHash: 'synthetic-nonexistent-refresh',
      newAccessHash: 'synthetic-unused-access', newRefreshHash: 'synthetic-unused-refresh',
      accessExpiresAt: new Date('2030-01-01T00:00:00Z'),
      refreshExpiresAt: new Date('2030-02-01T00:00:00Z') }));
  assert.deepEqual(result, { status: 'invalid' });
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['', 'system', 'identity_security']);
  assert.match(observed.calls[2].sql, /INNER JOIN users u ON u\.id = s\.user_id/);
  assert.equal(observed.calls.filter(({ sql }) => sql.includes("set_config('app.user_id'")).length, 1);
  assert.equal(observed.calls.some(({ sql }) => sql.startsWith('UPDATE ') || sql.startsWith('INSERT ')), false);
});

// A future users RLS policy must also preserve the ordinary authenticated
// customer view/update path. These recording clients only establish the
// current SQL actor and transaction boundaries, not actual row filtering.
test('NP-031 baseline: authenticated profile read scopes users lookup to the caller transaction', async () => {
  const observed = recordingPool((sql) => sql.includes('FROM users WHERE id = $1 LIMIT 1')
    ? [{ id: 17, name: 'Fixture', email: 'fixture@example.invalid', role: 'customer' }] : []);
  const repo = createPostgresIdentityRepository(observed.pool);
  const profile = await runWithDatabaseActor({ userId: 17, role: 'customer' }, () =>
    repo.findProfileById(17));
  assert.equal(profile?.id, 17);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['17', 'customer', '']);
  assert.match(observed.calls[2].sql, /SELECT\s+id,\s+name,\s+email,[\s\S]*FROM users WHERE id = \$1 LIMIT 1/i);
  assert.deepEqual(observed.calls[2].params, [17]);
});

test('NP-031 baseline: profile update and reread use the same verified actor in separate transactions', async () => {
  const observed = recordingPool((sql) => sql.includes('FROM users WHERE id = $1 LIMIT 1')
    ? [{ id: 17, phone: '09998887777', role: 'customer' }] : []);
  const repo = createPostgresIdentityRepository(observed.pool);
  const updated = await runWithDatabaseActor({ userId: 17, role: 'customer' }, () =>
    repo.updateProfile(17, { phone: '09998887777' }));
  assert.equal(updated?.id, 17);
  assert.equal(observed.releases, 2, 'current profile write and reread each use their own transaction');
  const first = observed.calls.slice(0, 5);
  const second = observed.calls.slice(5);
  expectTransaction(first);
  expectTransaction(second);
  assert.deepEqual(first[1].params, ['17', 'customer', '']);
  assert.deepEqual(second[1].params, ['17', 'customer', '']);
  assert.match(first[2].sql, /^UPDATE users SET phone = \$1 WHERE id = \$2$/);
  assert.deepEqual(first[2].params, ['09998887777', 17]);
  assert.match(second[2].sql, /FROM users WHERE id = \$1 LIMIT 1/);
  assert.deepEqual(second[2].params, [17]);
});

// Membership administration also touches users while the administrator has
// been authenticated. A future users RLS policy must preserve narrowly
// authorized partner-assignment reads without exposing arbitrary profiles.
// These recording-client observations are NOT database permission tests.
test('NP-031 baseline: admin membership listing joins users with authenticated admin context', async () => {
  const observed = recordingPool((sql) => sql.includes('INNER JOIN users u ON u.id = pm.user_id')
    ? [{ userId: 28, name: 'Partner fixture', email: 'partner@example.invalid',
      drugstoreId: 14, membershipRole: 'staff', isActive: 1 }] : []);
  const repo = createPostgresSecurityRepository(observed.pool);
  const memberships = await runWithDatabaseActor({ userId: 101, role: 'admin' }, () =>
    repo.listDrugstoreMemberships(14));
  assert.equal(memberships.length, 1);
  assert.equal(memberships[0].userId, 28);
  assert.equal(memberships[0].isActive, true);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['101', 'admin', 'identity_security']);
  assert.match(observed.calls[2].sql, /INNER JOIN users u ON u\.id = pm\.user_id/);
  assert.deepEqual(observed.calls[2].params, [14]);
});

test('NP-031 baseline: approved admin membership assignment reads partner users and audits its write', async () => {
  const observed = recordingPool((sql) => {
    if (sql.includes('SELECT id, role FROM users')) return [{ id: 28, role: 'partner' }];
    if (sql.includes('SELECT id FROM pharmacies')) return [{ id: 14 }];
    return [];
  });
  const repo = createPostgresSecurityRepository(observed.pool);
  const result = await runWithDatabaseActor({ userId: 101, role: 'admin' }, () =>
    repo.upsertMembership({ actorId: 101, userId: 28, drugstoreId: 14, membershipRole: 'staff' }));
  assert.deepEqual(result, { status: 'ok' });
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['101', 'admin', 'identity_security']);
  assert.match(observed.calls[2].sql, /^SELECT id, role FROM users WHERE id = \$1 LIMIT 1$/);
  assert.deepEqual(observed.calls[2].params, [28]);
  const membershipWrite = observed.calls.find(({ sql }) => sql.includes('INSERT INTO pharmacy_memberships'));
  assert.ok(membershipWrite, 'successful membership assignment should persist one scoped membership');
  assert.deepEqual(membershipWrite.params, [28, 14, 'staff']);
  const auditWrite = observed.calls.find(({ sql }) => sql.includes('INSERT INTO audit_logs'));
  assert.ok(auditWrite, 'privileged assignment must write an audit event in the same transaction');
  assert.equal(auditWrite.params[0], 101);
});

test('NP-031 baseline: non-partner membership target causes no membership or audit write', async () => {
  const observed = recordingPool((sql) => sql.includes('SELECT id, role FROM users')
    ? [{ id: 28, role: 'customer' }] : []);
  const repo = createPostgresSecurityRepository(observed.pool);
  const result = await runWithDatabaseActor({ userId: 101, role: 'admin' }, () =>
    repo.upsertMembership({ actorId: 101, userId: 28, drugstoreId: 14, membershipRole: 'staff' }));
  assert.deepEqual(result, { status: 'role_invalid' });
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['101', 'admin', 'identity_security']);
  assert.equal(observed.calls.some(({ sql }) => sql.startsWith('INSERT ') || sql.startsWith('UPDATE ')), false);
});

// Additional users joins are reached from administrative order/audit views and
// payment actor authorization. These are source-level compatibility observations:
// a recording pool never enforces SQL grants or row-level security.
test('NP-031 baseline: admin order listing joins customer users under verified admin actor', async () => {
  const observed = recordingPool((sql) => sql.includes('FROM orders o JOIN users u')
    ? [{ id: 37, customername: 'Fixture customer', customeremail: 'person@example.invalid' }] : []);
  const repo = createPostgresOrderRepository(observed.pool);
  const orders = await runWithDatabaseActor({ userId: 101, role: 'admin' }, () => repo.listAdminOrders());
  assert.equal(orders.length, 1);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['101', 'admin', 'order_mutation']);
  assert.match(observed.calls[2].sql, /FROM orders o JOIN users u ON u\.id = o\.user_id[\s\S]*ORDER BY o\.created_at DESC/);
  assert.deepEqual(observed.calls[2].params, []);
});

test('NP-031 baseline: admin audit report joins users under verified admin actor', async () => {
  const observed = recordingPool((sql) => sql.includes('LEFT JOIN users u ON u.id = a.user_id')
    ? [{ id: 61, username: 'Fixture customer' }] : []);
  const repo = createPostgresReportRepository(observed.pool);
  const logs = await runWithDatabaseActor({ userId: 101, role: 'admin' }, () => repo.listAuditLogs());
  assert.equal(logs.length, 1);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['101', 'admin', '']);
  assert.match(observed.calls[2].sql, /LEFT JOIN users u ON u\.id = a\.user_id/);
  assert.match(observed.calls[2].sql, /LIMIT 500/);
});

test('NP-031 baseline: payment actor check reads users role without granting cross-user visibility', async () => {
  const observed = recordingPool((sql) => sql.includes('EXISTS (SELECT 1 FROM users u')
    ? [{ id: 22, orderid: 15, paymentstatus: 'pending' }] : []);
  const repo = createPostgresPaymentSubscriptionRepository(observed.pool);
  const payment = await runWithDatabaseActor({ userId: 101, role: 'admin' }, () =>
    repo.findOrderPaymentForActor(15, 101));
  assert.equal(payment?.id, 22);
  expectTransaction(observed.calls);
  assert.deepEqual(observed.calls[1].params, ['101', 'admin', '']);
  assert.match(observed.calls[2].sql, /o\.user_id = \$2 OR EXISTS \(SELECT 1 FROM users u WHERE u\.id = \$3 AND u\.role = 'admin'\)/);
  assert.deepEqual(observed.calls[2].params, [15, 101, 101]);
});
