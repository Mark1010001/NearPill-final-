import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { assertApprovedFixtureTarget } from './lib/verify-fixture-target.mjs';
import { assertSafeLiveFixtureConnections } from './lib/verify-live-fixture-connection.mjs';
import { applyDatabaseActor } from '../src/infrastructure/postgres/context.js';

test('local API and staging enforce identity, ownership, refresh revocation and OTC review', {
  timeout: 120_000,
}, async () => {
  assertApprovedFixtureTarget(process.env);
  assert.equal(process.env.NEARPILL_VERIFICATION_PROJECT_REF, 'afqqozfjpiodanpogvfb');
  const { default: pg } = await import('pg');
  const config = { host: process.env.DB_HOST, port: 5432, database: process.env.DB_NAME, ssl: { rejectUnauthorized: true } };
  const app = new pg.Pool({ ...config, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
  const migrator = new pg.Pool({ ...config, user: process.env.MIGRATOR_DB_USER, password: process.env.MIGRATOR_DB_PASSWORD });
  const marker = randomUUID();
  const emails = ['a', 'b', 'partner-a', 'partner-b'].map((name) => `local-${marker}-${name}@example.invalid`);
  const stores = [];
  const medicines = [];
  let approved = false;

  async function request(route, body, token) {
    const response = await fetch(`http://127.0.0.1:8080/api/v1${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }

  async function register(email, fullName, password) {
    const otp = await request('/auth/send-otp', { email });
    assert.equal(otp.status, 200, otp.body.error);
    assert.equal(otp.body.devMode, true, 'This check only uses the local development API');
    assert.equal((await request('/auth/verify-otp', { email, code: otp.body.devCode })).status, 200);
    const result = await request('/auth/register', { email, fullName, password });
    assert.equal(result.status, 201, result.body.error);
    return result.body;
  }

  try {
    await assertSafeLiveFixtureConnections({ appPool: app, migratorPool: migrator, env: process.env });
    approved = true;
    const apiRoles = await migrator.query("SELECT rolname, has_schema_privilege(oid,'public','USAGE') AS can_use FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')");
    assert.equal(apiRoles.rowCount, 3);
    assert.ok(apiRoles.rows.every((row) => row.can_use === false));
    assert.equal((await request('/health')).body.status, 'ok');
    assert.equal((await request('/medicines')).status, 200);
    assert.equal((await request('/stores/nearby?latitude=10.3157&longitude=123.8854')).status, 200);
    const password = `Check-${randomBytes(24).toString('base64url')}!1`;
    const a = await register(emails[0], 'Local Check A', password);
    const b = await register(emails[1], 'Local Check B', password);
    const login = await request('/auth/login', { email: emails[0], password });
    assert.equal(login.status, 200, login.body.error);
    assert.equal((await request('/auth/login', { email: emails[1], password: 'Wrong-password!1' })).status, 401);
    assert.equal((await request('/auth/me', undefined, login.body.accessToken)).body.email, emails[0]);

    const client = await app.connect();
    try {
      await client.query('BEGIN');
      await applyDatabaseActor(client, { userId: Number(a.user.id), role: 'customer' });
      assert.deepEqual((await client.query('SELECT id FROM users')).rows.map((row) => row.id), [Number(a.user.id)]);
      assert.equal((await client.query('UPDATE users SET name=$1 WHERE id=$2', ['Forbidden', b.user.id])).rowCount, 0);
      for (const sql of ["UPDATE users SET role='admin'", 'UPDATE medicines SET otc_eligible=true']) {
        await client.query('SAVEPOINT denied');
        await assert.rejects(client.query(sql), (error) => error.code === '42501');
        await client.query('ROLLBACK TO SAVEPOINT denied');
      }
      await client.query('COMMIT');
      await client.query('BEGIN');
      assert.equal((await client.query('SELECT id FROM users')).rowCount, 0, 'Actor context must clear after commit');
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }

    const partners = await migrator.query("INSERT INTO users (name,email,password,role) VALUES ('Synthetic Partner A',$1,'!disabled','partner'),('Synthetic Partner B',$2,'!disabled','partner') RETURNING id", emails.slice(2));
    for (let i = 0; i < 2; i++) {
      stores.push((await migrator.query("INSERT INTO pharmacies (name,address,latitude,longitude) VALUES ($1,'synthetic test',10.3,123.9) RETURNING id", [`Synthetic ${marker}-${i}`])).rows[0].id);
      await migrator.query("INSERT INTO pharmacy_memberships (user_id,pharmacy_id,membership_role) VALUES ($1,$2,'manager')", [partners.rows[i].id, stores[i]]);
      const order = (await migrator.query("INSERT INTO orders (reference,user_id,total_centavos) VALUES ($1,$2,0) RETURNING id", [`check-${marker}-${i}`, i === 0 ? a.user.id : b.user.id])).rows[0].id;
      const child = await migrator.query('INSERT INTO order_pharmacies (order_id,pharmacy_id) VALUES ($1,$2) RETURNING user_id', [order, stores[i]]);
      assert.equal(child.rows[0].user_id, Number(i === 0 ? a.user.id : b.user.id));
    }
    await migrator.query("UPDATE pharmacies SET verification_status='verified',verified_at=CURRENT_TIMESTAMP,public_profile_published_at=CURRENT_TIMESTAMP WHERE id=$1", [stores[0]]);
    const nearby = await request('/stores/nearby?latitude=10.3157&longitude=123.8854');
    assert.equal(nearby.status, 200);
    const visible = nearby.body.stores.find((store) => store.store_id === Number(stores[0]));
    assert.ok(visible, 'A published synthetic pharmacy within 5 km must be discoverable');
    assert.ok(visible.distanceKm > 2 && visible.distanceKm < 3);
    assert.ok(!nearby.body.stores.some((store) => store.store_id === Number(stores[1])), 'Pending pharmacies stay private');
    const outsideRadius = await request('/stores/nearby?latitude=10.3157&longitude=123.8854&radiusKm=1');
    assert.equal(outsideRadius.status, 200);
    assert.ok(!outsideRadius.body.stores.some((store) => store.store_id === Number(stores[0])));
    const manual = await request(`/stores/nearby?q=${encodeURIComponent(marker)}`);
    assert.equal(manual.status, 200);
    assert.deepEqual(manual.body.stores.map((store) => store.store_id), [Number(stores[0])]);
    assert.equal(manual.body.stores[0].distanceKm, null, 'Manual search has no measured user distance');
    medicines.push((await migrator.query("INSERT INTO medicines (brand_name,publication_status,otc_eligible,otc_review_reference,otc_reviewed_at) VALUES ($1,'published',true,'synthetic checkout only',CURRENT_TIMESTAMP) RETURNING id", [`Synthetic ${marker}`])).rows[0].id);
    await migrator.query('INSERT INTO stock (pharmacy_id,medicine_id,price_centavos,stock_on_hand,availability) VALUES ($1,$2,1250,3,1)', [stores[0], medicines[0]]);
    const checkout = { idempotencyKey: marker, items: [{ id: medicines[0], drugstoreId: stores[0], quantity: 1, price: 0 }] };
    const order = await request('/orders', checkout, a.accessToken);
    assert.equal(order.status, 201, order.body.error);
    assert.equal(order.body.totalCentavos, 1250, 'The server owns the price');
    const replay = await request('/orders', checkout, a.accessToken);
    assert.equal(replay.status, 200);
    assert.equal(replay.body.id, order.body.id);
    assert.equal(Number((await migrator.query('SELECT reserved_quantity FROM stock WHERE pharmacy_id=$1 AND medicine_id=$2', [stores[0], medicines[0]])).rows[0].reserved_quantity), 1);
    const otherOrders = await request('/orders', undefined, b.accessToken);
    assert.equal(otherOrders.status, 200);
    assert.ok(otherOrders.body.every((row) => row.id !== order.body.id));
    await migrator.query("INSERT INTO audit_logs (user_id,action,description) VALUES ($1,'SYNTHETIC_CHECK',$2)", [b.user.id, marker]);
    const auditClient = await app.connect();
    try {
      await auditClient.query('BEGIN');
      await applyDatabaseActor(auditClient, { userId: Number(a.user.id), role: 'customer' });
      assert.equal((await auditClient.query('SELECT id FROM audit_logs')).rowCount, 0);
      await applyDatabaseActor(auditClient, { userId: Number(a.user.id), role: 'customer', capability: 'order_mutation' });
      assert.deepEqual((await auditClient.query('SELECT user_id FROM audit_logs')).rows.map((row) => row.user_id), [Number(a.user.id)]);
    } finally {
      await auditClient.query('ROLLBACK');
      auditClient.release();
    }
    const partner = await app.connect();
    try {
      await partner.query('BEGIN');
      await applyDatabaseActor(partner, { userId: partners.rows[0].id, role: 'partner' });
      assert.equal((await partner.query('SELECT id FROM users WHERE id=$1', [b.user.id])).rowCount, 0);
      assert.equal((await partner.query('SELECT id FROM orders WHERE reference LIKE $1', [`check-${marker}-%`])).rowCount, 1);
      await partner.query('ROLLBACK');
    } finally {
      await partner.query('ROLLBACK');
      partner.release();
    }

    const medicine = await migrator.connect();
    try {
      await medicine.query('BEGIN');
      const id = (await medicine.query("INSERT INTO medicines (brand_name) VALUES ('Synthetic OTC check') RETURNING id")).rows[0].id;
      await medicine.query('SAVEPOINT unreviewed');
      await assert.rejects(medicine.query("UPDATE medicines SET publication_status='published' WHERE id=$1", [id]), (error) => error.code === '23514');
      await medicine.query('ROLLBACK TO SAVEPOINT unreviewed');
      await medicine.query("UPDATE medicines SET otc_eligible=true,otc_review_reference='synthetic-test-only',otc_reviewed_at=CURRENT_TIMESTAMP,publication_status='published' WHERE id=$1", [id]);
      await medicine.query('ROLLBACK');
    } finally {
      await medicine.query('ROLLBACK');
      medicine.release();
    }

    const refreshed = await request('/auth/refresh', { refreshToken: login.body.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal((await request('/auth/refresh', { refreshToken: login.body.refreshToken })).status, 401);
    assert.equal((await request('/auth/me', undefined, refreshed.body.accessToken)).status, 401);
    assert.equal((await request('/auth/logout', { refreshToken: b.refreshToken })).status, 200);
    assert.equal((await request('/auth/me', undefined, b.accessToken)).status, 401);
  } finally {
    if (approved) {
      await migrator.query('DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email=ANY($1::text[]))', [emails]);
      await migrator.query('DELETE FROM users WHERE email=ANY($1::text[])', [emails]);
      await migrator.query('DELETE FROM pharmacies WHERE id=ANY($1::int[])', [stores]);
      await migrator.query('DELETE FROM medicines WHERE id=ANY($1::int[])', [medicines]);
      await migrator.query('DELETE FROM email_codes WHERE email=ANY($1::text[])', [emails]);
      await migrator.query('DELETE FROM auth_account_security WHERE email_hash=ANY($1::text[])', [emails.map((email) => createHash('sha256').update(email).digest('hex'))]);
    }
    await Promise.all([app.end(), migrator.end()]);
  }
});
