import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Node 24 LTS is pinned consistently for the root engineering runtime', async () => {
  const nvm = (await read('.nvmrc')).trim();
  const nodeVersion = (await read('.node-version')).trim();
  const rootPackage = JSON.parse(await read('package.json'));

  assert.equal(nvm, '24.22.0');
  assert.equal(nodeVersion, nvm);
  assert.equal(rootPackage.engines.node, '>=24.7.0 <25');
  assert.equal(rootPackage.engines.npm, '>=11 <12');
  assert.equal(rootPackage.packageManager, 'npm@11.19.1');
});

test('root orchestration exposes the required foundation gates without moving app roots', async () => {
  const rootPackage = JSON.parse(await read('package.json'));
  const scripts = rootPackage.scripts;

  for (const name of [
    'start:backend',
    'verify:packet0',
    'check:runtime',
    'check:lockfile',
    'check:syntax',
    'typecheck',
    'lint',
    'format:check',
    'test:foundation',
    'test:config',
    'test:backend',
    'secret:scan',
    'package:source',
    'verify:foundation',
    'install:clean',
  ]) {
    assert.equal(typeof scripts[name], 'string', `${name} must exist`);
  }

  assert.match(scripts['start:backend'], /--prefix backend/);
});

test('strict TypeScript configuration covers new backend and web code', async () => {
  const base = JSON.parse(await read('tsconfig.base.json'));
  const root = JSON.parse(await read('tsconfig.json'));

  assert.equal(base.compilerOptions.strict, true);
  assert.equal(base.compilerOptions.noUncheckedIndexedAccess, true);
  assert.equal(base.compilerOptions.exactOptionalPropertyTypes, true);
  assert.equal(base.compilerOptions.erasableSyntaxOnly, true);
  assert.equal(base.compilerOptions.verbatimModuleSyntax, true);
  assert(root.include.includes('backend/src/**/*.ts'));
  assert.equal(root.compilerOptions.allowJs, true);
  assert.equal(root.compilerOptions.checkJs, false);
  assert.match(JSON.parse(await read('package.json')).scripts.typecheck, /npm run typecheck:web/);
  assert.equal(JSON.parse(await read('web/tsconfig.json')).compilerOptions.jsx, 'react-jsx');
});

test('typed environment parser forbids wildcard CORS and requires HTTPS production URL', async () => {
  const source = await read('backend/src/config/env.ts');

  assert.match(source, /CORS_ORIGINS must not use a wildcard origin/);
  assert.match(source, /PUBLIC_APP_URL must use HTTPS in production/);
  assert.match(source, /BREVO_API_KEY and MAIL_FROM must be configured together/);
  assert.match(source, /CORS_ORIGINS must be explicitly configured/);
  assert.match(source, /DB_PASSWORD must be configured/);
});

test('source packaging excludes dependency caches, secrets, build output and stale analyzer output', async () => {
  const script = await read('scripts/package-source.sh');

  // Exclusions are built from reviewed directory names for both top-level and
  // nested build caches; requiring literal backend/node_modules patterns would
  // incorrectly reject the stronger generic exclusion.
  assert.match(script, /excluded_dirs=\(node_modules \.dart_tool \.gradle \.idea \.next \.turbo \.vercel dist build coverage \.git\)/);
  assert.match(script, /zip_excludes\+=\(\"\$dir\/\*\" \"\*\/\$dir\/\*\"/);
  assert.match(script, /zip -qr "\$staged_zip" \. -x "\$\{zip_excludes\[@\]\}"/);
  for (const excluded of ['web/playwright-report/*', 'web/test-results/*', 'web/playwright/.auth/*', '.env', 'analyze-output.txt']) {
    assert(script.includes(excluded), `${excluded} must be excluded`);
  }
  assert.doesNotMatch(script, /-x '\.env\.\*'/, '.env.example must remain packageable');
});

test('compose publishes only the gateway port and keeps database/API internal', async () => {
  const compose = await read('compose.yaml');

  assert.match(compose, /nginx:[\s\S]*ports:[\s\S]*"8080:8080"/);
  assert.match(compose, /postgres:[\s\S]*pgvector\/pgvector:[\s\S]*healthcheck:/);
  assert.equal((compose.match(/^    ports:/gm) || []).length, 1);
  assert.match(compose, /db-migrate:[\s\S]*service_healthy/);
  assert.match(compose, /api:[\s\S]*healthcheck:/);
  assert.match(compose, /api:[\s\S]*service_completed_successfully/);
  assert.match(compose, /nginx:[\s\S]*service_healthy/);
});


test('database migration runner is transactional and checksum-protected', async () => {
  const source = await read('backend/scripts/migrate-postgres.mjs');
  const executor = await read('backend/scripts/lib/execute-reviewed-migration.mjs');

  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /executeReviewedMigration/);
  assert.match(executor, /BEGIN/);
  assert.match(executor, /ROLLBACK/);
  assert.match(executor, /pg_advisory_xact_lock/);
  assert.match(executor, /migration journal drift/);
});

test('CI pins the declared Node and Flutter toolchains and separates root/backend installs', async () => {
  const workflow = await read('.github/workflows/ci.yml');

  assert.match(workflow, /node-version-file:\s*\.nvmrc/);
  assert.match(workflow, /flutter-version:\s*['"]3\.44\.4['"]/);
  assert.match(workflow, /npm run check:lockfile/);
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm ci --prefix backend/);
  assert.doesNotMatch(workflow, /npm install --ignore-scripts/);
  assert.match(workflow, /npm run test:foundation/);
  assert.match(workflow, /npm run test:config/);
});


test('safe environment template documents Compose secrets without containing real credentials', async () => {
  const example = await read('.env.example');

  assert.match(example, /DB_PASSWORD=replace-with-a-local-app-password/);
  assert.match(example, /MIGRATOR_DB_PASSWORD=replace-with-a-local-migrator-password/);
  assert.match(example, /POSTGRES_OWNER_PASSWORD=replace-with-a-local-owner-password/);
  const backendExample = await read('backend/.env.example');

  assert.match(example, /PUBLIC_APP_URL=http:\/\/localhost:8080/);
  assert.match(backendExample, /DB_HOST=127\.0\.0\.1/);
  assert.match(backendExample, /PORT=3001/);
  assert.doesNotMatch(example, /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(backendExample, /password123/);
});

test('foundation verification and CI validate Compose without publishing internal services', async () => {
  const rootPackage = JSON.parse(await read('package.json'));
  const verifier = await read('scripts/verify-foundation.sh');
  const workflow = await read('.github/workflows/ci.yml');

  assert.match(rootPackage.scripts['verify:foundation'], /verify-foundation\.sh/);
  assert.match(verifier, /docker compose config --quiet/);
  assert.match(workflow, /docker compose config --quiet/);
});

test('README documents the canonical existing startup paths and Packet 1 verification', async () => {
  const readme = await read('README.md');

  assert.match(readme, /npm ci --prefix backend/);
  assert.match(readme, /docker compose up --build/);
  assert.match(readme, /npm run verify:foundation/);
  assert.match(readme, /does not create a replacement V2 application/);
});


test('lockfile preflight blocks missing root lockfile instead of allowing a mutable install', async () => {
  const rootPackage = JSON.parse(await read('package.json'));
  const check = await read('scripts/check-lockfile.mjs');
  const workflow = await read('.github/workflows/ci.yml');

  assert.equal(rootPackage.packageManager, 'npm@11.19.1');
  assert.match(check, /LOCKFILE BLOCKER/);
  assert.match(check, /lockfileVersion/);
  assert.match(workflow, /npm run check:lockfile[\s\S]*npm ci --ignore-scripts/);
});
