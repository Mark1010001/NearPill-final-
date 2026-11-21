import { randomUUID } from 'node:crypto';
/**
 * Packet 0 live cross-customer ORDER and USER RLS negative tests.
 * Called only after the approved-target and least-privilege database preflight.
 * Every attempted mutation is contained in a transaction that is rolled back,
 * including expected RLS errors. This is verification code, not a replacement
 * for backend authorization or PostgreSQL policies.
 */

function assertFixture(fixture) {
  for (const key of ['userA', 'userB', 'storeId', 'inventoryId', 'orderA', 'orderB', 'medicineId', 'orderItemA', 'orderItemB', 'paymentA', 'paymentB']) {
    if (!Number.isSafeInteger(fixture?.[key]) || fixture[key] <= 0) {
      throw new Error(`RLS verification requires a valid synthetic ${key}.`);
    }
  }
  if (fixture.userA === fixture.userB || fixture.orderA === fixture.orderB ||
      fixture.orderItemA === fixture.orderItemB || fixture.paymentA === fixture.paymentB) {
    throw new Error('RLS verification requires distinct synthetic users and orders.');
  }
}

async function withActor(pool, userId, actorRole, action) {
  const client = await pool.connect();
  let begun = false;
  let safeToReuse = false;
  try {
    await client.query('BEGIN');
    begun = true;
    await client.query(
      `SELECT set_config('app.user_id', $1, true),
              set_config('app.role', $2, true),
              set_config('app.capability', '', true)`,
      [String(userId), actorRole],
    );
    return await action(client);
  } finally {
    try {
      if (begun) {
        await client.query('ROLLBACK');
        // Observe transaction-local state on the SAME physical connection,
        // before it is released to another pooled request.
        const state = await client.query(
          `SELECT current_setting('app.user_id', true) AS user_id,
                  current_setting('app.role', true) AS role,
                  current_setting('app.capability', true) AS capability`,
        );
        if (!state || !Array.isArray(state.rows) || state.rows.length !== 1 ||
            ![null, ''].includes(state.rows[0]?.user_id) ||
            ![null, '', 'anonymous'].includes(state.rows[0]?.role) ||
            ![null, ''].includes(state.rows[0]?.capability)) {
          throw new Error('RLS verification refused: tenant/capability context leaked past ROLLBACK.');
        }
        safeToReuse = true;
      }
    } finally {
      // node-postgres release(true) DISCARDS the connection. Never return a
      // potentially uncommitted transaction or leaked actor/capability state
      // to a subsequent tenant request if BEGIN, ROLLBACK, or reset inspection
      // failed. Reuse is allowed only after we have proven transaction cleanup.
      client.release(!safeToReuse);
    }
  }
}

function withCustomer(pool, userId, action) {
  return withActor(pool, userId, 'customer', action);
}

/**
 * Packet 0/NP-036: Detect a pharmacy member's ability to change the
 * admin-owned authoritative price through the least-privilege DB role.
 * This MUST fail on an open price-write policy, rather than silently
 * interpreting an allowed pharmacy stock/availability change as proof of
 * price authorization. All writes roll back, even when unexpectedly allowed.
 */
export async function assertPartnerInventoryPriceDenied({ pool, fixture }) {
  if (!pool || typeof pool.connect !== 'function' ||
      !Number.isSafeInteger(fixture?.userPartner) || fixture.userPartner <= 0 ||
      !Number.isSafeInteger(fixture?.userAdmin) || fixture.userAdmin <= 0 ||
      !Number.isSafeInteger(fixture?.partnerMembershipId) || fixture.partnerMembershipId <= 0 ||
      !Number.isSafeInteger(fixture?.storeId) || fixture.storeId <= 0 ||
      !Number.isSafeInteger(fixture?.inventoryId) || fixture.inventoryId <= 0 ||
      new Set([fixture.userPartner, fixture.userAdmin, fixture.userA, fixture.userB]).size !== 4) {
    throw new Error('Partner price RLS verification requires a distinct, recorded member and inventory fixture.');
  }

  // Positive control: ensure the synthetic partner genuinely owns an active
  // pharmacy membership and can update a permitted availability value. A
  // missing row, wrong tenant or app-role grant failure is not a security PASS.
  await withActor(pool, fixture.userPartner, 'partner', async (client) => {
    const membership = await client.query(
      `SELECT id,pharmacy_id,is_active FROM pharmacy_memberships
       WHERE id = $1 AND user_id = $2`,
      [fixture.partnerMembershipId, fixture.userPartner],
    );
    if (!membership || !Array.isArray(membership.rows) || membership.rows.length !== 1 ||
        Number(membership.rows[0]?.id) !== fixture.partnerMembershipId ||
        Number(membership.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(membership.rows[0]?.is_active) !== 1) {
      throw new Error('Partner price RLS verification refused an absent/inactive/wrong-tenant membership.');
    }
    // 0006_order_inventory.sql explicitly DROPS the old numeric price column.
    // Refuse a stale/drifted schema instead of probing a nonexistent column
    // and mistaking SQLSTATE 42703 for an authorization result.
    const legacyPrice = await client.query(
      `SELECT a.attname FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'stock'
         AND a.attname = 'price' AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    if (!legacyPrice || !Array.isArray(legacyPrice.rows) || legacyPrice.rows.length !== 0) {
      throw new Error('NP-036 schema drift: legacy inventory.price should have been dropped by migration 0006.');
    }
    // A stale or partially applied 0006 migration can leave a similarly
    // named column with a different type or nullability. A visible fixture
    // price of 1000 alone cannot prove the BIGINT/NOT NULL money contract.
    // Check the actual system catalog before interpreting any write denial.
    const centavoColumn = await client.query(
      `SELECT a.attname,
              a.atttypid = 'pg_catalog.int8'::regtype AS is_bigint,
              a.attnotnull AS is_not_null
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'stock'
         AND c.relkind IN ('r', 'p') AND a.attname = 'price_centavos'
         AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    if (!centavoColumn || !Array.isArray(centavoColumn.rows) || centavoColumn.rows.length !== 1 ||
        centavoColumn.rows[0]?.attname !== 'price_centavos' ||
        centavoColumn.rows[0]?.is_bigint !== true ||
        centavoColumn.rows[0]?.is_not_null !== true) {
      throw new Error('NP-036 schema drift: inventory.price_centavos must be a NOT NULL BIGINT after migration 0006.');
    }
    // Migration 0006 also requires nonnegative authoritative money. A
    // BIGINT/NOT NULL column with an absent, NOT VALID or weakened CHECK is
    // still a drifted schema. Verify the actual named and validated table
    // constraint (not merely its presence in the SQL migration source).
    const nonnegative = await client.query(
      `SELECT k.conname, k.contype, k.convalidated,
              -- PG18 permits NOT ENFORCED CHECK constraints; PG17 does not
              -- expose conenforced. JSONB catalog access works on both.
              CASE WHEN current_setting('server_version_num')::integer >= 180000
                   THEN (to_jsonb(k)->>'conenforced')::boolean
                   ELSE true END AS enforced,
              pg_catalog.pg_get_constraintdef(k.oid) AS definition
       FROM pg_catalog.pg_constraint k
       JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'stock'
         AND c.relkind IN ('r', 'p')
         AND k.conname = 'inventory_price_centavos_nonnegative'`,
    );
    if (!nonnegative || !Array.isArray(nonnegative.rows) || nonnegative.rows.length !== 1 ||
        nonnegative.rows[0]?.conname !== 'inventory_price_centavos_nonnegative' ||
        nonnegative.rows[0]?.contype !== 'c' || nonnegative.rows[0]?.convalidated !== true ||
        nonnegative.rows[0]?.enforced !== true ||
        !/^CHECK\s*\(\s*\(*\s*price_centavos\s*>=\s*0\s*\)*\s*\)$/i.test(
          String(nonnegative.rows[0]?.definition ?? ''),
        )) {
      throw new Error('NP-036 schema drift: inventory.price_centavos requires a validated and enforced nonnegative CHECK.');
    }
    // Migration 0006 also protects reservation accounting with a validated
    // nonnegative stock invariant. Price-only schema attestation could pass on
    // a drifted database that allows reserved_quantity > stock_on_hand.
    // These read-only checks run before any fixture UPDATE and do not substitute
    // for the separate 100-way concurrency acceptance gate.
    const stockColumns = await client.query(
      `SELECT a.attname,
              a.atttypid = 'pg_catalog.int4'::regtype AS is_integer,
              a.attnotnull AS is_not_null
       FROM pg_catalog.pg_attribute a
       JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'stock'
         AND c.relkind IN ('r', 'p')
         AND a.attname IN ('stock_on_hand', 'reserved_quantity')
         AND a.attnum > 0 AND NOT a.attisdropped`,
    );
    if (!stockColumns || !Array.isArray(stockColumns.rows) || stockColumns.rows.length !== 2 ||
        new Set(stockColumns.rows.map((row) => row?.attname)).size !== 2 ||
        !['stock_on_hand', 'reserved_quantity'].every((name) =>
          stockColumns.rows.some((row) => row?.attname === name &&
            row.is_integer === true && row.is_not_null === true))) {
      throw new Error('Packet 0 schema drift: inventory stock columns must be NOT NULL INTEGER.');
    }
    // PG18 supports NOT ENFORCED CHECK constraints. JSONB catalog access keeps
    // the query parseable on PG17, where existing CHECKs are always enforced.
    const stockConstraint = await client.query(
      `SELECT k.conname, k.contype, k.convalidated,
              CASE WHEN current_setting('server_version_num')::integer >= 180000
                   THEN (to_jsonb(k)->>'conenforced')::boolean
                   ELSE true END AS enforced,
              pg_catalog.pg_get_constraintdef(k.oid) AS definition
       FROM pg_catalog.pg_constraint k
       JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
       JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = 'stock'
         AND c.relkind IN ('r', 'p')
         AND k.conname = 'inventory_stock_invariant'`,
    );
    const row = stockConstraint?.rows?.[0];
    // This reviewed expression must contain exactly all three comparisons;
    // stripping PostgreSQL display parentheses/spacing does not admit altered
    // predicates (such as a missing reserved <= stock bound or an OR clause).
    const normalized = String(row?.definition ?? '').replace(/[()\s]/g, '').toUpperCase();
    if (!stockConstraint || !Array.isArray(stockConstraint.rows) || stockConstraint.rows.length !== 1 ||
        row?.conname !== 'inventory_stock_invariant' || row?.contype !== 'c' ||
        row?.convalidated !== true || row?.enforced !== true ||
        normalized !== 'CHECKSTOCK_ON_HAND>=0ANDRESERVED_QUANTITY>=0ANDRESERVED_QUANTITY<=STOCK_ON_HAND') {
      throw new Error('Packet 0 schema drift: inventory_stock_invariant must be validated and enforced.');
    }
    const visible = await client.query(
      'SELECT id,pharmacy_id,price_centavos,availability FROM stock WHERE id = $1',
      [fixture.inventoryId],
    );
    if (!visible || !Array.isArray(visible.rows) || visible.rows.length !== 1 ||
        Number(visible.rows[0]?.id) !== fixture.inventoryId ||
        Number(visible.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(visible.rows[0]?.price_centavos) !== 1000 ||
        Number(visible.rows[0]?.availability) !== 1) {
      throw new Error('Partner price RLS verification refused missing/mismatched priced inventory or initial availability.');
    }
    // Require an EFFECTIVE partner-owned availability change. A no-op UPDATE
    // may return a row even if a trigger/policy blocks actual availability
    // changes. 0001 constrains availability to 0/1; the committed synthetic
    // fixture starts at 1. ROLLBACK restores it before later RLS probes.
    const allowed = await client.query(
      'UPDATE stock SET availability = $2 WHERE id = $1 RETURNING id,availability,price_centavos',
      [fixture.inventoryId, 0],
    );
    if (!allowed || !Array.isArray(allowed.rows) || allowed.rows.length !== 1 ||
        allowed.rowCount !== 1 || Number(allowed.rows[0]?.id) !== fixture.inventoryId ||
        Number(allowed.rows[0]?.availability) !== 0 ||
        Number(allowed.rows[0]?.price_centavos) !== 1000) {
      throw new Error('Partner price RLS verification refused ineffective or unauthorized pharmacy write authority.');
    }
  });

  await withActor(pool, fixture.userPartner, 'partner', async (client) => {
    let denied = false;
    let result;
    try {
      result = await client.query(
        'UPDATE stock SET price_centavos = $2 WHERE id = $1 RETURNING id',
        [fixture.inventoryId, 1],
      );
    } catch (error) {
      if (!isExpectedMutationDenial(error, 'stock', 'price_centavos')) throw error;
      denied = true;
    }
    if (!denied && (!result || !Array.isArray(result.rows) ||
        result.rowCount !== 0 || result.rows.length !== 0)) {
      throw new Error('NP-036 RLS verification failed: pharmacy member can directly change admin-owned price_centavos.');
    }
  });

  // Positive control for the OTHER half of the same authorization contract:
  // blocking member price writes must not also break the legitimate admin
  // path. Use a separate real synthetic admin identity, ordinary app-role
  // connection and a transaction that is ALWAYS rolled back. A no-op UPDATE
  // would not prove an actual 1000 -> 1001 price change remains possible.
  await withActor(pool, fixture.userAdmin, 'admin', async (client) => {
    const actor = await client.query(
      'SELECT id,role FROM users WHERE id = $1',
      [fixture.userAdmin],
    );
    if (!actor || !Array.isArray(actor.rows) || actor.rows.length !== 1 ||
        Number(actor.rows[0]?.id) !== fixture.userAdmin || actor.rows[0]?.role !== 'admin') {
      throw new Error('NP-036 admin price positive control requires a real synthetic admin account.');
    }
    let changed;
    try {
      changed = await client.query(
        'UPDATE stock SET price_centavos = $2 WHERE id = $1 RETURNING id,price_centavos',
        [fixture.inventoryId, 1001],
      );
    } catch (cause) {
      throw new Error('NP-036 admin price positive control failed: legitimate admin price update was denied.', { cause });
    }
    if (!changed || !Array.isArray(changed.rows) || changed.rows.length !== 1 ||
        changed.rowCount !== 1 || Number(changed.rows[0]?.id) !== fixture.inventoryId ||
        Number(changed.rows[0]?.price_centavos) !== 1001) {
      throw new Error('NP-036 admin price positive control failed: legitimate admin price update is not effective.');
    }
  });
}


/**
 * Packet 0 tenant-isolation proof complementary to NP-036. A partner may
 * update availability at their own pharmacy but must not mutate another
 * verified/published pharmacy's inventory, even when that public row is
 * visible. The second pharmacy is inserted by the existing verifier on the
 * approved disposable/restorable target, never inferred from live records.
 * All probes use the real least-privilege app connection and always ROLLBACK.
 */
export async function assertPartnerCrossPharmacyInventoryDenied({ pool, fixture }) {
  const required = ['userPartner', 'partnerMembershipId', 'storeId', 'otherStoreId',
    'inventoryId', 'otherInventoryId'];
  if (!pool || typeof pool.connect !== 'function' ||
      required.some((key) => !Number.isSafeInteger(fixture?.[key]) || fixture[key] <= 0) ||
      fixture.storeId === fixture.otherStoreId ||
      fixture.inventoryId === fixture.otherInventoryId) {
    throw new Error('Cross-pharmacy RLS verification requires two distinct recorded pharmacy fixtures.');
  }

  await withActor(pool, fixture.userPartner, 'partner', async (client) => {
    const membership = await client.query(
      `SELECT id,pharmacy_id,is_active FROM pharmacy_memberships
       WHERE id = $1 AND user_id = $2`,
      [fixture.partnerMembershipId, fixture.userPartner],
    );
    if (membership?.rows?.length !== 1 ||
        Number(membership.rows[0]?.id) !== fixture.partnerMembershipId ||
        Number(membership.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(membership.rows[0]?.is_active) !== 1) {
      throw new Error('Cross-pharmacy RLS verification requires an active first-pharmacy membership.');
    }
    const foreignMembership = await client.query(
      `SELECT id FROM pharmacy_memberships
       WHERE pharmacy_id = $1 AND user_id = $2 AND is_active = 1`,
      [fixture.otherStoreId, fixture.userPartner],
    );
    if (!foreignMembership || !Array.isArray(foreignMembership.rows) || foreignMembership.rows.length !== 0) {
      throw new Error('Cross-pharmacy RLS verifier refuses a member of both synthetic pharmacies.');
    }
    // Both pharmacies are published so SELECT can observe the second row.
    // Otherwise a zero-row UPDATE would not demonstrate tenant isolation.
    const visible = await client.query(
      'SELECT id,pharmacy_id,availability,price_centavos FROM stock WHERE id = $1',
      [fixture.otherInventoryId],
    );
    if (!visible || !Array.isArray(visible.rows) || visible.rows.length !== 1 ||
        Number(visible.rows[0]?.id) !== fixture.otherInventoryId ||
        Number(visible.rows[0]?.pharmacy_id) !== fixture.otherStoreId ||
        Number(visible.rows[0]?.availability) !== 1 ||
        Number(visible.rows[0]?.price_centavos) !== 1000) {
      throw new Error('Cross-pharmacy RLS verifier requires visible priced foreign inventory.');
    }
  });

  // NP-037: partners may change delegated availability but must not
  // remove an inventory listing, even at their OWN pharmacy. The existing
  // inventory_write FOR ALL policy could otherwise make DELETE permissible.
  // Test both the owned row and a visible other-pharmacy row, without
  // treating an FK/trigger failure as authorization. Each attempt rolls back.
  for (const [inventoryId, scope] of [
    [fixture.inventoryId, 'own'],
    [fixture.otherInventoryId, 'other'],
  ]) {
    await withActor(pool, fixture.userPartner, 'partner', async (client) => {
      const visible = await client.query(
        'SELECT id,pharmacy_id,availability,price_centavos FROM stock WHERE id = $1',
        [inventoryId],
      );
      const expectedStore = scope === 'own' ? fixture.storeId : fixture.otherStoreId;
      if (!visible || !Array.isArray(visible.rows) || visible.rows.length !== 1 ||
          Number(visible.rows[0]?.id) !== inventoryId ||
          Number(visible.rows[0]?.pharmacy_id) !== expectedStore ||
          Number(visible.rows[0]?.availability) !== 1 ||
          Number(visible.rows[0]?.price_centavos) !== 1000) {
        throw new Error(`NP-037 DELETE verification requires visible ${scope}-pharmacy inventory.`);
      }
      let denied = false;
      let result;
      try {
        result = await client.query('DELETE FROM stock WHERE id = $1 RETURNING id', [inventoryId]);
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'stock')) throw error;
        denied = true;
      }
      if (!denied && (!result || !Array.isArray(result.rows) ||
          result.rowCount !== 0 || result.rows.length !== 0)) {
        throw new Error(`NP-037 RLS verification failed: partner can DELETE ${scope}-pharmacy inventory.`);
      }
    });
  }

  // Separate transactions: PostgreSQL aborts a transaction after a 42501
  // denial. Do not confuse one denied column with proof of the other column.
  for (const [column, attemptedValue] of [['availability', 0], ['price_centavos', 1]]) {
    await withActor(pool, fixture.userPartner, 'partner', async (client) => {
      let denied = false;
      let result;
      try {
        result = await client.query(
          `UPDATE stock SET ${column} = $2 WHERE id = $1 RETURNING id`,
          [fixture.otherInventoryId, attemptedValue],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'stock', column)) throw error;
        denied = true;
      }
      if (!denied && (!result || !Array.isArray(result.rows) ||
          result.rowCount !== 0 || result.rows.length !== 0)) {
        throw new Error(`Cross-pharmacy RLS verification failed: partner can change another pharmacy's ${column}.`);
      }
    });
  }
}


/**
 * Packet 0 / NP-038: The reviewed inventory FOR ALL policy includes INSERT,
 * not just allowed availability updates. A real member must not create a new
 * priced listing (and thereby choose an admin-owned price). First demonstrate
 * that a legitimate admin can insert the SAME otherwise-valid unpublished-
 * inventory fixture through the ordinary app role. Separate transactions
 * roll back both probes; a uniqueness/FK/grant error cannot prove security.
 */
export async function assertPartnerInventoryInsertDenied({ pool, fixture }) {
  const keys = ['userPartner', 'userAdmin', 'partnerMembershipId', 'storeId', 'otherStoreId', 'medicineId', 'priceProbeMedicineId'];
  if (typeof pool?.connect !== 'function' ||
      keys.some((key) => !Number.isSafeInteger(fixture?.[key]) || fixture[key] <= 0) ||
      fixture.medicineId === fixture.priceProbeMedicineId ||
      fixture.storeId === fixture.otherStoreId ||
      fixture.userPartner === fixture.userAdmin) {
    throw new Error('NP-038 requires distinct recorded actors and an unused synthetic medicine.');
  }
  // A real synthetic published medicine, with no existing pharmacy listing,
  // excludes absent foreign keys and unique inventory conflicts from the test.
  await withActor(pool, fixture.userAdmin, 'admin', async (client) => {
    const actor = await client.query('SELECT id,role FROM users WHERE id = $1', [fixture.userAdmin]);
    if (actor?.rows?.length !== 1 || Number(actor.rows[0]?.id) !== fixture.userAdmin ||
        actor.rows[0]?.role !== 'admin') {
      throw new Error('NP-038 admin INSERT positive control requires a real synthetic administrator.');
    }
    const medicine = await client.query(
      'SELECT id,publication_status FROM medicines WHERE id = $1',
      [fixture.priceProbeMedicineId],
    );
    if (medicine?.rows?.length !== 1 ||
        Number(medicine.rows[0]?.id) !== fixture.priceProbeMedicineId ||
        medicine.rows[0]?.publication_status !== 'published') {
      throw new Error('NP-038 INSERT probe requires a visible published synthetic medicine.');
    }
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO stock (pharmacy_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
         VALUES ($1,$2,$3,0,0,1) RETURNING id,pharmacy_id,medicine_id,price_centavos`,
        [fixture.storeId, fixture.priceProbeMedicineId, 1000],
      );
    } catch (cause) {
      throw new Error('NP-038 admin INSERT positive control failed: legitimate catalog insert denied.', { cause });
    }
    if (inserted?.rowCount !== 1 || inserted.rows?.length !== 1 ||
        !Number.isSafeInteger(Number(inserted.rows[0]?.id)) || Number(inserted.rows[0]?.id) <= 0 ||
        Number(inserted.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(inserted.rows[0]?.medicine_id) !== fixture.priceProbeMedicineId ||
        Number(inserted.rows[0]?.price_centavos) !== 1000) {
      throw new Error('NP-038 admin INSERT positive control failed: insertion was ineffective or malformed.');
    }
  });
  // Admin INSERT has rolled back. Reuse exactly the same valid product/store
  // combination, but try an unauthorized one-centavo price as an active member.
  await withActor(pool, fixture.userPartner, 'partner', async (client) => {
    const membership = await client.query(
      `SELECT id FROM pharmacy_memberships
       WHERE user_id = $1 AND pharmacy_id = $2 AND is_active = 1`,
      [fixture.userPartner, fixture.storeId],
    );
    if (membership?.rows?.length !== 1 ||
        Number(membership.rows[0]?.id) !== fixture.partnerMembershipId) {
      throw new Error('NP-038 requires a real active partner membership for the destination pharmacy.');
    }
    let error;
    try {
      await client.query(
        `INSERT INTO stock (pharmacy_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
         VALUES ($1,$2,$3,0,0,1) RETURNING id`,
        [fixture.storeId, fixture.priceProbeMedicineId, 1],
      );
    } catch (cause) {
      error = cause;
    }
    if (!error) {
      throw new Error('NP-038 RLS verification failed: pharmacy member can create a listing with an arbitrary price.');
    }
    // INSERT cannot return a harmless filtered zero-row result in this query.
    // Require the exact inventory WITH CHECK RLS denial, not a duplicate key,
    // FK error, syntax error, or a missing table INSERT grant.
    if (!isExpectedInsertRlsDenial(error, 'stock')) throw error;
  });

  // Cross-pharmacy INSERT must also be rejected, even at the legitimate
  // 1,000-centavo price. Unlike the own-store probe, this isolates tenant
  // ownership from price authority. Prove the second published store accepts
  // the SAME new medicine from a real administrator before the negative.
  await withActor(pool, fixture.userAdmin, 'admin', async (client) => {
    const foreignStore = await client.query(
      'SELECT id,is_active FROM pharmacies WHERE id = $1', [fixture.otherStoreId],
    );
    if (foreignStore?.rows?.length !== 1 ||
        Number(foreignStore.rows[0]?.id) !== fixture.otherStoreId ||
        Number(foreignStore.rows[0]?.is_active) !== 1) {
      throw new Error('NP-038 foreign INSERT control requires a real active second pharmacy.');
    }
    let inserted;
    try {
      inserted = await client.query(
        `INSERT INTO stock (pharmacy_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
         VALUES ($1,$2,$3,0,0,1) RETURNING id,pharmacy_id,medicine_id,price_centavos`,
        [fixture.otherStoreId, fixture.priceProbeMedicineId, 1000],
      );
    } catch (cause) {
      throw new Error('NP-038 foreign admin INSERT positive control failed.', { cause });
    }
    if (inserted?.rowCount !== 1 || inserted.rows?.length !== 1 ||
        !Number.isSafeInteger(Number(inserted.rows[0]?.id)) || Number(inserted.rows[0]?.id) <= 0 ||
        Number(inserted.rows[0]?.pharmacy_id) !== fixture.otherStoreId ||
        Number(inserted.rows[0]?.medicine_id) !== fixture.priceProbeMedicineId ||
        Number(inserted.rows[0]?.price_centavos) !== 1000) {
      throw new Error('NP-038 foreign admin INSERT positive control was ineffective or malformed.');
    }
  });

  await withActor(pool, fixture.userPartner, 'partner', async (client) => {
    const unauthorizedMembership = await client.query(
      `SELECT id FROM pharmacy_memberships
       WHERE user_id = $1 AND pharmacy_id = $2 AND is_active = 1`,
      [fixture.userPartner, fixture.otherStoreId],
    );
    if (!Array.isArray(unauthorizedMembership?.rows) || unauthorizedMembership.rows.length !== 0) {
      throw new Error('NP-038 foreign INSERT requires no active partner membership in the second pharmacy.');
    }
    const foreignStore = await client.query(
      'SELECT id,is_active FROM pharmacies WHERE id = $1', [fixture.otherStoreId],
    );
    if (foreignStore?.rows?.length !== 1 ||
        Number(foreignStore.rows[0]?.id) !== fixture.otherStoreId ||
        Number(foreignStore.rows[0]?.is_active) !== 1) {
      throw new Error('NP-038 foreign INSERT requires a visible active second pharmacy.');
    }
    let error;
    try {
      await client.query(
        `INSERT INTO stock (pharmacy_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
         VALUES ($1,$2,$3,0,0,1) RETURNING id`,
        [fixture.otherStoreId, fixture.priceProbeMedicineId, 1000],
      );
    } catch (cause) {
      error = cause;
    }
    if (!error) {
      throw new Error('NP-038 tenant isolation failed: member can insert into an unrelated pharmacy.');
    }
    if (!isExpectedInsertRlsDenial(error, 'stock')) throw error;
  });
}

/**
 * Packet 0 / NP-039: A pharmacy member may edit delegated availability, but
 * reserved_quantity is owned by the order reservation/release use case. The
 * existing inventory FOR ALL policy may let a partner write this column
 * without a matching reservation/stock movement. Two independently rolled-
 * back probes establish admin write parity and partner denial under the
 * ordinary app role. A schema CHECK (0 <= reserved <= stock) is insufficient.
 */
export async function assertPartnerReservedQuantityDenied({ pool, fixture }) {
  const keys = ['userPartner', 'userAdmin', 'partnerMembershipId', 'storeId', 'inventoryId'];
  if (typeof pool?.connect !== 'function' ||
      keys.some((key) => !Number.isSafeInteger(fixture?.[key]) || fixture[key] <= 0) ||
      fixture.userPartner === fixture.userAdmin) {
    throw new Error('NP-039 requires distinct synthetic admin/member actors and recorded inventory.');
  }

  await withActor(pool, fixture.userAdmin, 'admin', async (client) => {
    const actor = await client.query('SELECT id,role FROM users WHERE id=$1', [fixture.userAdmin]);
    if (actor?.rows?.length !== 1 || Number(actor.rows[0]?.id) !== fixture.userAdmin ||
        actor.rows[0]?.role !== 'admin') {
      throw new Error('NP-039 admin positive control requires a real administrator.');
    }
    const original = await client.query(
      'SELECT id,pharmacy_id,stock_on_hand,reserved_quantity FROM stock WHERE id=$1',
      [fixture.inventoryId],
    );
    if (original?.rows?.length !== 1 || Number(original.rows[0]?.id) !== fixture.inventoryId ||
        Number(original.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(original.rows[0]?.stock_on_hand) !== 3 ||
        Number(original.rows[0]?.reserved_quantity) !== 0) {
      throw new Error('NP-039 admin positive control requires an untouched 3/0 inventory fixture.');
    }
    const changed = await client.query(
      'UPDATE stock SET reserved_quantity=$2 WHERE id=$1 RETURNING id,reserved_quantity,stock_on_hand',
      [fixture.inventoryId, 1],
    );
    if (changed?.rowCount !== 1 || changed.rows?.length !== 1 ||
        Number(changed.rows[0]?.id) !== fixture.inventoryId ||
        Number(changed.rows[0]?.reserved_quantity) !== 1 ||
        Number(changed.rows[0]?.stock_on_hand) !== 3) {
      throw new Error('NP-039 admin positive control failed: reservation-column write was not effective.');
    }
  });

  // Admin mutation is rolled back before checking the partner. Both actors
  // start with the same valid 3/0 state, so a CHECK/unique/FK failure cannot
  // masquerade as authorization. The existing membership must be real.
  await withActor(pool, fixture.userPartner, 'partner', async (client) => {
    const membership = await client.query(
      'SELECT id,pharmacy_id,is_active FROM pharmacy_memberships WHERE id=$1 AND user_id=$2',
      [fixture.partnerMembershipId, fixture.userPartner],
    );
    if (membership?.rows?.length !== 1 ||
        Number(membership.rows[0]?.id) !== fixture.partnerMembershipId ||
        Number(membership.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(membership.rows[0]?.is_active) !== 1) {
      throw new Error('NP-039 requires a real active member of the inventory pharmacy.');
    }
    const original = await client.query(
      'SELECT id,pharmacy_id,stock_on_hand,reserved_quantity FROM stock WHERE id=$1',
      [fixture.inventoryId],
    );
    if (original?.rows?.length !== 1 || Number(original.rows[0]?.id) !== fixture.inventoryId ||
        Number(original.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(original.rows[0]?.stock_on_hand) !== 3 ||
        Number(original.rows[0]?.reserved_quantity) !== 0) {
      throw new Error('NP-039 requires visible untouched 3/0 member-owned inventory.');
    }
    let denied = false;
    let changed;
    try {
      changed = await client.query(
        'UPDATE stock SET reserved_quantity=$2 WHERE id=$1 RETURNING id,reserved_quantity,stock_on_hand',
        [fixture.inventoryId, 1],
      );
    } catch (error) {
      if (!isExpectedMutationDenial(error, 'stock', 'reserved_quantity')) throw error;
      denied = true;
    }
    if (!denied && (!changed || !Array.isArray(changed.rows) ||
        changed.rowCount !== 0 || changed.rows.length !== 0)) {
      throw new Error('NP-039 RLS verification failed: partner can directly modify reserved_quantity.');
    }
  });
}

/**
 * Packet 0 / NP-040: Pharmacy memberships permit a partner to READ their
 * pharmacy's reservation records. They must not confer a DELETE capability:
 * reservation release/fulfillment is an audited order-domain operation.
 * The reviewed reservations_app FOR ALL USING predicate includes membership;
 * DELETE does not apply WITH CHECK. Test a real, consistent synthetic active
 * reservation under a legitimate admin (positive control) and a member
 * (negative) on independent transaction-local, rollback-only app sessions.
 */
export async function assertPartnerReservationDeleteDenied({ pool, fixture }) {
  const keys = ['userPartner', 'userAdmin', 'partnerMembershipId', 'storeId',
    'reservationId', 'reservationInventoryId', 'reservationMovementId', 'orderB'];
  if (typeof pool?.connect !== 'function' ||
      keys.some((key) => !Number.isSafeInteger(fixture?.[key]) || fixture[key] <= 0) ||
      fixture.userPartner === fixture.userAdmin ||
      fixture.reservationInventoryId === fixture.inventoryId) {
    throw new Error('NP-040 requires distinct admin/member actors and a dedicated synthetic active reservation.');
  }

  await withActor(pool, fixture.userAdmin, 'admin', async (client) => {
    const actor = await client.query('SELECT id,role FROM users WHERE id=$1', [fixture.userAdmin]);
    if (actor?.rows?.length !== 1 || Number(actor.rows[0]?.id) !== fixture.userAdmin ||
        actor.rows[0]?.role !== 'admin') {
      throw new Error('NP-040 administrator DELETE positive control requires a real admin account.');
    }
    const reservation = await client.query(
      `SELECT r.id,r.order_id,r.stock_id,r.quantity,r.status,i.pharmacy_id,i.reserved_quantity
       FROM reservations r JOIN stock i ON i.id=r.stock_id WHERE r.id=$1`,
      [fixture.reservationId],
    );
    if (reservation?.rows?.length !== 1 ||
        Number(reservation.rows[0]?.id) !== fixture.reservationId ||
        Number(reservation.rows[0]?.order_id) !== fixture.orderB ||
        Number(reservation.rows[0]?.stock_id) !== fixture.reservationInventoryId ||
        Number(reservation.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(reservation.rows[0]?.quantity) !== 1 ||
        Number(reservation.rows[0]?.reserved_quantity) !== 1 ||
        reservation.rows[0]?.status !== 'active') {
      throw new Error('NP-040 requires a real, consistent, active reservation and reserved stock.');
    }
    const movement = await client.query(
      `SELECT id,stock_id,order_id,movement_type,held_change,stock_change
       FROM stock_movements WHERE id=$1`, [fixture.reservationMovementId],
    );
    if (movement?.rows?.length !== 1 ||
        Number(movement.rows[0]?.id) !== fixture.reservationMovementId ||
        Number(movement.rows[0]?.stock_id) !== fixture.reservationInventoryId ||
        Number(movement.rows[0]?.order_id) !== fixture.orderB ||
        movement.rows[0]?.movement_type !== 'reserve' ||
        Number(movement.rows[0]?.held_change) !== 1 ||
        Number(movement.rows[0]?.stock_change) !== 0) {
      throw new Error('NP-040 requires an authentic matching reserve movement for the active reservation.');
    }
    const removed = await client.query(
      'DELETE FROM reservations WHERE id=$1 RETURNING id', [fixture.reservationId],
    );
    if (removed?.rowCount !== 1 || removed.rows?.length !== 1 ||
        Number(removed.rows[0]?.id) !== fixture.reservationId) {
      throw new Error('NP-040 administrator DELETE positive control did not remove the recorded reservation.');
    }
  });

  // The admin DELETE rolled back. The member can read this same real row,
  // but must not destroy it. Treat a missing row or unrelated 42501 as FAIL.
  await withActor(pool, fixture.userPartner, 'partner', async (client) => {
    const membership = await client.query(
      'SELECT id,pharmacy_id,is_active FROM pharmacy_memberships WHERE id=$1 AND user_id=$2',
      [fixture.partnerMembershipId, fixture.userPartner],
    );
    if (membership?.rows?.length !== 1 ||
        Number(membership.rows[0]?.id) !== fixture.partnerMembershipId ||
        Number(membership.rows[0]?.pharmacy_id) !== fixture.storeId ||
        Number(membership.rows[0]?.is_active) !== 1) {
      throw new Error('NP-040 requires a real active membership in the reservation pharmacy.');
    }
    const existing = await client.query(
      'SELECT id,order_id,stock_id,status FROM reservations WHERE id=$1',
      [fixture.reservationId],
    );
    if (existing?.rows?.length !== 1 ||
        Number(existing.rows[0]?.id) !== fixture.reservationId ||
        Number(existing.rows[0]?.order_id) !== fixture.orderB ||
        Number(existing.rows[0]?.stock_id) !== fixture.reservationInventoryId ||
        existing.rows[0]?.status !== 'active') {
      throw new Error('NP-040 requires partner visibility of the existing active reservation.');
    }
    let denied = false;
    let result;
    try {
      result = await client.query(
        'DELETE FROM reservations WHERE id=$1 RETURNING id', [fixture.reservationId],
      );
    } catch (error) {
      if (!isExpectedMutationDenial(error, 'reservations')) throw error;
      denied = true;
    }
    if (!denied && (!result || !Array.isArray(result.rows) ||
        result.rowCount !== 0 || result.rows.length !== 0)) {
      throw new Error('NP-040 RLS verification failed: pharmacy member can DELETE an active reservation.');
    }
  });
}


/**
 * Packet 0 / NP-041: An order owner's ability to READ a reservation must not
 * confer DELETE authority. Migration 0006 uses reservations_app FOR ALL and
 * a customer-owned-order predicate in USING, so the DELETE path must be
 * characterized independently of NP-040's pharmacy-member probe. The
 * verifier uses the SAME consistent synthetic reservation/stock movement,
 * checks owner and foreign-customer visibility, and rolls back every attempt.
 */
export async function assertCustomerReservationDeleteDenied({ pool, fixture }) {
  const keys = ['userA', 'userB', 'orderA', 'orderB', 'reservationId',
    'reservationInventoryId', 'inventoryId'];
  if (typeof pool?.connect !== 'function' ||
      keys.some((key) => !Number.isSafeInteger(fixture?.[key]) || fixture[key] <= 0) ||
      fixture.userA === fixture.userB || fixture.orderA === fixture.orderB ||
      fixture.reservationInventoryId === fixture.inventoryId) {
    throw new Error('NP-041 requires two distinct synthetic customers/orders and a dedicated active reservation.');
  }

  // Non-vacuous owner control: a real, visible reserved order and its active
  // reservation exist. Lack of SELECT grants or an absent fixture cannot
  // masquerade as a successful delete-denial assertion.
  await withCustomer(pool, fixture.userB, async (client) => {
    const order = await client.query(
      'SELECT id,user_id,status FROM orders WHERE id=$1', [fixture.orderB],
    );
    if (order?.rows?.length !== 1 ||
        Number(order.rows[0]?.id) !== fixture.orderB ||
        Number(order.rows[0]?.user_id) !== fixture.userB ||
        order.rows[0]?.status !== 'reserved') {
      throw new Error('NP-041 owner control requires a real customer-owned reserved order.');
    }
    const existing = await client.query(
      'SELECT id,order_id,stock_id,quantity,status FROM reservations WHERE id=$1',
      [fixture.reservationId],
    );
    if (existing?.rows?.length !== 1 ||
        Number(existing.rows[0]?.id) !== fixture.reservationId ||
        Number(existing.rows[0]?.order_id) !== fixture.orderB ||
        Number(existing.rows[0]?.stock_id) !== fixture.reservationInventoryId ||
        Number(existing.rows[0]?.quantity) !== 1 ||
        existing.rows[0]?.status !== 'active') {
      throw new Error('NP-041 owner control requires a visible, real active reservation.');
    }
    let denied = false;
    let deleted;
    try {
      deleted = await client.query(
        'DELETE FROM reservations WHERE id=$1 RETURNING id', [fixture.reservationId],
      );
    } catch (error) {
      if (!isExpectedMutationDenial(error, 'reservations')) throw error;
      denied = true;
    }
    if (!denied && (!deleted || !Array.isArray(deleted.rows) ||
        deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
      throw new Error('NP-041 RLS verification failed: customer can DELETE their own active reservation.');
    }
  });

  // The other customer cannot even read the committed reservation. A
  // cross-owner DELETE must independently affect zero rows or be denied by
  // the reservations relation, not by a missing fixture or unrelated error.
  await withCustomer(pool, fixture.userA, async (client) => {
    const ownOrder = await client.query(
      'SELECT id,user_id,status FROM orders WHERE id=$1', [fixture.orderA],
    );
    if (ownOrder?.rows?.length !== 1 ||
        Number(ownOrder.rows[0]?.id) !== fixture.orderA ||
        Number(ownOrder.rows[0]?.user_id) !== fixture.userA ||
        ownOrder.rows[0]?.status !== 'reserved') {
      throw new Error('NP-041 foreign control requires a real second customer order.');
    }
    const invisible = await client.query(
      'SELECT id FROM reservations WHERE id=$1', [fixture.reservationId],
    );
    if (!Array.isArray(invisible?.rows) || invisible.rows.length !== 0) {
      throw new Error('NP-041 RLS verification failed: unrelated customer can read a foreign reservation.');
    }
    let denied = false;
    let deleted;
    try {
      deleted = await client.query(
        'DELETE FROM reservations WHERE id=$1 RETURNING id', [fixture.reservationId],
      );
    } catch (error) {
      if (!isExpectedMutationDenial(error, 'reservations')) throw error;
      denied = true;
    }
    if (!denied && (!deleted || !Array.isArray(deleted.rows) ||
        deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
      throw new Error('NP-041 RLS verification failed: customer can DELETE a foreign active reservation.');
    }
  });
}

function returnedId(result, id) {
  if (!result || !Array.isArray(result.rows)) {
    throw new Error('RLS verification received a malformed PostgreSQL result.');
  }
  return result.rows.some((row) => Number(row?.id) === id);
}

// UPDATE/DELETE can be safely blocked by either RLS filtering (zero rows) or
// ordinary PostgreSQL table/column permissions (SQLSTATE 42501). Only a
// relation/column-specific denial counts; an unrelated SQL/connection failure
// never proves tenant isolation. INSERT still has its separate WITH CHECK test.
function isExpectedMutationDenial(error, table, column) {
  if (error?.code !== '42501') return false;
  const detail = String(error?.message || '').trim().replaceAll('"', '');
  return detail.toLowerCase() === `permission denied for table ${table}` ||
    detail.toLowerCase() === `permission denied for relation ${table}` ||
    (column && detail.toLowerCase() === `permission denied for column ${column}`) ||
    detail.toLowerCase() === `new row violates row-level security policy for table ${table}`;
}

// A foreign order INSERT must be rejected by the orders WITH CHECK policy,
// not merely by an unrelated RLS failure or a missing SQL table grant. Check
// the relation as well as SQLSTATE so a broken policy cannot appear accepted.
function isExpectedInsertRlsDenial(error, table) {
  if (error?.code !== '42501') return false;
  const message = String(error?.message || '').trim().replaceAll('"', '').toLowerCase();
  return message === `new row violates row-level security policy for table ${table}`;
}

async function assertForeignMutationDenied(client, statement, params, { table, column, operation, resource }) {
  let result;
  try {
    result = await client.query(statement, params);
  } catch (error) {
    if (isExpectedMutationDenial(error, table, column)) return;
    throw error;
  }
  if (!result || !Array.isArray(result.rows) || result.rowCount !== 0 || result.rows.length !== 0) {
    throw new Error(`RLS verification failed: customer can ${operation} another customer ${resource}.`);
  }
}

export async function assertCustomerOrderRlsNegatives({ pool, fixture }) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('RLS verification requires the ordinary application-role pool.');
  }
  assertFixture(fixture);

  for (const [userId, ownOrder, otherOrder] of [
    [fixture.userA, fixture.orderA, fixture.orderB],
    [fixture.userB, fixture.orderB, fixture.orderA],
  ]) {
    await withCustomer(pool, userId, async (client) => {
      const read = await client.query('SELECT id FROM orders WHERE id = ANY($1::int[]) ORDER BY id', [[ownOrder, otherOrder]]);
      if (!returnedId(read, ownOrder) || returnedId(read, otherOrder)) {
        throw new Error('RLS verification failed: customer can read another customer order or cannot read own order.');
      }
    });

    // Authoritative order amounts are computed by the backend, never by an
    // ordinary customer SQL context. An owned-row RLS policy alone can allow
    // customers to UPDATE total_centavos if column grants are too broad.
    // This rollback-only negative probes column/table permissions explicitly.
    await withCustomer(pool, userId, async (client) => {
      let explicitlyDenied = false;
      let changed;
      try {
        changed = await client.query(
          'UPDATE orders SET total_centavos = $2 WHERE id = $1 RETURNING id',
          [ownOrder, 1],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'orders', 'total_centavos')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!changed || !Array.isArray(changed.rows) ||
          changed.rowCount !== 0 || changed.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can alter own order authoritative total_centavos.');
      }
    });

    // Lifecycle transitions are backend-owned, not customer SQL authority.
    // The fixture is reserved, and completed is a schema-valid status. Probe
    // that a customer context without order_mutation capability cannot skip
    // the order state machine, even on their own order. Never commit the write.
    await withCustomer(pool, userId, async (client) => {
      let explicitlyDenied = false;
      let changed;
      try {
        changed = await client.query(
          'UPDATE orders SET status = $2 WHERE id = $1 RETURNING id',
          [ownOrder, 'completed'],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'orders', 'status')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!changed || !Array.isArray(changed.rows) ||
          changed.rowCount !== 0 || changed.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can advance own order status directly.');
      }
    });

    // Ownership is immutable to the customer at the DB boundary. A customer
    // can read their own order but must not move it into someone else's
    // account by changing user_id. This tests orders' WITH CHECK policy and
    // never commits the attempted transfer.
    await withCustomer(pool, userId, async (client) => {
      let deniedByRls = false;
      let changed;
      try {
        changed = await client.query(
          'UPDATE orders SET user_id = $2 WHERE id = $1 RETURNING id',
          [ownOrder, userId === fixture.userA ? fixture.userB : fixture.userA],
        );
      } catch (error) {
        // Reject unrelated 42501 errors (including missing table grants):
        // only an orders-specific WITH CHECK denial proves this RLS boundary.
        if (!isExpectedInsertRlsDenial(error, 'orders')) throw error;
        deniedByRls = true;
      }
      if (!deniedByRls && (!changed || !Array.isArray(changed.rows) ||
          changed.rowCount !== 0 || changed.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can transfer own order to another customer.');
      }
    });

    // These two mutations must affect zero rows. They are always rolled back;
    // using status=status avoids making a visible state transition if a policy
    // unexpectedly permits UPDATE.
    await withCustomer(pool, userId, async (client) => {
      await assertForeignMutationDenied(client,
        'UPDATE orders SET status = status WHERE id = $1 RETURNING id', [otherOrder],
        { table: 'orders', column: 'status', operation: 'UPDATE', resource: 'order' });
    });
    await withCustomer(pool, userId, async (client) => {
      await assertForeignMutationDenied(client,
        'DELETE FROM orders WHERE id = $1 RETURNING id', [otherOrder],
        { table: 'orders', operation: 'DELETE', resource: 'order' });
    });

    // INSERT has a WITH CHECK policy. A rejection is a PASS only when the
    // database reports an explicit row-level-security violation (SQLSTATE 42501), not any
    // arbitrary SQL error, schema failure, or network error.
    await withCustomer(pool, userId, async (client) => {
      let deniedByRls = false;
      try {
        await client.query(
          `INSERT INTO orders (reference,user_id,total_centavos,status)
           VALUES ($1,$2,1000,'reserved') RETURNING id`,
          [`rls-cross-customer-${userId}-${otherOrder}`, userId === fixture.userA ? fixture.userB : fixture.userA],
        );
      } catch (error) {
        if (!isExpectedInsertRlsDenial(error, 'orders')) throw error;
        deniedByRls = true;
      }
      if (!deniedByRls) throw new Error('RLS verification failed: customer can INSERT an order for another customer.');
    });
  }

  // Packet 0 payment authority: reading one's own payment does not confer
  // permission to confirm payment or change its authoritative centavo amount.
  // Both probes use the real post-0007 schema and empty payment_mutation capability.
  for (const [userId, ownOrder, ownPayment, foreignPayment] of [
    [fixture.userA, fixture.orderA, fixture.paymentA, fixture.paymentB],
    [fixture.userB, fixture.orderB, fixture.paymentB, fixture.paymentA],
  ]) {
    await withCustomer(pool, userId, async (client) => {
      const result = await client.query(
        'SELECT id,order_id FROM payments WHERE id = ANY($1::int[]) ORDER BY id',
        [[ownPayment, foreignPayment]],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1 ||
          Number(result.rows[0]?.id) !== ownPayment ||
          Number(result.rows[0]?.order_id) !== ownOrder) {
        throw new Error('RLS verification failed: missing own payment or foreign customer payment visible.');
      }
    });
    for (const [column, value] of [['payment_status', 'confirmed'], ['amount_centavos', 1]]) {
      await withCustomer(pool, userId, async (client) => {
        let denied = false;
        let result;
        try {
          // Column names are a closed, code-owned allowlist, never user input.
          result = await client.query(
            `UPDATE payments SET ${column} = $2 WHERE id = $1 RETURNING id`,
            [ownPayment, value],
          );
        } catch (error) {
          if (!isExpectedMutationDenial(error, 'payments', column)) throw error;
          denied = true;
        }
        if (!denied && (!result || !Array.isArray(result.rows) ||
            result.rowCount !== 0 || result.rows.length !== 0)) {
          throw new Error(`RLS verification failed: customer can change own payment ${column}.`);
        }
      });
    }

    // Payment ownership must stay coupled to its original order. A customer
    // who can read a pending payment must not reassign it to another customer
    // order through direct SQL (even if the new order ID exists). This is a
    // rollback-only authorization probe using the existing application role.
    await withCustomer(pool, userId, async (client) => {
      const otherOrder = userId === fixture.userA ? fixture.orderB : fixture.orderA;
      let explicitlyDenied = false;
      let updated;
      try {
        updated = await client.query(
          'UPDATE payments SET order_id = $2 WHERE id = $1 RETURNING id',
          [ownPayment, otherOrder],
        );
      } catch (error) {
        // Only an object-scoped payments/order_id denial may count as a pass.
        // A missing FK, unrelated RLS error or failed connection does not.
        if (!isExpectedMutationDenial(error, 'payments', 'order_id')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!updated || !Array.isArray(updated.rows) ||
          updated.rowCount !== 0 || updated.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can reassign own payment to another order.');
      }
    });

    // Provider-confirmed payment creation is backend-owned. Even for a
    // customer-visible order, a customer SQL context with empty capability
    // cannot mint a one-centavo "confirmed" payment. Unlike UPDATE/DELETE,
    // this INSERT requires an explicit payments-specific WITH CHECK RLS denial;
    // missing table grants or unrelated constraint errors do not prove policy.
    await withCustomer(pool, userId, async (client) => {
      let deniedByRls = false;
      try {
        await client.query(
          `INSERT INTO payments (order_id,amount_centavos,payment_status,currency)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [ownOrder, 1, 'confirmed', 'PHP'],
        );
      } catch (error) {
        if (!isExpectedInsertRlsDenial(error, 'payments')) throw error;
        deniedByRls = true;
      }
      if (!deniedByRls) {
        throw new Error('RLS verification failed: customer can INSERT a confirmed payment outside provider verification.');
      }
    });

    // Payment history is provider/reconciliation-owned. Even an ordinary
    // customer who can read their own payment must not delete that record;
    // a mistaken DELETE grant/policy could erase evidence of money movement.
    // Keep this probe in its own rollback-only transaction. A zero-row result
    // or a payments-specific permission denial proves only this negative.
    await withCustomer(pool, userId, async (client) => {
      let explicitlyDenied = false;
      let deleted;
      try {
        deleted = await client.query('DELETE FROM payments WHERE id = $1 RETURNING id', [ownPayment]);
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'payments')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!deleted || !Array.isArray(deleted.rows) ||
          deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can DELETE own payment record.');
      }
    });
  }

  // NP-031 characterization: user records contain private identity fields,
  // so customer RLS must prevent foreign-row reads, updates and deletes. Keep this
  // alongside the same live, least-privilege app-role order verifier; do not
  // bypass its approved-target preflight. An all-deny policy is not accepted:
  // each synthetic customer must be able to see their own user id.
  for (const [ownUser, otherUser] of [
    [fixture.userA, fixture.userB],
    [fixture.userB, fixture.userA],
  ]) {
    await withCustomer(pool, ownUser, async (client) => {
      const read = await client.query('SELECT id FROM users WHERE id = ANY($1::int[]) ORDER BY id', [[ownUser, otherUser]]);
      if (!returnedId(read, ownUser) || returnedId(read, otherUser)) {
        throw new Error('RLS verification failed: customer can read another customer user or cannot read own user.');
      }
    });
    await withCustomer(pool, ownUser, async (client) => {
      // No value changes, even if a broken policy unexpectedly allows UPDATE;
      // the verifier still rolls back and treats any returned row as failure.
      await assertForeignMutationDenied(client,
        'UPDATE users SET name = name WHERE id = $1 RETURNING id', [otherUser],
        { table: 'users', column: 'name', operation: 'UPDATE', resource: 'user' });
    });
    // Only published OTC medicines appear in public catalog search. Ordinary
    // customer SQL context must never change master publication truth. Require
    // the real synthetic medicine to be visible before testing write denial,
    // so absent fixtures / an all-deny SELECT policy cannot yield false passes.
    await withCustomer(pool, ownUser, async (client) => {
      const visible = await client.query('SELECT id FROM medicines WHERE id = $1', [fixture.medicineId]);
      if (!visible || !Array.isArray(visible.rows) || visible.rows.length !== 1 ||
          Number(visible.rows[0]?.id) !== fixture.medicineId) {
        throw new Error('RLS verification failed: published synthetic medicine is not visible to customer.');
      }
    });
    await withCustomer(pool, ownUser, async (client) => {
      let explicitlyDenied = false;
      let changed;
      try {
        changed = await client.query(
          'UPDATE medicines SET publication_status = $2 WHERE id = $1 RETURNING id',
          [fixture.medicineId, 'retired'],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'medicines', 'publication_status')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!changed || !Array.isArray(changed.rows) ||
          changed.rowCount !== 0 || changed.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can change published medicine publication_status.');
      }
    });

    // Published OTC master records must also be protected against destruction
    // and forged publication, not just a status change. A successful DELETE
    // could cascade into inventory; both attempts remain rollback-only and
    // separate so a PostgreSQL 42501 cannot poison the next transaction.
    await withCustomer(pool, ownUser, async (client) => {
      let explicitlyDenied = false;
      let deleted;
      try {
        deleted = await client.query('DELETE FROM medicines WHERE id = $1 RETURNING id', [fixture.medicineId]);
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'medicines')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!deleted || !Array.isArray(deleted.rows) ||
          deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can DELETE published medicine.');
      }
    });
    await withCustomer(pool, ownUser, async (client) => {
      let deniedByRls = false;
      try {
        await client.query(
          `INSERT INTO medicines (publication_status,brand_name,generic_name)
           VALUES ($1,$2,$3) RETURNING id`,
          ['published', `RLS unauthorized ${randomUUID()}`, 'fixture'],
        );
      } catch (error) {
        // Missing table grants, unrelated RLS errors and schema failures are
        // not evidence that the medicines publication WITH CHECK rule works.
        if (!isExpectedInsertRlsDenial(error, 'medicines')) throw error;
        deniedByRls = true;
      }
      if (!deniedByRls) {
        throw new Error('RLS verification failed: customer can INSERT published medicine.');
      }
    });

    // medicine_evidence was removed by migration 0053; there is no evidence table left to forge.

    // A verified, published pharmacy is public, but the customer role must
    // never change its verification evidence or remove it. Verify that the
    // synthetic pharmacy is visible first so zero-row mutations are meaningful.
    await withCustomer(pool, ownUser, async (client) => {
      const visible = await client.query('SELECT id FROM pharmacies WHERE id = $1', [fixture.storeId]);
      if (!visible || !Array.isArray(visible.rows) || visible.rows.length !== 1 ||
          Number(visible.rows[0]?.id) !== fixture.storeId) {
        throw new Error('RLS verification failed: public synthetic pharmacy is not visible to customer.');
      }
    });
    await withCustomer(pool, ownUser, async (client) => {
      let explicitlyDenied = false;
      let updated;
      try {
        updated = await client.query(
          'UPDATE pharmacies SET verification_status = $2 WHERE id = $1 RETURNING id',
          [fixture.storeId, 'rejected'],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'pharmacies', 'verification_status')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!updated || !Array.isArray(updated.rows) ||
          updated.rowCount !== 0 || updated.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can alter verified pharmacy status.');
      }
    });
    await withCustomer(pool, ownUser, async (client) => {
      let explicitlyDenied = false;
      let deleted;
      try {
        deleted = await client.query('DELETE FROM pharmacies WHERE id = $1 RETURNING id', [fixture.storeId]);
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'pharmacies')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!deleted || !Array.isArray(deleted.rows) ||
          deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can DELETE verified pharmacy.');
      }
    });

    // Pharmacy membership grants access to tenant-private orders/inventory.
    // Even a customer who can identify a public pharmacy must never enroll
    // themself as a manager via an ordinary application-role SQL transaction.
    // The fixture contains a real approved synthetic pharmacy, so a missing FK
    // cannot masquerade as an RLS authorization denial.
    await withCustomer(pool, ownUser, async (client) => {
      let deniedByRls = false;
      try {
        await client.query(
          `INSERT INTO pharmacy_memberships (user_id,pharmacy_id,membership_role,is_active)
           VALUES ($1,$2,'manager',1) RETURNING id`,
          [ownUser, fixture.storeId],
        );
      } catch (error) {
        // Missing GRANT, duplicate rows, FK failures, or unrelated table RLS
        // are not acceptable evidence of this specific membership policy.
        if (!isExpectedInsertRlsDenial(error, 'pharmacy_memberships')) throw error;
        deniedByRls = true;
      }
      if (!deniedByRls) {
        throw new Error('RLS verification failed: customer can create their own pharmacy manager membership.');
      }
    });

    // Pharmacy verification records can confer publication legitimacy. A
    // customer who can view a verified pharmacy must not forge a new verified
    // review entry. Probe the existing fixture pharmacy and require a denial
    // explicitly from pharmacy_verifications' WITH CHECK policy.
    await withCustomer(pool, ownUser, async (client) => {
      let deniedByRls = false;
      try {
        await client.query(
          `INSERT INTO pharmacy_verifications (pharmacy_id,status,evidence_reference)
           VALUES ($1,'verified',$2) RETURNING id`,
          [fixture.storeId, 'RLS verifier synthetic evidence'],
        );
      } catch (error) {
        if (!isExpectedInsertRlsDenial(error, 'pharmacy_verifications')) throw error;
        deniedByRls = true;
      }
      if (!deniedByRls) {
        throw new Error('RLS verification failed: customer can INSERT verified pharmacy evidence.');
      }
    });

    // A customer cannot grant themself either privileged role in the actual
    // users.role CHECK constraint. Probe each separately: a 42501 aborts its
    // transaction, and each withCustomer() must roll back and verify the reset
    // on the same pooled connection before the next probe starts.
    for (const privilegedRole of ['admin', 'partner']) {
      await withCustomer(pool, ownUser, async (client) => {
        let explicitlyDenied = false;
        let updated;
        try {
          updated = await client.query(
            'UPDATE users SET role = $2 WHERE id = $1 RETURNING id',
            [ownUser, privilegedRole],
          );
        } catch (error) {
          // Do not count unrelated 42501 errors as proof of users/role denial.
          if (!isExpectedMutationDenial(error, 'users', 'role')) throw error;
          explicitlyDenied = true;
        }
        if (!explicitlyDenied && (!updated || !Array.isArray(updated.rows) ||
            updated.rowCount !== 0 || updated.rows.length !== 0)) {
          throw new Error(`RLS verification failed: customer can elevate own user role to ${privilegedRole}.`);
        }
      });
    }

    // A customer must not be able to INSERT either type of privileged user.
    // Values are synthetic and parameterized; no attempted write can commit.
    for (const privilegedRole of ['admin', 'partner']) {
      await withCustomer(pool, ownUser, async (client) => {
        let explicitlyDenied = false;
        try {
          await client.query(
            `INSERT INTO users (name,email,password,role)
             VALUES ('RLS verifier', $1, 'never-committed-fixture', $2) RETURNING id`,
            [`rls-privilege-${randomUUID()}@example.test`, privilegedRole],
          );
        } catch (error) {
          if (!isExpectedMutationDenial(error, 'users', 'role')) throw error;
          explicitlyDenied = true;
        }
        if (!explicitlyDenied) {
          throw new Error(`RLS verification failed: customer can INSERT ${privilegedRole === 'admin' ? 'an' : 'a'} ${privilegedRole} user.`);
        }
      });
    }
    await withCustomer(pool, ownUser, async (client) => {
      // A foreign-user DELETE can cascade into orders and other private data.
      // Never accept a returned row; the transaction is rolled back even when
      // a misconfigured policy unexpectedly permits the statement.
      await assertForeignMutationDenied(client,
        'DELETE FROM users WHERE id = $1 RETURNING id', [otherUser],
        { table: 'users', operation: 'DELETE', resource: 'user' });
    });
  }


  // NP-034: the per-pharmacy order status must use the same trusted order
  // state machine as orders.status. The 0004 order_drugstores_update policy is
  // owner-based; an ordinary customer SQL context must not finish an order.
  // Require exactly one visible synthetic child row before probing, to avoid
  // mistaking an absent/hidden fixture for a successful RLS denial.
  for (const [userId, ownOrder, otherOrder] of [
    [fixture.userA, fixture.orderA, fixture.orderB],
    [fixture.userB, fixture.orderB, fixture.orderA],
  ]) {
    let ownChildId;
    await withCustomer(pool, userId, async (client) => {
      const result = await client.query(
        'SELECT id,order_id FROM order_pharmacies WHERE order_id = ANY($1::int[]) ORDER BY id',
        [[ownOrder, otherOrder]],
      );
      if (!result || !Array.isArray(result.rows) || result.rows.length !== 1 ||
          !Number.isSafeInteger(Number(result.rows[0]?.id)) || Number(result.rows[0].id) <= 0 ||
          Number(result.rows[0].order_id) !== ownOrder) {
        throw new Error('RLS verification failed: missing synthetic pharmacy-order row or foreign pharmacy-order visible.');
      }
      ownChildId = Number(result.rows[0].id);
    });

    // NP-035: existing line price snapshots are backend-owned too. A missing
    // line or leaked foreign line cannot count as a safely denied UPDATE.
    const ownItem = userId === fixture.userA ? fixture.orderItemA : fixture.orderItemB;
    const foreignItem = userId === fixture.userA ? fixture.orderItemB : fixture.orderItemA;
    await withCustomer(pool, userId, async (client) => {
      const lineRead = await client.query(
        'SELECT id,order_pharmacy_id FROM order_items WHERE id = ANY($1::int[]) ORDER BY id',
        [[ownItem, foreignItem]],
      );
      if (!lineRead || !Array.isArray(lineRead.rows) || lineRead.rows.length !== 1 ||
          Number(lineRead.rows[0]?.id) !== ownItem ||
          Number(lineRead.rows[0]?.order_pharmacy_id) !== ownChildId) {
        throw new Error('RLS verification failed: missing own order-line fixture or foreign order line visible.');
      }
    });
    await withCustomer(pool, userId, async (client) => {
      let explicitlyDenied = false;
      let updated;
      try {
        updated = await client.query(
          'UPDATE order_items SET unit_price_centavos = $2 WHERE id = $1 RETURNING id',
          [ownItem, 1],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'order_items', 'unit_price_centavos')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!updated || !Array.isArray(updated.rows) ||
          updated.rowCount !== 0 || updated.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can change own order-line unit_price_centavos.');
      }
    });

    // NP-035: an existing checkout snapshot cannot be removed through a
    // customer SQL context, even if that customer can SELECT the line.
    // DELETE is always attempted in a rollback-only transaction so a broken
    // grant/policy cannot actually remove the synthetic order line.
    await withCustomer(pool, userId, async (client) => {
      let explicitlyDenied = false;
      let deleted;
      try {
        deleted = await client.query('DELETE FROM order_items WHERE id = $1 RETURNING id', [ownItem]);
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'order_items')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!deleted || !Array.isArray(deleted.rows) ||
          deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can DELETE own order-line snapshot.');
      }
    });

    // NP-035: even on a customer's own order, immutable medicine/quantity/price
    // snapshots must be created by the trusted checkout use case, not by a
    // direct SQL context with an empty order_mutation capability. The fixture
    // has a real owned child and a real synthetic medicine, so absent rows or
    // FK/constraint errors cannot create false evidence of a secure policy.
    await withCustomer(pool, userId, async (client) => {
      let explicitlyDenied = false;
      try {
        await client.query(
          `INSERT INTO order_items (order_pharmacy_id,medicine_id,quantity,unit_price_centavos)
           VALUES ($1,$2,1,1) RETURNING id`,
          [ownChildId, fixture.medicineId],
        );
      } catch (error) {
        if (!isExpectedInsertRlsDenial(error, 'order_items')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied) {
        throw new Error('RLS verification failed: customer can INSERT an order line outside checkout.');
      }
    });

    // NP-042: the owner-visible pharmacy-order child is part of the committed
    // checkout snapshot. The 0002 FOR ALL policy must not let a customer
    // directly DELETE it (and cascade its order items) outside the order use
    // case. The owned child was proven present above. Probe its *row id*, not
    // an unverified order filter; always roll back even if the DELETE succeeds.
    await withCustomer(pool, userId, async (client) => {
      let denied = false;
      let deleted;
      try {
        deleted = await client.query(
          'DELETE FROM order_pharmacies WHERE id = $1 RETURNING id', [ownChildId],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'order_pharmacies')) throw error;
        denied = true;
      }
      if (!denied && (!deleted || !Array.isArray(deleted.rows) ||
          deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
        throw new Error('NP-042 RLS verification failed: customer can DELETE own pharmacy-order child.');
      }
    });

    await withCustomer(pool, userId, async (client) => {
      let explicitlyDenied = false;
      let changed;
      try {
        changed = await client.query(
          'UPDATE order_pharmacies SET status = $2 WHERE order_id = $1 RETURNING id',
          [ownOrder, 'completed'],
        );
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'order_pharmacies', 'status')) throw error;
        explicitlyDenied = true;
      }
      if (!explicitlyDenied && (!changed || !Array.isArray(changed.rows) ||
          changed.rowCount !== 0 || changed.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can advance own pharmacy-order status directly.');
      }
    });
  }

  // Packet 0 inventory authority: the fixture stock is public/readable only
  // because its pharmacy and OTC medicine are published. An authenticated
  // customer has no inventory_mutation/order_mutation capability and must not
  // directly adjust stock or reservations. This guards checkout's backend-only
  // stock invariants without modifying business logic or production RLS.
  for (const userId of [fixture.userA, fixture.userB]) {
    await withCustomer(pool, userId, async (client) => {
      const visible = await client.query(
        'SELECT id,pharmacy_id,medicine_id FROM stock WHERE id = $1',
        [fixture.inventoryId],
      );
      if (!visible || !Array.isArray(visible.rows) || visible.rows.length !== 1 ||
          Number(visible.rows[0]?.id) !== fixture.inventoryId ||
          Number(visible.rows[0]?.pharmacy_id) !== fixture.storeId ||
          Number(visible.rows[0]?.medicine_id) !== fixture.medicineId) {
        throw new Error('RLS verification failed: public synthetic inventory fixture is absent or mismatched.');
      }
    });
    // All attempted values satisfy the reviewed 0006 schema constraints:
    // stock_on_hand=3, reserved_quantity=0, price_centavos=1000 initially.
    // A one-centavo price and an unavailable flag (0) would be schema-valid
    // but unauthorized changes to a public listing.
    // Constraint/FK failures or other-table denials cannot falsely prove RLS.
    for (const [column, value] of [['stock_on_hand', 2], ['reserved_quantity', 1], ['price_centavos', 1], ['availability', 0]]) {
      await withCustomer(pool, userId, async (client) => {
        let denied = false;
        let updated;
        try {
          // Field names are a closed code-owned allowlist, never user input.
          updated = await client.query(
            `UPDATE stock SET ${column} = $2 WHERE id = $1 RETURNING id`,
            [fixture.inventoryId, value],
          );
        } catch (error) {
          if (!isExpectedMutationDenial(error, 'stock', column)) throw error;
          denied = true;
        }
        if (!denied && (!updated || !Array.isArray(updated.rows) ||
            updated.rowCount !== 0 || updated.rows.length !== 0)) {
          throw new Error(`RLS verification failed: customer can directly alter inventory ${column}.`);
        }
      });
    }
    // A customer must not remove a public pharmacy's inventory row outright.
    // The previous read proves a real published fixture is present, preventing
    // an absent row from masquerading as authorization. The existing policy
    // and GRANTs should deny this operation; never commit the probe.
    await withCustomer(pool, userId, async (client) => {
      let denied = false;
      let deleted;
      try {
        deleted = await client.query('DELETE FROM stock WHERE id = $1 RETURNING id', [fixture.inventoryId]);
      } catch (error) {
        if (!isExpectedMutationDenial(error, 'stock')) throw error;
        denied = true;
      }
      if (!denied && (!deleted || !Array.isArray(deleted.rows) ||
          deleted.rowCount !== 0 || deleted.rows.length !== 0)) {
        throw new Error('RLS verification failed: customer can DELETE published inventory listing.');
      }
    });
  }

  // The existing 0002 audit_logs_insert policy allows customer-attributed
  // events only when user_id equals the transaction-local actor. Audit entries
  // are security/financial evidence: an ordinary customer must not attribute
  // an event to another real synthetic customer, irrespective of the action.
  // The foreign user fixture exists; FK failures and absent table grants do
  // NOT establish RLS policy correctness. Every probe is rollback-only.
  for (const [actorId, foreignUser] of [
    [fixture.userA, fixture.userB],
    [fixture.userB, fixture.userA],
  ]) {
    await withCustomer(pool, actorId, async (client) => {
      let deniedByRls = false;
      try {
        await client.query(
          `INSERT INTO audit_logs (user_id, action, description)
           VALUES ($1,$2,$3) RETURNING id`,
          [foreignUser, 'RLS_FOREIGN_ATTRIBUTION_PROBE', 'uncommitted synthetic fixture'],
        );
      } catch (error) {
        if (!isExpectedInsertRlsDenial(error, 'audit_logs')) throw error;
        deniedByRls = true;
      }
      if (!deniedByRls) {
        throw new Error('RLS verification failed: customer can forge another user audit event.');
      }
    });

    // Audit evidence must be append-only for ordinary customer contexts.
    // Insert a real, actor-attributed synthetic row INSIDE each rollback-only
    // probe: testing a guessed/absent audit ID would produce a false pass.
    // Separate UPDATE and DELETE transactions because 42501 aborts PostgreSQL
    // transactions and cannot be followed by another query until ROLLBACK.
    for (const operation of ['UPDATE', 'DELETE']) {
      await withCustomer(pool, actorId, async (client) => {
        // audit_logs SELECT is restricted to admins. An INSERT ... RETURNING id
        // can itself be denied by the SELECT policy, even when the customer's
        // own INSERT is correctly allowed. Use a transaction-unique action to
        // target the actual inserted row without requiring a SELECT grant.
        const auditAction = `RLS_AUDIT_IMMUTABILITY_${randomUUID()}`;
        const created = await client.query(
          `INSERT INTO audit_logs (user_id,action,description)
           VALUES ($1,$2,$3)`,
          [actorId, auditAction, 'uncommitted synthetic fixture'],
        );
        if (created?.rowCount !== 1) {
          throw new Error('RLS verification failed: own synthetic audit fixture was not created.');
        }
        const statement = operation === 'UPDATE'
          ? 'UPDATE audit_logs SET description = $3 WHERE user_id = $1 AND action = $2'
          : 'DELETE FROM audit_logs WHERE user_id = $1 AND action = $2';
        const params = operation === 'UPDATE' ? [actorId, auditAction, 'unauthorized alteration'] : [actorId, auditAction];
        let blocked = false;
        let result;
        try {
          result = await client.query(statement, params);
        } catch (error) {
          if (!isExpectedMutationDenial(error, 'audit_logs', operation === 'UPDATE' ? 'description' : undefined)) throw error;
          blocked = true;
        }
        if (!blocked && (!result || !Array.isArray(result.rows) ||
            result.rowCount !== 0 || result.rows.length !== 0)) {
          throw new Error(`RLS verification failed: customer can ${operation} own audit evidence.`);
        }
      });
    }
  }
}
