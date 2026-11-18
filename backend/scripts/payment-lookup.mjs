// READ-ONLY lookup of the payment(s) flagged for reconciliation. Prints ids/status/dates only.
import pg from 'pg';
const client = new pg.Client({ host: process.env.DB_HOST, port: 5432, database: 'postgres', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const show = async (label, sql) => { const r = await client.query(sql); console.log(`--- ${label} (${r.rowCount})`); for (const row of r.rows) console.log(JSON.stringify(row)); };
  await show('payments flagged reconciliation_required', `
    SELECT p.id AS payment_id, p.order_id, p.payment_status, p.provider, p.payment_plan, p.amount_centavos,
           to_jsonb(p)->>'created_at' AS created_at, o.reference AS order_reference, o.status AS order_status,
           (SELECT string_agg(d.name || ' (active=' || d.is_active || ')', ', ') FROM order_drugstores od JOIN drugstores d ON d.id = od.drugstore_id WHERE od.order_id = o.id) AS pharmacies
    FROM payments p LEFT JOIN orders o ON o.id = p.order_id WHERE p.payment_status = 'reconciliation_required'`);
  await show('open reconciliation cases', `SELECT id, payment_id, provider, reason, status, created_at FROM payment_reconciliation WHERE status = 'open'`);
  await show('provider events needing reconciliation', `SELECT id, provider, event_type, processing_status, created_at FROM payment_events WHERE processing_status = 'requires_reconciliation' OR processing_status ILIKE '%reconcil%'`);
  await client.query('ROLLBACK');
} finally { await client.end(); }
