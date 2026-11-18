import pg from 'pg';
const c = new pg.Client({ host: process.env.DB_HOST, port: 5432, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: true } });
await c.connect();
const q = async (label, sql) => { try { const r = await c.query(sql); console.log('--', label, r.rowCount); r.rows.forEach((x) => console.log(JSON.stringify(x))); } catch (e) { console.log('ERR', label, e.message); } };
await q('alaxan', `SELECT m.id, m.brand_name, m.generic_name, m.dosage_form, m.category, m.publication_status, m.otc_eligible, i.stock_on_hand, i.availability, i.pharmacy_sale_confirmation->'product' AS snap, ds.name FROM medicines m JOIN inventory i ON i.medicine_id=m.id JOIN drugstores ds ON ds.id=i.drugstore_id WHERE m.brand_name ILIKE 'Alaxan%'`);
await q('summary by pharmacy/category/status', `SELECT ds.name, m.category, m.publication_status, m.otc_eligible, (i.pharmacy_sale_confirmation IS NOT NULL) AS has_snap, ((i.pharmacy_sale_confirmation->'product') = jsonb_build_array(m.brand_name,m.generic_name,m.dosage_form,m.category)) AS snap_matches, count(*) FROM inventory i JOIN medicines m ON m.id=i.medicine_id JOIN drugstores ds ON ds.id=i.drugstore_id GROUP BY 1,2,3,4,5,6 ORDER BY 1,2`);
await c.end();
