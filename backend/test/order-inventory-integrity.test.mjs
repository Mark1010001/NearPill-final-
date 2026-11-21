import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { eligibleForStandardCheckout, listingEligibleForCheckout } from '../src/infrastructure/postgres/catalog-orderability.js';

const migration = await readFile(new URL('../migrations/postgres/0006_order_inventory.sql', import.meta.url), 'utf8');
const verifier = await readFile(new URL('../scripts/verify-order-inventory.mjs', import.meta.url), 'utf8');
const orderService = await readFile(new URL('../src/application/order-service.js', import.meta.url), 'utf8');
const orderRepo = await readFile(new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8');
const inventoryRepo = await readFile(new URL('../src/infrastructure/postgres/inventory-repository.js', import.meta.url), 'utf8');
const catalogRepo = await readFile(new URL('../src/infrastructure/postgres/catalog-repository.js', import.meta.url), 'utf8');
const cartService = await readFile(new URL('../../lib/features/cart/presentation/cart_view_model.dart', import.meta.url), 'utf8');
const sessionManager = await readFile(new URL('../../lib/core/auth/session_manager.dart', import.meta.url), 'utf8');
const envSource = await readFile(new URL('../src/config/env.ts', import.meta.url), 'utf8');
const importer = await readFile(new URL('../scripts/import-mysql-to-postgres.mjs', import.meta.url), 'utf8');
const profileSource = await readFile(new URL('../../lib/screens/profile_screen.dart', import.meta.url), 'utf8');

test('database enforces centavo money and inventory reservation invariants', () => {
  assert.match(migration, /price_centavos BIGINT/);
  assert.match(migration, /total_centavos BIGINT/);
  assert.match(migration, /unit_price_centavos BIGINT/);
  assert.match(migration, /amount_centavos BIGINT/);
  assert.match(migration, /reserved_quantity <= stock_on_hand/);
  assert.match(migration, /reservations_order_inventory_unique/);
  assert.match(migration, /orders_user_idempotency_unique/);
  assert.match(migration, /idempotency_fingerprint VARCHAR\(64\)/);
});

test('checkout does not trust client price or support multi-pharmacy orders', () => {
  assert.doesNotMatch(orderService, /item\?\.price|item\.price\s*\*/);
  assert.match(orderService, /drugstoreIds\.length !== 1/);
  assert.match(orderService, /findInventoryForUpdate/);
  assert.match(orderService, /priceCentavos/);
  assert.match(orderService, /orderFingerprint/);
  assert.match(orderService, /different order request/);
});

test('catalogue, branch intake, and checkout use the same prescription exclusion', () => {
  assert.match(eligibleForStandardCheckout, /m\.publication_status = 'published' AND m\.otc_eligible/);
  assert.match(eligibleForStandardCheckout, /NOT IN \('prescription \(source list\)', 'prescription', 'prescriptions', 'classification needs review'\)/);
  assert.match(listingEligibleForCheckout, /publication_status = 'draft' AND lower\(btrim\(m\.category\)\) IN/);
  assert.doesNotMatch(listingEligibleForCheckout, /pharmacy_sale_confirmation/);
  assert.match(orderRepo, /AND \$\{listingEligibleForCheckout\}/);
  assert.equal([...catalogRepo.matchAll(/\(\$\{listingEligibleForCheckout\}/g)].length, 2);
  // Branch intake may list any catalog item, but only eligible items are listed without a sale confirmation.
  assert.match(inventoryRepo, /CASE WHEN \(\$\{eligibleForStandardCheckout\}\) THEN NULL/);
});

test('reservation lifecycle is ledgered instead of decrementing stock at order creation', () => {
  assert.match(orderRepo, /reserved_quantity = reserved_quantity \+ \?/);
  assert.match(orderRepo, /INSERT INTO reservations/);
  assert.match(orderRepo, /movement_type.*'reserve'/s);
  assert.match(orderRepo, /movement_type.*'release'/s);
  assert.match(orderRepo, /movement_type.*'fulfill'/s);
  assert.doesNotMatch(orderRepo, /stock_count\s*=\s*stock_count\s*-/);
  assert.match(inventoryRepo, /movement_type, stock_change, held_change/);
});

test('live verifier requires 100 competing attempts and proves no oversell', () => {
  assert.match(verifier, /settleFixtureAttempts\(100,/);
  assert.doesNotMatch(verifier, /const attempts = await Promise\.all\(/);
  assert.match(verifier, /Expected 3 successful reservations and 97 conflicts/);
  assert.match(verifier, /stock_on_hand\s*-\s*reserved_quantity AS sellable/);
});


test('mobile cart storage is user-scoped and checkout requires one pharmacy', () => {
  assert.match(sessionManager, /user_id/);
  assert.match(cartService, /nearpill_cart_user_/);
  assert.match(cartService, /Cart requires an authenticated user/);
  assert.match(cartService, /checkoutBlockReason[\s\S]*?drugstoreId\)\.toSet\(\)\.length > 1/);
  assert.match(cartService, /delete\(key: 'nearpill_cart'\)/);
  assert.doesNotMatch(cartService, /static const _cartKey = 'nearpill_cart'/);
  assert.ok(profileSource.indexOf('await cartService.clearCart()') < profileSource.indexOf('await authService.logout()')); 
});


test('reservation expiry is configurable and production requires an explicit policy', () => {
  assert.match(envSource, /ORDER_RESERVATION_TTL_MINUTES must be explicitly configured/);
  assert.match(orderService, /reservationTtlMs/);
  assert.doesNotMatch(orderService, /new Date\(now\(\) \+ 3 \* 24 \* 60 \* 60 \* 1000\)/);
});

test('legacy monetary import uses exact centavo parsing instead of floating-point multiplication', () => {
  assert.match(importer, /pesosToCentavos/);
  assert.doesNotMatch(importer, /Math\.round\(Number\(copy\.(?:price|total|amount)/);
});
