import assert from 'node:assert/strict';
import { stat, readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCatalogService } from '../src/application/catalog-service.js';
import { createOrderService } from '../src/application/order-service.js';

const inventoryUrl = new URL('../../docs/data-inventory.md', import.meta.url);
const [inventory, cartSource, logoutSource, orderSource] = await Promise.all([
  readFile(inventoryUrl, 'utf8'),
  readFile(new URL('../../lib/features/cart/presentation/cart_view_model.dart', import.meta.url), 'utf8'),
  readFile(new URL('../../lib/screens/profile_screen.dart', import.meta.url), 'utf8'),
  readFile(new URL('../../lib/features/orders/data/order_repository.dart', import.meta.url), 'utf8'),
]);

test('Packet 0 data inventory has no broken relative code/policy links', async () => {
  const links = [...inventory.matchAll(/\]\(([^)]+)\)/g)]
    .map((match) => match[1])
    .filter((link) => !/^(?:https?:|mailto:|#)/i.test(link));
  assert.ok(links.length >= 6, 'inventory must retain meaningful traceable references');
  for (const link of links) {
    const relative = link.split('#', 1)[0];
    const file = new URL(relative, inventoryUrl);
    const info = await stat(file).catch(() => null);
    assert.ok(info?.isFile(), `broken source/policy link in data inventory: ${link}`);
  }
});

test('Packet 0 data inventory accurately reflects the existing user-scoped mobile cart and order repository', () => {
  assert.match(cartSource, /'nearpill_cart_user_\$_userId'/);
  assert.match(cartSource, /await _storage\.delete\(key: 'nearpill_cart'\)/);
  assert.match(cartSource, /'nearpill_checkout_idempotency_user_\$_userId'/);
  assert.match(logoutSource, /await cartService\.clearCart\(\);[\s\S]*?await authService\.logout\(\);/);
  assert.match(orderSource, /idempotencyKey/);
  assert.match(inventory, /nearpill_cart_user_/);
  assert.match(inventory, /user-scoped/i);
  assert.match(inventory, /lib\/features\/cart\/presentation\/cart_view_model\.dart/);
  assert.match(inventory, /lib\/features\/orders\/data\/order_repository\.dart/);
  assert.doesNotMatch(inventory, /Cart survives logout and is not scoped to the account\./);
});

test('Packet 0 R04: inventory and discovery claims do not overstate OTC eligibility', async () => {
  const [migration, eligibility, catalog, discovery] = await Promise.all([
    readFile(new URL('../migrations/postgres/0005_catalog_discovery.sql', import.meta.url), 'utf8'),
    readFile(new URL('../migrations/postgres/0009_otc_eligibility.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/application/catalog-service.js', import.meta.url), 'utf8'),
    readFile(new URL('../../docs/catalog-discovery.md', import.meta.url), 'utf8'),
  ]);
  assert.match(migration, /DROP COLUMN IF EXISTS rx_required/i,
    'the approved historical migration removes the legacy restricted-medicine flag');
  assert.match(catalog, /countApprovedMedicineEvidence\(medicineId\)/,
    'publication still requires approved evidence');
  assert.match(catalog, /medicine\.otc_eligible !== true/);
  assert.match(eligibility, /publication_status <> 'published' OR otc_eligible/);
  assert.match(catalog, /updateMedicinePublication\(medicineId, status\)/);
  assert.match(discovery, /recorded OTC eligibility review/i);
  assert.doesNotMatch(inventory, /Launch runtime is OTC-only\./,
    'a published medicine status is not alone proof of OTC eligibility');
});

// Evidence alone must not republish a retired medicine without an OTC review.
test('Packet 0 R04 behavior: retired medicine cannot be republished on evidence count alone', async () => {
  const calls = [];
  let currentStatus = 'retired';
  let approvedEvidence = 0;
  const repository = new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'findMasterMedicineById') return async (id) => {
        calls.push(['find', id]);
        return { id, publication_status: currentStatus };
      };
      if (property === 'countApprovedMedicineEvidence') return async (id) => {
        calls.push(['approved-evidence', id]);
        return approvedEvidence;
      };
      if (property === 'updateMedicinePublication') return async (id, status) => {
        calls.push(['publish', id, status]);
        currentStatus = status;
        return 1;
      };
      if (property === 'appendAudit') return async (_actor, action) => {
        calls.push(['audit', action]);
      };
      // The catalog port requires every method at composition time. Fail if
      // this particular scenario unexpectedly invokes any other operation.
      return async () => { throw new Error(`Unexpected catalog method: ${String(property)}`); };
    },
  });
  const service = createCatalogService({ repository });
  const rejected = await service.setMedicinePublication(7, 42, { status: 'published' });
  assert.equal(rejected.status, 409);
  assert.equal(currentStatus, 'retired');
  assert.ok(!calls.some((call) => call[0] === 'publish'));

  approvedEvidence = 1;
  const accepted = await service.setMedicinePublication(7, 42, { status: 'published' });
  assert.equal(accepted.status, 409, 'Evidence alone must not establish OTC eligibility');
  assert.equal(currentStatus, 'retired');
  assert.deepEqual(calls.filter((call) => call[0] === 'publish'), []);
  assert.equal(calls.some((call) => call[0] === 'audit' && call[1] === 'SET_MEDICINE_PUBLICATION'), false);
});


test('Packet 0 R04 checkout requires published and OTC-eligible inventory before reservation', async () => {
  const postgresRepository = await readFile(
    new URL('../src/infrastructure/postgres/order-repository.js', import.meta.url), 'utf8',
  );
  const lookup = /async findInventoryForUpdate\([\s\S]*?LIMIT 1 FOR UPDATE/.exec(postgresRepository)?.[0];
  assert.ok(lookup, 'existing checkout SQL lookup must remain characterized');
  // The eligibility predicate lives in one shared module so catalog, checkout and pickup cannot drift.
  assert.match(lookup, /\$\{listingEligibleForCheckout\}/);
  const orderability = await readFile(new URL('../src/infrastructure/postgres/catalog-orderability.js', import.meta.url), 'utf8');
  assert.match(orderability, /m\.publication_status = 'published' AND m\.otc_eligible/);

  const calls = [];
  let eligible = false;
  const transaction = {
    async lockIdempotencyKey() { calls.push('idempotency-lock'); },
    async findOrderByIdempotency() { return null; },
    async findCustomerById() { return { id: 7 }; },
    async findStoreById() { return { id: 5, name: 'Synthetic Store', is_active: 1 }; },
    async findInventoryForUpdate() {
      calls.push('stock-lock');
      if (!eligible) return null;
      return { inventoryId: 9, medicineName: 'Synthetic medicine', drugstoreName: 'Synthetic Store',
        availability: 1, priceCentavos: 1250, sellableQuantity: 3, publication_status: 'published' };
    },
    async createOrder() { calls.push('create-order'); return 101; },
    async createOrderDrugstore() { return 202; },
    async createOrderItem() { calls.push('create-item'); },
    async reserveInventory() { calls.push('reserve'); return true; },
    async appendAudit() { calls.push('audit'); },
  };
  const repository = new Proxy({
    async withTransaction(work) { return (await work(transaction)).value; },
  }, {
    get(target, key) {
      if (key in target) return target[key];
      return async () => { throw new Error(`Unexpected order repository method: ${String(key)}`); };
    },
  });
  const service = createOrderService({ repository, now: () => 1000, nextRandom: () => 1234, checkoutAvailable: true });
  const request = {
    idempotencyKey: 'r04-packet0-checkout', requireIdempotency: true,
    items: [{ id: 22, drugstoreId: 5, quantity: 1 }],
  };
  assert.equal((await service.createOrder(7, request)).status, 409);
  assert.deepEqual(calls.splice(0), ['idempotency-lock', 'stock-lock']);
  eligible = true;
  const result = await service.createOrder(7, request);
  assert.equal(result.status, 201);
  assert.equal(result.body.totalCentavos, 1250);
  assert.deepEqual(calls, ['idempotency-lock', 'stock-lock', 'create-order', 'create-item', 'reserve', 'audit']);
});
