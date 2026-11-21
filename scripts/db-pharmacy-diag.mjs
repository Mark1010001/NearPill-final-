// Read-only diagnostic: lists pharmacies, partner logins and their memberships. Prints no secrets and changes nothing.
import tls from 'node:tls';
import { createRequire } from 'node:module';
tls.DEFAULT_ECDH_CURVE = 'X25519:P-256';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const pg = require('pg');
const e = process.env;
const client = new pg.Client({ host: e.DB_HOST, port: Number(e.DB_PORT || 5432), database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASSWORD, ssl: { rejectUnauthorized: true } });
const show = (title, rows) => { console.log(`\n== ${title} (${rows.length})`); for (const r of rows) console.log(JSON.stringify(r)); };
try {
  await client.connect();
  show('drugstores', (await client.query(`SELECT id, name, account_no, is_active, verification_status, public_profile_published_at IS NOT NULL AS published FROM drugstores ORDER BY id`)).rows);
  show('partner users', (await client.query(`SELECT id, email, role FROM users WHERE role = 'partner' ORDER BY id`)).rows);
  show('memberships', (await client.query(`SELECT user_id, drugstore_id, membership_role, is_active FROM pharmacy_memberships ORDER BY drugstore_id, user_id`)).rows);
} catch (error) {
  console.log(`FAILED: ${String(error.message).split(e.DB_PASSWORD || '\0').join('<pw>')}`);
} finally { await client.end().catch(() => {}); }
