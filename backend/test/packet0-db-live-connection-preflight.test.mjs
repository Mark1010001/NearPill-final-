import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { assertSafeLiveFixtureConnections, assertReviewedMigrationFilenames, reviewedRlsPolicyInventory, reviewedRlsPolicyInventoryFromSources, literalReviewedPolicyInventory, reviewedInternalRoutineBodiesFromSources, reviewedForeignKeyInventoryFromSources } from '../scripts/lib/verify-live-fixture-connection.mjs';
import { loadReviewedMigrationSources, literalSqlStatements } from '../scripts/lib/reviewed-migration-sources.mjs';

const local = Object.freeze({
  NEARPILL_VERIFICATION_TARGET: 'local-test',
  DB_NAME: 'nearpill_test',
  DB_USER: 'nearpill_app',
  MIGRATOR_DB_USER: 'nearpill_migrator',
});
const staging = Object.freeze({
  ...local,
  NEARPILL_VERIFICATION_TARGET: 'staging',
  DB_NAME: 'postgres',
  DB_USER: 'nearpill_app.example-project',
  MIGRATOR_DB_USER: 'nearpill_migrator.example-project',
});

// Recording transport uses actual source SQL digests, not a hand-written
// fixture list that could quietly diverge from the canonical migrations.
const migrationDirectory = new URL('../migrations/postgres/', import.meta.url);
const migrationFiles = (await readdir(migrationDirectory))
  .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
const reviewedPolicyRows = (await reviewedRlsPolicyInventory()).map((policy) => ({
  ...policy,
  // Recording values are deliberately not a claim about live policy SQL.
  // The check only establishes a minimum predicate-shape safety floor.
  qual: ['ALL', 'SELECT', 'UPDATE', 'DELETE'].includes(policy.cmd)
    ? policy.roles[0] === 'nearpill_migrator' ? 'true' : '(nearpill.current_actor_id() IS NOT NULL)'
    : null,
  with_check: ['ALL', 'INSERT', 'UPDATE'].includes(policy.cmd)
    ? policy.roles[0] === 'nearpill_migrator' ? 'true' : '(nearpill.current_actor_id() IS NOT NULL)'
    : null,
}));
const sourceMigrations = await loadReviewedMigrationSources(migrationDirectory);
const canonicalHelperBodies = reviewedInternalRoutineBodiesFromSources(sourceMigrations);
const canonicalForeignKeys = reviewedForeignKeyInventoryFromSources(sourceMigrations);
const sourceMigrationRows = await Promise.all(migrationFiles.map(async (filename) => ({
  filename,
  sha256: createHash('sha256').update(await readFile(new URL(filename, migrationDirectory))).digest('hex'),
})));

const reviewedIdempotencyIndex = Object.freeze({
  index_name: 'orders_user_idempotency_unique', table_name: 'orders',
  index_method: 'btree', index_unique: true, index_valid: true,
  index_ready: true, index_live: true, index_immediate: true,
  index_key_count: 2, index_total_count: 2,
  index_columns: ['user_id', 'idempotency_key'],
  index_default_operator_classes: true, index_column_collations_match: true,
  index_predicate: '(idempotency_key IS NOT NULL)',
});

// Catalog rows simulate reviewed physical indexes, not PostgreSQL evidence.
const reviewedAdditionalIndexes = Object.freeze([
  ['password_reset_active_user_idx', 'password_reset_challenges', ['user_id'], '(consumed_at IS NULL)'],
  ['payments_provider_external_unique', 'payments', ['provider', 'provider_payment_id'], '((provider IS NOT NULL) AND (provider_payment_id IS NOT NULL))'],
  ['payments_order_idempotency_unique', 'payments', ['order_id', 'idempotency_key'], '(idempotency_key IS NOT NULL)'],
  ['subscription_entitlements_active_unique', 'subscription_entitlements', ['drugstore_id', 'entitlement_key'], '(revoked_at IS NULL)'],
].map(([index_name, table_name, index_columns, index_predicate]) => Object.freeze({
  ...reviewedIdempotencyIndex, index_name, table_name, index_columns,
  index_predicate, index_key_count: index_columns.length,
  index_total_count: index_columns.length,
})));

// pg_constraint UNIQUE constraints from migrations 0006/0007 are distinct
// from the partial UNIQUE indexes. Recording rows model catalog shape only.
const reviewedCriticalUniqueConstraints = Object.freeze([
  ['pharmacy_memberships_user_store_unique', 'pharmacy_memberships', ['user_id', 'drugstore_id']],
  ['inventory_store_medicine_unique', 'inventory', ['drugstore_id', 'medicine_id']],
  ['reservations_order_inventory_unique', 'reservations', ['order_id', 'inventory_id']],
  ['payment_events_provider_event_unique', 'payment_events', ['provider', 'event_id']],
  ['refunds_provider_external_unique', 'refunds', ['provider', 'provider_refund_id']],
  ['refunds_provider_idempotency_unique', 'refunds', ['provider', 'idempotency_key']],
].map(([critical_constraint_name, table_name, index_columns]) => Object.freeze({
  critical_constraint_name, table_name, constraint_type: 'u',
  constraint_deferrable: false, constraint_deferred: false, constraint_validated: true,
  index_name: critical_constraint_name, index_method: 'btree',
  index_unique: true, index_valid: true, index_ready: true,
  index_live: true, index_immediate: true, index_nulls_not_distinct: false,
  index_key_count: 2, index_total_count: 2, index_columns,
  index_default_operator_classes: true, index_column_collations_match: true,
  index_columns_not_null: true, index_predicate: null,
})));

// Read-only pg_constraint rows for named and inline stock/centavo CHECKs.
// The mocked catalog is only a recording contract, never deployed PG evidence.
const reviewedStockAndMoneyChecks = Object.freeze([
  ['inventory_stock_invariant', 'inventory',
    'CHECK (((stock_on_hand >= 0) AND (reserved_quantity >= 0) AND (reserved_quantity <= stock_on_hand)))'],
  ['inventory_price_centavos_nonnegative', 'inventory', 'CHECK ((price_centavos >= 0))'],
  ['orders_total_centavos_nonnegative', 'orders', 'CHECK ((total_centavos >= 0))'],
  ['order_items_unit_price_centavos_nonnegative', 'order_items', 'CHECK ((unit_price_centavos >= 0))'],
  ['payments_amount_centavos_nonnegative', 'payments', 'CHECK ((amount_centavos >= 0))'],
  ['reservations_quantity_check', 'reservations', 'CHECK ((quantity > 0))'],
  ['refunds_amount_centavos_check', 'refunds', 'CHECK ((amount_centavos > 0))'],
  ['payment_events_amount_centavos_check', 'payment_events',
    'CHECK (((amount_centavos IS NULL) OR (amount_centavos >= 0)))'],
].map(([invariant_constraint_name, table_name, constraint_definition]) => Object.freeze({
  invariant_constraint_name, table_name, constraint_definition,
  constraint_type: 'c', constraint_validated: true, constraint_enforced: true,
  constraint_no_inherit: false, constraint_is_local: true,
  constraint_inherit_count: 0, constraint_no_parent: true,
})));

// Verified migration 0006/0007 integer storage floor. PostgreSQL CHECK predicates
// evaluate NULL to UNKNOWN; only attnotnull closes that bypass.
const reviewedStockMoneyColumns = Object.freeze([
  ['inventory', 'price_centavos', 'int8'],
  ['inventory', 'stock_on_hand', 'int4'],
  ['inventory', 'reserved_quantity', 'int4'],
  ['orders', 'total_centavos', 'int8'],
  ['order_items', 'unit_price_centavos', 'int8'],
  ['payments', 'amount_centavos', 'int8'],
  ['reservations', 'quantity', 'int4'],
  ['refunds', 'amount_centavos', 'int8'],
  ['order_items', 'quantity', 'int4'],
  ['stock_movements', 'stock_on_hand_delta', 'int4'],
  ['stock_movements', 'reserved_delta', 'int4'],
  ['payment_events', 'amount_centavos', 'int8', false],
].map(([table_name, critical_column_name, type_name, column_not_null = true]) => Object.freeze({
  table_name, critical_column_name, type_name,
  column_not_null, column_generated: '', column_identity: '',
})));

const reviewedInternalRelations = [
  { internal_relation_name: 'prescription_reviews', internal_relation_kind: 'r', relrowsecurity: true, relforcerowsecurity: true, safe_acl: true },
  { internal_relation_name: 'prescription_reviews_id_seq', internal_relation_kind: 'S', safe_acl: true },
];

function pools({ env = local, app = {}, migrator = {}, tables = {}, publicSurface = [], publicRelations = [], defaultGrants = [], schema = {}, database = {}, policyRows = reviewedPolicyRows, migrationRows = sourceMigrationRows, internalSchemas = {}, internalRoutines = {}, internalRelations = reviewedInternalRelations, triggerRows = undefined, disabledConstraintTriggers = [], foreignKeys = canonicalForeignKeys, idempotencyIndex = reviewedIdempotencyIndex, additionalIndexes = reviewedAdditionalIndexes, criticalUniqueConstraints = reviewedCriticalUniqueConstraints, stockAndMoneyChecks = reviewedStockAndMoneyChecks, stockMoneyColumns = reviewedStockMoneyColumns } = {}) {
  const reads = [];
  const appProbe = {
    role_name: 'nearpill_app', session_role_name: 'nearpill_app', database_name: env.DB_NAME,
    is_superuser: false, bypass_rls: false,
    can_create_roles: false, can_create_databases: false,
    can_replicate: false, elevated_role_membership: false,
    client_elevated_role_membership: false,
    tls_active: env.NEARPILL_VERIFICATION_TARGET === 'staging', ...app,
  };
  const migratorProbe = {
    role_name: 'nearpill_migrator', session_role_name: 'nearpill_migrator', database_name: env.DB_NAME,
    is_superuser: false, bypass_rls: false,
    can_create_roles: false, can_create_databases: false,
    can_replicate: false, elevated_role_membership: false,
    client_elevated_role_membership: false,
    tls_active: env.NEARPILL_VERIFICATION_TARGET === 'staging', ...migrator,
  };
  const databaseProbe = {
    database_owner: 'nearpill_owner', app_can_assume_database_owner: false,
    app_can_create_database_objects: false, client_can_create_database_objects: false,
    public_can_create_database_objects: false, ...database,
  };
  const schemaProbe = {
    schema_owner: 'nearpill_owner', app_can_assume_schema_owner: false,
    app_can_create: false, client_can_create: false,
    public_can_create: false, api_roles_present: true, ...schema,
  };
  const protectedTables = [
    'drugstores', 'pharmacy_memberships', 'medicines', 'inventory', 'orders',
    'order_drugstores', 'order_items', 'payments', 'subscriptions', 'audit_logs',
    'auth_session_families', 'auth_sessions', 'email_verification_challenges',
    'password_reset_challenges', 'auth_rate_limit_events', 'auth_account_security',
    'medicine_evidence', 'pharmacy_verifications', 'reservations', 'stock_movements',
    'payment_events', 'refunds', 'payment_reconciliation',
    'subscription_entitlements', 'billing_events',
    'stock_submissions', 'auth_throttle_events', 'users', 'nearpill_schema_migrations', 'medicine_id_renumbering',
  ].map((table_name) => ({
    // A hypothetical hardened test database may pass this preflight. The
    // reviewed migrations still lack users RLS: see the NP-031 negative test.
    table_name, rls_enabled: table_name !== 'nearpill_schema_migrations',
    rls_forced: table_name !== 'nearpill_schema_migrations',
    owner_name: 'nearpill_owner', app_can_assume_owner: false,
    exposed_client_grant: false, public_grant: false,
    exposed_client_column_grant: false, public_column_grant: false,
    app_role_grant: table_name !== 'nearpill_schema_migrations',
    app_role_column_grant: table_name !== 'nearpill_schema_migrations',
    app_role_switch_table_grant: false,
    app_role_switch_column_grant: false,
    app_non_rls_table_privilege: false,
    app_role_switch_non_rls_table_privilege: false,
    app_non_rls_column_privilege: false,
    app_role_switch_non_rls_column_privilege: false,
    ...tables[table_name],
  }));
  const internalSchemaRows = ['nearpill', 'nearpill_extensions'].map((schema_name) => ({
    schema_name, schema_owner: 'nearpill_owner', app_can_assume_schema_owner: false,
    app_can_create: false, client_can_create: false, client_can_use: false,
    public_can_create: false, public_can_use: false,
    ...internalSchemas[schema_name],
  }));
  const reviewedInternalRoutines = Object.entries({
    current_actor_id: ['integer', 'search_path=pg_catalog'],
    current_actor_role: ['text', 'search_path=pg_catalog'],
    current_capability: ['text', 'search_path=pg_catalog'],
    touch_updated_at: ['trigger', 'search_path=pg_catalog, public, nearpill'],
    set_order_group_owner: ['trigger', 'search_path=pg_catalog, public, nearpill'],
    guard_inventory_authority: ['trigger', 'search_path=pg_catalog, public, nearpill'],
    guard_inventory_selling_unit: ['trigger', 'search_path=pg_catalog, nearpill'],
    canonical_category: ['text', 'search_path=pg_catalog'],
    normalize_medicine_category: ['trigger', 'search_path=pg_catalog, nearpill'],
  }).map(([internal_function_name, [return_type, searchPath]]) => ({
    internal_function_name, return_type,
    identity_arguments: internal_function_name === 'canonical_category' ? 'value text' : '', routine_kind: 'f', routine_language: return_type === 'trigger' ? 'plpgsql' : 'sql', security_definer: false,
    routine_settings: [searchPath], source_body: canonicalHelperBodies[internal_function_name], owner_name: 'nearpill_owner',
    app_can_assume_owner: false, app_can_execute: true,
    client_can_execute: false, public_can_execute: false,
    ...internalRoutines[internal_function_name],
  })).filter((row) => !internalRoutines[row.internal_function_name]?.missing);
  if (internalRoutines.extra) reviewedInternalRoutines.push(internalRoutines.extra);
  const approvedTriggerRows = triggerRows === undefined ? [{
    trigger_table_name: 'inventory', trigger_name: 'inventory_touch_updated_at',
    trigger_function_schema: 'nearpill', trigger_function_name: 'touch_updated_at',
    trigger_function_identity_arguments: '', trigger_type: 19, trigger_enabled: 'O',
    trigger_internal: false, trigger_is_clone: false, trigger_is_constraint: false,
    trigger_deferrable: false, trigger_initially_deferred: false, trigger_argument_count: 0,
    trigger_update_columns: '', trigger_has_when: false,
    trigger_has_old_transition: false, trigger_has_new_transition: false,
  }].flatMap((row) => [row,
    { ...row, trigger_table_name: 'order_drugstores', trigger_name: 'order_group_owner', trigger_function_name: 'set_order_group_owner', trigger_type: 7 },
    { ...row, trigger_name: 'inventory_authority', trigger_function_name: 'guard_inventory_authority' },
    { ...row, trigger_name: 'inventory_selling_unit_authority', trigger_function_name: 'guard_inventory_selling_unit', trigger_update_columns: 'package_size,selling_unit' },
    { ...row, trigger_table_name: 'medicines', trigger_name: 'medicines_normalize_category', trigger_function_name: 'normalize_medicine_category', trigger_type: 23, trigger_update_columns: 'category' },
  ]) : triggerRows;
  function fakePool(probe, isApp) {
    return {
      async query(sql, args) {
        reads.push({ sql, args });
        if (sql.includes('pg_stat_ssl')) return { rows: [probe] };
        if (!isApp && sql.includes('FROM public.nearpill_schema_migrations')) return { rows: migrationRows };
        if (isApp && sql.includes('FROM pg_database AS d')) return { rows: [databaseProbe] };
        if (isApp && sql.includes('AS internal_function_name')) return { rows: reviewedInternalRoutines };
        if (isApp && sql.includes('AS internal_relation_name')) return { rows: internalRelations };
        if (isApp && sql.includes('AS trigger_table_name')) return { rows: approvedTriggerRows };
        if (isApp && sql.includes('AS fk_source_table')) return { rows: foreignKeys };
        if (isApp && sql.includes('AS critical_constraint_name')) return { rows: criticalUniqueConstraints };
        if (isApp && sql.includes('AS invariant_constraint_name')) return { rows: stockAndMoneyChecks };
        if (isApp && sql.includes('AS critical_column_name')) return { rows: stockMoneyColumns };
        if (isApp && sql.includes('AS index_predicate')) return { rows: [
          ...(idempotencyIndex === null ? [] : Array.isArray(idempotencyIndex) ? idempotencyIndex : [idempotencyIndex]),
          ...additionalIndexes,
        ] };
        if (isApp && sql.includes('AS disabled_constraint_trigger_name')) return { rows: disabledConstraintTriggers };
        if (isApp && sql.includes('AS client_can_use') && sql.includes('FROM pg_namespace AS n')) return { rows: internalSchemaRows.filter((row) => !internalSchemas[row.schema_name]?.missing) };
        if (isApp && sql.includes('FROM pg_namespace AS n WHERE n.nspname = \'public\'')) return { rows: [schemaProbe] };
        if (isApp && sql.includes('FROM pg_catalog.pg_policies')) return { rows: Array.isArray(policyRows) ? policyRows.filter((policy) => args?.[0]?.includes(policy.tablename)) : policyRows };
        if (isApp && sql.includes('AS relation_kind')) return { rows: publicRelations };
        if (isApp && sql.includes('FROM pg_default_acl')) return { rows: defaultGrants };
        if (isApp && sql.includes('pg_proc')) return { rows: publicSurface };
        if (isApp && sql.includes('pg_class')) return { rows: protectedTables.filter((t) => !tables[t.table_name]?.missing) };
        throw new Error('Unexpected preflight query; no fixture writes may run.');
      },
    };
  }
  return { appPool: fakePool(appProbe, true), migratorPool: fakePool(migratorProbe, false), env, reads };
}

test('accepts a read-only live role and forced-RLS inventory check for disposable local test DB', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  assert.equal(fixture.reads.length, 20);
  assert.equal(fixture.reads[1].args[0].length, 30);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('Packet 0 keeps Drizzle order idempotency index predicate aligned with reviewed migration 0006', async () => {
  const ddl = (await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8'));
  const drizzle = (await readFile(new URL('../src/infrastructure/postgres/schema.ts', import.meta.url), 'utf8'));
  assert.match(drizzle, /import\s*\{\s*sql\s*\}\s*from\s*'drizzle-orm'/);
  assert.match(ddl, /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+orders_user_idempotency_unique\s+ON\s+orders\s*\(user_id,\s*idempotency_key\)\s+WHERE\s+idempotency_key\s+IS\s+NOT\s+NULL\s*;/i);
  assert.match(drizzle, /uniqueIndex\('orders_user_idempotency_unique'\)\s*\.on\(table\.userId,\s*table\.idempotencyKey\)\s*\.where\(sql`\$\{table\.idempotencyKey\} IS NOT NULL`\)/,
    'Drizzle must describe the canonical partial UNIQUE index rather than an unfiltered replacement');
});

test('Packet 0 keeps payment and entitlement partial UNIQUE declarations aligned with reviewed migration 0007', async () => {
  // A Drizzle declaration is schema metadata, not authority to regenerate or
  // apply migrations. The existing reviewed SQL is the canonical contract.
  const ddl = await readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8');
  const drizzle = await readFile(new URL('../src/infrastructure/postgres/schema.ts', import.meta.url), 'utf8');
  const declarations = [
    {
      name: 'payments_provider_external_unique',
      sql: /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+payments_provider_external_unique\s+ON\s+payments\s*\(provider,\s*provider_payment_id\)\s+WHERE\s+provider\s+IS\s+NOT\s+NULL\s+AND\s+provider_payment_id\s+IS\s+NOT\s+NULL\s*;/i,
      drizzle: /uniqueIndex\('payments_provider_external_unique'\)\s*\.on\(table\.provider,\s*table\.providerPaymentId\)\s*\.where\(sql`\$\{table\.provider\} IS NOT NULL AND \$\{table\.providerPaymentId\} IS NOT NULL`\)/,
    },
    {
      name: 'payments_order_idempotency_unique',
      sql: /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+payments_order_idempotency_unique\s+ON\s+payments\s*\(order_id,\s*idempotency_key\)\s+WHERE\s+idempotency_key\s+IS\s+NOT\s+NULL\s*;/i,
      drizzle: /uniqueIndex\('payments_order_idempotency_unique'\)\s*\.on\(table\.orderId,\s*table\.idempotencyKey\)\s*\.where\(sql`\$\{table\.idempotencyKey\} IS NOT NULL`\)/,
    },
    {
      name: 'subscription_entitlements_active_unique',
      sql: /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+subscription_entitlements_active_unique\s+ON\s+subscription_entitlements\s*\(drugstore_id,\s*entitlement_key\)\s+WHERE\s+revoked_at\s+IS\s+NULL\s*;/i,
      drizzle: /uniqueIndex\('subscription_entitlements_active_unique'\)\s*\.on\(table\.drugstoreId,\s*table\.entitlementKey\)\s*\.where\(sql`\$\{table\.revokedAt\} IS NULL`\)/,
    },
  ];
  for (const { name, sql, drizzle: expected } of declarations) {
    assert.match(ddl, sql, `${name} must retain its canonical migration definition`);
    assert.match(drizzle, expected, `${name} Drizzle metadata must describe the reviewed partial UNIQUE index`);
    assert.equal((drizzle.match(new RegExp(`uniqueIndex\\('${name}'\\)`, 'g')) ?? []).length, 1,
      `${name} must be declared exactly once in the canonical Drizzle schema`);
  }
});

test('Packet 0 keeps password-reset active-user partial UNIQUE metadata aligned with migration 0004', async () => {
  // The migration is canonical; this prevents generated-schema drift in an
  // identity invariant without attempting to replay or replace the migration.
  const ddl = await readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8');
  const drizzle = await readFile(new URL('../src/infrastructure/postgres/schema.ts', import.meta.url), 'utf8');
  assert.match(ddl,
    /CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+password_reset_active_user_idx\s+ON\s+password_reset_challenges\s*\(user_id\)\s+WHERE\s+consumed_at\s+IS\s+NULL\s*;/i,
    'the reviewed migration must retain one active password-reset challenge per user');
  assert.match(drizzle,
    /uniqueIndex\('password_reset_active_user_idx'\)\s*\.on\(table\.userId\)\s*\.where\(sql`\$\{table\.consumedAt\} IS NULL`\)/,
    'Drizzle must describe the same partial uniqueness predicate, not a full-user UNIQUE index');
  assert.equal((drizzle.match(/uniqueIndex\('password_reset_active_user_idx'\)/g) ?? []).length, 1,
    'declare the reviewed reset-challenge index exactly once');
});

test('Packet 0 requires the reviewed partial UNIQUE order idempotency index before fixture writes', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const query = fixture.reads.find(({ sql }) => sql.includes('AS index_predicate'));
  assert.ok(query, 'index catalog must be read under the application role');
  assert.match(query.sql, /pg_catalog\.pg_index/);
  assert.match(query.sql, /indisvalid/);
  assert.match(query.sql, /indisready/);
  assert.match(query.sql, /indislive/);
  assert.match(query.sql, /pg_get_expr/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('Packet 0 attests the other four reviewed partial UNIQUE indexes before migrator access', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const catalog = fixture.reads.find(({ sql }) => sql.includes('AS index_predicate'));
  for (const name of [
    'password_reset_active_user_idx',
    'payments_provider_external_unique',
    'payments_order_idempotency_unique',
    'subscription_entitlements_active_unique',
  ]) {
    assert.ok(catalog.sql.includes(name), `live catalog preflight must check ${name}`);
  }
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('Packet 0 refuses missing, drifted or unsafe reset/payment/entitlement unique indexes before migrator access', async () => {
  for (const reviewed of reviewedAdditionalIndexes) {
    const altered = [
      null, // missing one reviewed index
      { index_name: 'unreviewed_replacement_unique' },
      { table_name: 'orders' },
      { index_method: 'hash' },
      { index_unique: false },
      { index_valid: false },
      { index_ready: false },
      { index_live: false },
      { index_immediate: false },
      { index_key_count: 0 },
      { index_total_count: 3 },
      { index_columns: [...reviewed.index_columns].reverse().concat('unexpected') },
      { index_default_operator_classes: false },
      { index_column_collations_match: false },
      { index_predicate: null },
      { index_predicate: '(unrelated IS NOT NULL)' },
    ];
    for (const change of altered) {
      const additionalIndexes = reviewedAdditionalIndexes.flatMap((candidate) =>
        candidate.index_name === reviewed.index_name
          ? change === null ? [] : [{ ...candidate, ...change }]
          : [candidate]);
      const fixture = pools({ additionalIndexes });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture), /UNIQUE index/i,
        `${reviewed.index_name} must reject ${JSON.stringify(change)} before fixture execution`);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
        'unsafe index metadata must block subsequent migrator journal access');
      assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')),
        'preflight may not write data while evaluating catalogs');
    }
  }

  // An otherwise-valid duplicate is ambiguous, not evidence of parity.
  const duplicate = pools({ additionalIndexes: [...reviewedAdditionalIndexes, reviewedAdditionalIndexes[0]] });
  await assert.rejects(assertSafeLiveFixtureConnections(duplicate), /UNIQUE index/i);
  assert.equal(duplicate.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
});

test('Packet 0 attests twelve typed stock/money columns and reviewed nullability before migrator journal', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const catalog = fixture.reads.find(({ sql }) => sql.includes('AS critical_column_name'));
  assert.ok(catalog, 'must read pg_attribute catalog for critical stock and centavo columns');
  assert.match(catalog.sql, /pg_catalog\.pg_attribute/);
  assert.match(catalog.sql, /attnotnull/);
  assert.match(catalog.sql, /pg_catalog\.pg_type/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
  for (const expected of reviewedStockMoneyColumns) {
    assert.ok(catalog.sql.includes(expected.critical_column_name), expected.critical_column_name);
  }
  const columnIndex = fixture.reads.findIndex(({ sql }) => sql.includes('AS critical_column_name'));
  const migrationIndex = fixture.reads.findIndex(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations'));
  assert.ok(columnIndex >= 0 && columnIndex < migrationIndex);
});

test('Packet 0 attests order quantities, stock movement deltas and nullable payment event centavos', async () => {
  const expected = [
    ['order_items', 'quantity', 'int4', true],
    ['stock_movements', 'stock_on_hand_delta', 'int4', true],
    ['stock_movements', 'reserved_delta', 'int4', true],
    ['payment_events', 'amount_centavos', 'int8', false],
  ];
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const catalog = fixture.reads.find(({ sql }) => sql.includes('AS critical_column_name'))?.sql;
  assert.ok(catalog);
  for (const [table, column, type, notNull] of expected) {
    assert.ok(catalog.includes(`('${table}','${column}')`), `${table}.${column} must be catalog-attested`);
    assert.ok(reviewedStockMoneyColumns.some(row => row.table_name === table &&
      row.critical_column_name === column && row.type_name === type &&
      row.column_not_null === notNull), `${table}.${column}: must enforce reviewed type/nullability`);
  }
});

test('Packet 0 extended numeric column inventory matches the reviewed SQL migrations', async () => {
  const core = await readFile(new URL('../migrations/postgres/0001_core.sql', import.meta.url), 'utf8');
  const stock = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
  const payments = await readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8');
  assert.match(core, /CREATE TABLE IF NOT EXISTS order_items[\s\S]*?quantity INTEGER NOT NULL CHECK \(quantity > 0\)/);
  assert.match(stock, /CREATE TABLE IF NOT EXISTS stock_movements[\s\S]*?stock_on_hand_delta INTEGER NOT NULL DEFAULT 0,[\s\S]*?reserved_delta INTEGER NOT NULL DEFAULT 0/);
  assert.match(payments, /CREATE TABLE IF NOT EXISTS payment_events[\s\S]*?amount_centavos BIGINT CHECK \(amount_centavos IS NULL OR amount_centavos >= 0\)/);
  assert.ok(!/amount_centavos BIGINT NOT NULL CHECK \(amount_centavos IS NULL/.test(payments));
});

test('Packet 0 rejects altered payment event nullability and stock-movement quantity representation', async () => {
  const targets = [
    ['order_items', 'quantity'], ['stock_movements', 'stock_on_hand_delta'],
    ['stock_movements', 'reserved_delta'], ['payment_events', 'amount_centavos'],
  ];
  for (const [table, name] of targets) {
    const original = reviewedStockMoneyColumns.find(row =>
      row.table_name === table && row.critical_column_name === name);
    assert.ok(original, `${table}.${name} must be included in the reviewed catalog`);
    for (const mutation of [
      { column_not_null: !original.column_not_null },
      { column_not_null: null },
      { type_name: original.type_name === 'int4' ? 'int8' : 'int4' },
    ]) {
      const rows = reviewedStockMoneyColumns.map(row => row === original ? { ...row, ...mutation } : row);
      const fixture = pools({ stockMoneyColumns: rows });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture), /stock\/centavo column/i);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
      assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
    }
  }
});

test('Packet 0 refuses missing, altered-nullability, wrong-type or duplicate stock/money columns', async () => {
  const changedCases = [
    null, { column_not_null: false }, { column_not_null: null },
    { type_name: 'numeric' }, { type_name: 'int4' },
    { table_name: 'users' }, { column_generated: 's' },
    { column_identity: 'a' }, { critical_column_name: 'modified' },
  ];
  for (const original of reviewedStockMoneyColumns) {
    for (const mutation of changedCases) {
      if (mutation?.type_name === original.type_name ||
          mutation?.column_not_null === original.column_not_null) continue;
      const rows = reviewedStockMoneyColumns.flatMap((row) => row !== original ? [row]
        : mutation === null ? [] : [{ ...row, ...mutation }]);
      const fixture = pools({ stockMoneyColumns: rows });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture), /stock\/centavo column/i);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  for (const rows of [null, [...reviewedStockMoneyColumns, reviewedStockMoneyColumns[0]]]) {
    const fixture = pools({ stockMoneyColumns: rows });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /stock\/centavo column/i);
  }
});

test('Packet 0 must attest enforceable stock and centavo CHECK constraints before fixture writes', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const checkCatalog = fixture.reads.find(({ sql }) => sql.includes('AS invariant_constraint_name'));
  assert.ok(checkCatalog, 'live CHECK catalog must be queried by the app role');
  assert.match(checkCatalog.sql, /pg_catalog\.pg_constraint/);
  for (const name of [
    'inventory_stock_invariant', 'inventory_price_centavos_nonnegative',
    'orders_total_centavos_nonnegative', 'order_items_unit_price_centavos_nonnegative',
    'payments_amount_centavos_nonnegative',
    'reservations_quantity_check', 'refunds_amount_centavos_check',
    'payment_events_amount_centavos_check',
  ]) assert.ok(checkCatalog.sql.includes(name), `${name} must be reviewed`);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('Packet 0 must attest inline reservation and refund positivity CHECKs before fixture writes', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const catalog = fixture.reads.find(({ sql }) => sql.includes('AS invariant_constraint_name'));
  assert.ok(catalog, 'existing read-only CHECK catalog must be reused');
  for (const name of [
    'reservations_quantity_check',
    'refunds_amount_centavos_check',
    'payment_events_amount_centavos_check',
  ]) {
    assert.ok(catalog.sql.includes(name), `${name} must be attested before fixture writes`);
  }
  const migratorIndex = fixture.reads.findIndex(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations'));
  const checksIndex = fixture.reads.findIndex(({ sql }) => sql.includes('AS invariant_constraint_name'));
  assert.ok(checksIndex >= 0 && checksIndex < migratorIndex);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('Packet 0 inline positivity expectations match reviewed migrations 0006 and 0007', async () => {
  const migration6 = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
  const migration7 = await readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8');
  assert.match(migration6, /quantity\s+INTEGER\s+NOT\s+NULL\s+CHECK\s*\(quantity\s*>\s*0\)/i);
  assert.match(migration7, /amount_centavos\s+BIGINT\s+NOT\s+NULL\s+CHECK\s*\(amount_centavos\s*>\s*0\)/i);
  assert.match(migration7, /amount_centavos\s+BIGINT\s+CHECK\s*\(amount_centavos\s+IS\s+NULL\s+OR\s+amount_centavos\s*>=\s*0\)/i);
});

test('Packet 0 rejects missing, relaxed, unvalidated, or unenforced stock and centavo CHECKs before migrator access', async () => {
  const relaxed = [
    null, // dropped constraint
    { table_name: 'users' },
    { constraint_type: 'u' },
    { constraint_validated: false },
    { constraint_enforced: false },
    { constraint_enforced: null },
    { constraint_no_inherit: true },
    { constraint_is_local: false },
    { constraint_inherit_count: 1 },
    { constraint_no_parent: false },
    { constraint_definition: 'CHECK (true)' },
    { constraint_definition: 'CHECK ((price_centavos >= -1))' },
    { constraint_definition: null },
  ];
  for (const reviewed of reviewedStockAndMoneyChecks) {
    for (const mutation of relaxed) {
      const changed = reviewedStockAndMoneyChecks.flatMap((row) =>
        row.invariant_constraint_name !== reviewed.invariant_constraint_name ? [row]
          : mutation === null ? [] : [{ ...row, ...mutation }]);
      const fixture = pools({ stockAndMoneyChecks: changed });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture), /stock\/centavo CHECK constraint/,
        `${reviewed.invariant_constraint_name}: ${JSON.stringify(mutation)}`);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
        'fail before migrator journal access');
      assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
    }
  }
  const duplicate = pools({ stockAndMoneyChecks: [...reviewedStockAndMoneyChecks, reviewedStockAndMoneyChecks[0]] });
  await assert.rejects(assertSafeLiveFixtureConnections(duplicate), /stock\/centavo CHECK constraint/);
  const unreadable = pools({ stockAndMoneyChecks: null });
  await assert.rejects(assertSafeLiveFixtureConnections(unreadable), /stock\/centavo CHECK constraint/);
});

test('Packet 0 named stock/centavo CHECK catalog aligns with five reviewed migration 0006 declarations', async () => {
  const ddl = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
  for (const expected of reviewedStockAndMoneyChecks.slice(0, 5)) {
    assert.match(ddl, new RegExp(`ADD CONSTRAINT ${expected.invariant_constraint_name}\\s+CHECK`, 'i'));
  }
  assert.match(ddl, /CHECK\s*\(stock_on_hand\s*>=\s*0\s+AND\s+reserved_quantity\s*>=\s*0\s+AND\s+reserved_quantity\s*<=\s*stock_on_hand\s*\)/i);
});

test('Packet 0 must attest pharmacy membership and inventory identity UNIQUE constraints', async () => {
  const migration = await readFile(new URL('../migrations/postgres/0001_core.sql', import.meta.url), 'utf8');
  const expected = [
    ['pharmacy_memberships_user_store_unique', 'pharmacy_memberships', ['user_id', 'drugstore_id']],
    ['inventory_store_medicine_unique', 'inventory', ['drugstore_id', 'medicine_id']],
  ];
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const catalogIndex = fixture.reads.findIndex(({ sql }) => sql.includes('AS critical_constraint_name'));
  const migratorIndex = fixture.reads.findIndex(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations'));
  assert.ok(catalogIndex >= 0 && catalogIndex < migratorIndex,
    'source-required uniqueness must be checked under app role before migration journal');
  const catalogSql = fixture.reads[catalogIndex].sql;
  for (const [name, table, columns] of expected) {
    assert.match(migration, new RegExp(`CONSTRAINT ${name}\\s+UNIQUE\\s*\\(\\s*${columns.join('\\s*,\\s*')}\\s*\\)`, 'i'));
    assert.ok(catalogSql.includes(`'${name}'`), `live catalog probe must cover ${name}`);
    assert.ok(reviewedCriticalUniqueConstraints.some((row) =>
      row.critical_constraint_name === name && row.table_name === table &&
      JSON.stringify(row.index_columns) === JSON.stringify(columns)),
      `recorded catalog must describe ${name} in canonical key order`);
  }
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')),
    'live preflight must be read-only');
});

test('Packet 0 must attest reservation, event and refund UNIQUE constraints before migrator access', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const catalog = fixture.reads.find(({ sql }) => sql.includes('AS critical_constraint_name'));
  assert.ok(catalog, 'reservation, provider-event and refund UNIQUE constraints must be probed in pg_constraint');
  assert.match(catalog.sql, /pg_catalog\.pg_constraint/);
  assert.match(catalog.sql, /pg_catalog\.pg_index/);
  for (const row of reviewedCriticalUniqueConstraints) {
    assert.ok(catalog.sql.includes(row.critical_constraint_name), row.critical_constraint_name);
  }
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('Packet 0 requires the reviewed reservation order/inventory UNIQUE constraint before fixture writes', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const catalog = fixture.reads.find(({ sql }) => sql.includes('AS critical_constraint_name'));
  assert.ok(catalog, 'preflight must inspect live, constraint-backed UNIQUE indexes');
  assert.match(catalog.sql, /reservations_order_inventory_unique/,
    'the same read-only preflight must enforce one reservation per order/inventory item');
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('Packet 0 refuses altered provider, refund and reservation UNIQUE constraints before migrator or fixture writes', async () => {
  for (const reviewed of reviewedCriticalUniqueConstraints) {
    const deviations = [
      null,
      { critical_constraint_name: 'unreviewed_constraint' },
      { table_name: 'payments' },
      { constraint_type: 'c' },
      { constraint_deferrable: true },
      { constraint_deferred: true },
      { constraint_validated: false },
      { index_name: 'unreviewed_index' },
      { index_method: 'hash' },
      { index_unique: false },
      { index_valid: false },
      { index_ready: false },
      { index_live: false },
      { index_immediate: false },
      { index_nulls_not_distinct: true },
      { index_key_count: 1 },
      { index_total_count: 3 },
      { index_columns: [...reviewed.index_columns].reverse() },
      { index_columns: ['provider', 'unrelated'] },
      { index_default_operator_classes: false },
      { index_column_collations_match: false },
      { index_columns_not_null: false },
      { index_predicate: 'provider IS NOT NULL' },
    ];
    for (const change of deviations) {
      const criticalUniqueConstraints = reviewedCriticalUniqueConstraints.flatMap((row) =>
        row.critical_constraint_name === reviewed.critical_constraint_name
          ? change === null ? [] : [{ ...row, ...change }]
          : [row]);
      const fixture = pools({ criticalUniqueConstraints });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture), /business UNIQUE constraint/i,
        `must reject ${reviewed.critical_constraint_name} ${JSON.stringify(change)}`);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
        'never access migrator journal when UNIQUE enforcement is unverified');
      assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
    }
  }
  const duplicate = pools({ criticalUniqueConstraints: [...reviewedCriticalUniqueConstraints, reviewedCriticalUniqueConstraints[0]] });
  await assert.rejects(assertSafeLiveFixtureConnections(duplicate), /business UNIQUE constraint/i);
  assert.equal(duplicate.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
});

test('Packet 0 critical business constraints match canonical migrations 0001, 0006 and 0007', async () => {
  const coreSql = await readFile(new URL('../migrations/postgres/0001_core.sql', import.meta.url), 'utf8');
  const paymentSql = await readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8');
  const reservationSql = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
  const drizzle = await readFile(new URL('../src/infrastructure/postgres/schema.ts', import.meta.url), 'utf8');
  for (const reviewed of reviewedCriticalUniqueConstraints) {
    const sql = ['pharmacy_memberships', 'inventory'].includes(reviewed.table_name)
      ? coreSql : reviewed.table_name === 'reservations' ? reservationSql : paymentSql;
    const escaped = reviewed.critical_constraint_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(sql, new RegExp(`CONSTRAINT\\s+${escaped}\\s+UNIQUE\\s*\\(\\s*${reviewed.index_columns.join('\\s*,\\s*')}\\s*\\)`, 'i'));
  }
  assert.match(drizzle, /uniqueIndex\('pharmacy_memberships_user_store_unique'\)\.on\(table\.userId,\s*table\.drugstoreId\)/);
  assert.match(drizzle, /uniqueIndex\('inventory_store_medicine_unique'\)\.on\(table\.drugstoreId,\s*table\.medicineId\)/);
  assert.match(drizzle, /uniqueIndex\('reservations_order_inventory_unique'\)\.on\(table\.orderId,\s*table\.inventoryId\)/,
    'the single Drizzle reservation declaration must preserve the reviewed order/inventory keys');
  assert.match(reservationSql, /order_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+orders\(id\)/i);
  assert.match(reservationSql, /inventory_id\s+INTEGER\s+NOT NULL\s+REFERENCES\s+inventory\(id\)/i);
  assert.match(paymentSql, /provider\s+VARCHAR\(64\)\s+NOT NULL/i);
  assert.match(paymentSql, /event_id\s+VARCHAR\(200\)\s+NOT NULL/i);
  assert.match(paymentSql, /provider_refund_id\s+VARCHAR\(200\)\s+NOT NULL/i);
  assert.match(paymentSql, /idempotency_key\s+VARCHAR\(128\)\s+NOT NULL/i);
});

test('Packet 0 refuses missing, invalid, nonunique or changed idempotency indexes before migrator access', async () => {
  const deviations = [
    null, [], [reviewedIdempotencyIndex, reviewedIdempotencyIndex],
    { index_unique: false }, { index_valid: false },
    { index_ready: false }, { index_live: false },
    { index_immediate: false }, { index_method: 'hash' },
    { index_key_count: 1 }, { index_total_count: 3 },
    { index_columns: ['idempotency_key', 'user_id'] },
    { index_columns: ['user_id', null] },
    { index_predicate: null },
    { index_predicate: '(user_id IS NOT NULL)' },
  ];
  for (const changed of deviations) {
    const idempotencyIndex = changed === null || Array.isArray(changed)
      ? changed : { ...reviewedIdempotencyIndex, ...changed };
    const fixture = pools({ idempotencyIndex });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /idempotency UNIQUE index/);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});


test('Packet 0 checks the idempotency index operator classes and key collations', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const read = fixture.reads.find(({ sql }) => sql.includes('AS index_predicate'));
  assert.ok(read, 'live application-role index introspection must execute');
  assert.match(read.sql, /pg_catalog\.pg_opclass/);
  assert.match(read.sql, /opcdefault/);
  assert.match(read.sql, /indcollation/);
  assert.match(read.sql, /attcollation/);
});

test('Packet 0 rejects custom or unreadable idempotency equality and collation semantics', async () => {
  for (const deviation of [
    { index_default_operator_classes: false },
    { index_default_operator_classes: null },
    { index_column_collations_match: false },
    { index_column_collations_match: null },
  ]) {
    const fixture = pools({ idempotencyIndex: { ...reviewedIdempotencyIndex, ...deviation } });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /idempotency UNIQUE index/);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
      'unsafe index semantics must block migrator journal access');
  }
});

test('foreign-key preflight reviews all 41 canonical single-column relationships before migrator access', async () => {
  assert.equal(canonicalForeignKeys.length, 41);
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const read = fixture.reads.find(({ sql }) => sql.includes('AS fk_source_table'));
  assert.ok(read, 'read-only pg_constraint inventory must be queried');
  assert.match(read.sql, /pg_catalog\.pg_constraint/);
  assert.match(read.sql, /k\.convalidated/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('foreign-key preflight refuses missing, unvalidated or retargeted relationships before journal/fixtures', async () => {
  for (const foreignKeys of [
    canonicalForeignKeys.slice(1),
    canonicalForeignKeys.map((fk, i) => i === 0 ? { ...fk, fk_validated: false } : fk),
    canonicalForeignKeys.map((fk, i) => i === 0 ? { ...fk, fk_delete_action: 'a' } : fk),
    canonicalForeignKeys.map((fk, i) => i === 0 ? { ...fk, fk_target_column: 'another_id' } : fk),
    [...canonicalForeignKeys, { ...canonicalForeignKeys[0] }],
  ]) {
    const fixture = pools({ foreignKeys });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /foreign key/i);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('PostgreSQL 18 NOT ENFORCED foreign keys cannot pass a validated catalog preflight', async () => {
  for (const enforcement of [false, null, undefined]) {
    const foreignKeys = canonicalForeignKeys.map((fk, i) => i === 0
      ? { ...fk, fk_validated: true, fk_enforced: enforcement } : fk);
    const fixture = pools({ foreignKeys });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /foreign key/i);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
      'unverified constraint enforcement must fail before accessing migrator journal');
  }
});

test('foreign key enforcement probe is version-aware and keeps PostgreSQL 17 catalog compatibility', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const read = fixture.reads.find(({ sql }) => sql.includes('AS fk_source_table'));
  assert.match(read.sql, /server_version_num/);
  assert.match(read.sql, /to_jsonb\(k\).*?conenforced/s);
  assert.match(read.sql, /AS fk_enforced/);
});

test('source-backed foreign keys fail closed on removal or unsupported new DDL', () => {
  const first = sourceMigrations[0];
  const missing = sourceMigrations.map((source) => source === first ? {
    ...source, sql: source.sql.replace('REFERENCES users(id) ON DELETE CASCADE', 'INTEGER'),
  } : source);
  assert.throws(() => reviewedForeignKeyInventoryFromSources(missing), /foreign key/i);
  assert.throws(() => reviewedForeignKeyInventoryFromSources([
    ...sourceMigrations,
    { filename: '0008_unreviewed.sql', sql: 'ALTER TABLE inventory ADD FOREIGN KEY (drugstore_id) REFERENCES drugstores(id);' },
  ]), /foreign key/i);
  assert.throws(() => reviewedForeignKeyInventoryFromSources([
    ...sourceMigrations,
    { filename: '0008_unreviewed.sql', sql: 'ALTER TABLE inventory DROP CONSTRAINT inventory_drugstore_id_fkey;' },
  ]), /foreign key/i);
});

test('policy catalog preflight includes users and migration journal, not only the protected tables', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const policyRead = fixture.reads.find(({ sql }) => sql.includes('FROM pg_catalog.pg_policies'));
  assert.ok(policyRead, 'policy inventory must be queried before fixture writes');
  assert.equal(policyRead.args[0].length, 31);
  assert.ok(policyRead.args[0].includes('users'), 'users policies require a reviewed migration');
  assert.ok(policyRead.args[0].includes('nearpill_schema_migrations'), 'journal policies cannot be introduced silently');
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('rejects unreviewed policies on users or migration journal before migrator journal reads', async () => {
  for (const tablename of ['users', 'nearpill_schema_migrations']) {
    const fixture = pools({ policyRows: [
      ...reviewedPolicyRows,
      { tablename, policyname: 'unreviewed_app_all', roles: ['nearpill_app'],
        cmd: 'ALL', permissive: 'PERMISSIVE', qual: 'true', with_check: 'true' },
    ] });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture),
      /policy inventory differs from reviewed migrations/,
      `${tablename} policy without reviewed source must be rejected`);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('accepts session-pooler usernames only when live underlying role, database and TLS match', async () => {
  await assertSafeLiveFixtureConnections(pools({ env: staging }));
});

test('public-schema creation privileges are independently denied before any fixture writes', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probe = fixture.reads.find(({ sql }) => sql.includes("FROM pg_namespace AS n WHERE n.nspname = 'public'"))?.sql;
  assert.ok(probe, 'read-only public-schema creation privileges must be checked');
  assert.match(probe, /has_schema_privilege\(current_user, n\.oid, 'CREATE'\)/);
  assert.match(probe, /has_schema_privilege\(exposed\.oid, n\.oid, 'CREATE'\)/);
  assert.match(probe, /pg_has_role\(n\.nspowner, 'MEMBER'\)/);
  assert.match(probe, /acl\.grantee = 0 AND acl\.privilege_type = 'CREATE'/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('public-schema CREATE probe includes app privileges reachable only by SET ROLE', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const schemaRead = fixture.reads.find(({ sql }) =>
    sql.includes("FROM pg_namespace AS n WHERE n.nspname = 'public'"));
  assert.ok(schemaRead, 'read-only public schema probe must run');
  const grantClause = schemaRead.sql.match(/(has_schema_privilege\(current_user, n\.oid, 'CREATE'\)[\s\S]*?) AS app_can_create/);
  assert.ok(grantClause, 'app CREATE authorization must be independently evaluated');
  assert.match(grantClause[1], /aclexplode\(\s*COALESCE\(n\.nspacl, acldefault\('n', n\.nspowner\)\)\s*\)/);
  assert.match(grantClause[1], /acl\.privilege_type = 'CREATE'/);
  assert.match(grantClause[1], /pg_has_role\(current_user, acl\.grantee, 'SET'\)/,
    'non-inherited schema CREATE reachable with SET ROLE must not pass preflight');
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('preflight rejects a SET ROLE-only public-schema CREATE exposure before migrator access', async () => {
  const fixture = pools({ schema: { app_can_create: true } });
  await assert.rejects(assertSafeLiveFixtureConnections(fixture),
    /public schema permits untrusted object creation/);
  assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
});

test('fails closed for schema CREATE and owner escalation by app, Supabase API roles or PUBLIC', async () => {
  for (const field of ['app_can_create', 'client_can_create', 'public_can_create', 'app_can_assume_schema_owner']) {
    for (const value of [true, null, undefined]) {
      const fixture = pools({ schema: { [field]: value } });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /public schema permits untrusted object creation/,
        `${field}=${String(value)} must be rejected`);
      assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
        'stop before the migrator journal when public schema is unsafe');
    }
  }
  for (const schema_owner of [null, '', 'nearpill_app']) {
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ schema: { schema_owner } })),
      /public schema permits untrusted object creation/);
  }
});

test('staging requires real Supabase anon and authenticated roles rather than vacuous grant checks', async () => {
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ env: staging, schema: { api_roles_present: false } })),
    /Supabase roles are unverifiable/);
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ env: staging, schema: { api_roles_present: null } })),
    /Supabase roles are unverifiable/);
  await assertSafeLiveFixtureConnections(pools({ schema: { api_roles_present: false } }));
});

test('refuses admin, superuser or BYPASSRLS application role, even when configured name looks ordinary', async () => {
  for (const app of [
    { is_superuser: true }, { bypass_rls: true }, { bypass_rls: null },
    { role_name: 'postgres' },
  ]) {
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ app })));
  }
});

test('fails closed for role creation, replication, database creation and inherited elevated roles', async () => {
  for (const flag of [
    'can_create_roles', 'can_create_databases', 'can_replicate', 'elevated_role_membership',
  ]) {
    for (const value of [true, null, undefined]) {
      await assert.rejects(assertSafeLiveFixtureConnections(pools({ app: { [flag]: value } })),
        `${flag}=${String(value)} must be rejected for app role`);
      await assert.rejects(assertSafeLiveFixtureConnections(pools({ migrator: { [flag]: value } })),
        `${flag}=${String(value)} must be rejected for migrator role`);
    }
  }
});

test('privilege probe explicitly checks transitive membership rather than direct role attributes alone', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const roleProbe = fixture.reads[0].sql;
  assert.match(roleProbe, /pg_has_role\(r\.oid, privileged\.oid, 'MEMBER'\)/);
  assert.match(roleProbe, /privileged\.rolbypassrls/);
  assert.match(roleProbe, /privileged\.rolsuper/);
  assert.match(roleProbe, /elevated_role_membership/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('refuses a role or database that differs from the operator-approved configuration', async () => {
  for (const app of [
    { role_name: 'nearpill_partner' }, { database_name: 'production' },
  ]) {
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ app })));
  }
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ migrator: { database_name: 'other' } })));
});

test('refuses every missing, unforced, or app-owned protected table', async () => {
  for (const name of ['orders', 'inventory', 'pharmacy_memberships', 'auth_sessions', 'payment_events', 'billing_events']) {
    for (const update of [{ missing: true }, { rls_enabled: false }, { rls_forced: false }, { owner_name: 'nearpill_app' }, { owner_name: null }, { app_can_assume_owner: true }, { app_can_assume_owner: null }]) {
      await assert.rejects(assertSafeLiveFixtureConnections(pools({ tables: { [name]: update } })));
    }
  }
});

test('refuses missing staging TLS on application or migrator connection', async () => {
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ env: staging, app: { tls_active: false } })));
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ env: staging, migrator: { tls_active: false } })));
});

test('refuses a mismatched or shared migrator identity', async () => {
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ migrator: { role_name: 'postgres' } })));
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ migrator: { is_superuser: true } })));
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ migrator: { bypass_rls: true } })));
  const env = { ...local, MIGRATOR_DB_USER: 'nearpill_app' };
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ env, migrator: { role_name: 'nearpill_app' } })));
});

test('refuses an unapproved target or missing application pool', async () => {
  await assert.rejects(assertSafeLiveFixtureConnections({ ...pools(), env: { ...local, NEARPILL_VERIFICATION_TARGET: 'production' } }));
  await assert.rejects(assertSafeLiveFixtureConnections({ appPool: null, env: local }));
});


test('preflight and reconciliation cover all protected RLS tables, including users', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probe = fixture.reads[1];
  assert.equal(probe.args[0].length, 30);
  assert.equal(new Set(probe.args[0]).size, 30);
  const reconcileSource = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const rlsBlock = reconcileSource.match(/const rls = await client\.query\(`[\s\S]*?`, \[\[([\s\S]*?)\]\]\);/);
  assert.ok(rlsBlock, 'read canonical reconciliation RLS inventory');
  const expected = [...rlsBlock[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(probe.args[0].filter((name) => name !== 'nearpill_schema_migrations').sort(), expected.sort());
});

test('preflight rejects hidden protected tables and inherited table-owner authority', async () => {
  for (const tableName of ['auth_session_families', 'payment_events', 'billing_events']) {
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ tables: { [tableName]: { missing: true } } })), /lacks forced RLS/);
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ tables: { [tableName]: { app_can_assume_owner: true } } })), /unsafe owner/);
  }
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  assert.match(fixture.reads[1].sql, /pg_has_role\(c\.relowner, 'MEMBER'\)/);
});

test('all three fixture-writing verifiers execute live read-only preflight before first writes', async () => {
  for (const name of [
    'verify-postgres-security.mjs',
    'verify-identity-security.mjs',
    'verify-order-inventory.mjs',
  ]) {
    const source = await readFile(new URL(`../scripts/${name}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ assertSafeLiveFixtureConnections \} from '\.\/lib\/verify-live-fixture-connection\.mjs'/);
    const callAt = source.indexOf('await assertSafeLiveFixtureConnections(');
    const operatorGuard = name === 'verify-order-inventory.mjs'
      ? 'assertIsolatedOrderVerifierTarget(process.env)' : 'assertApprovedFixtureTarget(process.env)';
    assert.ok(callAt > source.indexOf(operatorGuard), `${name}: live check must follow operator check`);
    assert.ok(callAt < source.indexOf('INSERT INTO users'), `${name}: role check must precede fixture writes`);
  }
});


test('preflight probes column-specific Supabase, PUBLIC and journal grants before fixture writes', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const tableQuery = fixture.reads.find(({ sql }) => sql.includes('AS exposed_client_grant'))?.sql;
  assert.ok(tableQuery, 'table grant inspection must run before writing fixtures');
  assert.match(tableQuery, /has_any_column_privilege\(\s*exposed\.oid, c\.oid/);
  assert.match(tableQuery, /aclexplode\(a\.attacl\)/);
  assert.match(tableQuery, /pg_has_role\(exposed\.oid, acl\.grantee, 'SET'\)/);
  assert.match(tableQuery, /AS exposed_client_column_grant/);
  assert.match(tableQuery, /AS public_column_grant/);
  assert.match(tableQuery, /AS app_role_column_grant/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

// RLS does not apply to whole-table TRUNCATE or REFERENCES, and granting
// TRIGGER would allow the ordinary app role to attach arbitrary trigger code.
// Protect every public table (including users and the migration journal) from
// these privileges directly, through inherited roles, and via SET ROLE.
test('app-role preflight denies table-wide operations outside RLS before fixture writes', async () => {
  const baseline = pools();
  await assertSafeLiveFixtureConnections(baseline);
  const sql = baseline.reads.find(({ sql: statement }) =>
    statement.includes('AS exposed_client_grant'))?.sql;
  assert.ok(sql, 'inspect the actual read-only table catalog probe');
  assert.match(sql, /has_table_privilege\(\s*current_user, c\.oid,\s*'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'/);
  assert.match(sql, /AS app_non_rls_table_privilege/);
  assert.match(sql, /AS app_role_switch_non_rls_table_privilege/);
  assert.match(sql, /has_any_column_privilege\(\s*current_user, c\.oid,\s*'REFERENCES'/);
  assert.match(sql, /AS app_non_rls_column_privilege/);
  assert.match(sql, /AS app_role_switch_non_rls_column_privilege/);
  assert.match(sql, /pg_has_role\(current_user, acl\.grantee, 'SET'\)/);
  assert.ok(baseline.reads.every(({ sql: statement }) => statement.trim().startsWith('SELECT')));

  for (const table of ['orders', 'inventory', 'users', 'nearpill_schema_migrations']) {
    for (const flag of [
      'app_non_rls_table_privilege',
      'app_role_switch_non_rls_table_privilege',
      'app_non_rls_column_privilege',
      'app_role_switch_non_rls_column_privilege',
    ]) {
      for (const unsafe of [true, null, undefined]) {
        const fixture = pools({ tables: { [table]: { [flag]: unsafe } } });
        await assert.rejects(assertSafeLiveFixtureConnections(fixture),
          /non-RLS (?:table|column) privilege/, `${table}.${flag}=${String(unsafe)}`);
        assert.equal(fixture.reads.some(({ sql: statement }) =>
          statement.includes('FROM public.nearpill_schema_migrations')), false,
        'privilege drift must block before migrator journal access');
      }
    }
  }
});

// PostgreSQL 17+ MAINTAIN is independent of row-level filtering: it can
// authorize REINDEX/CLUSTER/LOCK TABLE. Its predefined pg_maintain role is
// another privilege-escalation path for ordinary app or migrator logins.
test('preflight rejects MAINTAIN privileges and pg_maintain role paths before fixture writes', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const roleSql = fixture.reads.find(({ sql }) => sql.includes('pg_stat_ssl'))?.sql;
  const tableSql = fixture.reads.find(({ sql }) => sql.includes('AS exposed_client_grant'))?.sql;
  const defaultSql = fixture.reads.find(({ sql }) => sql.includes('FROM pg_default_acl'))?.sql;
  assert.ok(roleSql && tableSql && defaultSql);
  assert.match(roleSql, /'pg_maintain'/);
  assert.match(roleSql, /pg_has_role\(r\.oid, privileged\.oid, 'MEMBER'\)/);
  // Direct/inherited privileges and SET ROLE reachability, for both app and
  // Supabase Data API roles, are checked on all protected public tables.
  assert.match(tableSql, /'TRUNCATE,REFERENCES,TRIGGER,MAINTAIN'/);
  assert.match(tableSql, /'MAINTAIN'/);
  assert.match(tableSql, /pg_has_role\(current_user, acl\.grantee, 'SET'\)/);
  assert.match(tableSql, /pg_has_role\(exposed\.oid, acl\.grantee, 'SET'\)/);
  assert.match(defaultSql, /'MAINTAIN'/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));

  for (const role of ['app', 'migrator']) {
    const unsafe = pools({ [role]: { elevated_role_membership: true } });
    await assert.rejects(assertSafeLiveFixtureConnections(unsafe), /elevated privileges/);
    assert.equal(unsafe.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
  for (const field of ['app_non_rls_table_privilege', 'app_role_switch_non_rls_table_privilege']) {
    const unsafe = pools({ tables: { inventory: { [field]: true } } });
    await assert.rejects(assertSafeLiveFixtureConnections(unsafe), /non-RLS table privilege/);
    assert.equal(unsafe.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
  await assert.rejects(assertSafeLiveFixtureConnections(pools({ defaultGrants: [{ object_type: 'r', privilege_type: 'MAINTAIN' }] })),
    /unsafe or unverifiable reviewed-schema default privileges/);
});

// Global data grants can cross a private schema boundary despite ordinary
// table ACL checks; server file/program roles can bypass database permission
// checks altogether. None belongs to the NearPill app or Supabase API roles.
test('preflight rejects global data and server-execution role paths before fixture access', async () => {
  const safe = pools();
  await assertSafeLiveFixtureConnections(safe);
  const roleSql = safe.reads[0]?.sql;
  assert.ok(roleSql?.includes('FROM pg_roles'));
  for (const roleName of [
    'pg_read_all_data', 'pg_write_all_data',
    'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program',
    'pg_create_subscription', 'pg_use_reserved_connections',
    'pg_signal_autovacuum_worker',
  ]) {
    assert.ok(roleSql.includes(`'${roleName}'`), `${roleName} must be forbidden in the role probe`);
    assert.ok(roleSql.split(`'${roleName}'`).length >= 3, `${roleName} must be denied to app/migrator and Supabase API roles`);
  }
  assert.match(roleSql, /pg_has_role\(r\.oid, privileged\.oid, 'MEMBER'\)/);
  assert.match(roleSql, /pg_has_role\(exposed\.oid, privileged\.oid, 'MEMBER'\)/);
  assert.match(roleSql, /AS client_elevated_role_membership/);
  assert.ok(safe.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));

  for (const role of ['app', 'migrator']) {
    for (const flag of ['elevated_role_membership', 'client_elevated_role_membership']) {
      for (const value of [true, null, undefined]) {
        const unsafe = pools({ [role]: { [flag]: value } });
        await assert.rejects(assertSafeLiveFixtureConnections(unsafe), /elevated privileges/,
          `${role}.${flag}=${String(value)} must fail closed`);
        assert.ok(!unsafe.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')),
          'elevated roles must block before any migrator journal read');
      }
    }
  }
});

// PostgreSQL monitoring roles can reveal restricted backend statistics or
// configuration, while signal/checkpoint rights enable operational disruption.
// Ordinary API, migrator-verification and Supabase client logins must not
// inherit or SET ROLE into these independently of per-table RLS grants.
test('preflight excludes PostgreSQL monitoring and operational role memberships', async () => {
  const baseline = pools();
  await assertSafeLiveFixtureConnections(baseline);
  const roleSql = baseline.reads.find(({ sql }) => sql.includes('pg_stat_ssl'))?.sql;
  assert.ok(roleSql, 'read-only role catalog probe is required');
  for (const role of [
    'pg_monitor', 'pg_read_all_settings', 'pg_read_all_stats',
    'pg_stat_scan_tables', 'pg_signal_backend', 'pg_checkpoint',
  ]) {
    assert.ok(roleSql.includes(`'${role}'`), `${role} role membership must be audited`);
  }
  assert.match(roleSql, /pg_has_role\(r\.oid, privileged\.oid, 'MEMBER'\)/);
  assert.match(roleSql, /pg_has_role\(exposed\.oid, privileged\.oid, 'MEMBER'\)/);
  assert.ok(baseline.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));

  for (const actor of ['app', 'migrator']) {
    for (const flag of ['elevated_role_membership', 'client_elevated_role_membership']) {
      const unsafe = pools({ [actor]: { [flag]: true } });
      await assert.rejects(assertSafeLiveFixtureConnections(unsafe), /elevated privileges/);
      assert.equal(unsafe.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
});

test('live fixture role query includes direct self-role and future predefined PostgreSQL privileges', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const sql = fixture.reads.find(({ sql }) => sql.includes('AS elevated_role_membership'))?.sql;
  assert.ok(sql, 'a live role probe is required');
  assert.doesNotMatch(sql, /privileged\.oid\s*<>\s*r\.oid/,
    'the current login must not be exempted from the privileged-role probe');
  const pattern = /left\(privileged\.rolname,\s*3\)\s*=\s*'pg_'/g;
  assert.equal([...sql.matchAll(pattern)].length, 2,
    'both app/migrator and exposed Supabase API membership probes must catch future pg_ roles');
});

test('fails closed on Supabase Data API client or PUBLIC table grants, including unknown results', async () => {
  for (const name of ['orders', 'auth_sessions', 'payments', 'billing_events']) {
    for (const field of ['exposed_client_grant', 'public_grant', 'exposed_client_column_grant', 'public_column_grant']) {
      for (const flag of [true, null, undefined]) {
        await assert.rejects(
          assertSafeLiveFixtureConnections(pools({ tables: { [name]: { [field]: flag } } })),
          /unsafe owner, membership or Data API grant boundary/,
          `${name} ${field}=${String(flag)} must block fixture writes`,
        );
      }
    }
  }
});

test('SET ROLE access to a private object is denied even without inherited privileges', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const tableSql = fixture.reads[1].sql;
  const schemaSql = fixture.reads.find(({ sql }) => sql.includes('AS app_can_create'))?.sql;
  const sequenceSql = fixture.reads.find(({ sql }) => sql.includes("SELECT 'view' AS object_kind"))?.sql;
  const defaultAclSql = fixture.reads.find(({ sql }) => sql.includes('FROM pg_default_acl'))?.sql;
  for (const [name, sql] of Object.entries({ tableSql, schemaSql, sequenceSql, defaultAclSql })) {
    assert.ok(sql, `${name} must query PostgreSQL catalogs`);
    assert.match(sql, /pg_has_role\(exposed\.oid, (?:acl\.grantee|granted\.oid), 'SET'\)/,
      `${name} must check privileges reachable by SET ROLE`);
    assert.match(sql, /exposed\.rolname IN \('anon', 'authenticated'\)/);
  }
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
  // The fake transport models a positive catalog finding: every affected
  // surface must fail closed before the migrator journal is queried.
  for (const overrides of [
    { tables: { auth_sessions: { exposed_client_grant: true } } },
    { schema: { client_can_create: true } },
    { publicSurface: [{ object_kind: 'sequence-grant' }] },
    { defaultGrants: [{ object_type: 'r', privilege_type: 'SELECT' }] },
  ]) {
    const unsafe = pools(overrides);
    await assert.rejects(assertSafeLiveFixtureConnections(unsafe));
    assert.equal(unsafe.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('read-only table probe inspects effective inherited client grants and PUBLIC ACL grants', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const query = fixture.reads[1].sql;
  assert.match(query, /has_table_privilege\(/);
  assert.match(query, /exposed\.rolname IN \('anon', 'authenticated'\)/);
  assert.match(query, /aclexplode\(COALESCE\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/);
  assert.match(query, /acl\.grantee = 0/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});


test('preflight includes users and the migrator-only journal in the full public-table inventory', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probed = fixture.reads[1].args[0];
  const sqlFiles = (await readdir(new URL('../migrations/postgres/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'));
  const sql = (await Promise.all(sqlFiles.map((name) => readFile(
    new URL(`../migrations/postgres/${name}`, import.meta.url), 'utf8',
  )))).join('\n');
  const tables = [...sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_]+)(?![a-z_.])/gi)]
    .map((match) => match[1]);
  assert.deepEqual([...probed].sort(), [...tables].sort(), 'any new public table needs a reviewed security classification');
  assert.ok(probed.includes('users'));
  assert.ok(probed.includes('nearpill_schema_migrations'));
});

test('preflight rejects unknown or unsafe Supabase grants on credential and migration tables', async () => {
  for (const name of ['users', 'nearpill_schema_migrations']) {
    for (const field of ['exposed_client_grant', 'public_grant', 'exposed_client_column_grant', 'public_column_grant', 'app_can_assume_owner']) {
      for (const value of [true, null, undefined]) {
        await assert.rejects(
          assertSafeLiveFixtureConnections(pools({ tables: { [name]: { [field]: value } } })),
          /lacks required forced RLS or has an unsafe public-schema grant or owner boundary/,
          `${name}: ${field}=${String(value)} cannot be accepted`,
        );
      }
    }
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ tables: { [name]: { missing: true } } })),
      /unsafe public-schema grant or owner boundary/);
  }
  for (const field of ['app_role_grant', 'app_role_column_grant']) {
    for (const value of [true, null, undefined]) {
      await assert.rejects(
        assertSafeLiveFixtureConnections(pools({ tables: { nearpill_schema_migrations: { [field]: value } } })),
        /lacks required forced RLS or has an unsafe public-schema grant or owner boundary/,
      );
    }
  }
});

test('journal probe detects table and column rights reachable through SET ROLE', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const sql = fixture.reads.find(({ sql: statement }) => statement.includes('AS exposed_client_grant'))?.sql;
  assert.ok(sql, 'read-only table inventory must be used');
  const tableClause = sql.match(/(EXISTS\s*\([\s\S]*?)\s+AS app_role_switch_table_grant/);
  const columnClause = sql.match(/(EXISTS\s*\([\s\S]*?)\s+AS app_role_switch_column_grant/);
  assert.ok(tableClause, 'app role-switch table authority must be computed');
  assert.ok(columnClause, 'app role-switch column authority must be computed');
  assert.match(tableClause[1], /pg_has_role\(current_user, acl\.grantee, 'SET'\)/);
  assert.match(columnClause[1], /pg_has_role\(current_user, acl\.grantee, 'SET'\)/);
  assert.match(tableClause[1], /aclexplode\(COALESCE\(c\.relacl, acldefault\('r', c\.relowner\)\)\)/);
  assert.match(columnClause[1], /pg_attribute/);
  assert.match(columnClause[1], /aclexplode\(a\.attacl\)/);
  assert.ok(fixture.reads.every(({ sql: statement }) => statement.trim().startsWith('SELECT')));
});

test('journal denies non-inherited SET ROLE table and column grants before migrator access', async () => {
  for (const flag of ['app_role_switch_table_grant', 'app_role_switch_column_grant']) {
    for (const value of [true, null, undefined]) {
      const fixture = pools({ tables: { nearpill_schema_migrations: { [flag]: value } } });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /nearpill_schema_migrations lacks required forced RLS or has an unsafe public-schema grant or owner boundary/,
        `${flag}=${String(value)} must be refused`);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
        'an unsafe journal grant must stop verification before separate migrator reads');
    }
  }
});

test('NP-031: users without forced RLS fails closed before fixture writes', async () => {
  // Existing canonical migrations leave users unprotected. The preflight must
  // refuse that source-confirmed state, even if every Data API grant is safe.
  for (const flag of ['rls_enabled', 'rls_forced']) {
    for (const value of [false, null, undefined]) {
      const fixture = pools({ tables: { users: { [flag]: value } } });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /users lacks required forced RLS/);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
      assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
    }
  }
  // The migration journal remains a migrator-only table with no app grant;
  // its lack of RLS does not confer an exemption to `users`.
  await assertSafeLiveFixtureConnections(pools({ tables: {
    nearpill_schema_migrations: { rls_enabled: false, rls_forced: false },
  } }));
  const migration = await readFile(new URL('../migrations/postgres/0002_rls.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(migration, /ALTER TABLE users\s+FORCE ROW LEVEL SECURITY/i,
    'NP-031 remains open until an approved authentication-compatible SQL migration exists');
});

test('rejects unexpected public base, partitioned and foreign tables before fixture writes', async () => {
  for (const relation_kind of ['r', 'p', 'f']) {
    const fixture = pools({ publicRelations: [{ relation_name: 'unreviewed_data', relation_kind }] });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture),
      /unreviewed public base, partitioned or foreign table/);
    assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
    assert.equal(fixture.reads.filter(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')).length, 0,
      'unreviewed relation is rejected before the migrator checks migration history');
  }
});

test('fails closed when the unexpected-relation catalog result is unavailable', async () => {
  for (const publicRelations of [null, { notRows: true }, false]) {
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ publicRelations })),
      /unreviewed public base, partitioned or foreign table/);
  }
});

test('unexpected public relation probe inspects base, partitioned and foreign tables', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const query = fixture.reads.find(({ sql }) => sql.includes('AS relation_kind'));
  assert.ok(query);
  assert.match(query.sql, /c\.relkind IN \('r', 'p', 'f'\)/);
  assert.match(query.sql, /n\.nspname = 'public'/);
  assert.match(query.sql, /NOT \(c\.relname = ANY\(\$1::text\[\]\)\)/);
  assert.equal(query.args[0].length, 30);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('fail-closed public-schema audit rejects unreviewed views, RPC routines and exposed sequences', async () => {
  for (const object_kind of ['view', 'routine', 'sequence-grant', 'sequence-owner', 'sequence-app-update']) {
    const fixture = pools({ publicSurface: [{ object_kind }] });
    await assert.rejects(
      assertSafeLiveFixtureConnections(fixture),
      /unreviewed public view\/routine or unsafe sequence owner\/grant/,
      `${object_kind} must block fixture writes`,
    );
    assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
  }
});

test('read-only public schema probe covers views, materialized views, functions and effective sequence grants', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probe = fixture.reads.find(({ sql }) => sql.includes("SELECT 'view' AS object_kind"))?.sql;
  assert.ok(probe);
  assert.match(probe, /c\.relkind IN \('v', 'm'\)/);
  assert.match(probe, /p\.prokind IN \('f', 'p', 'a', 'w'\)/);
  assert.match(probe, /has_sequence_privilege\(exposed\.oid, c\.oid, 'USAGE,SELECT,UPDATE'\)/);
  assert.match(probe, /exposed\.rolname IN \('anon', 'authenticated'\)/);
  assert.match(probe, /aclexplode\(COALESCE\(c\.relacl, acldefault\('S', c\.relowner\)\)\)/);
  assert.match(probe, /acl\.grantee = 0/);
});


test('public routine surface rejects unreviewed aggregate and window-function kinds', async () => {
  // pg_proc stores functions (f), procedures (p), aggregates (a), and window
  // functions (w). Omitting the latter two hides callable public routines.
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const sql = fixture.reads.find(({ sql }) => sql.includes("SELECT 'view' AS object_kind"))?.sql;
  assert.ok(sql);
  assert.match(sql, /p\.prokind IN \('f', 'p', 'a', 'w'\)/);
  // The pg_trgm exception remains limited to real extension-member functions.
  assert.match(sql, /p\.prokind = 'f' AND p\.prosecdef = false/);
  for (const prokind of ['a', 'w']) {
    const blocked = pools({ publicSurface: [{ object_kind: 'routine', prokind }] });
    await assert.rejects(assertSafeLiveFixtureConnections(blocked), /unreviewed public view\/routine/);
    assert.equal(blocked.reads.some(({ sql: statement }) =>
      statement.includes('FROM public.nearpill_schema_migrations')), false);
    assert.ok(blocked.reads.every(({ sql: statement }) => statement.trim().startsWith('SELECT')));
  }
});

test('public sequence ownership must remain with a non-assumable migration role', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const sql = fixture.reads.find(({ sql }) => sql.includes("SELECT 'view' AS object_kind"))?.sql;
  assert.ok(sql, 'public-surface catalog must run before migrator access');
  assert.match(sql, /SELECT 'sequence-owner' AS object_kind/);
  assert.match(sql, /c\.relkind = 'S'\s+AND pg_has_role\(c\.relowner, 'MEMBER'\)/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('public sequence ownership escalation blocks the preflight before migrator access', async () => {
  const fixture = pools({ publicSurface: [{ object_kind: 'sequence-owner' }] });
  await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unreviewed public view\/routine or unsafe sequence owner\/grant/);
  assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
});

test('app role must not receive public sequence UPDATE even through SET ROLE', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const sql = fixture.reads.find(({ sql }) => sql.includes("SELECT 'view' AS object_kind"))?.sql;
  assert.ok(sql, 'read-only public sequence catalog must be checked');
  assert.match(sql, /SELECT 'sequence-app-update' AS object_kind/);
  assert.match(sql, /has_sequence_privilege\(current_user, c\.oid, 'UPDATE'\)/);
  assert.match(sql, /acl\.privilege_type = 'UPDATE'[\s\S]*pg_has_role\(current_user, acl\.grantee, 'SET'\)/);
  const rlsMigration = await readFile(new URL('../migrations/postgres/0002_rls.sql', import.meta.url), 'utf8');
  assert.match(rlsMigration, /GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO nearpill_app/i);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('unsafe app sequence UPDATE rights fail before migrator journal access', async () => {
  const fixture = pools({ publicSurface: [{ object_kind: 'sequence-app-update' }] });
  await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unsafe sequence/);
  assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('public routine guard permits only PostgreSQL-cataloged pg_trgm extension members', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probe = fixture.reads.find(({ sql }) => sql.includes("SELECT 'view' AS object_kind"))?.sql;
  assert.ok(probe, 'public routine audit must execute');
  // Source migration 0005 installs pg_trgm in public, including its functions.
  const catalogMigration = await readFile(new URL('../migrations/postgres/0005_catalog_discovery.sql', import.meta.url), 'utf8');
  assert.match(catalogMigration, /CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public/i);
  // An allowlist based on names would let an unrelated similarity() RPC pass.
  // Require actual extension ownership in pg_depend and refuse definers.
  assert.match(probe, /JOIN pg_extension AS e ON e\.oid = d\.refobjid/);
  assert.match(probe, /d\.objid = p\.oid/);
  assert.match(probe, /d\.classid = 'pg_proc'::regclass/);
  assert.match(probe, /d\.refclassid = 'pg_extension'::regclass/);
  assert.match(probe, /d\.deptype = 'e'/);
  assert.match(probe, /e\.extname = 'pg_trgm'/);
  assert.match(probe, /e\.extnamespace = p\.pronamespace/);
  assert.match(probe, /p\.prosecdef = false/);
  assert.match(probe, /p\.prokind = 'f'/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('unreviewed public RPC routines still fail closed even when named like pg_trgm functions', async () => {
  for (const routine of ['similarity', 'show_trgm', 'custom_admin_rpc']) {
    const fixture = pools({ publicSurface: [{ object_kind: 'routine', routine }] });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unreviewed public view\/routine/);
    assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
  }
});

test('the public surface guard rejects missing or malformed responses', async () => {
  for (const publicSurface of [null, false, { error: 'unavailable' }]) {
    const fixture = pools({ publicSurface });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture),
      /unreviewed public view\/routine or unsafe sequence owner\/grant/);
  }
});

test('the reviewed migrations define no custom public view or RPC function contract', async () => {
  const names = (await readdir(new URL('../migrations/postgres/', import.meta.url)))
    .filter((name) => name.endsWith('.sql'));
  const sql = (await Promise.all(names.map((name) => readFile(
    new URL(`../migrations/postgres/${name}`, import.meta.url), 'utf8',
  )))).join('\n');
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\b/i);
  assert.doesNotMatch(sql, /CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+public\./i);
  assert.match(sql, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+nearpill\./i);
});


test('read-only migrator verification compares the complete reviewed migration history', async () => {
  assert.equal(sourceMigrationRows.length, 52, 'review the expected migration count when migration history changes');
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const journal = fixture.reads.find(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations'));
  assert.ok(journal);
  assert.match(journal.sql, /^\s*SELECT filename, sha256 /);
  assert.equal(fixture.reads.at(-1), journal, 'check migration history before any fixture-writing command proceeds');
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('refuses a missing, extra, altered, or unreadable migration journal entry', async () => {
  const original = sourceMigrationRows;
  const damaged = [
    original.slice(1),
    [...original, { filename: '9999_unreviewed.sql', sha256: '0'.repeat(64) }],
    original.map((row, i) => i === 0 ? { ...row, sha256: '0'.repeat(64) } : row),
    original.map((row, i) => i === 0 ? { ...row, sha256: null } : row),
    original.map((row, i) => i === 0 ? { ...row, filename: '0000_other.sql' } : row),
  ];
  for (const migrationRows of damaged) {
    await assert.rejects(
      assertSafeLiveFixtureConnections(pools({ migrationRows })),
      /migration journal does not match reviewed SQL checksums/,
    );
  }
  await assert.rejects(
    assertSafeLiveFixtureConnections(pools({ migrationRows: null })),
    /migration journal does not match reviewed SQL checksums/,
  );
});

test('refuses missing separate migrator connection rather than reading journal as application role', async () => {
  await assert.rejects(
    assertSafeLiveFixtureConnections({ ...pools(), migratorPool: null }),
    /separate migrator connection required/,
  );
});


test('refuses switched-role sessions for both app and migrator before fixture writes', async () => {
  for (const originalLogin of ['postgres', 'supabase_admin', 'service_role', 'nearpill_owner']) {
    for (const poolRole of ['app', 'migrator']) {
      const fixture = pools({ [poolRole]: { session_role_name: originalLogin } });
      await assert.rejects(
        assertSafeLiveFixtureConnections(fixture),
        /session identity differs from approved login/,
        `${poolRole}: a switched effective role must not conceal ${originalLogin} session authority`,
      );
      assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
    }
  }
});

test('refuses an unavailable or unexpected session-user identity and probes both roles', async () => {
  for (const value of [null, undefined, '', 'nearpill_other']) {
    await assert.rejects(
      assertSafeLiveFixtureConnections(pools({ app: { session_role_name: value } })),
      /session identity differs from approved login/,
    );
    await assert.rejects(
      assertSafeLiveFixtureConnections(pools({ migrator: { session_role_name: value } })),
      /session identity differs from approved login/,
    );
  }
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  for (const roleProbe of fixture.reads.filter(({ sql }) => sql.includes('pg_stat_ssl'))) {
    assert.match(roleProbe.sql, /session_user\s+AS\s+session_role_name/i);
    assert.match(roleProbe.sql, /current_user\s+AS\s+role_name/i);
  }
});

// The actual migration runner picks up every .sql file, even when the name is
// not numbered. The live preflight must not silently ignore those same files.
test('migration inventory rejects unreviewed executable SQL filenames instead of silently ignoring them', () => {
  assert.deepEqual(assertReviewedMigrationFilenames([
    '0002_rls.sql', 'README.md', '0001_core.sql',
  ]), ['0001_core.sql', '0002_rls.sql']);
  for (const entries of [
    ['0001_core.sql', 'hotfix.sql'],
    ['0001_core.sql', '1_unreviewed.sql'],
    ['0001_core.sql', '0001_core.sql'],
    ['README.md'], null,
  ]) {
    assert.throws(() => assertReviewedMigrationFilenames(entries), /migration (file inventory|file)/);
  }
});

test('migration journal refuses duplicate rows even when total count and checksums appear valid', async () => {
  const first = sourceMigrationRows[0];
  const duplicateAndMissing = [first, first, ...sourceMigrationRows.slice(2)];
  assert.equal(duplicateAndMissing.length, sourceMigrationRows.length);
  await assert.rejects(
    assertSafeLiveFixtureConnections(pools({ migrationRows: duplicateAndMissing })),
    /migration journal does not match reviewed SQL checksums/,
  );
});


test('policy audit covers all reviewed PostgreSQL RLS policy roles and commands', async () => {
  assert.equal(reviewedPolicyRows.length, 124); // +1 admin delete-partner policy from 0052; 118 + 3 retention DELETE policies from 0045 + 1 auto-approved stock insert policy from 0046 + 1 admin prescription-scrub policy from 0051
  assert.equal(reviewedPolicyRows.filter((row) => row.policyname === 'migrator_all').length, 30);
  assert.equal(reviewedPolicyRows.filter((row) => row.policyname === 'identity_security_app').length, 7);
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probe = fixture.reads.find(({ sql }) => sql.includes('pg_catalog.pg_policies'));
  assert.ok(probe, 'must query actual PostgreSQL policies before fixture writes');
  assert.equal(probe.args[0].length, 31); // RLS tables, users, journal, renumbering map and prescription reviews
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('policy audit rejects unreviewed or wider policy roles, commands and duplicate policies', async () => {
  const first = reviewedPolicyRows.find((row) => row.roles[0] === 'nearpill_app');
  const firstIndex = reviewedPolicyRows.indexOf(first);
  const modified = [
    reviewedPolicyRows.filter((row) => row !== first),
    [...reviewedPolicyRows, { ...first, tablename: 'orders', policyname: 'unreviewed_public_read' }],
    [...reviewedPolicyRows, first],
    reviewedPolicyRows.map((row, i) => i === firstIndex ? { ...row, roles: ['public'] } : row),
    reviewedPolicyRows.map((row, i) => i === firstIndex ? { ...row, roles: ['nearpill_app','authenticated'] } : row),
    reviewedPolicyRows.map((row, i) => i === firstIndex ? { ...row, roles: ['nearpill_migrator'] } : row),
    reviewedPolicyRows.map((row, i) => i === firstIndex ? { ...row, cmd: 'ALL' === row.cmd ? 'SELECT' : 'ALL' } : row),
    reviewedPolicyRows.map((row, i) => i === firstIndex ? { ...row, permissive: 'RESTRICTIVE' } : row),
    reviewedPolicyRows.map((row, i) => i === firstIndex ? { ...row, roles: null } : row),
    null,
    { unavailable: true },
  ];
  for (const policyRows of modified) {
    const fixture = pools({ policyRows });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture),
      /RLS policy inventory differs from reviewed migrations/);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
      'no fixture writing or migrator connection before rejecting policy drift');
  }
});

test('policy audit reads predicate columns but does not claim expression-parity or tenant isolation', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probe = fixture.reads.find(({ sql }) => sql.includes('pg_catalog.pg_policies')).sql;
  assert.match(probe, /policyname, roles::text\[\] AS roles, cmd, permissive, qual, with_check/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('policy preflight refuses absent or trivially unrestricted app-role predicates before migrator journal', async () => {
  const cases = [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
    { cmd: 'ALL', field: 'qual' },
    { cmd: 'ALL', field: 'with_check' },
  ];
  for (const { cmd, field } of cases) {
    const position = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(position, -1, `reviewed SQL must include an app-role ${cmd} policy`);
    for (const invalid of [null, undefined, '', 'true', '(true)', '(( true ))', 'true::boolean', "'t'::bool"]) {
      const rows = reviewedPolicyRows.map((row, index) =>
        index === position ? { ...row, [field]: invalid } : row);
      const fixture = pools({ policyRows: rows });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field}=${String(invalid)} must not pass`);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
});

test('app policy preflight rejects tautological OR predicates without confusing quoted SQL text', async () => {
  const cases = [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ];
  const unrestricted = [
    '(nearpill.current_actor_id() IS NOT NULL OR true)',
    '(true OR nearpill.current_actor_id() IS NOT NULL)',
    '(nearpill.current_actor_id() IS NOT NULL OR (true::boolean))',
    '(true AND (nearpill.current_actor_id() IS NOT NULL OR true))',
    "(name = ')' OR true)",
  ];
  for (const { cmd, field } of cases) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const unsafe of unrestricted) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, [field]: unsafe } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  // Quoted text containing OR true, and an AND expression with a conditional
  // branch, must not be mistaken for an unconditional grant.
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const qualified of [
    "(name = 'OR true' AND nearpill.current_actor_id() IS NOT NULL)",
    '(nearpill.current_actor_id() IS NOT NULL AND (true OR false))',
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, qual: qualified } : row),
    })));
  }
});

// Numeric tautologies are semantically unconditional despite lacking a
// literal TRUE token. They must not turn a reviewed tenant predicate into
// universal SELECT, INSERT or UPDATE access without a policy name change.
test('app policy preflight rejects constant-true numeric OR branches without rejecting guarded comparisons', async () => {
  const cases = [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ];
  for (const { cmd, field } of cases) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const predicate of [
      '(nearpill.current_actor_id() IS NOT NULL OR (1 = 1))',
      '((0002 = +2) OR nearpill.current_actor_id() IS NOT NULL)',
      '(nearpill.current_actor_id() IS NOT NULL OR (0 = 0 AND 1 = 1))',
    ]) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, [field]: predicate } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${predicate}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const predicate of [
    '(nearpill.current_actor_id() IS NOT NULL AND (1 = 1))',
    "(name = '1 = 1' AND nearpill.current_actor_id() IS NOT NULL)",
    '(nearpill.current_actor_id() IS NOT NULL OR (1 = 2))',
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, qual: predicate } : row),
    })));
  }
});

// Keep the safety floor narrow: only operand-only integer comparisons with
// mathematically certain TRUE values can act as unconditional OR branches.
// Never evaluate SQL functions, casts, identifiers, strings or row predicates.
test('app policy preflight rejects constant-true ordering and inequality branches without rejecting guarded expressions', async () => {
  const cases = [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ];
  for (const { cmd, field } of cases) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const comparison of ['0 < 1', '2 > 1', '1 <= 1', '2 >= 1', '1 <> 2', '1 != 2', '-2 < -1']) {
      const predicate = `(nearpill.current_actor_id() IS NOT NULL OR (${comparison}))`;
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, [field]: predicate } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject unconditional ${comparison}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const predicate of [
    '(nearpill.current_actor_id() IS NOT NULL OR (2 < 1))',
    '(nearpill.current_actor_id() IS NOT NULL AND (0 < 1))',
    "(name = '1 < 2' AND nearpill.current_actor_id() IS NOT NULL)",
    '(nearpill.current_actor_id() IS NOT NULL OR (current_actor_id = 1))',
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, qual: predicate } : row),
    })));
  }
});

// PostgreSQL constant-null checks also yield unconditional TRUE without a
// literal TRUE keyword or two integer operands. A broad `OR NULL IS NULL`
// should never be accepted as an app-role policy that restricts tenant data.
test('app policy preflight rejects literal IS NULL tautologies but accepts conditional predicates', async () => {
  const cases = [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ];
  for (const { cmd, field } of cases) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const fragment of [
      'NULL IS NULL', '1 IS NOT NULL', '-2 IS NOT NULL', 'TRUE IS NOT NULL',
      '(NULL IS NULL AND 3 IS NOT NULL)',
    ]) {
      const predicate = `(nearpill.current_actor_id() IS NOT NULL OR (${fragment}))`;
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, [field]: predicate } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field}: ${fragment}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const predicate of [
    '(nearpill.current_actor_id() IS NOT NULL OR NULL IS NOT NULL)',
    '(nearpill.current_actor_id() IS NOT NULL OR 1 IS NULL)',
    '(nearpill.current_actor_id() IS NOT NULL AND NULL IS NULL)',
    "(name = 'NULL IS NULL' AND nearpill.current_actor_id() IS NOT NULL)",
    '(nearpill.current_actor_id() IS NOT NULL OR item_id IS NOT NULL)',
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, qual: predicate } : row),
    })));
  }
});

// PostgreSQL's boolean negation and IS TRUE/FALSE/UNKNOWN predicates can
// construct unconditional TRUE without a bare TRUE expression. Preflight
// must reject those branches under both USING and WITH CHECK, but retain
// row-dependent and genuinely false OR branches.
test('app policy preflight rejects constant-true boolean negation and truth tests', async () => {
  const cases = [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ];
  for (const { cmd, field } of cases) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const fragment of [
      'NOT FALSE', 'NOT (FALSE)', 'TRUE IS TRUE',
      'FALSE IS FALSE', 'FALSE IS NOT TRUE', 'TRUE IS NOT FALSE',
      'NULL IS NOT TRUE', 'NULL IS NOT FALSE', 'NULL IS UNKNOWN',
    ]) {
      const predicate = `(nearpill.current_actor_id() IS NOT NULL OR (${fragment}))`;
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, [field]: predicate } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${fragment}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const predicate of [
    '(nearpill.current_actor_id() IS NOT NULL OR NOT TRUE)',
    '(nearpill.current_actor_id() IS NOT NULL OR FALSE IS TRUE)',
    '(nearpill.current_actor_id() IS NOT NULL OR NULL IS TRUE)',
    '(nearpill.current_actor_id() IS NOT NULL AND NOT FALSE)',
    "(name = 'NOT FALSE OR TRUE IS TRUE' AND nearpill.current_actor_id() IS NOT NULL)",
    '(nearpill.current_actor_id() IS NOT NULL OR actor_id IS NOT FALSE)',
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, qual: predicate } : row),
    })));
  }
});

// Negating a provably false literal condition is as unrestricted as OR TRUE.
// The safety preflight must recognize these constants without interpreting
// row-dependent SQL or treating quoted text as executable boolean logic.
test('app policy preflight rejects negated false literal comparisons', async () => {
  for (const { cmd, field } of [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ]) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const fragment of [
      'NOT (1 = 2)', 'NOT (-2 > 4)', 'NOT (1 <> 1)',
      'NOT (NULL IS NOT NULL)', 'NOT (TRUE IS FALSE)',
    ]) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, [field]: `(nearpill.current_actor_id() IS NOT NULL OR (${fragment}))`,
        } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${fragment}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const fragment of [
    'NOT (1 = 1)', 'NOT (NULL IS NULL)', 'NOT (TRUE IS TRUE)',
    'NOT (actor_id = 12)',
    "name = 'NOT (1 = 2)'",
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, qual: `(nearpill.current_actor_id() IS NOT NULL OR (${fragment}))`,
        } : row),
    })));
  }
});

// Recursive boolean folding must reject unconditional branches even if no
// individual top-level OR operand is a standalone TRUE literal. A row-valued
// operand remains unknown; never mistake it for a constant false condition.
test('app policy preflight rejects nested NOT of always-false boolean expressions without broad false positives', async () => {
  for (const { cmd, field } of [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ]) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const unsafe of [
      'NOT (nearpill.current_actor_id() IS NOT NULL AND FALSE)',
      'NOT ((1 = 2) AND (nearpill.current_actor_id() IS NOT NULL))',
      'NOT ((1 = 2) OR (3 > 4))',
      'NOT ((1 = 1) AND (FALSE OR FALSE))',
    ]) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, [field]: `(nearpill.current_actor_id() IS NOT NULL OR (${unsafe}))`,
        } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${unsafe}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const safe of [
    'NOT (1 = 1 AND 2 = 2)',
    'NOT (1 = 2 OR actor_id = 8)',
    'NOT (actor_id = 8 AND actor_id = 9)',
    'NOT (1 = 1 AND TRUE)',
    "name = 'OR NOT (1 = 2 AND FALSE)'",
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, qual: `(nearpill.current_actor_id() IS NOT NULL OR (${safe}))`,
        } : row),
    })));
  }
});

// COALESCE can hide an unconditional TRUE RLS alternative behind a function
// call. Unlike a literal OR TRUE, the earlier structural check leaves this
// opaque. Only statically provable constant inputs are treated as unsafe.
test('app policy preflight refuses constant-true COALESCE arms but preserves row-dependent fallbacks', async () => {
  for (const { cmd, field } of [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ]) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const unsafe of [
      'COALESCE(NULL, TRUE)',
      'COALESCE(TRUE, FALSE)',
      'COALESCE(NULL, NULL, (1 < 2))',
      'COALESCE(NULL, (FALSE OR TRUE))',
    ]) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, [field]: `(nearpill.current_actor_id() IS NOT NULL OR (${unsafe}))`,
        } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${unsafe}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const safe of [
    'COALESCE(FALSE, TRUE)',
    'COALESCE(NULL, FALSE, TRUE)',
    'COALESCE(nearpill.current_actor_id() IS NOT NULL, TRUE)',
    'COALESCE(NULL, nearpill.current_actor_id() IS NOT NULL, TRUE)',
    "name = 'COALESCE(NULL, TRUE)'",
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, qual: `(nearpill.current_actor_id() IS NOT NULL OR (${safe}))`,
        } : row),
    })), `do not classify ${safe} as universally true`);
  }
});

// Searched CASE can be equivalent to an unconditional grant even when
// every explicit TRUE is inside THEN/ELSE. This is a source-level guard,
// not a PostgreSQL RLS row-isolation test.
test('app policy preflight rejects unconditional searched CASE arms without splitting CASE-local OR', async () => {
  for (const { cmd, field } of [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ]) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const unsafe of [
      'CASE WHEN TRUE THEN TRUE ELSE FALSE END',
      'CASE WHEN FALSE THEN FALSE ELSE TRUE END',
      'CASE WHEN actor_id = 42 THEN TRUE ELSE TRUE END',
      'CASE WHEN (actor_id = 42 OR TRUE) THEN TRUE ELSE FALSE END',
      'CASE WHEN actor_id = 42 OR TRUE THEN TRUE ELSE FALSE END',
      'COALESCE(NULL, CASE WHEN actor_id = 42 THEN TRUE ELSE TRUE END)',
    ]) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, [field]: `(nearpill.current_actor_id() IS NOT NULL OR (${unsafe}))`,
        } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${unsafe}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const safe of [
    'CASE WHEN TRUE THEN FALSE ELSE TRUE END',
    'CASE WHEN actor_id = 42 THEN TRUE ELSE FALSE END',
    'CASE WHEN (actor_id = 42 OR TRUE) THEN FALSE ELSE TRUE END',
    'CASE WHEN actor_id = 42 OR TRUE THEN FALSE ELSE TRUE END',
    'COALESCE(NULL, CASE WHEN actor_id = 42 OR TRUE THEN FALSE ELSE TRUE END)',
    "CASE WHEN name = 'THEN TRUE ELSE TRUE' THEN FALSE ELSE TRUE END",
    // CASE-local OR TRUE is inside a condition selecting FALSE, not an
    // unconditional disjunct granting RLS to every row.
    'nearpill.current_actor_id() IS NOT NULL OR CASE WHEN (actor_id = 42 OR TRUE) THEN FALSE ELSE TRUE END',
    "name = 'CASE WHEN TRUE THEN TRUE ELSE FALSE END'",
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, qual: `(nearpill.current_actor_id() IS NOT NULL OR (${safe}))`,
        } : row),
    })), `do not classify ${safe} as universally true`);
  }
});

// A second searched CASE arm currently escapes the one-WHEN recognizer:
// even if every reachable branch is TRUE, an outer actor OR would be accepted.
// Reject provably unconditional multi-WHEN cases before reading the migrator
// journal, while keeping row-dependent and quoted conditions indeterminate.
test('app policy preflight rejects unconditional multi-arm searched CASE policies', async () => {
  for (const { cmd, field } of [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ]) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const unsafe of [
      'CASE WHEN FALSE THEN FALSE WHEN TRUE THEN TRUE ELSE FALSE END',
      'CASE WHEN actor_id = 42 THEN TRUE WHEN actor_id = 43 THEN TRUE ELSE TRUE END',
      'CASE WHEN FALSE THEN FALSE WHEN actor_id = 43 THEN TRUE ELSE TRUE END',
      'COALESCE(NULL, CASE WHEN FALSE THEN FALSE WHEN TRUE THEN TRUE ELSE FALSE END)',
      "CASE WHEN name = 'WHEN TRUE THEN FALSE' THEN TRUE WHEN actor_id = 43 THEN TRUE ELSE TRUE END",
    ]) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, [field]: `(nearpill.current_actor_id() IS NOT NULL OR (${unsafe}))`,
        } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${unsafe}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }

  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const safe of [
    'CASE WHEN actor_id = 42 THEN TRUE WHEN actor_id = 43 THEN FALSE ELSE FALSE END',
    'CASE WHEN TRUE THEN FALSE WHEN TRUE THEN TRUE ELSE TRUE END',
    'CASE WHEN FALSE THEN TRUE WHEN actor_id = 43 THEN FALSE ELSE TRUE END',
    'CASE WHEN actor_id = 42 OR TRUE THEN FALSE WHEN actor_id = 43 THEN TRUE ELSE TRUE END',
    "CASE WHEN name = 'WHEN TRUE THEN TRUE' THEN FALSE WHEN actor_id = 43 THEN TRUE ELSE FALSE END",
    "name = 'CASE WHEN FALSE THEN TRUE WHEN TRUE THEN TRUE ELSE TRUE END'",
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, qual: `(nearpill.current_actor_id() IS NOT NULL OR (${safe}))` } : row),
    })), `do not classify ${safe} as universally true`);
  }
});

// PostgreSQL searched CASE has an implicit ELSE NULL when ELSE is omitted.
// A provably TRUE WHEN arm can still grant access to every row; a conditional
// arm must remain indeterminate because the implicit NULL does not grant.
test('app policy preflight rejects unconditional implicit-ELSE searched CASE policies', async () => {
  for (const { cmd, field } of [
    { cmd: 'SELECT', field: 'qual' },
    { cmd: 'INSERT', field: 'with_check' },
    { cmd: 'UPDATE', field: 'qual' },
    { cmd: 'UPDATE', field: 'with_check' },
  ]) {
    const index = reviewedPolicyRows.findIndex((row) =>
      row.roles[0] === 'nearpill_app' && row.cmd === cmd);
    assert.notEqual(index, -1);
    for (const unsafe of [
      'CASE WHEN TRUE THEN TRUE END',
      'CASE WHEN FALSE THEN FALSE WHEN TRUE THEN TRUE END',
      'CASE WHEN (actor_id = 42 OR TRUE) THEN TRUE END',
      'COALESCE(NULL, CASE WHEN TRUE THEN TRUE END)',
    ]) {
      const fixture = pools({ policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? {
          ...row, [field]: `(nearpill.current_actor_id() IS NOT NULL OR (${unsafe}))`,
        } : row) });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture),
        /missing or unrestricted USING\/WITH CHECK predicate/,
        `${cmd}.${field} must reject ${unsafe}`);
      assert.equal(fixture.reads.some(({ sql }) =>
        sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }

  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_app' && row.cmd === 'SELECT');
  for (const safe of [
    'CASE WHEN actor_id = 42 THEN TRUE END',
    'CASE WHEN FALSE THEN TRUE END',
    'CASE WHEN actor_id = 42 THEN FALSE END',
    'CASE WHEN FALSE THEN TRUE WHEN actor_id = 43 THEN TRUE END',
    'CASE WHEN TRUE THEN FALSE END',
    "name = 'CASE WHEN TRUE THEN TRUE END'",
  ]) {
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({
      policyRows: reviewedPolicyRows.map((row, i) =>
        i === index ? { ...row, qual: `(nearpill.current_actor_id() IS NOT NULL OR (${safe}))` } : row),
    })), `do not classify ${safe} as universally true`);
  }
});

test('migration-only broad policy does not falsely fail the app-role predicate safety floor', async () => {
  const fixture = pools();
  assert.ok(reviewedPolicyRows.some((row) => row.policyname === 'migrator_all' &&
    row.roles[0] === 'nearpill_migrator' && row.qual === 'true' && row.with_check === 'true'));
  await assertSafeLiveFixtureConnections(fixture);
});


test('staging policy preflight rejects a migrator policy that would silently filter integrity rows', async () => {
  // A migrator policy can retain the same name, role, command and permissive
  // classification while a changed USING clause hides invalid tenant rows.
  // Reconciliation must never report zero invalid rows from that partial view.
  const index = reviewedPolicyRows.findIndex((row) =>
    row.roles[0] === 'nearpill_migrator' && row.policyname === 'migrator_all');
  assert.notEqual(index, -1);
  for (const accepted of ['true', '(true)', '(( true ))', 'true::boolean', "'t'::bool"]) {
    const rows = reviewedPolicyRows.map((row, i) =>
      i === index ? { ...row, qual: accepted, with_check: accepted } : row);
    await assert.doesNotReject(assertSafeLiveFixtureConnections(pools({ policyRows: rows })));
  }
  for (const [field, invalid] of [
    ['qual', 'drugstore_id = 1'], ['qual', 'false'], ['qual', null],
    ['with_check', 'drugstore_id = 1'], ['with_check', null],
  ]) {
    const changed = reviewedPolicyRows.map((row, i) =>
      i === index ? { ...row, [field]: invalid } : row);
    const fixture = pools({ policyRows: changed });
    await assert.rejects(
      assertSafeLiveFixtureConnections(fixture),
      /migrator.*policy|policy.*migrator/i,
      `${field}=${String(invalid)} must not permit incomplete reconciliation`,
    );
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false,
      'deny partial migrator visibility before journal reads or fixture writes');
  }
});

test('default-ACL preflight rejects explicit future-object grants to public and Supabase clients', async () => {
  for (const [object_type, privilege_type] of [
    ['r','SELECT'], ['S','USAGE'], ['f','EXECUTE'], ['n','CREATE'], ['T','USAGE'],
  ]) {
    const fixture = pools({ defaultGrants: [{ object_type, privilege_type }] });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture),
      /unsafe or unverifiable reviewed-schema default privileges/);
    assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('default-ACL preflight includes future objects in both private NearPill schemas', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const query = fixture.reads.find(({ sql }) => sql.includes('FROM pg_default_acl'))?.sql;
  assert.ok(query);
  assert.match(query, /'nearpill'::regnamespace/, 'future auth helpers require default ACL checks');
  assert.match(query, /'nearpill_extensions'::regnamespace/, 'future extensions require default ACL checks');
  assert.match(query, /'public'::regnamespace/, 'the existing public boundary must remain enforced');
  for (const schema_name of ['nearpill', 'nearpill_extensions']) {
    const unsafe = pools({ defaultGrants: [{ schema_name, object_type: 'f', privilege_type: 'EXECUTE' }] });
    await assert.rejects(assertSafeLiveFixtureConnections(unsafe),
      /unsafe or unverifiable .* default privileges/);
    assert.equal(unsafe.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('default-ACL preflight inspects future grants to the ordinary app role, including SET ROLE paths', async () => {
  // Source SQL is the contract here: a recording-pool result alone cannot
  // establish which PostgreSQL ACL grantees the deployed query will discover.
  const baseline = pools();
  await assertSafeLiveFixtureConnections(baseline);
  const query = baseline.reads.find(({ sql }) => sql.includes('FROM pg_default_acl'))?.sql;
  assert.ok(query, 'a read-only default ACL catalog probe is required');
  assert.match(query, /pg_has_role\(current_user, granted\.oid, 'USAGE'\)/,
    'future grants inherited by the app must not escape review');
  assert.match(query, /pg_has_role\(current_user, granted\.oid, 'SET'\)/,
    'future grants reachable by SET ROLE must not escape review');

  for (const [object_type, privilege_type] of [
    ['r', 'TRUNCATE'], ['r', 'REFERENCES'], ['r', 'TRIGGER'], ['r', 'MAINTAIN'],
    ['r', 'SELECT'], ['S', 'UPDATE'], ['f', 'EXECUTE'],
  ]) {
    const fixture = pools({ defaultGrants: [{ object_type, privilege_type, grantee: 'nearpill_app' }] });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture),
      /unsafe or unverifiable reviewed-schema default privileges/,
      `future ${object_type} ${privilege_type} access must not pass app preflight`);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('default-ACL inventory requires complete read-only results and inherited or SET ROLE grants', async () => {
  for (const defaultGrants of [null, false, { error: 'catalog unavailable' }]) {
    await assert.rejects(assertSafeLiveFixtureConnections(pools({ defaultGrants })),
      /unsafe or unverifiable reviewed-schema default privileges/);
  }
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const query = fixture.reads.find(({ sql }) => sql.includes('FROM pg_default_acl'))?.sql;
  assert.ok(query);
  assert.match(query, /d\.defaclnamespace = 0/);
  assert.match(query, /'public'::regnamespace/);
  assert.match(query, /aclexplode\(d\.defaclacl\)/);
  assert.match(query, /acl\.grantee = 0/);
  assert.match(query, /pg_has_role\(exposed\.oid, granted\.oid, 'USAGE'\)/);
  assert.match(query, /exposed\.rolname IN \('anon', 'authenticated'\)/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

// Packet 0: preflight must not interpret comments, quoted strings or DO bodies
// as executable RLS policy DDL; this check uses source input, not database mocks.
test('live policy source inventory ignores fake policy statements inside comments and DO blocks', () => {
  const history = [{ filename: '0008_probe.sql', sql: `
-- CREATE POLICY comment_read ON inventory FOR SELECT TO nearpill_app;
/* CREATE POLICY block_read ON inventory FOR ALL TO nearpill_app; */
DO $$ BEGIN RAISE NOTICE 'CREATE POLICY body_read ON inventory FOR DELETE TO nearpill_app;'; END $$;
CREATE POLICY real_read ON inventory FOR SELECT TO nearpill_app USING (true);
SELECT 'DROP POLICY real_read ON inventory;';
` }];
  assert.deepEqual(literalReviewedPolicyInventory(history), [{
    tablename: 'inventory', policyname: 'real_read', cmd: 'SELECT',
    roles: ['nearpill_app'], permissive: 'PERMISSIVE',
  }]);
});

test('live policy source inventory rejects unsupported policy changes rather than skipping them', () => {
  for (const sql of [
    'ALTER POLICY real_read ON inventory USING (true);',
    'CREATE POLICY broken ON inventory;',
    'CREATE POLICY unexpected ON inventory FOR SELECT TO anon USING (true);',
  ]) {
    assert.throws(() => literalReviewedPolicyInventory([{ filename: '0008_probe.sql', sql }]), /unreviewed/i);
  }
});

// Packet 0: PostgreSQL drops policies with their table. The preflight's
// literal expected inventory must use table identity, not policy names alone.
test('live policy preflight forgets policies after DROP TABLE and recreation', () => {
  const base = [{ filename: '0001.sql', sql: `CREATE POLICY old_read ON inventory FOR SELECT TO nearpill_app USING (true);
CREATE POLICY old_write ON inventory FOR UPDATE TO nearpill_app USING (true) WITH CHECK (true);` }];
  assert.equal(literalReviewedPolicyInventory(base).length, 2);
  const dropped = [...base, { filename: '0002.sql', sql: 'DROP TABLE IF EXISTS public.inventory CASCADE;' }];
  assert.deepEqual(literalReviewedPolicyInventory(dropped), []);
  const recreated = [...dropped, { filename: '0003.sql', sql: 'CREATE TABLE public.inventory (id bigint);' }];
  assert.deepEqual(literalReviewedPolicyInventory(recreated), []);
  const restored = [...recreated, { filename: '0004.sql', sql: 'CREATE POLICY fresh_read ON inventory FOR SELECT TO nearpill_app USING (true);' }];
  assert.deepEqual(literalReviewedPolicyInventory(restored).map((p) => p.policyname), ['fresh_read']);
});

test('live policy preflight handles multiple dropped tables and refuses ambiguous table identities', () => {
  const base = [{ filename: '0001.sql', sql: `CREATE POLICY inventory_read ON inventory FOR SELECT TO nearpill_app USING (true);
CREATE POLICY reservations_read ON reservations FOR SELECT TO nearpill_app USING (true);
CREATE POLICY orders_read ON orders FOR SELECT TO nearpill_app USING (true);` }];
  const drop = [...base, { filename: '0002.sql', sql: 'DROP TABLE IF EXISTS public.inventory, public.reservations CASCADE;' }];
  assert.deepEqual(literalReviewedPolicyInventory(drop).map((p) => p.policyname), ['orders_read']);
  assert.deepEqual(literalReviewedPolicyInventory([...base, { filename: '0002.sql', sql: '-- DROP TABLE inventory;\nSELECT 1;' }]).map((p) => p.policyname),
    ['inventory_read', 'reservations_read', 'orders_read']);
  assert.throws(() => literalReviewedPolicyInventory([...base, { filename: '0002.sql', sql: 'DROP TABLE "inventory";' }]), /unreviewed DROP TABLE syntax/i);
});

// A dynamic DO/FOREACH policy belongs at the point where its migration ran.
// It cannot be resurrected after a later DROP POLICY or DROP TABLE.
test('reviewed dynamic migrator policy is retired by a later literal DROP POLICY', async () => {
  const sources = await loadReviewedMigrationSources(migrationDirectory);
  const baseline = reviewedRlsPolicyInventoryFromSources(sources);
  assert.ok(baseline.some((p) => p.tablename === 'inventory' && p.policyname === 'migrator_all'));
  const next = reviewedRlsPolicyInventoryFromSources([
    ...sources,
    { filename: '0008_probe.sql', sql: 'DROP POLICY IF EXISTS migrator_all ON public.inventory;' },
  ]);
  assert.equal(next.some((p) => p.tablename === 'inventory' && p.policyname === 'migrator_all'), false);
  assert.ok(next.some((p) => p.tablename === 'inventory' && p.policyname === 'inventory_update'));
});

// A dynamic FOREACH array is security-sensitive in full: skipping a token
// with digits or other unexpected syntax can hide extra policy targets.
test('reviewed dynamic RLS loop rejects every extra or malformed array member', async () => {
  const sources = await loadReviewedMigrationSources(migrationDirectory);
  for (const [filename, lastPair] of [
    ['0002_rls.sql', "'subscriptions','audit_logs'"],
    ['0004_identity_security.sql', "'auth_rate_limit_events','auth_account_security'"],
  ]) {
    const original = sources.find((source) => source.filename === filename);
    assert.ok(original?.sql.includes(lastPair));
    for (const extra of ["'shadow_table_123'", "'shadow_table'::text", 'NULL']) {
      // Keep every reviewed table name; append a token that must be rejected.
      const injected = original.sql.replace(lastPair, `${lastPair},${extra}`);
      assert.notEqual(injected, original.sql);
      assert.throws(() => reviewedRlsPolicyInventoryFromSources(sources.map((source) =>
        source.filename === filename ? { ...source, sql: injected } : source)),
        /dynamic RLS migration policy inventory drift/i, `${filename}: ${extra}`);
    }
  }
});

// Packet 0: an unrecognized EXECUTE inside an otherwise reviewed DO loop
// can add a policy without appearing in the expected FOR ALL declaration list.
test('dynamic policy preflight rejects additional executable SQL inside reviewed loops', async () => {
  const sources = await loadReviewedMigrationSources(migrationDirectory);
  for (const filename of ['0002_rls.sql', '0004_identity_security.sql']) {
    const original = sources.find((source) => source.filename === filename);
    assert.ok(original?.sql.includes('  END LOOP;'));
    for (const operation of [
      "EXECUTE format('CREATE POLICY injected_delete ON %I FOR DELETE TO nearpill_app USING (true)', protected_table);",
      "EXECUTE 'DROP POLICY IF EXISTS inventory_select ON public.inventory';",
    ]) {
      const injected = original.sql.replace('  END LOOP;', `    ${operation}\n  END LOOP;`);
      assert.notEqual(injected, original.sql);
      assert.throws(() => reviewedRlsPolicyInventoryFromSources(sources.map((source) =>
        source.filename === filename ? { ...source, sql: injected } : source)),
        /dynamic RLS migration policy inventory drift/i,
        `${filename}: extra executable SQL must invalidate the migration inventory`);
    }
  }
});

// Dynamic policy review must reject non-EXECUTE procedural side effects too.
// Counting only EXECUTE calls cannot detect PERFORM/CALL/static DML injected
// between the approved statements inside a SECURITY-critical DO body.
test('dynamic policy preflight rejects unreviewed procedural side effects in reviewed loops', async () => {
  const sources = await loadReviewedMigrationSources(migrationDirectory);
  for (const filename of ['0002_rls.sql', '0004_identity_security.sql']) {
    const original = sources.find((entry) => entry.filename === filename);
    assert.ok(original?.sql.includes('  END LOOP;'));
    for (const operation of [
      "PERFORM set_config('app.role', 'admin', true);",
      'DELETE FROM public.inventory WHERE id = 1;',
      'CALL audit_unsafe_procedure();',
    ]) {
      const injected = original.sql.replace('  END LOOP;', `    ${operation}\n  END LOOP;`);
      assert.throws(() => reviewedRlsPolicyInventoryFromSources(sources.map((entry) =>
        entry.filename === filename ? { ...entry, sql: injected } : entry)),
        /dynamic RLS migration policy inventory drift/i,
        `${filename}: unreviewed procedural side effect must fail closed: ${operation}`);
    }
  }
});

// The number and names of CREATE POLICY templates alone do not protect
// against changing their USING/WITH CHECK predicates inside a dynamic loop.
test('dynamic policy preflight rejects weakened reviewed SQL templates', async () => {
  const sources = await loadReviewedMigrationSources(migrationDirectory);
  const source = sources.find(({ filename }) => filename === '0002_rls.sql');
  const original = "CREATE POLICY migrator_all ON %I FOR ALL TO nearpill_migrator USING (true) WITH CHECK (true)";
  assert.ok(source.sql.includes(original));
  const injected = source.sql.replace(original,
    "CREATE POLICY migrator_all ON %I FOR ALL TO nearpill_migrator USING (false) WITH CHECK (true)");
  assert.throws(() => reviewedRlsPolicyInventoryFromSources(sources.map((entry) =>
    entry.filename === source.filename ? { ...entry, sql: injected } : entry)),
    /dynamic RLS migration policy inventory drift/i);
});

test('reviewed dynamic identity policies cannot survive dropping and recreating their table', async () => {
  const sources = await loadReviewedMigrationSources(migrationDirectory);
  const changed = reviewedRlsPolicyInventoryFromSources([
    ...sources,
    { filename: '0008_probe.sql', sql: `DROP TABLE IF EXISTS public.auth_sessions CASCADE;
CREATE TABLE public.auth_sessions (id integer);
CREATE POLICY fresh_session_read ON public.auth_sessions FOR SELECT TO nearpill_app USING (true);` },
  ]);
  const sessions = changed.filter((p) => p.tablename === 'auth_sessions');
  assert.deepEqual(sessions.map((p) => p.policyname), ['fresh_session_read'],
    'old dynamically created identity and migrator policies belong to the dropped table');
});


test('live preflight inventories both reviewed internal schemas before any fixture or migrator access', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const internal = fixture.reads.find(({ sql }) => sql.includes('AS client_can_use'));
  assert.ok(internal, 'internal NearPill schemas must have their own grant preflight');
  assert.deepEqual(internal.args, [['nearpill', 'nearpill_extensions']]);
  assert.match(internal.sql, /has_schema_privilege\(exposed\.oid, n\.oid, 'USAGE'\)/);
  assert.match(internal.sql, /pg_has_role\(exposed\.oid, acl\.grantee, 'SET'\)/);
  assert.match(internal.sql, /pg_has_role\(current_user, acl\.grantee, 'SET'\)/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('internal schema access and ownership drift fail closed before migrator journal access', async () => {
  for (const schemaName of ['nearpill', 'nearpill_extensions']) {
    for (const field of ['app_can_create', 'app_can_assume_schema_owner', 'client_can_use', 'client_can_create', 'public_can_use', 'public_can_create']) {
      for (const value of [true, null]) {
        const fixture = pools({ internalSchemas: { [schemaName]: { [field]: value } } });
        await assert.rejects(assertSafeLiveFixtureConnections(fixture), /internal schema/, `${schemaName}.${field}=${String(value)}`);
        assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
      }
    }
    const absent = pools({ internalSchemas: { [schemaName]: { missing: true } } });
    await assert.rejects(assertSafeLiveFixtureConnections(absent), /internal schema/);
  }
});

test('read-only internal helper preflight enumerates exactly the four reviewed routines before migration journal', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const routine = fixture.reads.find(({ sql }) => sql.includes('AS internal_function_name'));
  assert.ok(routine, 'internal helper EXECUTE grants and function modes must be verified');
  assert.match(routine.sql, /pg_get_function_identity_arguments/);
  assert.match(routine.sql, /p\.prosecdef AS security_definer/);
  assert.match(routine.sql, /acldefault\('f', p\.proowner\)/);
  assert.match(routine.sql, /has_function_privilege\(exposed\.oid, p\.oid, 'EXECUTE'\)/);
  assert.match(routine.sql, /pg_has_role\(exposed\.oid, acl\.grantee, 'SET'\)/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('internal helper EXECUTE grants and SECURITY DEFINER escalation fail closed before migrator access', async () => {
  for (const name of ['current_actor_id', 'current_actor_role', 'current_capability', 'touch_updated_at']) {
    for (const field of ['public_can_execute', 'client_can_execute', 'security_definer', 'app_can_assume_owner']) {
      for (const value of [true, null]) {
        const fixture = pools({ internalRoutines: { [name]: { [field]: value } } });
        await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unsafe internal helper routine/,
          `${name}.${field}=${value}`);
        assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
      }
    }
  }
});

test('internal helper identity, trusted search paths, owners and complete inventory fail closed', async () => {
  for (const override of [
    { identity_arguments: 'integer' }, { routine_kind: 'p' },
    { return_type: 'text' }, { owner_name: 'nearpill_app' },
    { routine_settings: ['search_path=public, pg_catalog'] },
    { routine_settings: null }, { routine_settings: [null] }, { app_can_execute: false },
  ]) {
    // This actor helper must have app EXECUTE for RLS policy predicates.
    const fixture = pools({ internalRoutines: { current_actor_id: override } });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unsafe internal helper routine/);
  }
  for (const name of ['current_actor_id', 'touch_updated_at']) {
    const fixture = pools({ internalRoutines: { [name]: { missing: true } } });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unreviewed or missing internal helper/);
  }
  const extra = pools({ internalRoutines: { extra: {
    internal_function_name: 'shadow_auth', return_type: 'text', identity_arguments: '',
    routine_kind: 'f', security_definer: false, routine_settings: ['search_path=pg_catalog'],
    owner_name: 'nearpill_owner', app_can_assume_owner: false, app_can_execute: false,
    client_can_execute: false, public_can_execute: false,
  } } });
  await assert.rejects(assertSafeLiveFixtureConnections(extra), /unreviewed or missing internal helper/);
});


test('database-level CREATE is independently checked before app table or migrator journal reads', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const check = fixture.reads.find(({ sql }) => sql.includes('FROM pg_database AS d'));
  assert.ok(check, 'database CREATE rights must not be confused with schema-level CREATE');
  assert.match(check.sql, /has_database_privilege\(current_user, d\.oid, 'CREATE'\)/);
  assert.match(check.sql, /pg_has_role\(current_user, acl\.grantee, 'SET'\)/);
  assert.match(check.sql, /has_database_privilege\(exposed\.oid, d\.oid, 'CREATE'\)/);
  assert.match(check.sql, /acl\.grantee = 0 AND acl\.privilege_type = 'CREATE'/);
  assert.match(check.sql, /pg_has_role\(d\.datdba, 'MEMBER'\)/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('database-level CREATE privilege drift fails closed before migrator or fixture access', async () => {
  for (const field of ['app_can_create_database_objects', 'client_can_create_database_objects',
    'public_can_create_database_objects', 'app_can_assume_database_owner']) {
    for (const value of [true, null, undefined]) {
      const fixture = pools({ database: { [field]: value } });
      await assert.rejects(assertSafeLiveFixtureConnections(fixture), /database CREATE privilege boundary/,
        `${field}=${String(value)} must fail closed`);
      assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
    }
  }
  await assert.rejects(
    assertSafeLiveFixtureConnections(pools({ database: { database_owner: 'nearpill_app' } })),
    /database CREATE privilege boundary/,
  );
});

test('private authorization schema has a read-only relation inventory before migrator access', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const probe = fixture.reads.find(({ sql }) => sql.includes('AS internal_relation_name'));
  assert.ok(probe, 'nearpill schema relations must be inventoried');
  assert.match(probe.sql, /n\.nspname = 'nearpill'/);
  assert.match(probe.sql, /c\.relkind IN \('r', 'p', 'f', 'v', 'm', 'S'\)/);
  assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), true);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('unreviewed authorization-schema relations or unreadable results fail before migrator access', async () => {
  for (const rows of [[...reviewedInternalRelations, { internal_relation_name: 'shadow_orders', internal_relation_kind: 'r' }],
                      [{ ...reviewedInternalRelations[0], relforcerowsecurity: false }, reviewedInternalRelations[1]],
                      [reviewedInternalRelations[0], { ...reviewedInternalRelations[1], safe_acl: false }],
                      [], null, false]) {
    const fixture = pools({ internalRelations: rows });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture),
      /unreviewed or unverifiable authorization-schema relation/);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
    assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
  }
});


test('live internal helper preflight rejects modified or unavailable function bodies before migration-journal access', async () => {
  const baseline = pools();
  await assertSafeLiveFixtureConnections(baseline);
  for (const source_body of [
    "SELECT 1", // a different actor body despite unchanged signature/grants
    null,
    undefined,
  ]) {
    const fixture = pools({ internalRoutines: { current_actor_id: { source_body } } });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unsafe internal helper routine current_actor_id/);
    assert.ok(!fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')),
      'changed helper implementation must fail before migrator journal access');
  }
});

test('helper body attestation rejects a changed routine language even when text is unchanged', async () => {
  const fixture = pools({ internalRoutines: { current_actor_id: { routine_language: 'plpgsql' } } });
  await assert.rejects(assertSafeLiveFixtureConnections(fixture), /unsafe internal helper routine current_actor_id/);
  assert.ok(!fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')));
});

test('reviewed internal helper baseline reads canonical SQL definitions and rejects unreviewed replacements', () => {
  const bodies = reviewedInternalRoutineBodiesFromSources(sourceMigrations);
  assert.deepEqual(Object.keys(bodies).sort(), [
    'canonical_category', 'current_actor_id', 'current_actor_role', 'current_capability', 'guard_inventory_authority',
    'guard_inventory_selling_unit', 'normalize_medicine_category', 'set_order_group_owner', 'touch_updated_at',
  ].sort());
  assert.match(bodies.current_actor_id, /current_setting\('app\.user_id'/);
  assert.match(bodies.touch_updated_at, /NEW\.updated_at\s*=\s*CURRENT_TIMESTAMP/);
  assert.throws(() => reviewedInternalRoutineBodiesFromSources([{ filename: '0001_rogue.sql', sql:
    'CREATE FUNCTION nearpill.rogue() RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;' }]), /Unreviewed internal helper/);
  assert.throws(() => reviewedInternalRoutineBodiesFromSources([{ filename: '0001_empty.sql', sql: 'SELECT 1;' }]), /Missing reviewed internal helper/);
});

// Packet 0 trigger inventory: the single reviewed inventory timestamp trigger
// must remain active and bound to the reviewed invoker helper. Extra business
// triggers can mutate inventory/orders outside the canonical use cases.
test('preflight inventories exactly the reviewed non-internal public trigger', async () => {
  const fixture = pools();
  await assertSafeLiveFixtureConnections(fixture);
  const sql = fixture.reads.find(({ sql }) => sql.includes('AS trigger_table_name'))?.sql;
  assert.ok(sql, 'live catalog must inventory user-defined triggers before migrator access');
  assert.match(sql, /FROM pg_trigger AS t/);
  assert.match(sql, /NOT t\.tgisinternal/);
  assert.ok(fixture.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));
});

test('preflight denies missing, duplicate and unreviewed triggers before migrator journal read', async () => {
  const valid = {
    trigger_table_name: 'inventory', trigger_name: 'inventory_touch_updated_at',
    trigger_function_schema: 'nearpill', trigger_function_name: 'touch_updated_at',
    trigger_function_identity_arguments: '', trigger_type: 19, trigger_enabled: 'O',
    trigger_internal: false, trigger_is_clone: false, trigger_is_constraint: false,
    trigger_deferrable: false, trigger_initially_deferred: false, trigger_argument_count: 0,
    trigger_update_columns: '', trigger_has_when: false,
    trigger_has_old_transition: false, trigger_has_new_transition: false,
  };
  for (const triggerRows of [[], [valid, valid], [valid, { ...valid, trigger_name: 'unreviewed_payment_trigger' }]]) {
    const fixture = pools({ triggerRows });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /trigger/i);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('preflight denies a disabled, altered-event, re-targeted or conditional timestamp trigger', async () => {
  const valid = {
    trigger_table_name: 'inventory', trigger_name: 'inventory_touch_updated_at',
    trigger_function_schema: 'nearpill', trigger_function_name: 'touch_updated_at',
    trigger_function_identity_arguments: '', trigger_type: 19, trigger_enabled: 'O',
    trigger_internal: false, trigger_is_clone: false, trigger_is_constraint: false,
    trigger_deferrable: false, trigger_initially_deferred: false, trigger_argument_count: 0,
    trigger_update_columns: '', trigger_has_when: false,
    trigger_has_old_transition: false, trigger_has_new_transition: false,
  };
  for (const delta of [
    { trigger_enabled: 'D' }, { trigger_type: 17 }, { trigger_function_name: 'other' },
    { trigger_table_name: 'orders' }, { trigger_update_columns: '5' },
    { trigger_has_when: true }, { trigger_internal: true },
  ]) {
    const fixture = pools({ triggerRows: [{ ...valid, ...delta }] });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /trigger/i);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('trigger inventory contract matches the canonical migration source', () => {
  const statements = sourceMigrations.flatMap(({ filename, sql }) =>
    literalSqlStatements(sql, filename)
      .filter(({ statement }) => /^(?:CREATE|DROP|ALTER)\s+TRIGGER\b/i.test(statement))
      .map(({ statement }) => statement.replace(/\s+/g, ' ').trim()));
  assert.deepEqual(statements, [
    'DROP TRIGGER IF EXISTS inventory_touch_updated_at ON inventory',
    'CREATE TRIGGER inventory_touch_updated_at BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION nearpill.touch_updated_at()',
    'CREATE TRIGGER order_group_owner BEFORE INSERT ON order_drugstores FOR EACH ROW EXECUTE FUNCTION nearpill.set_order_group_owner()',
    'CREATE TRIGGER inventory_authority BEFORE UPDATE ON inventory FOR EACH ROW EXECUTE FUNCTION nearpill.guard_inventory_authority()',
    'CREATE TRIGGER inventory_selling_unit_authority BEFORE UPDATE OF selling_unit, package_size ON inventory FOR EACH ROW EXECUTE FUNCTION nearpill.guard_inventory_selling_unit()',
    'DROP TRIGGER IF EXISTS medicines_normalize_category ON medicines',
    'CREATE TRIGGER medicines_normalize_category BEFORE INSERT OR UPDATE OF category ON medicines FOR EACH ROW EXECUTE FUNCTION nearpill.normalize_medicine_category()',
  ], 'a trigger lifecycle change needs a reviewed inventory update and live test');
});

// Packet 0: the user-defined timestamp trigger is not the only integrity
// trigger in PostgreSQL. FK/constraint triggers must not be disabled or
// replica-only while the staging database is being accepted.
test('preflight rejects disabled internal constraint triggers before migrator access', async () => {
  const ok = pools();
  await assertSafeLiveFixtureConnections(ok);
  const read = ok.reads.find(({ sql }) => sql.includes('AS disabled_constraint_trigger_name'));
  assert.ok(read, 'live preflight must query internal constraint trigger enablement');
  assert.match(read.sql, /FROM pg_trigger AS t/);
  assert.match(read.sql, /t\.tgisinternal/);
  assert.match(read.sql, /t\.tgconstraint/);
  assert.ok(ok.reads.every(({ sql }) => sql.trim().startsWith('SELECT')));

  for (const status of ['D', 'R']) {
    const fixture = pools({ disabledConstraintTriggers: [{
      disabled_constraint_trigger_table: 'order_items',
      disabled_constraint_trigger_name: 'RI_ConstraintTrigger_c',
      disabled_constraint_trigger_enabled: status,
    }] });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /constraint trigger/i);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});

test('preflight refuses unreadable internal constraint trigger catalog results', async () => {
  for (const disabledConstraintTriggers of [null, { error: 'unavailable' }]) {
    const fixture = pools({ disabledConstraintTriggers });
    await assert.rejects(assertSafeLiveFixtureConnections(fixture), /constraint trigger/i);
    assert.equal(fixture.reads.some(({ sql }) => sql.includes('FROM public.nearpill_schema_migrations')), false);
  }
});
