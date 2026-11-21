import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, symlink, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assertReviewedMigrationFilenames,
  loadReviewedMigrationSources,
  literalSqlStatements,
  reviewedDropTableTargets,
} from '../scripts/lib/reviewed-migration-sources.mjs';

async function withFixture(files, verify) {
  const dir = await mkdtemp(path.join(tmpdir(), 'nearpill-migration-inventory-'));
  try {
    for (const [name, value] of Object.entries(files)) {
      await writeFile(path.join(dir, name), value);
    }
    return await verify(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('canonical migration loader reads the complete numbered source set in order', async () => {
  await withFixture({
    '0002_identity.sql': 'SELECT 2;',
    'README.md': 'not SQL',
    '0001_core.sql': 'SELECT 1;',
  }, async (dir) => {
    assert.deepEqual(await loadReviewedMigrationSources(dir), [
      { filename: '0001_core.sql', sql: 'SELECT 1;' },
      { filename: '0002_identity.sql', sql: 'SELECT 2;' },
    ]);
  });
});

test('migration loader refuses unnumbered SQL, sequence gaps and duplicate sequence numbers', async () => {
  for (const files of [
    { '0001_core.sql': 'SELECT 1;', 'hotfix.sql': 'SELECT 2;' },
    { '0001_core.sql': 'SELECT 1;', '0003_payment.sql': 'SELECT 3;' },
    { '0001_core.sql': 'SELECT 1;', '0001_extra.sql': 'SELECT 2;' },
    { '0002_identity.sql': 'SELECT 2;' },
  ]) {
    await withFixture(files, async (dir) => {
      await assert.rejects(loadReviewedMigrationSources(dir), /migration file inventory refused/);
    });
  }
  assert.throws(() => assertReviewedMigrationFilenames(null), /migration file inventory/i);
});

test('migration inventory refuses unreviewed directory entries instead of ignoring them', async () => {
  // An unexpected staged/renamed migration must block BOTH the canonical
  // runner and its read-only staging preflight, not be silently skipped.
  for (const unreviewed of [
    '0002_unreviewed.SQL',
    '0002_unreviewed.sql.bak',
    '0002_unreviewed.txt',
    '.pending-migration',
  ]) {
    await withFixture({
      '0001_core.sql': 'SELECT 1;',
      [unreviewed]: 'SELECT 2;',
    }, async (dir) => {
      await assert.rejects(loadReviewedMigrationSources(dir), /migration file inventory refused/,
        `${unreviewed} must be rejected before DB connection`);
    });
  }
  // Preserve the existing ordinary README alongside canonical SQL sources.
  await withFixture({ '0001_core.sql': 'SELECT 1;', 'README.md': 'Notes only' }, async (dir) => {
    assert.equal((await loadReviewedMigrationSources(dir)).length, 1);
  });
  await withFixture({ '0001_core.sql': 'SELECT 1;' }, async (dir) => {
    await symlink(path.join(dir, '0001_core.sql'), path.join(dir, 'README.md'));
    await assert.rejects(loadReviewedMigrationSources(dir), /migration file inventory refused/,
      'allowed README name must not mask a symbolic link');
  });
});

test('source SQL statement scanner respects PostgreSQL E-string escaped quotes and semicolons', () => {
  // PostgreSQL E'...' backslashes can escape quotes: the apparent semicolon
  // and CREATE POLICY below are literal text, not standalone SQL commands.
  const source = String.raw`SELECT E'escaped \' quote; CREATE POLICY phantom ON users FOR ALL TO nearpill_app;';
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;`;
  const statements = literalSqlStatements(source, '0001_core.sql');
  assert.equal(statements.length, 2, 'E-string content must not create fake SQL statements');
  assert.equal(statements[0].statement, String.raw`SELECT E'escaped \' quote; CREATE POLICY phantom ON users FOR ALL TO nearpill_app;'`);
  assert.equal(statements[1].statement, 'ALTER TABLE public.users ENABLE ROW LEVEL SECURITY');

  // An escaped backslash before a *real* closing quote must not swallow the
  // following statement, and ordinary/doubled-quote SQL stays supported.
  const doubled = String.raw`SELECT E'escaped \\' || 'ordinary;string'; SELECT 2;`;
  assert.equal(literalSqlStatements(doubled, '0002_core.sql').length, 2);
});

test('migration loader refuses a symlinked migration directory before reading external SQL', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nearpill-migration-root-'));
  const external = await mkdtemp(path.join(tmpdir(), 'nearpill-external-migrations-'));
  try {
    await writeFile(path.join(external, '0001_core.sql'), 'SELECT 42;');
    const disguised = path.join(root, 'postgres');
    await symlink(external, disguised, 'dir');
    await assert.rejects(loadReviewedMigrationSources(disguised),
      /migration file inventory refused.*directory/i,
      'a migration directory symlink must not redirect trusted source outside the project');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('migration loader refuses a symlinked ancestor of the canonical migration directory', async () => {
  // The final postgres/ directory may be regular even when its migrations/
  // ancestor is a link to SQL outside the reviewed project tree.
  const root = await mkdtemp(path.join(tmpdir(), 'nearpill-migration-ancestor-'));
  const external = await mkdtemp(path.join(tmpdir(), 'nearpill-external-parent-'));
  try {
    const outsideSql = path.join(external, 'postgres');
    await mkdir(outsideSql);
    await writeFile(path.join(outsideSql, '0001_core.sql'), 'SELECT 42;');
    await symlink(external, path.join(root, 'migrations'), 'dir');
    await assert.rejects(
      loadReviewedMigrationSources(path.join(root, 'migrations', 'postgres')),
      /migration file inventory refused.*(?:symlink|ancestor|directory)/i,
      'a regular final directory under a linked parent must not be read',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});

test('loader refuses symlinked SQL even when its filename follows the canonical pattern', async () => {
  await withFixture({ '0001_core.sql': 'SELECT 1;' }, async (dir) => {
    await symlink(path.join(dir, '0001_core.sql'), path.join(dir, '0002_injected.sql'));
    await assert.rejects(loadReviewedMigrationSources(dir), /not a regular SQL file/);
  });
});

test('loader rejects empty SQL and does not return a partially executable batch', async () => {
  await withFixture({
    '0001_core.sql': 'SELECT 1;',
    '0002_empty.sql': '   \n',
  }, async (dir) => {
    await assert.rejects(loadReviewedMigrationSources(dir), /cannot safely read 0002_empty\.sql/);
  });
});

test('migration loader rejects invalid UTF-8 and NUL instead of silently changing SQL bytes', async () => {
  const invalid = Buffer.concat([Buffer.from('SELECT 1; -- '), Buffer.from([0xc3, 0x28])]);
  for (const [label, bytes, expected] of [
    ['malformed UTF-8', invalid, /invalid UTF-8/i],
    ['NUL byte', Buffer.from('SELECT 1;\0 SELECT 2;'), /NUL byte/i],
  ]) {
    await withFixture({ '0001_core.sql': 'SELECT 1;', '0002_bad.sql': bytes }, async (dir) => {
      await assert.rejects(loadReviewedMigrationSources(dir), (error) => {
        assert.match(error.message, /cannot safely read 0002_bad\.sql/);
        assert.match(error.cause?.message ?? '', expected, label);
        return true;
      });
    });
  }
  // TextDecoder strips a leading UTF-8 BOM by default, turning an on-disk
  // migration into different executable/checksummed SQL without warning.
  // Refuse this source ambiguity before a migration runner opens a Pool.
  await withFixture({
    '0001_core.sql': Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('SELECT 1;')]),
  }, async (dir) => {
    await assert.rejects(loadReviewedMigrationSources(dir), (error) => {
      assert.match(error.message, /cannot safely read 0001_core\.sql/);
      assert.match(error.cause?.message ?? '', /UTF-8 BOM/i);
      return true;
    });
  });
  // Valid multibyte UTF-8 must remain intact in the shared preflight/runner source.
  await withFixture({ '0001_core.sql': "SELECT 'Cebu—NearPill';" }, async (dir) => {
    assert.equal((await loadReviewedMigrationSources(dir))[0].sql, "SELECT 'Cebu—NearPill';");
  });
});

test('runner must validate the complete source inventory before creating its Pool', async () => {
  const runner = await readFile(new URL('../scripts/migrate-postgres.mjs', import.meta.url), 'utf8');
  const preflight = await readFile(new URL('../scripts/lib/verify-live-fixture-connection.mjs', import.meta.url), 'utf8');
  const sourceStart = runner.indexOf('await loadReviewedMigrationSources(migrationDir)');
  const poolStart = runner.indexOf('new Pool(');
  assert.ok(sourceStart > 0 && poolStart > sourceStart);
  assert.match(runner, /for \(const \{ filename, sql, sha256 \} of migrations\)/);
  assert.match(preflight, /loadReviewedMigrationSources\(MIGRATION_DIRECTORY\)/);
  assert.doesNotMatch(runner, /readdir\(migrationDir\)/);
});

test('actual reviewed migrations are regular files with contiguous versions', async () => {
  const dir = new URL('../migrations/postgres/', import.meta.url);
  const migrations = await loadReviewedMigrationSources(dir);
  assert.deepEqual(migrations.map(({ filename }) => filename), [
    '0001_core.sql', '0002_rls.sql', '0003_indexes.sql',
    '0004_identity_security.sql', '0005_catalog_discovery.sql',
    '0006_order_inventory.sql', '0007_payment_reconciliation.sql',
    '0008_users_rls.sql', '0009_otc_eligibility.sql',
    '0010_order_policy_recursion.sql', '0011_order_payment_policy_recursion.sql',
    '0012_internal_function_permissions.sql', '0013_order_owner_fk_inventory.sql',
    '0014_internal_function_defaults.sql', '0015_order_status_defaults.sql',
    '0016_backend_mutation_authority.sql', '0017_reservation_delete_authority.sql',
    '0018_mutation_audit_returning.sql', '0019_catalog_browsing.sql',
    '0020_payment_status_constraint.sql', '0021_partner_inventory_intake.sql',
    '0022_partner_inventory_price.sql', '0023_pharmacy_sale_confirmation.sql', '0024_partner_test_pickup.sql',
    '0025_partner_complete_pickup.sql', '0026_inventory_selling_units.sql', '0027_staging_prescription_reviews.sql', '0028_prescription_rejection_reason.sql', '0029_pharmacy_new_product.sql', '0030_prescription_customer_name.sql', '0031_inventory_expiry_low_stock.sql', '0032_partner_catalog_any_category.sql', '0033_plans_categories_cleanup.sql',
  '0034_delete_test_pharmacies.sql',
  '0035_order_prescription_check.sql',
  '0036_order_pickup_date.sql',
  '0037_account_deletion.sql', '0038_signup_hardening.sql', '0039_partner_account_numbers.sql', '0040_admin_create_partner_accounts.sql', '0041_stock_submissions.sql', '0042_renumber_catalog_ids.sql', '0043_verify_existing_pharmacies.sql', '0044_revoke_public_category_helpers.sql', '0045_log_retention.sql', '0046_auto_approved_stock.sql', '0047_delete_leftover_test_pharmacies.sql', '0048_remove_account_4_renumber_moms.sql', '0049_keep_only_alv_bing_dobol_b.sql', '0050_link_moms_partner_login.sql', '0051_admin_scrub_prescriptions.sql', '0052_partner_sees_own_pharmacy_and_full_delete.sql', '0053_simpler_database_names.sql',
  ]);
  for (const { sql } of migrations) assert.ok(sql.trim().length > 100);
});


// Packet 0 source characterization only: replay literal policy statements in
// canonical migration order. Split SQL without treating comments, quoted text,
// or DO $$ procedural bodies as policy commands. This is deliberately NOT a
// general SQL parser: deployed grants, inherited roles, dynamic SQL and RLS
// effectiveness must still be checked with the actual staging application role.

// DROP TABLE discards every policy attached to that relation, even when a
// later migration recreates a same-named table and re-enables FORCE RLS.
// Share the strict literal DROP recognition with the RLS-posture replay so
// that the two source characterizations cannot disagree about table identity.

// The only table renames the reviewed history may contain: migration 0053 gives the database simpler names. A renamed table keeps its
// RLS posture and policies, so its earlier history counts for the new name. Any other RENAME or SET SCHEMA is still rejected.
const reviewedTableRenames = new Map([
  ['drugstores', 'pharmacies'], ['inventory', 'stock'], ['order_drugstores', 'order_pharmacies'],
  ['subscription_entitlements', 'plan_features'], ['payment_reconciliation', 'payment_issues'],
  ['email_verification_challenges', 'email_codes'], ['password_reset_challenges', 'reset_links'],
]);
const reviewedRenameFile = '0053_simpler_database_names.sql';
const tableAliases = (table) => new Set([table, ...[...reviewedTableRenames].filter(([, renamed]) => renamed === table).map(([original]) => original)]);

function effectiveLiteralPolicies(migrations, table) {
  if (!/^(?:nearpill\.)?[a-z][a-z0-9_]*$/.test(table)) throw new Error('invalid inspected table');
  const policies = new Map();
  const aliases = tableAliases(table);
  for (const { filename, sql } of migrations) {
    for (const { statement, line } of literalSqlStatements(sql, filename)) {
      if (reviewedDropTableTargets(statement, filename, line)?.some((dropped) => aliases.has(dropped))) {
        policies.clear();
        continue;
      }
      if (!/^(?:CREATE|DROP|ALTER)\s+POLICY\b/i.test(statement)) continue;
      const match = /^(CREATE|DROP|ALTER)\s+POLICY\s+(?:IF\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s+ON\s+(?:public\.)?((?:nearpill\.)?[a-z_][a-z0-9_]*)(?:\s+FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\s+TO\s+([a-z_][a-z0-9_]*))?(?=\s|$)/i.exec(statement);
      if (!match) throw new Error(`unreviewed policy syntax at ${filename}:${line}`);
      const [, action, name, target, operation, role] = match;
      if (!aliases.has(target)) continue;
      const suffix = statement.slice(match[0].length).trim();
      if (suffix && !/^(?:USING\b|WITH\b)/i.test(suffix)) {
        throw new Error(`unreviewed policy suffix for ${table} at ${filename}:${line}`);
      }
      if (action.toUpperCase() === 'ALTER') {
        throw new Error(`unreviewed ALTER POLICY for ${table} at ${filename}:${line}`);
      }
      if (action.toUpperCase() === 'DROP') {
        policies.delete(name);
      } else {
        if (!operation || !['nearpill_app', 'nearpill_migrator'].includes(role)) {
          throw new Error(`unreviewed policy role for ${table} at ${filename}:${line}`);
        }
        if (role === 'nearpill_migrator') continue;
        if (policies.has(name)) {
          throw new Error(`duplicate active policy ${name} on ${table} at ${filename}:${line}`);
        }
        policies.set(name, { operation: operation.toUpperCase(), filename });
      }
    }
  }
  return policies;
}

// Policy existence is not proof of protection: a later ALTER TABLE may
// disable RLS or remove FORCE. Replay those explicit DDL switches in exactly
// the reviewed migration order, fail closed on unfamiliar RLS DDL, and keep
// this distinct from the mandatory *live* pg_class/app-role acceptance probe.
function effectiveLiteralRlsPosture(migrations, table) {
  if (!/^(?:nearpill\.)?[a-z][a-z0-9_]*$/.test(table)) throw new Error('invalid inspected table');
  let enabled = false;
  let forced = false;
  let lastChange = null;
  const aliases = tableAliases(table);
  for (const { filename, sql } of migrations) {
    for (const { statement, line } of literalSqlStatements(sql, filename)) {
      // A later DROP removes the protected relation and its policies even if
      // earlier migrations enabled/forced RLS. A recreated relation must earn
      // fresh ENABLE and FORCE evidence; do not carry old posture forward.
      if (/^DROP\s+TABLE\b/i.test(statement)) {
        if (reviewedDropTableTargets(statement, filename, line)?.some((dropped) => aliases.has(dropped))) {
          enabled = false;
          forced = false;
          lastChange = `${filename}:${line}`;
        }
        continue;
      }
      if (!/^ALTER\s+TABLE\b/i.test(statement)) continue;
      const head = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?((?:nearpill\.)?[a-z_][a-z0-9_]*)(?=\s|$)/i.exec(statement);
      // Do not silently ignore unrecognized RLS-altering syntax.
      if (!head) {
        if (/\bROW\s+LEVEL\s+SECURITY\b/i.test(statement)) {
          throw new Error(`unreviewed RLS table syntax at ${filename}:${line}`);
        }
        continue;
      }
      if (!aliases.has(head[1].toLowerCase())) continue;
      const remainder = statement.slice(head[0].length).trim();
      const switchMatch = /^(ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY$/i.exec(remainder);
      if (switchMatch) {
        const command = switchMatch[1].replace(/\s+/g, ' ').toUpperCase();
        if (command === 'ENABLE') enabled = true;
        if (command === 'DISABLE') enabled = false;
        if (command === 'FORCE') forced = true;
        if (command === 'NO FORCE') forced = false;
        lastChange = `${filename}:${line}`;
      } else if (filename === reviewedRenameFile && reviewedTableRenames.get(head[1].toLowerCase()) === (/^RENAME\s+TO\s+([a-z_][a-z0-9_]*)$/i.exec(remainder)?.[1] ?? '').toLowerCase()) {
        // The reviewed 0053 rename: posture and policies carry over to the new name.
        continue;
      } else if (/^(?:RENAME\s+TO|SET\s+SCHEMA)\b/i.test(remainder)) {
        // Moving/renaming a protected table invalidates the expected public
        // table identity, even if its physical relrowsecurity flag survives.
        throw new Error(`protected table relocated at ${filename}:${line}: ${table}`);
      } else if (/\bROW\s+LEVEL\s+SECURITY\b/i.test(remainder)) {
        throw new Error(`unreviewed RLS mutation for ${table} at ${filename}:${line}`);
      }
    }
  }
  return { enabled, forced, lastChange };
}

function policyOperations(policies) {
  return [...policies.values()].map(({ operation }) => operation).sort();
}

test('Packet 0 migration-order audit: later migrations retire broad order, inventory and reservation policies', async () => {
  const migrations = await loadReviewedMigrationSources(new URL('../migrations/postgres/', import.meta.url));
  const orderChildren = effectiveLiteralPolicies(migrations, 'order_pharmacies');
  assert.equal(orderChildren.has('order_drugstores_access'), false);
  assert.deepEqual(policyOperations(orderChildren), ['INSERT', 'SELECT', 'SELECT', 'UPDATE', 'UPDATE', 'UPDATE']);
  assert.equal(orderChildren.get('order_drugstores_partner_pickup_update')?.operation, 'UPDATE');
  const lines = effectiveLiteralPolicies(migrations, 'order_items');
  assert.equal(lines.has('order_items_access'), false);
  assert.deepEqual(policyOperations(lines), ['INSERT', 'SELECT']);
  const inventory = effectiveLiteralPolicies(migrations, 'stock');
  assert.equal(inventory.has('inventory_write'), false);
  // 0029 adds one partner-only INSERT policy (inventory_partner_new_product) for a pharmacy's brand-new draft product.
  assert.deepEqual(policyOperations(inventory), ['INSERT', 'INSERT', 'INSERT', 'INSERT', 'SELECT', 'SELECT', 'SELECT', 'UPDATE', 'UPDATE']);
  assert.equal(inventory.get('inventory_partner_intake')?.operation, 'INSERT');
  assert.equal(inventory.get('inventory_partner_new_product')?.operation, 'INSERT');
  // 0032 lets a pharmacy list any catalog item (prescription listings carry no sale confirmation, so they never check out).
  assert.equal(inventory.get('inventory_partner_catalog_any')?.operation, 'INSERT');
  const reservations = effectiveLiteralPolicies(migrations, 'reservations');
  assert.equal(reservations.has('reservations_app'), false);
  assert.deepEqual(policyOperations(reservations), ['DELETE', 'INSERT', 'SELECT', 'SELECT', 'UPDATE', 'UPDATE']);
});

test('Packet 0 effective-policy replay honors DROP before a later CREATE, and detects reintroduced broad child permissions', () => {
  const history = [
    { filename: '0001.sql', sql: 'CREATE POLICY child_access ON order_drugstores FOR ALL TO nearpill_app\n' },
    { filename: '0002.sql', sql: 'DROP POLICY IF EXISTS child_access ON order_drugstores;\nCREATE POLICY child_select ON order_drugstores FOR SELECT TO nearpill_app;' },
  ];
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(history, 'order_drugstores')), ['SELECT']);
  history.push({ filename: '0003.sql', sql: 'CREATE POLICY child_delete ON order_drugstores FOR DELETE TO nearpill_app;' });
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(history, 'order_drugstores')), ['DELETE', 'SELECT']);
  history.push({ filename: '0004.sql', sql: 'DROP POLICY IF EXISTS child_delete ON order_drugstores;' });
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(history, 'order_drugstores')), ['SELECT']);
});

test('Packet 0 policy lineage retires policies when a protected table is dropped and recreated', () => {
  const beforeDrop = [{ filename: '0001.sql', sql: `CREATE POLICY old_read ON order_items FOR SELECT TO nearpill_app;
CREATE POLICY old_write ON order_items FOR INSERT TO nearpill_app WITH CHECK (true);` }];
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(beforeDrop, 'order_items')), ['INSERT', 'SELECT']);
  const dropped = [...beforeDrop, { filename: '0002.sql', sql: 'DROP TABLE IF EXISTS public.order_items CASCADE;' }];
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(dropped, 'order_items')), []);
  const recreated = [...dropped, { filename: '0003.sql', sql: `CREATE TABLE public.order_items (id bigint);
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;` }];
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(recreated, 'order_items')), [],
    'forcing RLS on a newly created relation does not restore dropped policies');
  const fresh = [...recreated, { filename: '0004.sql', sql: 'CREATE POLICY new_read ON order_items FOR SELECT TO nearpill_app USING (true);' }];
  assert.deepEqual([...effectiveLiteralPolicies(fresh, 'order_items').keys()], ['new_read']);
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(fresh, 'order_items')), ['SELECT']);
});

test('Packet 0 policy lineage handles multi-table DROP and refuses unreviewed quoted target', () => {
  const history = [{ filename: '0001.sql', sql: 'CREATE POLICY old_select ON reservations FOR SELECT TO nearpill_app;' },
    { filename: '0002.sql', sql: 'DROP TABLE IF EXISTS public.orders, public.reservations CASCADE;' }];
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(history, 'reservations')), []);
  history[1].sql = 'DROP TABLE "reservations";';
  assert.throws(() => effectiveLiteralPolicies(history, 'reservations'), /unreviewed DROP TABLE syntax/);
  history[1].sql = '-- DROP TABLE reservations;';
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(history, 'reservations')), ['SELECT']);
});

test('Packet 0 effective-policy replay rejects unsupported policy syntax instead of claiming mitigation', () => {
  const target = 'order_drugstores';
  for (const sql of [
    'ALTER POLICY child_select ON order_drugstores USING (true);',
    'CREATE POLICY surprise ON order_drugstores;',
    'CREATE POLICY leaked ON order_drugstores FOR SELECT TO public;',
    'CREATE POLICY leaked ON order_drugstores FOR SELECT TO nearpill_app, anon;',
    'CREATE POLICY child_select ON order_drugstores FOR SELECT TO nearpill_app;\nCREATE POLICY child_select ON order_drugstores FOR ALL TO nearpill_app;',
  ]) {
    assert.throws(() => effectiveLiteralPolicies([{ filename: '0008.sql', sql }], target), /unreviewed|duplicate/);
  }
});


test('Packet 0 lineage ignores comments and procedural literals, never inventing an active policy', () => {
  const history = [{ filename: '0008.sql', sql: `-- CREATE POLICY forged ON order_drugstores FOR ALL TO nearpill_app;
/* CREATE POLICY forged_block ON order_drugstores FOR DELETE TO nearpill_app; */
DO $$ BEGIN RAISE NOTICE 'CREATE POLICY forged_do ON order_drugstores FOR ALL TO nearpill_app;'; END $$;
CREATE POLICY approved ON order_drugstores FOR SELECT TO nearpill_app;
-- DROP POLICY approved ON order_drugstores;
` }];
  const result = effectiveLiteralPolicies(history, 'order_drugstores');
  assert.deepEqual([...result.keys()], ['approved']);
  assert.deepEqual(policyOperations(result), ['SELECT']);
});

test('Packet 0 lineage replays same-line and multiline policy commands in order', () => {
  const history = [{ filename: '0008.sql', sql: `CREATE POLICY first ON order_drugstores FOR ALL TO nearpill_app; DROP POLICY first ON order_drugstores; CREATE POLICY safe
ON order_drugstores FOR SELECT TO nearpill_app USING (true);` }];
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(history, 'order_drugstores')), ['SELECT']);
  history[0].sql += ' CREATE POLICY forbidden ON order_drugstores FOR DELETE TO nearpill_app;';
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(history, 'order_drugstores')), ['DELETE', 'SELECT']);
});

test('Packet 0 lineage is not confused by semicolons inside policy predicates or nested block comments', () => {
  const sql = `/* outer /* CREATE POLICY fake ON order_drugstores FOR ALL TO nearpill_app; */ still comment */
CREATE POLICY safe ON order_drugstores FOR SELECT TO nearpill_app USING (note = 'hello;world');
DROP POLICY safe ON order_drugstores;
CREATE POLICY retained ON order_drugstores FOR INSERT TO nearpill_app WITH CHECK (true);`;
  assert.deepEqual(policyOperations(effectiveLiteralPolicies([{ filename: '0008.sql', sql }], 'order_drugstores')), ['INSERT']);
  assert.throws(() => effectiveLiteralPolicies([{ filename: '0008.sql', sql: '/* unclosed' }], 'order_drugstores'), /unclosed/);
});


test('Packet 0 effective RLS posture remains ENABLED and FORCED for protected order and inventory tables', async () => {
  const migrations = await loadReviewedMigrationSources(new URL('../migrations/postgres/', import.meta.url));
  for (const table of ['stock', 'reservations', 'order_pharmacies', 'order_items']) {
    const posture = effectiveLiteralRlsPosture(migrations, table);
    assert.equal(posture.enabled, true, `${table} source RLS must be enabled`);
    assert.equal(posture.forced, true, `${table} source RLS must be forced`);
    assert.match(posture.lastChange, /^000[1-7]_[a-z_]+\.sql:\d+$/);
  }
});

test('the private prescription table has forced RLS and scoped read, submit, and update policies', async () => {
  const migrations = await loadReviewedMigrationSources(new URL('../migrations/postgres/', import.meta.url));
  const table = 'nearpill.prescription_reviews';
  const { enabled, forced } = effectiveLiteralRlsPosture(migrations, table);
  assert.equal(enabled && forced, true);
  assert.deepEqual(policyOperations(effectiveLiteralPolicies(migrations, table)),
    ['INSERT', 'SELECT', 'SELECT', 'SELECT', 'SELECT', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE', 'UPDATE']);
});

test('Packet 0 RLS posture honors later weakening and explicit restoration, not earlier policy declarations', () => {
  const baseline = [{ filename: '0001.sql', sql: `ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_select ON inventory FOR SELECT TO nearpill_app USING (true);` }];
  const read = (history) => effectiveLiteralRlsPosture(history, 'inventory');
  assert.deepEqual([read(baseline).enabled, read(baseline).forced], [true, true]);
  const weakened = [...baseline, { filename: '0002.sql', sql: `-- ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory DISABLE ROW LEVEL SECURITY; ALTER TABLE inventory NO FORCE ROW LEVEL SECURITY;` }];
  assert.deepEqual([read(weakened).enabled, read(weakened).forced], [false, false]);
  const restored = [...weakened, { filename: '0003.sql', sql: `ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;` }];
  assert.deepEqual([read(restored).enabled, read(restored).forced], [true, true]);
});

test('Packet 0 RLS posture ignores procedural/comment literals and rejects unreviewed RLS DDL', () => {
  const history = [{ filename: '0008.sql', sql: `/* ALTER TABLE inventory DISABLE ROW LEVEL SECURITY; */
DO $$ BEGIN RAISE NOTICE 'ALTER TABLE inventory NO FORCE ROW LEVEL SECURITY;'; END $$;
ALTER TABLE inventory ENABLE ROW LEVEL SECURITY; ALTER TABLE inventory FORCE ROW LEVEL SECURITY;` }];
  assert.deepEqual([effectiveLiteralRlsPosture(history, 'inventory').enabled, effectiveLiteralRlsPosture(history, 'inventory').forced], [true, true]);
  assert.throws(() => effectiveLiteralRlsPosture([{ filename: '0009.sql', sql: 'ALTER TABLE inventory ENABLE ROW LEVEL SECURITY CASCADE;' }], 'inventory'), /unreviewed RLS mutation/);
  assert.throws(() => effectiveLiteralRlsPosture([{ filename: '0009.sql', sql: 'ALTER TABLE "inventory" DISABLE ROW LEVEL SECURITY;' }], 'inventory'), /unreviewed RLS table syntax/);
  assert.throws(() => effectiveLiteralRlsPosture(history, 'inventory; DROP TABLE inventory'), /invalid inspected table/);
});


test('Packet 0 RLS posture fails after a later table drop, until a recreated relation is explicitly resecured', () => {
  const replay = (history) => effectiveLiteralRlsPosture(history, 'inventory');
  const baseline = [{ filename: '0001.sql', sql: 'ALTER TABLE inventory ENABLE ROW LEVEL SECURITY; ALTER TABLE inventory FORCE ROW LEVEL SECURITY;' }];
  assert.deepEqual([replay(baseline).enabled, replay(baseline).forced], [true, true]);
  const dropped = [...baseline, { filename: '0002.sql', sql: 'DROP TABLE IF EXISTS public.inventory CASCADE;' }];
  assert.deepEqual([replay(dropped).enabled, replay(dropped).forced], [false, false]);
  const recreated = [...dropped, { filename: '0003.sql', sql: 'CREATE TABLE inventory (id bigint);' }];
  assert.deepEqual([replay(recreated).enabled, replay(recreated).forced], [false, false]);
  const restored = [...recreated, { filename: '0004.sql', sql: 'ALTER TABLE inventory ENABLE ROW LEVEL SECURITY; ALTER TABLE inventory FORCE ROW LEVEL SECURITY;' }];
  assert.deepEqual([replay(restored).enabled, replay(restored).forced], [true, true]);
});

test('Packet 0 RLS posture rejects unreviewed protected table moves and quoted drops', () => {
  const migration = (sql) => [{ filename: '0008.sql', sql }];
  for (const sql of [
    'ALTER TABLE inventory RENAME TO inventory_old;',
    'ALTER TABLE IF EXISTS public.inventory SET SCHEMA archival;',
  ]) assert.throws(() => effectiveLiteralRlsPosture(migration(sql), 'inventory'), /protected table relocated/);
  assert.throws(() => effectiveLiteralRlsPosture(migration('DROP TABLE "inventory";'), 'inventory'), /unreviewed DROP TABLE syntax/);
  // Comments and a DO body are not executable top-level table drops.
  assert.deepEqual(
    [effectiveLiteralRlsPosture(migration(`ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
-- DROP TABLE inventory;
DO $$ BEGIN RAISE NOTICE 'DROP TABLE inventory;'; END $$;`), 'inventory').enabled,
    effectiveLiteralRlsPosture(migration(`ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
/* DROP TABLE inventory; */`), 'inventory').forced],
    [true, true],
  );
});
