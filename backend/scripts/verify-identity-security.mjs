import { assertApprovedFixtureTarget } from './lib/verify-fixture-target.mjs';
import { assertSafeLiveFixtureConnections } from './lib/verify-live-fixture-connection.mjs';
import { withIsolatedRefreshProbeUser } from './lib/with-isolated-refresh-probe-user.mjs';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createAuthService } from '../src/application/auth-service.js';
import { createPostgresSecurityRepository } from '../src/infrastructure/postgres/security-repository.js';

// Stop before any database connection or fixture write without an explicit test target.
assertApprovedFixtureTarget(process.env);

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'nearpill_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nearpill',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

const migratorPool = new Pool({
  host: process.env.MIGRATOR_DB_HOST || process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.MIGRATOR_DB_PORT || process.env.DB_PORT || 5432),
  user: process.env.MIGRATOR_DB_USER || 'nearpill_migrator',
  password: process.env.MIGRATOR_DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nearpill',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

const repository = createPostgresSecurityRepository(pool);
const auth = createAuthService({ repository, production: false });
const marker = `packet0-${randomUUID()}`;

try {
  await assertSafeLiveFixtureConnections({ appPool: pool, migratorPool, env: process.env });
  const client = await migratorPool.connect();
  let fixtureCommitted = false;
  try {
    await client.query('BEGIN');
    const userA = await client.query(`INSERT INTO users (name,email,password,role) VALUES ($1,$2,'test','partner') RETURNING id`, [`${marker}-a`, `${marker}-a@example.invalid`]);
    const userB = await client.query(`INSERT INTO users (name,email,password,role) VALUES ($1,$2,'test','partner') RETURNING id`, [`${marker}-b`, `${marker}-b@example.invalid`]);
    const customer = await client.query(`INSERT INTO users (name,email,password,role) VALUES ($1,$2,'test','customer') RETURNING id`, [`${marker}-customer`, `${marker}-c@example.invalid`]);
    const storeA = await client.query(`INSERT INTO drugstores (name,address,latitude,longitude) VALUES ($1,'test',10.3,123.9) RETURNING id`, [`${marker}-store-a`]);
    const storeB = await client.query(`INSERT INTO drugstores (name,address,latitude,longitude) VALUES ($1,'test',10.31,123.91) RETURNING id`, [`${marker}-store-b`]);
    await client.query(`INSERT INTO pharmacy_memberships (user_id,drugstore_id,membership_role) VALUES ($1,$2,'manager'),($3,$4,'manager')`, [userA.rows[0].id, storeA.rows[0].id, userB.rows[0].id, storeB.rows[0].id]);
    const orderA = await client.query(`INSERT INTO orders (reference,user_id,total_centavos,status) VALUES ($1,$2,1000,'reserved') RETURNING id`, [`${marker}-oa`, customer.rows[0].id]);
    const orderB = await client.query(`INSERT INTO orders (reference,user_id,total_centavos,status) VALUES ($1,$2,2000,'reserved') RETURNING id`, [`${marker}-ob`, customer.rows[0].id]);
    await client.query(`INSERT INTO order_drugstores (order_id,drugstore_id,status) VALUES ($1,$2,'reserved'),($3,$4,'reserved')`, [orderA.rows[0].id, storeA.rows[0].id, orderB.rows[0].id, storeB.rows[0].id]);

    await client.query('COMMIT');
    fixtureCommitted = true;
    const actorClient = await pool.connect();
    try {
      await actorClient.query('BEGIN');
      await actorClient.query(`SELECT set_config('app.user_id', $1, true), set_config('app.role', 'partner', true), set_config('app.capability', '', true)`, [String(userA.rows[0].id)]);
      const visible = await actorClient.query(`SELECT id FROM orders WHERE id = ANY($1::int[]) ORDER BY id`, [[orderA.rows[0].id, orderB.rows[0].id]]);
      assert.deepEqual(visible.rows.map(row => Number(row.id)), [Number(orderA.rows[0].id)], 'partner A must not read partner B order');
    } finally {
      try { await actorClient.query('ROLLBACK'); } finally { actorClient.release(); }
    }
  } finally {
    try {
      await client.query('ROLLBACK');
      if (fixtureCommitted) {
        const users = await client.query('DELETE FROM users WHERE email = ANY($1::text[])', [[`${marker}-a@example.invalid`, `${marker}-b@example.invalid`, `${marker}-c@example.invalid`]]);
        const stores = await client.query('DELETE FROM drugstores WHERE name = ANY($1::text[])', [[`${marker}-store-a`, `${marker}-store-b`]]);
        assert.equal(users.rowCount, 3, 'all synthetic identity users must be removed');
        assert.equal(stores.rowCount, 2, 'both synthetic identity stores must be removed');
      }
    } finally { client.release(); }
  }

  // A refresh replay revokes its entire credential family. Always run it against
  // a disposable, synthetic user: never select an existing customer/partner.
  await withIsolatedRefreshProbeUser({
    pool: migratorPool,
    marker,
    verify: async (probeUser) => {
      const issued = await auth.issueCredentials(probeUser);
      const first = await auth.rotateRefresh(issued.refreshToken);
      assert.equal(first.status, 'rotated');
      const replay = await auth.rotateRefresh(issued.refreshToken);
      assert.equal(replay.status, 'replay');
      const revoked = await auth.authenticate({ headers: { authorization: `Bearer ${first.accessToken}` } });
      assert.equal(revoked, null, 'refresh replay must revoke the family');
    },
  });

  console.log('PASS live RLS cross-tenant isolation');
  console.log('PASS live refresh rotation/replay revocation');
} finally {
  await Promise.allSettled([pool.end(), migratorPool.end()]);
}
