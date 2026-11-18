import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

// Packet 0 characterization, NOT evidence of real Supabase roles, grants,
// tenant isolation, migrations, restores or concurrency under the app role.
// This locks the owner-approved *provider*, not a second authentication or
// persistence authority inside the existing web/Flutter applications.
const root = new URL('../../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

async function clientSources(folder, extension) {
  const collected = [];
  async function visit(path) {
    for (const entry of await readdir(new URL(`${path}/`, root), { withFileTypes: true })) {
      const next = `${path}/${entry.name}`;
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && extension.test(entry.name)) {
        collected.push([next, await source(next)]);
      }
    }
  }
  await visit(folder);
  return collected;
}

const forbiddenClientAuthority = [
  /@supabase\/supabase-js\b/i,
  /@supabase\/postgrest-js\b/i,
  /\bpostgrest_flutter\b/i,
  // Native Android/JVM database SDKs are equally client-side authority.
  /\bio\.github\.jan(?:-tennert)?\.supabase\b/i,
  /\bjdbc:postgresql?:\/\//i,
  /\borg\.postgresql(?:\.Driver|:postgresql)\b/i,
  /package:postgrest\/postgrest\.dart/i,
  /['"`]\/(?:rest|auth|storage)\/v1(?:\/|['"`])/i,
  /\bsupabase_flutter\b/i,
  /\bSupabase\.initialize\s*\(/,
  /\bcreateClient\s*\(\s*[^)]*supabase/i,
  /https?:\/\/[^\s'"`]+\.supabase\.co(?:[\/:?]|$)/i,
  /(?:postgres(?:ql)?:\/\/)/i,
  /\bservice_role\b/i,
  /\bsb_secret_[A-Za-z0-9_-]+/i,
  /\b(?:VITE_|NEXT_PUBLIC_|EXPO_PUBLIC_)?SUPABASE_(?:URL|ANON_KEY|SERVICE_ROLE_KEY|SECRET_KEY)\b/i,
  /['"`](?:pg|postgres|@neondatabase\/serverless|@vercel\/postgres|@prisma\/client)['"`]/i,
  /package:postgres\/postgres\.dart/i,
  /\b(?:drizzle-orm|mysql2|node-postgres)\b/i,
];

function clientAuthorityViolations(path, contents) {
  return forbiddenClientAuthority.filter((pattern) => pattern.test(contents)).map(String)
    .map((pattern) => `${path}: ${pattern}`);
}

test('Packet 0 boundary detector rejects synthetic client-side Supabase/Data API/database authority', () => {
  for (const synthetic of [
    "import { createClient } from '@supabase/supabase-js'",
    "import 'package:supabase_flutter/supabase_flutter.dart';",
    'Supabase.initialize(',
    'https://sample.supabase.co/rest/v1/orders',
    'postgresql://host/db',
    'const x = "service_role";',
    "import { drizzle } from 'drizzle-orm/node-postgres';",
    "import { PostgrestClient } from '@supabase/postgrest-js';",
    "import 'package:postgrest/postgrest.dart';",
    "fetch('/rest/v1/orders', { method: 'POST' })",
    "fetch('/auth/v1/token', { method: 'POST' })",
    'https://fixture.supabase.co/auth/v1/token',
    'https://fixture.supabase.co/storage/v1/object/public/test',
    ['sb_secret_', 'synthetic-marker-not-a-key'].join(''),
    'process.env.VITE_SUPABASE_URL',
    "import io.github.jan.supabase.SupabaseClient", // Native Android Supabase authority
    'implementation("io.github.jan-tennert.supabase:postgrest-kt:3.0.0")',
    'DriverManager.getConnection("jdbc:postgresql://db.example.invalid:5432/postgres")',
    'Class.forName("org.postgresql.Driver")',
    "import pg from 'pg'",
    "import postgres from 'postgres'",
    "import 'package:postgres/postgres.dart';",
  ]) {
    assert.ok(clientAuthorityViolations('synthetic-client', synthetic).length > 0,
      'the detector must reject this unauthorized client authority pattern');
  }
  assert.deepEqual(clientAuthorityViolations('safe-client', "fetch('/api/v1/catalog')"), []);
});

test('Packet 0 provider boundary keeps database and Supabase credentials out of existing React and Flutter sources', async () => {
  const files = [
    ...await clientSources('web/src', /\.(?:ts|tsx)$/),
    ...await clientSources('web/public', /\.(?:js|mjs|html|json)$/),
    ...await clientSources('lib', /\.dart$/),
    // Native Android code and manifest are shipped in the Flutter client too.
    ...await clientSources('android/app/src', /\.(?:kt|java|xml)$/),
    ['android/app/build.gradle.kts', await source('android/app/build.gradle.kts')],
    ['android/build.gradle.kts', await source('android/build.gradle.kts')],
    ['android/settings.gradle.kts', await source('android/settings.gradle.kts')],
    ['android/gradle.properties', await source('android/gradle.properties')],
    ['web/package.json', await source('web/package.json')],
    ['web/index.html', await source('web/index.html')],
    ['web/vite.config.ts', await source('web/vite.config.ts')],
    ['pubspec.yaml', await source('pubspec.yaml')],
  ];
  assert.ok(files.length >= 40, 'expected the actual portal and mobile source files');
  const scannedPaths = new Set(files.map(([path]) => path));
  for (const nativePath of [
    'android/app/build.gradle.kts',
    'android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/kotlin/dev/nearpill/mobile/MainActivity.kt',
  ]) {
    assert.ok(scannedPaths.has(nativePath), `native application source must be scanned: ${nativePath}`);
  }
  const violations = files.flatMap(([path, contents]) => clientAuthorityViolations(path, contents));
  assert.deepEqual(violations, [], 'mobile and browser must call the NearPill API, not Supabase or Postgres');
});

test('Packet 0 provider boundary preserves exactly the existing backend-owned Hono/Drizzle authority', async () => {
  const [bootstrap, postgres, backendPackage, webClient, mobileClient] = await Promise.all([
    source('backend/src/bootstrap/server.ts'),
    source('backend/src/infrastructure/postgres/client.js'),
    source('backend/package.json'),
    source('web/src/api/client.ts'),
    source('lib/core/api/api_client.dart'),
  ]);
  assert.match(bootstrap, /createPostgresDatabase\(/);
  assert.match(bootstrap, /createHttpApp\(/);
  assert.match(bootstrap, /createAuthService\(/);
  assert.doesNotMatch(bootstrap, /(?:express|supabase(?:Auth|Client)|createClient\s*\()/i);
  assert.match(postgres, /drizzle-orm\/node-postgres/);
  assert.match(postgres, /rejectUnauthorized:\s*true/);
  assert.match(backendPackage, /"drizzle-orm"/);
  assert.doesNotMatch(backendPackage, /"@supabase\/supabase-js"/);
  assert.match(webClient, /const API_BASE = '\/api\/v1'/);
  assert.match(webClient, /credentials:\s*'same-origin'/);
  assert.match(webClient, /X-CSRF-Token/);
  assert.match(mobileClient, /\bDio\b/);
});

test('Packet 0 RLS source contract keeps backend actor state transaction-local, not Supabase Auth', async () => {
  const [context, policy, parser] = await Promise.all([
    source('backend/src/infrastructure/postgres/context.js'),
    source('backend/migrations/postgres/0002_rls.sql'),
    source('backend/src/config/env.ts'),
  ]);
  assert.match(context, /set_config\('app\.user_id',\s*\$1,\s*true\)/);
  assert.match(context, /set_config\('app\.role',\s*\$2,\s*true\)/);
  assert.match(policy, /ALTER TABLE orders FORCE ROW LEVEL SECURITY;/);
  assert.match(policy, /ALTER TABLE inventory FORCE ROW LEVEL SECURITY;/);
  assert.match(policy, /CREATE POLICY orders_insert ON orders FOR INSERT TO nearpill_app/);
  assert.match(policy, /WITH CHECK/);
  assert.doesNotMatch(policy, /\bauth\.uid\s*\(/);
  assert.match(parser, /nearpill_app/);
  // This is static source evidence only; non-BYPASSRLS ownership, actual role
  // grants, pooling rollback isolation, and tenant-negative queries remain
  // explicitly BLOCKED until an approved NearPill Supabase staging exists.
});
