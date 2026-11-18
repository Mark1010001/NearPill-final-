// Safe diagnostic: tests the database connection the API uses. Prints no secrets (host/user/password are masked).
import tls from 'node:tls';
import dns from 'node:dns/promises';
import net from 'node:net';
import { createRequire } from 'node:module';
tls.DEFAULT_ECDH_CURVE = 'X25519:P-256';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const pg = require('pg');
const e = process.env;
const mask = (s) => String(s ?? '').split(e.DB_HOST ?? '\0').join('<host>').split(e.DB_USER ?? '\0').join('<user>').split(e.DB_PASSWORD ?? '\0').join('<pw>');
const out = [];
const say = (s) => { out.push(s); console.log(s); };
say(`time=${new Date().toISOString()} node=${process.version}`);
say(`env: DB_HOST=${e.DB_HOST ? 'set' : 'MISSING'} DB_PORT=${e.DB_PORT ?? 'MISSING'} DB_NAME=${e.DB_NAME ? 'set' : 'MISSING'} DB_USER=${e.DB_USER ? 'set' : 'MISSING'} DB_PASSWORD=${e.DB_PASSWORD ? 'set' : 'MISSING'} DB_SSL=${e.DB_SSL ?? 'unset'}`);
try { const a = await dns.lookup(e.DB_HOST, { all: true }); say(`dns: ${a.map((x) => 'IPv' + x.family).join(',')}`); } catch (x) { say(`dns FAILED: ${x.code}`); }
await new Promise((res) => { const t0 = Date.now(); const s = net.connect({ host: e.DB_HOST, port: Number(e.DB_PORT), timeout: 8000 }, () => { say(`tcp: connected in ${Date.now() - t0}ms`); s.destroy(); res(); }); s.on('error', (x) => { say(`tcp FAILED: ${x.code}`); res(); }); s.on('timeout', () => { say('tcp TIMEOUT'); s.destroy(); res(); }); });
const client = new pg.Client({ host: e.DB_HOST, port: Number(e.DB_PORT), database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASSWORD, ssl: e.DB_SSL && e.DB_SSL !== 'false' ? { rejectUnauthorized: true } : false, connectionTimeoutMillis: 15000 });
try {
  const t0 = Date.now(); await client.connect(); say(`pg connect ok in ${Date.now() - t0}ms`);
  const r = await client.query('select count(*)::int as n from drugstores'); say(`drugstores rows: ${r.rows[0].n}`);
} catch (x) { say(`pg FAILED: code=${x.code} msg=${mask(x.message).slice(0, 200)}`); }
finally { try { await client.end(); } catch {} }
