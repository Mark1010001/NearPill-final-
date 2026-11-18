/** Packet 0/NP-036 recording-pool characterization, not a real Supabase PASS. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPartnerInventoryPriceDenied } from '../scripts/lib/verify-order-tenant-isolation.mjs';

const fixture = Object.freeze({
  userA: 11, userB: 12, userPartner: 13, userAdmin: 17,
  partnerMembershipId: 14, storeId: 15, inventoryId: 16,
});

function recordingPool({ priceAllowed = false, legacyColumnPresent = false, membershipActive = true,
  wrongPharmacy = false, canUpdateAvailability = true, availabilityWriteNotApplied = false,
  availabilityInitialZero = false, availabilityWriteAlteredPrice = false,
  priceError, legacyColumnMalformed = false, centavoColumnMalformed = false,
  centavoColumnMissing = false, centavoColumnWrongType = false,
  centavoColumnNullable = false, contextLeak = false, failRollback = false,
  nonnegativeMissing = false, nonnegativeMalformed = false, nonnegativeUnvalidated = false,
  nonnegativeWrongType = false, nonnegativeWrongExpression = false,
  nonnegativeUnenforced = false, nonnegativeEnforcementUnknown = false,
  stockColumnMissing = false, stockColumnMalformed = false,
  stockColumnNullable = false, stockColumnWrongType = false,
  stockCheckMissing = false, stockCheckMalformed = false, stockCheckUnvalidated = false,
  stockCheckUnenforced = false, stockCheckWrongExpression = false,
  adminMissing = false, adminWrongRole = false, adminWriteDenied = false,
  adminWriteNoRows = false, adminWriteNotApplied = false } = {}) {
  const history = [];
  const releases = [];
  let transactions = 0;
  return {
    history,
    releases,
    get transactions() { return transactions; },
    async connect() {
      transactions += 1;
      let actor = '';
      let role = '';
      let capability = '';
      return {
        async query(sql, params = []) {
          history.push({ sql, params });
          if (sql === 'BEGIN') return { rows: [] };
          if (sql === 'ROLLBACK') {
            if (failRollback) throw new Error('synthetic rollback failed');
            if (!contextLeak) { actor = ''; role = ''; capability = ''; }
            return { rows: [] };
          }
          if (sql.includes("set_config('app.user_id'")) {
            actor = params[0]; role = params[1]; capability = '';
            return { rows: [] };
          }
          if (sql.includes("current_setting('app.user_id'")) {
            return { rows: [{ user_id: actor, role, capability }] };
          }
          if (sql.startsWith('SELECT id,role FROM users WHERE id = $1')) {
            return { rows: adminMissing ? [] : [{ id: fixture.userAdmin, role: adminWrongRole ? 'partner' : 'admin' }] };
          }
          if (sql.startsWith('SELECT id,drugstore_id,is_active FROM pharmacy_memberships')) {
            return { rows: [{ id: fixture.partnerMembershipId,
              drugstore_id: wrongPharmacy ? 99 : fixture.storeId,
              is_active: membershipActive ? 1 : 0 }] };
          }
          if (sql.includes('AS is_integer') && sql.includes('FROM pg_catalog.pg_attribute a')) {
            if (stockColumnMalformed) return { rows: null };
            return { rows: stockColumnMissing ? [{ attname: 'stock_on_hand', is_integer: true, is_not_null: true }] : [
              { attname: 'stock_on_hand', is_integer: !stockColumnWrongType, is_not_null: true },
              { attname: 'reserved_quantity', is_integer: true, is_not_null: !stockColumnNullable },
            ] };
          }
          if (sql.includes('FROM pg_catalog.pg_attribute a')) {
            if (sql.includes("a.attname = 'price_centavos'")) {
              if (centavoColumnMalformed) return { rows: null };
              return { rows: centavoColumnMissing ? [] : [{
                attname: 'price_centavos', is_bigint: !centavoColumnWrongType,
                is_not_null: !centavoColumnNullable,
              }] };
            }
            if (legacyColumnMalformed) return { rows: null };
            return { rows: legacyColumnPresent ? [{ attname: 'price' }] : [] };
          }
          if (sql.includes('FROM pg_catalog.pg_constraint k') && sql.includes("'inventory_stock_invariant'")) {
            if (stockCheckMalformed) return { rows: null };
            return { rows: stockCheckMissing ? [] : [{
              conname: 'inventory_stock_invariant', contype: 'c',
              convalidated: !stockCheckUnvalidated, enforced: !stockCheckUnenforced,
              definition: stockCheckWrongExpression
                ? 'CHECK ((stock_on_hand >= 0) AND (reserved_quantity >= 0))'
                : 'CHECK (((stock_on_hand >= 0) AND (reserved_quantity >= 0) AND (reserved_quantity <= stock_on_hand)))',
            }] };
          }
          if (sql.includes('FROM pg_catalog.pg_constraint k')) {
            if (nonnegativeMalformed) return { rows: null };
            return { rows: nonnegativeMissing ? [] : [{
              conname: 'inventory_price_centavos_nonnegative',
              contype: nonnegativeWrongType ? 'u' : 'c',
              convalidated: !nonnegativeUnvalidated,
              ...(!nonnegativeEnforcementUnknown ? { enforced: !nonnegativeUnenforced } : {}),
              definition: nonnegativeWrongExpression
                ? 'CHECK ((price_centavos >= -999))'
                : 'CHECK ((price_centavos >= 0))',
            }] };
          }
          if (sql.startsWith('SELECT id,drugstore_id,price_centavos,availability FROM inventory')) {
            return { rows: [{ id: fixture.inventoryId, drugstore_id: fixture.storeId,
              price_centavos: 1000, availability: availabilityInitialZero ? 0 : 1 }] };
          }
          if (sql.startsWith('UPDATE inventory SET availability = $2')) {
            return canUpdateAvailability
              ? { rows: [{ id: fixture.inventoryId, availability: availabilityWriteNotApplied ? 1 : 0, price_centavos: availabilityWriteAlteredPrice ? 1 : 1000 }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          if (sql.startsWith('UPDATE inventory SET price_centavos = $2 WHERE id = $1 RETURNING id,price_centavos')) {
            if (adminWriteDenied) throw Object.assign(new Error('permission denied for column price_centavos'), { code: '42501' });
            return adminWriteNoRows ? { rows: [], rowCount: 0 } : {
              rows: [{ id: fixture.inventoryId, price_centavos: adminWriteNotApplied ? 1000 : 1001 }], rowCount: 1,
            };
          }
          if (sql.startsWith('UPDATE inventory SET price_centavos')) {
            if (priceError) throw Object.assign(new Error(priceError.message), { code: priceError.code });
            return priceAllowed
              ? { rows: [{ id: fixture.inventoryId }], rowCount: 1 }
              : { rows: [], rowCount: 0 };
          }
          throw new Error(`Unexpected SQL in partner price probe: ${sql}`);
        },
        release(discard) { releases.push(discard); },
      };
    },
  };
}

test('NP-036 validates actual active membership and allowed pharmacy write before a rollback-only price negative', async () => {
  const pool = recordingPool();
  await assertPartnerInventoryPriceDenied({ pool, fixture });
  assert.equal(pool.transactions, 3);
  assert.deepEqual(pool.releases, [false, false, false]);
  assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 3);
  const contexts = pool.history.filter((q) => q.sql.includes("set_config('app.user_id'"));
  assert.equal(contexts.length, 3);
  assert.deepEqual(contexts[0].params, [String(fixture.userPartner), 'partner']);
  assert.deepEqual(contexts[2].params, [String(fixture.userAdmin), 'admin']);
  assert.deepEqual(pool.history.find((q) => q.sql.endsWith('RETURNING id,price_centavos')).params,
    [fixture.inventoryId, 1001]);
  assert.deepEqual(pool.history.find((q) => q.sql.startsWith('UPDATE inventory SET availability = $2')).params, [fixture.inventoryId, 0]);
  assert.deepEqual(pool.history.find((q) => q.sql.startsWith('UPDATE inventory SET price_centavos')).params, [fixture.inventoryId, 1]);
  assert.equal(pool.history.filter((q) => q.sql.includes('FROM pg_catalog.pg_attribute a')).length, 3);
  assert.ok(pool.history.some((q) => q.sql.includes("a.attname IN ('stock_on_hand', 'reserved_quantity')")));
  assert.ok(pool.history.some((q) => q.sql.includes("'inventory_stock_invariant'") && q.sql.includes('conenforced')));
  assert.ok(pool.history.some((q) => q.sql.includes("'pg_catalog.int8'::regtype")));
  assert.ok(pool.history.some((q) => q.sql.includes("'inventory_price_centavos_nonnegative'") && q.sql.includes('conenforced')));
  assert.ok(pool.history.some((q) => q.sql.includes('pg_catalog.pg_get_constraintdef')));
  assert.ok(pool.history.every((q) => !/^COMMIT/.test(q.sql)));
});

test('NP-036 fails closed when an actual pharmacy member can set authoritative price', async () => {
  const pool = recordingPool({ priceAllowed: true });
  await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /NP-036 RLS verification failed/);
  assert.deepEqual(pool.releases, [false, false]);
  assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 2);
});

test('NP-036 rejects stale legacy inventory.price schema before running a misleading price negative', async () => {
  const pool = recordingPool({ legacyColumnPresent: true });
  await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /schema drift: legacy inventory\.price/);
  assert.equal(pool.transactions, 1);
  assert.deepEqual(pool.releases, [false]);
  assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
  assert.ok(!pool.history.some((q) => q.sql.startsWith('UPDATE inventory SET price_centavos')));
});

test('NP-036 fails closed on malformed catalog introspection, not as an RLS success', async () => {
  const pool = recordingPool({ legacyColumnMalformed: true });
  await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /schema drift/);
  assert.deepEqual(pool.releases, [false]);
});

test('NP-036 rejects an absent, nullable, non-BIGINT or malformed centavo column before price writes', async () => {
  for (const flag of [
    'centavoColumnMissing', 'centavoColumnNullable',
    'centavoColumnWrongType', 'centavoColumnMalformed',
  ]) {
    const pool = recordingPool({ [flag]: true });
    await assert.rejects(
      assertPartnerInventoryPriceDenied({ pool, fixture }),
      /schema drift: inventory\.price_centavos must be a NOT NULL BIGINT/,
      flag,
    );
    assert.equal(pool.transactions, 1, 'stop before negative-write transaction');
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
    assert.ok(!pool.history.some((q) => q.sql.startsWith('UPDATE inventory SET price_centavos')));
  }
});

test('NP-036 refuses a missing, unvalidated or weakened money CHECK before price writes', async () => {
  for (const flag of [
    'nonnegativeMissing', 'nonnegativeMalformed', 'nonnegativeUnvalidated',
    'nonnegativeWrongType', 'nonnegativeWrongExpression',
  ]) {
    const pool = recordingPool({ [flag]: true });
    await assert.rejects(
      assertPartnerInventoryPriceDenied({ pool, fixture }),
      /schema drift: inventory\.price_centavos requires a validated and enforced nonnegative CHECK/,
      flag,
    );
    assert.equal(pool.transactions, 1, `${flag}: stop before the price-write transaction`);
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
    assert.ok(!pool.history.some((q) => q.sql.startsWith('UPDATE inventory SET price_centavos')));
  }
});

test('NP-036 PG18 money constraint enforcement must be attested before price writes', async () => {
  for (const flag of ['nonnegativeUnenforced', 'nonnegativeEnforcementUnknown']) {
    const pool = recordingPool({ [flag]: true });
    await assert.rejects(
      assertPartnerInventoryPriceDenied({ pool, fixture }),
      /schema drift: inventory\.price_centavos requires a validated and enforced nonnegative CHECK/,
      flag,
    );
    assert.equal(pool.transactions, 1, `${flag}: stop before price-write transaction`);
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
    assert.ok(!pool.history.some((q) => q.sql.startsWith('UPDATE inventory SET price_centavos')));
  }
});

test('Packet 0 inventory stock columns must be non-null integers before authorization probes', async () => {
  for (const flag of ['stockColumnMissing', 'stockColumnMalformed', 'stockColumnNullable', 'stockColumnWrongType']) {
    const pool = recordingPool({ [flag]: true });
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /stock columns must be NOT NULL INTEGER/, flag);
    assert.equal(pool.transactions, 1);
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
    assert.ok(!pool.history.some((q) => q.sql.startsWith('UPDATE inventory SET price_centavos')));
  }
});

test('Packet 0 requires validated enforced stock reservation invariant, not only price integrity', async () => {
  for (const flag of ['stockCheckMissing', 'stockCheckMalformed', 'stockCheckUnvalidated',
    'stockCheckUnenforced', 'stockCheckWrongExpression']) {
    const pool = recordingPool({ [flag]: true });
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /inventory_stock_invariant must be validated and enforced/, flag);
    assert.equal(pool.transactions, 1);
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
    assert.ok(!pool.history.some((q) => q.sql.startsWith('UPDATE inventory SET price_centavos')));
  }
});

test('NP-036 denies vacuous partner fixtures and missing permitted-write authority', async () => {
  for (const flags of [{ membershipActive: false }, { wrongPharmacy: true }, { canUpdateAvailability: false }]) {
    const pool = recordingPool(flags);
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /refused/);
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
  }
});

test('NP-036 rejects a non-effective partner availability write even with one returned row', async () => {
  const pool = recordingPool({ availabilityWriteNotApplied: true });
  await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /refused.*pharmacy write authority/);
  assert.equal(pool.transactions, 1);
  assert.deepEqual(pool.releases, [false]);
  assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
});

test('NP-036 refuses a zero initial availability or silently changed price in partner write', async () => {
  for (const flag of ['availabilityInitialZero', 'availabilityWriteAlteredPrice']) {
    const pool = recordingPool({ [flag]: true });
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /refused/, flag);
    assert.equal(pool.transactions, 1);
    assert.deepEqual(pool.releases, [false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 1);
  }
});

test('NP-036 accepts only price-specific SQLSTATE 42501 or zero-row denial', async () => {
  const allowed = recordingPool({ priceError: { code: '42501', message: 'permission denied for column price_centavos' } });
  await assertPartnerInventoryPriceDenied({ pool: allowed, fixture });
  assert.deepEqual(allowed.releases, [false, false, false]);
  for (const priceError of [
    { code: '42501', message: 'permission denied for table orders' },
    { code: '23514', message: 'check constraint failed' },
    { code: '42501', message: 'permission denied for column total_centavos' },
  ]) {
    const pool = recordingPool({ priceError });
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [false, false]);
  }
});

test('NP-036 admin positive control rejects missing actor and ineffective/admin-denied price writes', async () => {
  for (const flag of ['adminMissing', 'adminWrongRole', 'adminWriteDenied', 'adminWriteNoRows', 'adminWriteNotApplied']) {
    const pool = recordingPool({ [flag]: true });
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }), /NP-036 admin price positive control/, flag);
    assert.equal(pool.transactions, 3);
    assert.deepEqual(pool.releases, [false, false, false]);
    assert.equal(pool.history.filter((q) => q.sql === 'ROLLBACK').length, 3);
    assert.ok(pool.history.every((q) => q.sql !== 'COMMIT'));
  }
});

test('NP-036 releases/discards unsafe transaction-local contexts, and never commits', async () => {
  for (const flags of [{ contextLeak: true }, { failRollback: true }]) {
    const pool = recordingPool(flags);
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture }));
    assert.deepEqual(pool.releases, [true]);
    assert.ok(pool.history.every((q) => q.sql !== 'COMMIT'));
  }
});

test('NP-036 refuses invalid/mixed synthetic identity without DB queries', async () => {
  for (const invalid of [{ userPartner: 11 }, { userPartner: 0 }, { userAdmin: 11 }, { userAdmin: 13 }, { userAdmin: 0 }, { partnerMembershipId: undefined }, { inventoryId: '16' }]) {
    const pool = recordingPool();
    await assert.rejects(assertPartnerInventoryPriceDenied({ pool, fixture: { ...fixture, ...invalid } }), /requires a distinct/);
    assert.equal(pool.transactions, 0);
  }
});
