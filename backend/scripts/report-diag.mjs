// READ-ONLY: why admin reports look empty. Prints counts only (no names of people, no emails).
import pg from 'pg';
const client = new pg.Client({ host: process.env.DB_HOST, port: 5432, database: 'postgres', user: process.env.DB_USER,
  password: process.env.DB_PASSWORD, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  await client.query('BEGIN READ ONLY');
  const show = async (label, sql) => { const r = await client.query(sql); console.log(`--- ${label} (${r.rowCount})`); for (const row of r.rows) console.log(JSON.stringify(row)); };
  await show('orders by status', `SELECT status, COUNT(*) n, MIN(created_at)::date first_day, MAX(created_at)::date last_day FROM orders GROUP BY status ORDER BY n DESC`);
  await show('pharmacies: id, name, active, orders linked, items linked', `
    SELECT d.id, d.name, d.is_active, COUNT(DISTINCT od.order_id) orders, COUNT(oi.id) items
    FROM pharmacies d LEFT JOIN order_pharmacies od ON od.pharmacy_id = d.id LEFT JOIN order_items oi ON oi.order_pharmacy_id = od.id
    GROUP BY d.id, d.name, d.is_active ORDER BY orders DESC`);
  await show('orders per pharmacy and status', `
    SELECT d.name, o.status, COUNT(DISTINCT o.id) n FROM order_pharmacies od JOIN pharmacies d ON d.id = od.pharmacy_id JOIN orders o ON o.id = od.order_id
    GROUP BY d.name, o.status ORDER BY d.name, n DESC`);
  await show('order_items whose medicine row is missing', `SELECT COUNT(*) n FROM order_items oi LEFT JOIN medicines m ON m.id = oi.medicine_id WHERE m.id IS NULL`);
  await show('orders by day (UTC vs Manila), last 20 days', `
    SELECT (created_at AT TIME ZONE 'UTC')::date utc_day, (created_at AT TIME ZONE 'Asia/Manila')::date manila_day, COUNT(*) n
    FROM orders WHERE created_at > now() - interval '20 days' GROUP BY 1,2 ORDER BY 1`);
  await show('db session timezone', `SHOW timezone`);
  await client.query('ROLLBACK');
} finally { await client.end(); }
