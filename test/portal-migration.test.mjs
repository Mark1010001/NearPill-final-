import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), 'utf8');

async function walk(dir) {
  const full = path.join(root, dir);
  const items = await readdir(full, { withFileTypes: true });
  const files = [];
  for (const item of items) {
    const rel = path.posix.join(dir, item.name);
    if (item.isDirectory() && !['node_modules', 'dist', 'playwright-report', 'test-results'].includes(item.name)) files.push(...await walk(rel));
    else if (item.isFile()) files.push(rel);
  }
  return files;
}

test('web surface is React/TypeScript/Vite and legacy browser globals are retired', async () => {
  const webPackage = JSON.parse(await read('web/package.json'));
  assert.equal(webPackage.dependencies.react, '19.3.1');
  assert.equal(webPackage.devDependencies.vite, '8.3.4');
  assert.ok(webPackage.dependencies['@tanstack/react-query']);
  assert.ok(webPackage.dependencies['react-router']);

  const webFiles = await walk('web');
  for (const retired of ['web/js/app.js', 'web/js/data.js', 'web/js/db.js', 'web/js/tenant-engine.js', 'web/js/charts.js']) {
    assert.equal(webFiles.includes(retired), false, `${retired} must be retired`);
  }
  assert.ok(webFiles.includes('web/src/main.tsx'));
  assert.ok(webFiles.includes('web/src/app/App.tsx'));
});

test('portal has no editable browser role/tenant authority or unsafe HTML rendering', async () => {
  const sourceFiles = (await walk('web/src')).filter((file) => /\.(?:ts|tsx)$/.test(file));
  const source = (await Promise.all(sourceFiles.map(read))).join('\n');
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|\.innerHTML\s*=/);
  assert.doesNotMatch(source, /CoreDB|TenantEvent|tenant-engine/i);
  assert.doesNotMatch(source, /password123|demo@|admin@nearpill/i);
});

test('web API uses same-origin v1 session and CSRF semantics', async () => {
  const client = await read('web/src/api/client.ts');
  assert.match(client, /const API_BASE = '\/api\/v1'/);
  assert.match(client, /credentials:\s*'same-origin'/);
  assert.match(client, /X-CSRF-Token/);
  assert.match(client, /\/auth\/me/);
  assert.match(client, /\/auth\/login/);
  assert.match(client, /\/auth\/logout/);
});

test('partner screens use membership-scoped partner endpoints instead of admin datasets', async () => {
  const client = await read('web/src/api/client.ts');
  const partner = await read('web/src/features/partner/PartnerPages.tsx');
  assert.match(client, /\/partner\/orders/);
  assert.match(client, /\/partner\/inventory/);
  assert.doesNotMatch(partner, /adminOrders|\/admin\/orders|adminInventory|\/admin\/inventory/);
});

test('backend partner reads resolve authorization from active memberships', async () => {
  const orders = await read('backend/src/application/order-service.js');
  const inventory = await read('backend/src/application/inventory-service.js');
  assert.match(orders, /listPartnerOrders/);
  assert.match(orders, /memberships/);
  assert.match(orders, /orders:read:pharmacy/);
  assert.match(inventory, /listPartnerInventory/);
  assert.match(inventory, /memberships/);
  assert.match(inventory, /inventory:adjust/);
});

test('partner order repository avoids parent orders table so membership RLS remains authoritative', async () => {
  const repository = await read('backend/src/infrastructure/postgres/order-repository.js');
  const start = repository.indexOf('async listPartnerOrderItems');
  assert.ok(start >= 0);
  const method = repository.slice(start, repository.indexOf('\n    },', start) + 7);
  assert.match(method, /order_drugstores/);
  assert.match(method, /order_items/);
  assert.doesNotMatch(method, /\bFROM\s+orders\b|\bJOIN\s+orders\b/i);
});

test('web production path builds an artifact and Compose no longer mounts raw source', async () => {
  const compose = await read('compose.yaml');
  const dockerfile = await read('web/Dockerfile');
  assert.match(compose, /web:\s*\n\s+build:\s*\n\s+context:\s*\.\/web/);
  assert.doesNotMatch(compose, /\.\/web:\/usr\/share\/nginx\/html/);
  assert.match(dockerfile, /npm ci --ignore-scripts/);
  assert.match(dockerfile, /npm run build/);
});

test('Playwright tenant-boundary specification exists without committed authentication state', async () => {
  const spec = await read('web/e2e/portal.spec.ts');
  const gitignore = await read('.gitignore');
  assert.match(spec, /partner\/orders/);
  assert.match(spec, /partner\/inventory/);
  assert.match(gitignore, /web\/playwright\/\.auth\//);
});
