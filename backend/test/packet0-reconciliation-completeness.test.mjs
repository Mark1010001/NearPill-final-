import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertZeroInvalidRows } from '../scripts/lib/reconcile-count.mjs';
import { assertApprovedFixtureTarget } from '../scripts/lib/verify-fixture-target.mjs';
import { createPaymentPolicy } from '../src/domain/payments/policy.js';

const local = {
  NODE_ENV: 'test', NEARPILL_VERIFICATION_TARGET: 'local-test',
  NEARPILL_VERIFICATION_CONFIRMATION: 'I_APPROVE_TEST_FIXTURE_WRITES',
  DB_HOST: '127.0.0.1', DB_PORT: '5432', DB_NAME: 'nearpill_test',
  NEARPILL_VERIFICATION_EXPECTED_HOST: '127.0.0.1',
  NEARPILL_VERIFICATION_EXPECTED_DATABASE: 'nearpill_test',
  DB_USER: 'nearpill_app', MIGRATOR_DB_USER: 'nearpill_migrator',
};

test('reconciliation accepts only a complete zero-count result', () => {
  assert.doesNotThrow(() => assertZeroInvalidRows('negative stock', { rows: [{ count: 0 }] }));
  assert.doesNotThrow(() => assertZeroInvalidRows('negative stock', { rows: [{ count: '0' }] }));
  for (const result of [undefined, {}, { rows: [] }, { rows: [{}] },
    { rows: [{ count: null }] }, { rows: [{ count: undefined }] },
    { rows: [{ count: '' }] }, { rows: [{ count: 'NaN' }] },
    { rows: [{ count: -1 }] }, { rows: [{ count: 0.5 }] },
    { rows: [{ count: '1.5' }] }, { rows: [{ count: Number.MAX_SAFE_INTEGER + 1 }] },
    { rows: [{ count: '99999999999999999999999' }] },
    { rows: [{ count: 0 }, { count: 0 }] }]) {
    assert.throws(() => assertZeroInvalidRows('negative stock', result), /inconclusive/);
  }
  assert.throws(() => assertZeroInvalidRows('negative stock', { rows: [{ count: 2 }] }), /2 invalid row/);
});

test('read-only reconciliation still requires explicit approved test/staging target', () => {
  assert.equal(assertApprovedFixtureTarget(local), 'local-test');
  assert.throws(() => assertApprovedFixtureTarget({ ...local, NEARPILL_VERIFICATION_TARGET: 'production' }));
  assert.throws(() => assertApprovedFixtureTarget({ ...local, DB_USER: 'postgres' }));
  assert.throws(() => assertApprovedFixtureTarget({ ...local, DB_NAME: 'nearpill', NEARPILL_VERIFICATION_EXPECTED_DATABASE: 'nearpill' }));
  assert.throws(() => assertApprovedFixtureTarget({ ...local, NEARPILL_VERIFICATION_CONFIRMATION: '' }));
});

test('reconciliation uses reviewed migrator role for every integrity query, after live preflight', async () => {
  const script = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const guard = script.indexOf('assertApprovedFixtureTarget(process.env)');
  const firstPool = script.indexOf('new Pool(');
  const live = script.indexOf('await assertSafeLiveFixtureConnections(');
  const firstCount = script.indexOf('for (const [name, sql] of checks)');
  assert.ok(guard >= 0 && guard < firstPool, 'operator approval precedes connection');
  assert.ok(live > firstPool && live < firstCount, 'live role/migration probe precedes integrity reads');
  assert.match(script, /user: process\.env\.MIGRATOR_DB_USER/);
  assert.match(script, /password: process\.env\.MIGRATOR_DB_PASSWORD/);
  assert.match(script, /ssl: process\.env\.DB_SSL === 'true' \? \{ rejectUnauthorized: true \}/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.match(script, /const result = await client\.query\(sql\)/);
  assert.match(script, /assertZeroInvalidRows\(name, result\)/);
  assert.doesNotMatch(script, /\b(?:await )?appPool\.query\(/,
    'ordinary app role must not reconcile RLS-filtered tenant data');
  assert.doesNotMatch(script, /(?:await )?pool\.query\(/);
});


test('read-only reconciliation detects refund and provider-event money anomalies before claiming data integrity', async () => {
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  // Refunds are required positive centavos; payment events may legitimately
  // omit their amount, but a present amount may never be negative.
  assert.match(source, /\['invalid refund amounts',\s*`SELECT COUNT\(\*\)::int AS count FROM refunds WHERE amount_centavos IS NULL OR amount_centavos <= 0`\]/);
  assert.match(source, /\['negative provider event amounts',\s*`SELECT COUNT\(\*\)::int AS count FROM payment_events WHERE amount_centavos < 0`\]/);
  // A confirmed refund must be backed by the timestamp written by the
  // existing payment repository on provider-confirmed completion.
  assert.match(source, /\['confirmed refunds without evidence timestamp',\s*`SELECT COUNT\(\*\)::int AS count FROM refunds WHERE status = 'confirmed' AND confirmed_at IS NULL`\]/);
  // Every discovered failure must abort reconciliation; absence of defects is
  // a zero count, not a missing or malformed SELECT result.
  for (const label of ['invalid refund amounts', 'negative provider event amounts', 'confirmed refunds without evidence timestamp']) {
    assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  }
});

test('read-only reconciliation includes unresolved provider incidents and processed-event evidence', async () => {
  const [source, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
  ]);
  // Match the reviewed schema and canonical payment-event writing behavior;
  // an event that is merely 'received' is not automatically an integrity error.
  assert.match(migration, /CREATE TABLE IF NOT EXISTS payment_reconciliation/);
  assert.match(migration, /processing_status IN \('received','processed','reconciliation_required'\)/);
  assert.match(repository, /UPDATE payment_events SET processing_status = \?, processed_at = CURRENT_TIMESTAMP/);

  const requiredChecks = [
    [
      'unresolved payment reconciliation cases',
      "SELECT COUNT(*)::int AS count FROM payment_reconciliation WHERE status = 'open'",
    ],
    [
      'provider events requiring reconciliation',
      "SELECT COUNT(*)::int AS count FROM payment_events WHERE processing_status = 'reconciliation_required'",
    ],
    [
      'processed provider events without evidence timestamp',
      "SELECT COUNT(*)::int AS count FROM payment_events WHERE processing_status = 'processed' AND processed_at IS NULL",
    ],
  ];
  for (const [label, query] of requiredChecks) {
    assert.ok(source.includes(`['${label}', \`${query}\`]`), `missing fail-closed integrity check: ${label}`);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
    assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  }
  // All checks must remain in the single verified read-only snapshot and
  // must be assessed before the script emits any PASS lines.
  assert.match(source, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.match(source, /for \(const \[name, sql\] of checks\) \{[\s\S]*?assertZeroInvalidRows\(name, result\)/);
});

test('payment reconciliation incidents cannot attribute a linked payment to another provider', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /payment_id INTEGER REFERENCES payments\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS payment_reconciliation/);
  assert.match(repository, /INSERT INTO payment_reconciliation \(payment_id, provider, event_id, reason, details, status\)/);
  const label = 'payment reconciliation incidents linked to a different provider';
  assert.ok(script.includes(`['${label}',`), 'linked provider mismatch must block read-only acceptance');
  assert.match(script, /FROM payment_reconciliation pr\s+JOIN payments p ON p\.id = pr\.payment_id\s+WHERE pr\.provider IS DISTINCT FROM p\.provider/);
  assert.doesNotMatch(script, /FROM payment_reconciliation pr\s+LEFT JOIN payments p/,
    'nullable unlinked incidents are legitimate and must not be mistaken for mismatches');
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
});

test('read-only reconciliation compares active reservations to stock holds and terminal lifecycle evidence', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /reserved_quantity INTEGER NOT NULL DEFAULT 0/);
  assert.match(migration, /status IN \('active','released','fulfilled'\)/);
  assert.match(repository, /UPDATE reservations SET status = 'released', released_at = CURRENT_TIMESTAMP/);
  assert.match(repository, /UPDATE reservations SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP/);

  const required = [
    ['reserved stock does not match active reservation ledger',
      /FROM inventory i\s+LEFT JOIN \(SELECT inventory_id, SUM\(quantity\) AS held_quantity\s+FROM reservations WHERE status = 'active' GROUP BY inventory_id\) active\s+ON active\.inventory_id = i\.id\s+WHERE i\.reserved_quantity <> COALESCE\(active\.held_quantity, 0\)/],
    ['terminal orders with active reservations',
      /FROM reservations r JOIN orders o ON o\.id = r\.order_id\s+WHERE r\.status = 'active' AND o\.status IN \('cancelled','expired','completed'\)/],
    ['reservation lifecycle missing timestamps',
      /FROM reservations\s+WHERE \(status = 'released' AND released_at IS NULL\)\s+OR \(status = 'fulfilled' AND fulfilled_at IS NULL\)/],
  ];
  for (const [name, queryPattern] of required) {
    assert.ok(script.includes(`['${name}',`), `missing integrity check: ${name}`);
    assert.match(script, queryPattern);
    assert.throws(() => assertZeroInvalidRows(name, { rows: [{ count: 1 }] }), /invalid row/);
    assert.throws(() => assertZeroInvalidRows(name, { rows: [] }), /inconclusive/);
    assert.doesNotThrow(() => assertZeroInvalidRows(name, { rows: [{ count: 0 }] }));
  }
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
});

test('read-only reconciliation matches each reservation to its stock-movement journal', async () => {
  const [script, migration, orderRepository, paymentRepository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS stock_movements/);
  assert.match(migration, /movement_type IN \('adjustment','reserve','release','fulfill'\)/);
  for (const movement of ['reserve', 'release', 'fulfill']) {
    assert.match(orderRepository, new RegExp(`'${movement}'`));
  }
  assert.match(paymentRepository, /'release'/);

  const label = 'reservation stock movements differ from lifecycle ledger';
  assert.ok(script.includes(`['${label}',`), 'the existing reconciliation must cover reservation movement evidence');
  assert.match(script, /FROM reservations r\s+LEFT JOIN LATERAL \(/);
  assert.match(script, /FROM stock_movements sm\s+WHERE sm\.order_id = r\.order_id\s+AND sm\.inventory_id = r\.inventory_id/);
  assert.match(script, /movement_type = 'reserve'/);
  assert.match(script, /movement_type = 'release'/);
  assert.match(script, /movement_type = 'fulfill'/);
  assert.match(script, /movements\.reserve_events <> 1/);
  assert.match(script, /movements\.reserve_delta <> r\.quantity/);
  assert.match(script, /movements\.release_events <> CASE WHEN r\.status = 'released' THEN 1 ELSE 0 END/);
  assert.match(script, /movements\.fulfill_events <> CASE WHEN r\.status = 'fulfilled' THEN 1 ELSE 0 END/);
  assert.match(script, /movements\.fulfill_stock_delta <> CASE WHEN r\.status = 'fulfilled' THEN -r\.quantity ELSE 0 END/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('read-only reconciliation verifies order centavo snapshots and single-pharmacy order contents', async () => {
  const [script, schema, orderRepository, orderService] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/order-service.js', import.meta.url), 'utf8'),
  ]);
  assert.match(schema, /orders_total_centavos_nonnegative/);
  assert.match(schema, /order_items_unit_price_centavos_nonnegative/);
  assert.match(orderRepository, /INSERT INTO order_items \(order_drugstore_id, medicine_id, quantity, unit_price_centavos, selling_unit\)/);
  assert.match(orderService, /totalCentavos \+= lineTotalCentavos/);

  const totalLabel = 'orders with inconsistent immutable line totals';
  assert.ok(script.includes(`['${totalLabel}',`), 'missing order total/line snapshot integrity check');
  assert.match(script, /SUM\(oi\.quantity::numeric \* oi\.unit_price_centavos::numeric\)/,
    'compute exact centavos with PostgreSQL numeric, not floating point or joined current catalog prices');
  assert.match(script, /JOIN order_items oi ON oi\.order_drugstore_id = od\.id/);
  assert.match(script, /o\.total_centavos::numeric <> COALESCE\(items\.lines_centavos, 0\)/);

  const contentsLabel = 'orders without exactly one pharmacy and at least one item';
  assert.ok(script.includes(`['${contentsLabel}',`), 'missing one-pharmacy/nonempty order integrity check');
  assert.match(script, /COUNT\(DISTINCT od\.id\) AS pharmacy_rows/,
    'count actual pharmacy association rows, not merely distinct IDs');
  assert.match(script, /COUNT\(oi\.id\) AS item_rows/);
  assert.match(script, /COALESCE\(contents\.pharmacy_rows, 0\) <> 1/);
  assert.match(script, /COALESCE\(contents\.item_rows, 0\) = 0/);

  // Both queries must use the already authorized read-only, consistent
  // snapshot and reject nonzero, absent or malformed results before PASS.
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.match(script, /for \(const \[name, sql\] of checks\) \{[\s\S]*?assertZeroInvalidRows\(name, result\)/);
  for (const label of [totalLabel, contentsLabel]) {
    assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
    assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  }
});


test('read-only reconciliation validates the pharmacy, medicine and quantity of each reservation order line', async () => {
  const [script, schema, repository, service] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/order-service.js', import.meta.url), 'utf8'),
  ]);
  // The existing checkout contract creates both records from the same locked
  // inventory row. Neither independent foreign key proves tenant/catalog parity.
  assert.match(schema, /inventory_id INTEGER NOT NULL REFERENCES inventory\(id\)/);
  assert.match(schema, /order_id INTEGER NOT NULL REFERENCES orders\(id\)/);
  assert.match(repository, /INSERT INTO order_items \(order_drugstore_id, medicine_id, quantity, unit_price_centavos, selling_unit\)/);
  assert.match(repository, /INSERT INTO reservations \(order_id, inventory_id, quantity, status\)/);
  assert.match(service, /await transaction\.reserveInventory\(\{ orderId, inventoryId: item\.inventoryId, quantity: item\.quantity/);

  const label = 'reservations without exactly one matching pharmacy medicine order line';
  assert.ok(script.includes(`['${label}',`), 'missing tenant/catalog reservation linkage check');
  assert.match(script, /FROM reservations r\s+JOIN inventory i ON i\.id = r\.inventory_id/);
  assert.match(script, /FROM order_drugstores od\s+JOIN order_items oi ON oi\.order_drugstore_id = od\.id/);
  assert.match(script, /od\.order_id = r\.order_id/);
  assert.match(script, /od\.drugstore_id = i\.drugstore_id/);
  assert.match(script, /oi\.medicine_id = i\.medicine_id/);
  assert.match(script, /oi\.quantity = r\.quantity/);
  assert.match(script, /\) <> 1`\]/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});


test('read-only reconciliation detects reservation journal movements orphaned from live orders', async () => {
  const [script, schema, orderRepository, paymentRepository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
  ]);
  assert.match(schema, /order_id INTEGER REFERENCES orders\(id\) ON DELETE SET NULL/);
  for (const type of ['reserve', 'release', 'fulfill']) {
    assert.match(orderRepository, new RegExp(`'${type}'`));
  }
  assert.match(paymentRepository, /'release'/);

  const label = 'reservation movements without a matching live order reservation';
  assert.ok(script.includes(`['${label}',`), 'missing reverse journal/orphan check');
  assert.match(script, /FROM stock_movements sm\s+WHERE sm\.movement_type IN \('reserve','release','fulfill'\)/);
  assert.match(script, /AND sm\.order_id IS NOT NULL/,
    'historical journal rows cleared by ON DELETE SET NULL are not assumed corrupt');
  assert.match(script, /AND NOT EXISTS \(\s+SELECT 1 FROM reservations r/);
  assert.match(script, /r\.order_id = sm\.order_id/);
  assert.match(script, /r\.inventory_id = sm\.inventory_id/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('read-only reconciliation rejects cross-provider refunds and cumulative confirmed over-refunds', async () => {
  const [script, schema, paymentService] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8'),
  ]);
  assert.match(schema, /payment_id INTEGER NOT NULL REFERENCES payments\(id\)/);
  assert.match(schema, /amount_centavos BIGINT NOT NULL CHECK \(amount_centavos > 0\)/);
  assert.match(paymentService, /provider: locked\.provider/);
  assert.match(paymentService, /await transaction\.updateRefundStatus\(Number\(refund\.id\), 'confirmed'\)/);

  const mismatchedProvider = 'refund provider differs from payment provider';
  const excessRefund = 'confirmed refunds exceed the originating payment amount';
  assert.ok(script.includes(`['${mismatchedProvider}',`), 'refund provider consistency must be reconciled');
  assert.match(script, /FROM refunds r\s+JOIN payments p ON p\.id = r\.payment_id\s+WHERE r\.provider IS DISTINCT FROM p\.provider/);
  assert.ok(script.includes(`['${excessRefund}',`), 'cumulative confirmed refunds must be bounded by the paid amount');
  assert.match(script, /FROM refunds r\s+WHERE r\.status = 'confirmed'\s+GROUP BY r\.payment_id/);
  assert.match(script, /SUM\(r\.amount_centavos::numeric\) AS confirmed_centavos/);
  assert.match(script, /confirmed\.confirmed_centavos > p\.amount_centavos::numeric/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  for (const label of [mismatchedProvider, excessRefund]) {
    assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
    assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  }
});


test('read-only reconciliation verifies processed refund events belong to their referenced payment', async () => {
  const [script, schema, paymentService] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8'),
  ]);
  assert.match(schema, /provider_refund_id VARCHAR\(200\)/);
  assert.match(schema, /payment_id INTEGER NOT NULL REFERENCES payments\(id\)/);
  assert.match(paymentService, /findPaymentByExternalIdForUpdate\(providerId, event\.providerPaymentId\)/);
  assert.match(paymentService, /findRefundByExternalIdForUpdate\(providerId, event\.providerRefundId\)/);

  const label = 'processed refund events without matching payment refund ownership';
  assert.ok(script.includes(`['${label}',`), 'processed refund events must be reconciled to their own payment, not just to a provider refund identifier');
  assert.match(script, /FROM payment_events e\s+WHERE e\.processing_status = 'processed'/);
  assert.match(script, /e\.event_type IN \('refund\.confirmed','refund\.failed'\)/);
  assert.match(script, /NOT EXISTS \(\s+SELECT 1 FROM payments p\s+JOIN refunds r ON r\.payment_id = p\.id/);
  assert.match(script, /p\.provider = e\.provider/);
  assert.match(script, /p\.provider_payment_id = e\.provider_payment_id/);
  assert.match(script, /r\.provider = e\.provider/);
  assert.match(script, /r\.provider_refund_id = e\.provider_refund_id/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('read-only reconciliation attests processed payment webhook identity and optional amount/currency', async () => {
  const [script, migration, paymentService] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8'),
  ]);
  // The provider event schema intentionally permits absent amount/currency,
  // but processed confirmed/failed events MUST have a matching payment.
  assert.match(migration, /provider_payment_id VARCHAR\(200\)/);
  assert.match(migration, /amount_centavos BIGINT CHECK/);
  assert.match(migration, /currency VARCHAR\(3\)/);
  assert.match(paymentService, /findPaymentByExternalIdForUpdate\(providerId, event\.providerPaymentId\)/);
  assert.match(paymentService, /event\.amountCentavos !== undefined/);
  assert.match(paymentService, /event\.currency && event\.currency !== payment\.currency/);

  const label = 'processed payment events without matching provider payment amount or currency';
  assert.ok(script.includes(`['${label}',`), 'missing processed payment webhook identity and value attestation');
  assert.match(script, /FROM payment_events e\s+WHERE e\.processing_status = 'processed'/);
  assert.match(script, /e\.event_type IN \('payment\.confirmed','payment\.failed'\)/);
  assert.match(script, /NOT EXISTS \(\s+SELECT 1 FROM payments p/);
  assert.match(script, /p\.provider = e\.provider/);
  assert.match(script, /p\.provider_payment_id = e\.provider_payment_id/);
  assert.match(script, /e\.amount_centavos IS NULL OR e\.amount_centavos::numeric = p\.amount_centavos::numeric/);
  assert.match(script, /e\.currency IS NULL OR e\.currency = p\.currency/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});


test('read-only reconciliation attests optional refund webhook amount and currency against refund and payment', async () => {
  const [script, schema] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(schema, /amount_centavos BIGINT CHECK \(amount_centavos IS NULL OR amount_centavos >= 0\)/);
  assert.match(schema, /provider_refund_id VARCHAR\(200\)/);
  assert.match(schema, /currency VARCHAR\(3\)/);
  const label = 'processed refund events without matching payment refund ownership';
  const start = script.indexOf(`[\'${label}\',`);
  assert.ok(start >= 0, 'refund-event integrity must attest both identity and optional monetary metadata');
  const next = script.indexOf("  ['invalid reservations'", start);
  const query = script.slice(start, next);
  assert.match(query, /e\.event_type IN \('refund\.confirmed','refund\.failed'\)/);
  assert.match(query, /p\.provider_payment_id = e\.provider_payment_id/);
  assert.match(query, /r\.provider_refund_id = e\.provider_refund_id/);
  assert.match(query, /e\.amount_centavos IS NULL OR e\.amount_centavos::numeric = r\.amount_centavos::numeric/);
  assert.match(query, /e\.currency IS NULL OR e\.currency = p\.currency/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});


test('read-only reconciliation checks full-price payment quotes and deposit upper bounds without inventing deposit policy', async () => {
  const [script, policy, service, migration] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/domain/payments/policy.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
  ]);
  // The existing policy quotes the immutable order total for the full plan,
  // while an enabled deposit can be smaller. No deposit percentage is approved
  // here, so only its invariant upper bound is attested.
  assert.match(policy, /plan === 'full'/);
  assert.match(policy, /BigInt\(total\) \* BigInt\(depositBasisPoints\)/);
  assert.match(service, /amountCentavos: quote\.amountCentavos/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS payment_plan VARCHAR\(32\)/);
  const configuredPolicy = createPaymentPolicy({ mode: 'deposit_or_full', depositBasisPoints: 3750, version: 'packet0-test' });
  const fullQuote = configuredPolicy.quote(13337, 'full');
  const depositQuote = configuredPolicy.quote(13337, 'deposit');
  assert.equal(fullQuote.ok, true);
  assert.equal(fullQuote.amountCentavos, 13337);
  assert.equal(depositQuote.ok, true);
  assert.equal(depositQuote.amountCentavos, 5002);
  assert.ok(depositQuote.amountCentavos <= fullQuote.amountCentavos);

  const full = 'full payment amounts differ from authoritative order totals';
  const deposit = 'deposit payments exceed authoritative order totals';
  assert.ok(script.includes(`['${full}',`), 'full payment amount parity must be attested');
  assert.ok(script.includes(`['${deposit}',`), 'deposit amount must not exceed the order total');
  assert.match(script, /FROM payments p JOIN orders o ON o\.id = p\.order_id\s+WHERE p\.payment_plan = 'full'\s+AND p\.amount_centavos::numeric <> o\.total_centavos::numeric/);
  assert.match(script, /FROM payments p JOIN orders o ON o\.id = p\.order_id\s+WHERE p\.payment_plan = 'deposit'\s+AND p\.amount_centavos::numeric > o\.total_centavos::numeric/);
  // Both checks use the existing consistent read-only staging snapshot.
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  for (const label of [full, deposit]) {
    assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
    assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  }
});


test('read-only reconciliation catches cross-pharmacy subscription entitlement and billing references', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
  ]);
  // Individual FKs protect IDs but do not prove that an entitlement or billing
  // event refers to a subscription owned by the SAME pharmacy. The service
  // passes both IDs independently; stale/corrupted joins must block acceptance.
  assert.match(migration, /subscription_id INTEGER NOT NULL REFERENCES subscriptions\(id\)/);
  assert.match(migration, /subscription_id INTEGER REFERENCES subscriptions\(id\) ON DELETE SET NULL/);
  assert.match(repository, /INSERT INTO subscription_entitlements \(drugstore_id, subscription_id, entitlement_key\)/);
  assert.match(repository, /INSERT INTO billing_events \(drugstore_id, subscription_id, actor_id, event_type, details\)/);

  const required = [
    ['entitlements linked to another pharmacy subscription',
      /FROM subscription_entitlements e\s+JOIN subscriptions s ON s\.id = e\.subscription_id\s+WHERE e\.drugstore_id IS DISTINCT FROM s\.drugstore_id/],
    ['billing events linked to another pharmacy subscription',
      /FROM billing_events b\s+JOIN subscriptions s ON s\.id = b\.subscription_id\s+WHERE b\.drugstore_id IS DISTINCT FROM s\.drugstore_id/],
  ];
  for (const [label, query] of required) {
    assert.ok(script.includes(`['${label}',`), `missing cross-pharmacy reconciliation: ${label}`);
    assert.match(script, query);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
    assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
    assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  }
  // Historic billing events can have a null subscription after ON DELETE SET
  // NULL. Inner-join semantics intentionally do not misclassify those records.
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.match(script, /for \(const \[name, sql\] of checks\) \{[\s\S]*?assertZeroInvalidRows\(name, result\)/);
});

test('read-only reconciliation rejects unrevoked premium grants whose subscription no longer qualifies', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
  ]);
  // The existing premium permission query trusts an unrevoked entitlement;
  // stale grants can therefore outlive subscription status or end date.
  assert.match(repository, /FROM subscription_entitlements\s+WHERE drugstore_id = \? AND revoked_at IS NULL/);
  assert.match(migration, /WHERE s\.tier = 'Premium' AND s\.status = 'active'/);
  assert.match(migration, /s\.end_date IS NULL OR s\.end_date >= CURRENT_DATE/);
  const label = 'unrevoked premium entitlements from ineligible subscriptions';
  assert.ok(script.includes(`['${label}',`), 'stale premium grants must block staged acceptance');
  const query = script.slice(script.indexOf(`['${label}',`), script.indexOf("  ['active premium subscriptions without entitlement'"));
  assert.match(query, /FROM subscription_entitlements e\s+JOIN subscriptions s ON s\.id = e\.subscription_id/);
  assert.match(query, /e\.revoked_at IS NULL/);
  assert.match(query, /e\.entitlement_key = 'reports:view:premium'/);
  assert.match(query, /s\.tier NOT IN \('Plus', 'Pro'\)/);
  assert.match(query, /s\.status IS DISTINCT FROM 'active'/);
  assert.match(query, /s\.end_date IS NOT NULL AND s\.end_date < CURRENT_DATE/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});


test('eligible Premium subscriptions require an entitlement linked to that exact subscription', async () => {
  const [script, migration] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
  ]);
  // Multiple subscription rows may belong to the same pharmacy. A grant on
  // subscription A cannot establish that subscription B has an entitlement.
  // The partial UNIQUE index is scoped by pharmacy/key, NOT subscription ID;
  // the verifier must detect the mismatch rather than reporting a false PASS.
  assert.match(migration, /ON subscription_entitlements\(drugstore_id, entitlement_key\)/);
  const label = 'active premium subscriptions without entitlement';
  const start = script.indexOf(`['${label}',`);
  assert.ok(start >= 0, 'missing eligible Premium subscription check');
  const query = script.slice(start, script.indexOf('\n];', start));
  assert.match(query, /FROM subscriptions s/);
  assert.match(query, /e\.drugstore_id = s\.drugstore_id/);
  assert.match(query, /e\.subscription_id = s\.id/,
    'entitlement must attest the exact eligible subscription, not another one in the pharmacy');
  assert.match(query, /e\.entitlement_key = 'reports:view:premium'/);
  assert.match(query, /e\.revoked_at IS NULL/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('reconciliation incident event IDs resolve only within the same payment provider', async () => {
  const [source, migration, repository, service] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /event_id VARCHAR\(200\)/);
  assert.match(migration, /CONSTRAINT payment_events_provider_event_unique UNIQUE\(provider, event_id\)/);
  assert.match(repository, /INSERT INTO payment_reconciliation \(payment_id, provider, event_id, reason, details, status\)/);
  // Webhook event insertion precedes incident creation inside one transaction.
  assert.ok(service.indexOf('await transaction.insertProviderEvent(') < service.indexOf("reason: 'unmatched_provider_event'"));

  const label = 'reconciliation incidents with unknown or cross-provider event IDs';
  assert.ok(source.includes(`['${label}',`), 'reconciliation must verify incident event provenance');
  assert.match(source, /FROM payment_reconciliation pr\s+WHERE pr\.event_id IS NOT NULL\s+AND NOT EXISTS \(/);
  assert.match(source, /FROM payment_events e\s+WHERE e\.provider = pr\.provider\s+AND e\.event_id = pr\.event_id/);
  // An incident without an event ID remains valid (manual provider checks).
  assert.match(source, /pr\.event_id IS NOT NULL/);
  assert.match(source, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('reconciliation incidents with an event and linked payment attest the same provider payment identity', async () => {
  const [source, migration, repository, service] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /payment_id INTEGER REFERENCES payments\(id\) ON DELETE CASCADE/);
  assert.match(migration, /provider_payment_id VARCHAR\(200\)/);
  assert.match(repository, /INSERT INTO payment_reconciliation \(payment_id, provider, event_id, reason, details, status\)/);
  assert.match(service, /paymentId: Number\(payment\.id\), provider: providerId, eventId/);

  const label = 'reconciliation incident events attributed to another payment';
  const start = source.indexOf(`['${label}',`);
  assert.ok(start >= 0, 'an incident and its provider event must not identify different payments');
  const check = source.slice(start, source.indexOf('`]', start));
  assert.match(check, /FROM payment_reconciliation pr\s+JOIN payments p ON p\.id = pr\.payment_id/,
    'manual incidents without a payment must remain valid');
  assert.match(check, /WHERE pr\.event_id IS NOT NULL/,
    'manual incidents without an event ID must remain valid');
  assert.match(check, /NOT EXISTS \(\s*SELECT 1 FROM payment_events e/);
  assert.match(check, /e\.provider = pr\.provider/);
  assert.match(check, /e\.event_id = pr\.event_id/);
  assert.match(check, /e\.provider_payment_id IS NOT NULL/,
    'an incident linked to a payment cannot be attested by a provider event with no payment ID');
  assert.match(check, /e\.provider_payment_id = p\.provider_payment_id/,
    'the referenced event must attest the incident-linked payment, not just the provider');
  assert.match(source, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('active access and refresh credentials must belong to their own session family user', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/security-repository.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /family_id VARCHAR\(64\) REFERENCES auth_session_families\(id\)/);
  assert.match(repository, /INSERT INTO auth_sessions \(user_id, family_id, token_hash, token_kind, expires_at\)/);
  const label = 'active bearer sessions without an owned refresh family';
  assert.ok(script.includes(`['${label}',`), 'live reconciliation must verify session-to-family ownership');
  assert.match(script, /FROM auth_sessions s\s+LEFT JOIN auth_session_families f ON f\.id = s\.family_id/);
  assert.match(script, /s\.user_id IS DISTINCT FROM f\.user_id/);
  assert.match(script, /s\.family_id IS NULL/);
  assert.match(script, /s\.token_kind IN \('access','refresh'\)/);
  assert.match(script, /s\.revoked_at IS NULL/);
  assert.match(script, /s\.consumed_at IS NULL/);
  assert.match(script, /s\.expires_at > CURRENT_TIMESTAMP/);
  // It must reject an active mismatched family rather than assuming that the
  // independent user and family foreign keys establish identical ownership.
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
});

test('each refresh-token family has at most one currently redeemable refresh credential', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/security-repository.js', import.meta.url), 'utf8'),
  ]);
  // The schema does not enforce a single active refresh token per family.
  // Rotation holds both session/family locks, consumes the previous refresh
  // and inserts a single replacement within the same transaction.
  assert.match(migration, /family_id VARCHAR\(64\) REFERENCES auth_session_families\(id\)/);
  assert.match(repository, /FOR UPDATE OF s, f/);
  assert.match(repository, /UPDATE auth_sessions SET consumed_at = CURRENT_TIMESTAMP WHERE id = \$1/);
  const label = 'refresh-token families with multiple redeemable refresh sessions';
  const start = script.indexOf(`['${label}',`);
  assert.ok(start >= 0, 'Packet 0 staging reconciliation must detect forked refresh families');
  const check = script.slice(start, script.indexOf('`]', start));
  assert.match(check, /FROM auth_sessions s/);
  assert.match(check, /s\.token_kind = 'refresh'/);
  assert.match(check, /s\.family_id IS NOT NULL/);
  assert.match(check, /s\.consumed_at IS NULL/);
  assert.match(check, /s\.revoked_at IS NULL/);
  assert.match(check, /s\.expires_at > CURRENT_TIMESTAMP/);
  assert.match(check, /GROUP BY s\.family_id/);
  assert.match(check, /HAVING COUNT\(\*\) > 1/);
  assert.doesNotMatch(check, /token_kind = 'web'/,
    'independent web sessions must not be considered refresh tokens');
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
});

test('revoked refresh families cannot retain unrevoked live access or refresh credentials', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/security-repository.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /revoked_at TIMESTAMPTZ/);
  assert.match(repository, /UPDATE auth_session_families SET revoked_at = COALESCE\(revoked_at, CURRENT_TIMESTAMP\)/);
  assert.match(repository, /UPDATE auth_sessions SET revoked_at = COALESCE\(revoked_at, CURRENT_TIMESTAMP\) WHERE family_id = \$1/);

  const label = 'revoked token families retain active bearer sessions';
  const start = script.indexOf(`['${label}',`);
  assert.ok(start >= 0, 'staging integrity verification must detect incomplete token-family revocation');
  const check = script.slice(start, script.indexOf('`]', start));
  assert.match(check, /FROM auth_sessions s\s+JOIN auth_session_families f ON f\.id = s\.family_id/);
  assert.match(check, /f\.revoked_at IS NOT NULL/);
  assert.match(check, /s\.token_kind IN \('access','refresh'\)/);
  assert.match(check, /s\.revoked_at IS NULL/);
  assert.match(check, /s\.consumed_at IS NULL/);
  assert.match(check, /s\.expires_at > CURRENT_TIMESTAMP/);
  assert.doesNotMatch(check, /token_kind = 'web'/,
    'independent web sessions are not members of refresh-token families');
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
});

test('live password reset challenges must identify the same email as their owning user', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/security-repository.js', import.meta.url), 'utf8'),
  ]);
  // A user FK does not bind the independent email field to that user. Reset
  // consumption changes the account selected by user_id, not by email.
  assert.match(migration, /user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /email VARCHAR\(254\) NOT NULL/);
  assert.match(repository, /UPDATE users SET password = \$2 WHERE id = \$1/);
  const label = 'active password reset challenges with mismatched account email';
  const start = script.indexOf(`['${label}',`);
  assert.ok(start >= 0, 'live reconciliation must include password-reset account/email consistency');
  const check = script.slice(start, script.indexOf('`]', start));
  assert.match(check, /FROM password_reset_challenges c\s+JOIN users u ON u\.id = c\.user_id/);
  assert.match(check, /c\.consumed_at IS NULL/);
  assert.match(check, /c\.expires_at > CURRENT_TIMESTAMP/);
  assert.match(check, /lower\(btrim\(c\.email\)\) IS DISTINCT FROM lower\(btrim\(u\.email\)\)/,
    'compare normalized email, not an unrelated account or raw case differences');
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('unverified email codes cannot retain a redeemable challenge after the five-attempt limit', async () => {
  const [script, migration, repository] = await Promise.all([
    readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0004_identity_security.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/infrastructure/postgres/security-repository.js', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /attempt_count INTEGER NOT NULL DEFAULT 0 CHECK \(attempt_count >= 0\)/);
  assert.match(repository, /if \(attempts >= 5\) await client\.query\(`DELETE FROM email_verification_challenges WHERE email = \$1`/);
  const label = 'active unverified email challenges beyond attempt limit';
  const start = script.indexOf(`['${label}',`);
  assert.ok(start >= 0, 'staging reconciliation must detect five-attempt challenge records');
  const check = script.slice(start, script.indexOf('`]', start));
  assert.match(check, /FROM email_verification_challenges/);
  assert.match(check, /verified_at IS NULL/);
  assert.match(check, /expires_at > CURRENT_TIMESTAMP/);
  assert.match(check, /attempt_count >= 5/);
  assert.match(script, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [{ count: 1 }] }), /invalid row/);
  assert.throws(() => assertZeroInvalidRows(label, { rows: [] }), /inconclusive/);
  assert.doesNotThrow(() => assertZeroInvalidRows(label, { rows: [{ count: 0 }] }));
});

test('reconciliation re-attests the actual transaction client migrator and RLS setting', async () => {
  const { assertReconciliationPrincipal } = await import('../scripts/lib/read-only-reconciliation-snapshot.mjs');
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const expected = 'nearpill_migrator';
  const good = {
    rows: [{ role_name: expected, session_role_name: expected, row_security: 'on',
      is_superuser: false, bypass_rls: false, tls_active: true }],
  };
  assert.doesNotThrow(() => assertReconciliationPrincipal(good, expected, { requireTls: true }));
  assert.doesNotThrow(() => assertReconciliationPrincipal({ rows: [{ ...good.rows[0], tls_active: false }] }, expected));
  for (const bad of [
    { role_name: 'nearpill_app' },
    { session_role_name: 'postgres' },
    { row_security: 'off' },
    { is_superuser: true },
    { bypass_rls: true },
    { tls_active: false },
  ]) {
    assert.throws(() => assertReconciliationPrincipal(
      { rows: [{ ...good.rows[0], ...bad }] }, expected, { requireTls: true }), /reconciliation principal/i);
  }
  for (const malformed of [undefined, {}, { rows: [] }, { rows: [good.rows[0], good.rows[0]] }]) {
    assert.throws(() => assertReconciliationPrincipal(malformed, expected, { requireTls: true }), /reconciliation principal/i);
  }
  assert.throws(() => assertReconciliationPrincipal(good, 'postgres'), /reconciliation principal/i);
  assert.match(source, /assertReconciliationPrincipal\(principal, process\.env\.MIGRATOR_DB_USER/);
  const snapshot = source.indexOf('withReadOnlyReconciliationSnapshot(migratorPool, async (client) =>');
  const principalCheck = source.indexOf('assertReconciliationPrincipal(principal, process.env.MIGRATOR_DB_USER');
  const firstCount = source.indexOf('for (const [name, sql] of checks)');
  assert.ok(snapshot >= 0 && snapshot < principalCheck && principalCheck < firstCount,
    'same-connection role/RLS attestation must precede all protected integrity reads');
});

test('Packet 0: reconciliation independently attests users forced RLS and the exact protected-table set', async () => {
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const { assertForcedReconciliationRls } = await import('../scripts/lib/read-only-reconciliation-snapshot.mjs');
  const expected = ['users', 'orders', 'auth_sessions'];
  const rows = expected.map((relname) => ({
    relname, relkind: 'r', relrowsecurity: true, relforcerowsecurity: true,
  }));
  assert.doesNotThrow(() => assertForcedReconciliationRls({ rows }, expected));
  for (const result of [
    undefined, { rows: [] }, { rows: rows.slice(1) },
    { rows: [rows[0], rows[0], rows[2]] },
    { rows: [{ ...rows[0], relname: 'different' }, rows[1], rows[2]] },
    { rows: [{ ...rows[0], relrowsecurity: false }, rows[1], rows[2]] },
    { rows: [{ ...rows[0], relforcerowsecurity: false }, rows[1], rows[2]] },
    { rows: [{ ...rows[0], relkind: 'v' }, rows[1], rows[2]] },
    { rows: [{ ...rows[0], relforcerowsecurity: null }, rows[1], rows[2]] },
  ]) {
    assert.throws(() => assertForcedReconciliationRls(result, expected), /RLS/i);
  }
  assert.throws(() => assertForcedReconciliationRls({ rows }, ['users', 'users', 'orders']), /RLS/i);

  // The earlier pooled preflight already requires users RLS. The later
  // read-only snapshot must independently verify it on its own connection.
  const rlsPart = source.slice(source.indexOf('const rls = await client.query('), source.indexOf('const appRole = await client.query('));
  assert.match(rlsPart, /'users'/);
  assert.match(rlsPart, /assertForcedReconciliationRls\(rls, /);
  assert.match(rlsPart, /c\.relkind/);
  assert.match(source, /withReadOnlyReconciliationSnapshot\(migratorPool, async \(client\) =>/);
});

test('Packet 0: reconciliation re-attests reviewed RLS policies on its own snapshot before reading private data', async () => {
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const security = await import('../scripts/lib/verify-live-fixture-connection.mjs');
  const approved = await security.reviewedRlsPolicyInventory();
  assert.ok(approved.length > 0, 'policy inventory must come from reviewed migrations');
  assert.equal(typeof security.assertActualRlsPolicyInventory, 'function', 'reuse the canonical policy validator');
  assert.equal(typeof security.POLICY_INVENTORY_PROBE_SQL, 'string', 'reuse the canonical policy catalog query');
  const canonical = approved.map((policy) => ({ ...policy,
    roles: [...policy.roles], qual: policy.roles[0] === 'nearpill_app' ? '(pharmacy_id IS NOT NULL)' : 'true',
    with_check: policy.roles[0] === 'nearpill_app' ? '(pharmacy_id IS NOT NULL)' : 'true',
  }));
  assert.doesNotThrow(() => security.assertActualRlsPolicyInventory(canonical, approved));
  for (const changed of [
    canonical.slice(1),
    [...canonical, { ...canonical[0] }],
    [...canonical, { ...canonical[0], tablename: 'users', policyname: 'extra_admin' }],
    canonical.map((row, i) => i === 0 ? { ...row, roles: ['public'] } : row),
    canonical.map((row, i) => i === 0 ? { ...row, cmd: 'SELECT' } : row),
    canonical.map((row) => row.roles[0] === 'nearpill_app' ? { ...row, qual: '(true)' } : row),
    canonical.map((row) => row.roles[0] === 'nearpill_app' ? { ...row, with_check: null } : row),
  ]) {
    assert.throws(() => security.assertActualRlsPolicyInventory(changed, approved), /policy/i);
  }
  // The very same canonical validator protects this reconciliation snapshot.
  // A narrowed migrator policy could hide tenant rows and yield a false PASS.
  for (const changed of [
    canonical.map((row) => row.roles[0] === 'nearpill_migrator'
      ? { ...row, qual: '(drugstore_id = 1)' } : row),
    canonical.map((row) => row.roles[0] === 'nearpill_migrator'
      ? { ...row, with_check: null } : row),
  ]) {
    assert.throws(() => security.assertActualRlsPolicyInventory(changed, approved), /migrator.*policy|policy.*migrator/i);
  }
  const start = source.indexOf('withReadOnlyReconciliationSnapshot(migratorPool, async (client) =>');
  const query = source.indexOf('client.query(POLICY_INVENTORY_PROBE_SQL', start);
  const attest = source.indexOf('assertActualRlsPolicyInventory(', query);
  const firstIntegrity = source.indexOf('for (const [name, sql] of checks)', start);
  assert.ok(start >= 0 && query > start && attest > query && firstIntegrity > attest,
    'exact source-backed RLS policy inventory must be checked inside the current snapshot before any private integrity read');
  assert.match(source, /await reviewedRlsPolicyInventory\(\)/);
  assert.match(source, /'users'\s*,\s*'nearpill_schema_migrations'/,
    'unreviewed policies on users or the migrator journal must not evade catalog attestation');
});

test('Packet 0: same-transaction policy, forced RLS and app-role checks precede the first integrity SELECT', async () => {
  const source = await readFile(new URL('../scripts/reconcile-postgres.mjs', import.meta.url), 'utf8');
  const snapshot = source.indexOf('withReadOnlyReconciliationSnapshot(migratorPool, async (client) =>');
  const policy = source.indexOf('assertActualRlsPolicyInventory(', snapshot);
  const forced = source.indexOf('assertForcedReconciliationRls(', snapshot);
  const appRole = source.indexOf('const appRole = await client.query(', snapshot);
  const firstIntegrity = source.indexOf('for (const [name, sql] of checks)', snapshot);
  assert.ok(snapshot >= 0 && policy > snapshot && forced > policy && appRole > forced && firstIntegrity > appRole,
    'RLS policy inventory, forced-RLS flags and non-bypass app role must be attested before any protected read');
});
