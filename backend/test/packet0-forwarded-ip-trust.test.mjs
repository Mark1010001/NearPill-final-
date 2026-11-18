import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Packet 0 NP-047 security regression against the *existing* production
// transport, not a copied IP parser or a simulation of a real NGINX network.
// A trusted peer must be explicitly configured; clients cannot self-assert it.
const transportUrl = new URL('../src/http/transport.ts', import.meta.url).href;
const environmentUrl = new URL('../src/config/env.ts', import.meta.url).href;

function readClientIp(header, remoteAddress = '203.0.113.77', trustedProxyIps = []) {
  const code = `
    const { clientIp } = await import(${JSON.stringify(transportUrl)});
    const peers = new Set(${JSON.stringify(trustedProxyIps)});
    const c = {
      req: { header: (name) => name === 'x-forwarded-for' ? ${JSON.stringify(header)} : '' },
      env: { incoming: { socket: { remoteAddress: ${JSON.stringify(remoteAddress)} } } },
      get: (key) => key === 'trustedProxyIps' ? peers : undefined,
    };
    process.stdout.write(JSON.stringify({ ip: clientIp(c) }));
  `;
  const stdout = execFileSync(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e', code,
  ], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(stdout).ip;
}

function parseProxyConfig(value) {
  const code = `
    const { parseBackendEnvironment } = await import(${JSON.stringify(environmentUrl)});
    try {
      const env = parseBackendEnvironment({ NODE_ENV: 'test', TRUSTED_PROXY_IPS: ${JSON.stringify(value)} });
      process.stdout.write(JSON.stringify({ ips: env.trustedProxyIps }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error.message }));
    }
  `;
  return JSON.parse(execFileSync(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e', code,
  ], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, NODE_OPTIONS: '' }, stdio: ['ignore', 'pipe', 'ignore'] }));
}

test('NP-047 direct peer: spoofed or rotated XFF cannot change the login/recovery rate-limit key', () => {
  for (const header of ['198.51.100.42', '198.51.100.43', 'spoofed-not-an-ip', '198.51.100.42, 192.0.2.21']) {
    assert.equal(readClientIp(header), '203.0.113.77');
  }
  const routes = readFileSync(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
  assert.match(routes, /limiter\.allowIp\(clientIp\(c\)\)/, 'existing durable auth limiter consumes this key');
});

test('NP-047 trusted proxy: accepts one validated replacement XFF only from the exact configured socket peer', () => {
  assert.equal(readClientIp('198.51.100.42', '192.0.2.10', ['192.0.2.10']), '198.51.100.42');
  assert.equal(readClientIp('198.51.100.42', '192.0.2.11', ['192.0.2.10']), '192.0.2.11');
  assert.equal(readClientIp('198.51.100.42, 192.0.2.22', '192.0.2.10', ['192.0.2.10']), '192.0.2.10');
  assert.equal(readClientIp('not-an-ip', '192.0.2.10', ['192.0.2.10']), '192.0.2.10');
  assert.equal(readClientIp('2001:db8::5', '192.0.2.10', ['192.0.2.10']), '2001:db8::5');
});

test('NP-047 missing/invalid network peer and IPv4-mapped socket cannot create a spoofable key', () => {
  assert.equal(readClientIp('198.51.100.42', null, ['192.0.2.10']), 'unknown');
  assert.equal(readClientIp('198.51.100.42', 'garbage', ['garbage']), 'unknown');
  assert.equal(readClientIp('198.51.100.42', '::ffff:192.0.2.10', ['192.0.2.10']), '198.51.100.42');
});

test('NP-047 typed trust config defaults to no proxy and rejects broad/malformed or duplicate authority', () => {
  assert.deepEqual(parseProxyConfig(undefined), { ips: [] });
  assert.deepEqual(parseProxyConfig('192.0.2.10,2001:db8::a'), { ips: ['192.0.2.10', '2001:db8::a'] });
  assert.deepEqual(parseProxyConfig('::ffff:192.0.2.10'), { ips: ['192.0.2.10'] });
  for (const value of ['*', '0.0.0.0/0', '10.0.0.0/8', 'not-a-host', '192.0.2.10,192.0.2.10', '192.0.2.10,::ffff:192.0.2.10', '0.0.0.0', '::', '192.0.2.10,']) {
    assert.match(parseProxyConfig(value).error || '', /TRUSTED_PROXY_IPS/, `reject ${value}`);
  }
});

test('NP-047 NGINX source overwrites XFF, Compose API is internal, and opt-in peers are server-only', () => {
  const nginx = readFileSync(new URL('../../infra/nginx/nginx.conf', import.meta.url), 'utf8');
  const api = nginx.match(/location \/api\/ \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(api);
  assert.match(api, /proxy_set_header X-Forwarded-For \$remote_addr;/);
  assert.doesNotMatch(api, /\$proxy_add_x_forwarded_for/);
  const compose = readFileSync(new URL('../../compose.yaml', import.meta.url), 'utf8');
  const apiService = compose.match(/^  api:\n([\s\S]*?)(?=^  [\w-]+:\s*$)/m)?.[1];
  assert.ok(apiService);
  assert.match(apiService, /expose:\n\s+- "3001"/);
  assert.doesNotMatch(apiService, /^    ports:/m);
  assert.match(apiService, /TRUSTED_PROXY_IPS: \$\{TRUSTED_PROXY_IPS:-\}/);
  const transport = readFileSync(new URL('../src/http/transport.ts', import.meta.url), 'utf8');
  assert.match(transport, /trustedProxyIps/);
  const app = readFileSync(new URL('../src/http/app.ts', import.meta.url), 'utf8');
  const bootstrap = readFileSync(new URL('../src/bootstrap/server.ts', import.meta.url), 'utf8');
  assert.match(app, /c\.set\('trustedProxyIps', reviewedProxyPeers\)/);
  assert.match(bootstrap, /trustedProxyIps: env\.trustedProxyIps/);
});

// Local TCP characterization uses a real Node HTTP socket but deliberately
// does not claim an installed-Hono/NGINX or deployed rate-limit integration.
// It verifies the actual transport clientIp() chooses the connected peer, not
// attacker-controlled headers, before a trusted peer is explicitly configured.
test('NP-047 loopback TCP: direct spoofed XFF stays socket-scoped; exact trusted peer accepts only one address', () => {
  const code = `
    import { createServer, request } from 'node:http';
    import { clientIp } from ${JSON.stringify(transportUrl)};
    const server = createServer((incoming, outgoing) => {
      const c = {
        env: { incoming },
        req: { header: (name) => incoming.headers[name] },
        get: (key) => key === 'trustedProxyIps'
          ? (incoming.url === '/trusted' ? new Set(['127.0.0.1']) : new Set())
          : undefined,
      };
      outgoing.setHeader('Connection', 'close');
      outgoing.setHeader('Content-Type', 'application/json');
      outgoing.end(JSON.stringify({ peer: incoming.socket.remoteAddress, key: clientIp(c) }));
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    async function send(path, forwardedHeaders) {
      return new Promise((resolve, reject) => {
        const headers = forwardedHeaders.length ? { 'X-Forwarded-For': forwardedHeaders } : {};
        const req = request({ hostname: '127.0.0.1', port, path, method: 'GET',
          headers: { ...headers, Connection: 'close' } }, (res) => {
          const chunks = [];
          res.on('data', (part) => chunks.push(part));
          res.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (error) { reject(new Error('local HTTP response was not JSON (status ' + res.statusCode + ')')); }
          });
        });
        req.once('error', reject);
        req.end();
      });
    }
    try {
      const results = [
        await send('/direct', ['198.51.100.1']),
        await send('/direct', ['203.0.113.2']),
        await send('/trusted', ['198.51.100.3']),
        await send('/trusted', ['198.51.100.3', '203.0.113.4']),
        await send('/trusted', ['not-an-ip']),
        await send('/trusted', []),
      ];
      process.stdout.write(JSON.stringify(results));
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  `;
  const results = JSON.parse(execFileSync(process.execPath, [
    '--experimental-strip-types', '--input-type=module', '-e', code,
  ], { encoding: 'utf8', timeout: 15_000, env: { ...process.env, NODE_OPTIONS: '' },
    stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(results.length, 6);
  for (const observed of results) {
    assert.equal(observed.peer, '127.0.0.1', 'requests must arrive on a genuine local socket');
  }
  assert.deepEqual(results.map(({ key }) => key), [
    '127.0.0.1', '127.0.0.1', '198.51.100.3',
    '127.0.0.1', '127.0.0.1', '127.0.0.1',
  ]);
});
