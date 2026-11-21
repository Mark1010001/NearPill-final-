// Read-only diagnostic: lists pharmacies, partner logins and their memberships. Prints no secrets and changes nothing.
import tls from 'node:tls';
import { createRequire } from 'node:module';
tls.DEFAULT_ECDH_CURVE = 'X25519:P-256';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const pg = require('pg');
const e = process.env;
const client = new pg.Client({
  host: e.DB_HOST,
  port: Number(e.DB_PORT || 5432),
  database: e.DB_NAME,
  user: e.DB_USER,
  password: e.DB_PASSWORD,
  ssl: { rejectUnauthorized: true },
});
const show = (title, rows) => {
  console.log(`\n== ${title} (${rows.length})`);
  for (const r of rows) console.log(JSON.stringify(r));
};
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    "SELECT set_config('app.user_id', '', true), set_config('app.role', 'admin', true), set_config('app.capability', '', true)",
  );
  show(
    'drugstores',
    (
      await client.query(
        `SELECT id, name, account_no, is_active, verification_status, public_profile_published_at IS NOT NULL AS published FROM drugstores ORDER BY id`,
      )
    ).rows,
  );
  show(
    'partner users',
    (await client.query(`SELECT id, email, role FROM users WHERE role = 'partner' ORDER BY id`))
      .rows,
  );
  show(
    'memberships',
    (
      await client.query(
        `SELECT user_id, drugstore_id, membership_role, is_active FROM pharmacy_memberships ORDER BY drugstore_id, user_id`,
      )
    ).rows,
  );
  for (const userId of [93, 72]) {
    await client.query(
      "SELECT set_config('app.user_id', $1, true), set_config('app.role', 'partner', true), set_config('app.capability', 'identity_security', true)",
      [String(userId)],
    );
    show(
      `as partner ${userId}: membership join (what the plan page reads)`,
      (
        await client.query(
          `SELECT pm.drugstore_id, d.name FROM pharmacy_memberships pm INNER JOIN drugstores d ON d.id = pm.drugstore_id WHERE pm.user_id = $1 AND pm.is_active = 1`,
          [userId],
        )
      ).rows,
    );
    show(
      `as partner ${userId}: own user row`,
      (await client.query(`SELECT id, role, email FROM users WHERE id = $1`, [userId])).rows,
    );
  }
  await client.query(
    "SELECT set_config('app.user_id', '', true), set_config('app.role', 'admin', true), set_config('app.capability', '', true)",
  );
  show(
    'subscriptions',
    (await client.query(`SELECT * FROM subscriptions WHERE drugstore_id IN (26, 43) ORDER BY id`))
      .rows,
  );
} catch (error) {
  console.log(
    `FAILED: ${String(error.message)
      .split(e.DB_PASSWORD || '\0')
      .join('<pw>')}`,
  );
} finally {
  await client.query('ROLLBACK').catch(() => {});
  await client.end().catch(() => {});
}
