import { assertApprovedFixtureTarget } from './lib/verify-fixture-target.mjs';
import { assertSafeLiveFixtureConnections } from './lib/verify-live-fixture-connection.mjs';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { assertCustomerOrderRlsNegatives, assertPartnerInventoryPriceDenied, assertPartnerCrossPharmacyInventoryDenied, assertPartnerInventoryInsertDenied, assertPartnerReservedQuantityDenied, assertPartnerReservationDeleteDenied, assertCustomerReservationDeleteDenied } from './lib/verify-order-tenant-isolation.mjs';
import { settleFixtureAttempts } from './lib/verify-concurrent-attempts.mjs';
import { attemptFixtureInventoryReservation } from './lib/verify-inventory-pool-isolation.mjs';
import { cleanupSyntheticRlsVerifierFixtures } from './lib/cleanup-rls-fixtures.mjs';

// Stop before any database connection or fixture write without an explicit test target.
assertApprovedFixtureTarget(process.env);

const { Pool } = pg;
const appPool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'nearpill_app',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nearpill',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});
const migratorPool = new Pool({
  host: process.env.MIGRATOR_DB_HOST || process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.MIGRATOR_DB_PORT || process.env.DB_PORT || 5432),
  user: process.env.MIGRATOR_DB_USER || 'nearpill_migrator',
  password: process.env.MIGRATOR_DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nearpill',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});

const stamp = `${Date.now()}-${process.pid}`;
const fixture = {};
let migrationClient;
let transactionOpen = false;
let fixtureCommitted = false;
let verificationError;
const teardownErrors = [];
try {
  // Run the approved-target and read-only privilege/RLS/TLS preflight before
  // opening a migration-role fixture transaction or inserting any rows.
  await assertSafeLiveFixtureConnections({ appPool, migratorPool, env: process.env });
  migrationClient = await migratorPool.connect();
  // Mark the transaction uncertain before BEGIN: even a failed BEGIN must be
  // rolled back (or the client destroyed) before it can be reused.
  transactionOpen = true;
  await migrationClient.query('BEGIN');
  const users = await migrationClient.query(
    `INSERT INTO users (name,email,password,role) VALUES
       ('RLS A',$1,'fixture','customer'),
       ('RLS B',$2,'fixture','customer')
     RETURNING id`,
    [`rls-a-${stamp}@example.test`, `rls-b-${stamp}@example.test`],
  );
  [fixture.userA, fixture.userB] = users.rows.map((row) => Number(row.id));
  // A real synthetic partner (not a spoofed customer role) is required to
  // characterize the membership-based price-column permission gap.
  // Never give a transient privileged fixture a predictable login secret.
  // Deliberately store a high-entropy NON-Argon2 placeholder, so the normal
  // backend password verifier cannot authenticate it even if teardown fails.
  fixture.userAdmin = Number((await migrationClient.query(
    `INSERT INTO users (name,email,password,role) VALUES
     ('RLS Admin',$1,$2,'admin') RETURNING id`,
    [`rls-admin-${stamp}@example.test`, `!disabled-${randomBytes(32).toString('hex')}`],
  )).rows[0].id);
  fixture.userPartner = Number((await migrationClient.query(
    `INSERT INTO users (name,email,password,role) VALUES
     ('RLS Partner',$1,'fixture','partner') RETURNING id`,
    [`rls-partner-${stamp}@example.test`],
  )).rows[0].id);
  fixture.storeId = Number((await migrationClient.query(
    `INSERT INTO drugstores (name,address,latitude,longitude,is_active,verification_status,verified_at,public_profile_published_at)
     VALUES ($1,'fixture',10.3157,123.8854,1,'verified',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id`,
    [`RLS Store ${stamp}`],
  )).rows[0].id);
  fixture.partnerMembershipId = Number((await migrationClient.query(
    `INSERT INTO pharmacy_memberships (user_id,drugstore_id,membership_role,is_active)
     VALUES ($1,$2,'manager',1) RETURNING id`,
    [fixture.userPartner, fixture.storeId],
  )).rows[0].id);
  fixture.medicineId = Number((await migrationClient.query(
    `INSERT INTO medicines (brand_name,generic_name,publication_status,published_at,otc_eligible,otc_review_reference,otc_reviewed_at) VALUES ($1,'fixture','published',CURRENT_TIMESTAMP,true,'synthetic verifier fixture',CURRENT_TIMESTAMP) RETURNING id`,
    [`RLS Medicine ${stamp}`],
  )).rows[0].id);
  // Separate published OTC medicine with NO inventory listing: a partner
  // INSERT negative must not be satisfied by an existing unique key conflict.
  fixture.priceProbeMedicineId = Number((await migrationClient.query(
    `INSERT INTO medicines (brand_name,generic_name,publication_status,published_at,otc_eligible,otc_review_reference,otc_reviewed_at)
     VALUES ($1,'fixture','published',CURRENT_TIMESTAMP,true,'synthetic verifier fixture',CURRENT_TIMESTAMP) RETURNING id`,
    [`RLS Insert Medicine ${stamp}`],
  )).rows[0].id);
  fixture.inventoryId = Number((await migrationClient.query(
    `INSERT INTO inventory (drugstore_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
     VALUES ($1,$2,1000,3,0,1) RETURNING id`,
    [fixture.storeId, fixture.medicineId],
  )).rows[0].id);
  // A second published pharmacy with the SAME OTC medicine provides a real
  // cross-tenant inventory row. The partner has membership only in storeId.
  fixture.otherStoreId = Number((await migrationClient.query(
    `INSERT INTO drugstores (name,address,latitude,longitude,is_active,verification_status,verified_at,public_profile_published_at)
     VALUES ($1,'fixture',10.3157,123.8854,1,'verified',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id`,
    [`RLS Other Store ${stamp}`],
  )).rows[0].id);
  fixture.otherInventoryId = Number((await migrationClient.query(
    `INSERT INTO inventory (drugstore_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
     VALUES ($1,$2,1000,3,0,1) RETURNING id`,
    [fixture.otherStoreId, fixture.medicineId],
  )).rows[0].id);
  fixture.orderA = Number((await migrationClient.query(
    `INSERT INTO orders (reference,user_id,total_centavos,status) VALUES ($1,$2,1000,'reserved') RETURNING id`,
    [`RLS-A-${stamp}`, fixture.userA],
  )).rows[0].id);
  fixture.orderB = Number((await migrationClient.query(
    `INSERT INTO orders (reference,user_id,total_centavos,status) VALUES ($1,$2,1000,'reserved') RETURNING id`,
    [`RLS-B-${stamp}`, fixture.userB],
  )).rows[0].id);
  // NP-040: isolate a real active reservation from the three-stock contention
  // fixture. Match the 1 reserved unit with a movement entry. The new fixture
  // inventory and medicine belong to the same real synthetic pharmacy and
  // are never used by price/INSERT/100-way contention tests.
  fixture.reservationMedicineId = Number((await migrationClient.query(
    `INSERT INTO medicines (brand_name,generic_name,publication_status,published_at,otc_eligible,otc_review_reference,otc_reviewed_at)
     VALUES ($1,'fixture','published',CURRENT_TIMESTAMP,true,'synthetic verifier fixture',CURRENT_TIMESTAMP) RETURNING id`,
    [`RLS Reservation Medicine ${stamp}`],
  )).rows[0].id);
  fixture.reservationInventoryId = Number((await migrationClient.query(
    `INSERT INTO inventory (drugstore_id,medicine_id,price_centavos,stock_on_hand,reserved_quantity,availability)
     VALUES ($1,$2,1000,3,1,1) RETURNING id`,
    [fixture.storeId, fixture.reservationMedicineId],
  )).rows[0].id);
  fixture.reservationId = Number((await migrationClient.query(
    `INSERT INTO reservations (order_id,inventory_id,quantity,status)
     VALUES ($1,$2,1,'active') RETURNING id`,
    [fixture.orderB, fixture.reservationInventoryId],
  )).rows[0].id);
  fixture.reservationMovementId = Number((await migrationClient.query(
    `INSERT INTO stock_movements (inventory_id,order_id,actor_id,movement_type,reserved_delta,stock_on_hand_delta,reason)
     VALUES ($1,$2,$3,'reserve',1,0,'NP-040 synthetic characterization') RETURNING id`,
    [fixture.reservationInventoryId, fixture.orderB, fixture.userB],
  )).rows[0].id);
  // Real pending payments allow non-vacuous customer SELECT and mutation
  // negatives under the actual least-privilege application role. Deleting the
  // parent synthetic orders cascades these rows during checked cleanup.
  const payments = await migrationClient.query(
    `INSERT INTO payments (order_id,amount_centavos,payment_status,currency)
     VALUES ($1,1000,'pending','PHP'),($2,1000,'pending','PHP') RETURNING id,order_id`,
    [fixture.orderA, fixture.orderB],
  );
  if (!Array.isArray(payments?.rows) || payments.rows.length !== 2) {
    throw new Error('RLS fixture setup did not create both pending payment rows.');
  }
  const paymentFor = (orderId) => {
    const matches = payments.rows.filter((row) => Number(row.order_id) === orderId);
    if (matches.length !== 1 || !Number.isSafeInteger(Number(matches[0].id)) || Number(matches[0].id) <= 0) {
      throw new Error('RLS fixture setup returned ambiguous payment ownership.');
    }
    return Number(matches[0].id);
  };
  fixture.paymentA = paymentFor(fixture.orderA);
  fixture.paymentB = paymentFor(fixture.orderB);
  // Both synthetic orders need a real pharmacy-order child row; the RLS
  // verifier refuses vacuous results when a child-order fixture is absent.
  const children = await migrationClient.query(
    `INSERT INTO order_drugstores (order_id,drugstore_id,status)
     VALUES ($1,$3,'reserved'),($2,$3,'reserved') RETURNING id,order_id`,
    [fixture.orderA, fixture.orderB, fixture.storeId],
  );
  if (!Array.isArray(children?.rows) || children.rows.length !== 2) {
    throw new Error('RLS fixture setup did not create both pharmacy-order rows.');
  }
  const childFor = (orderId) => {
    const child = children.rows.filter((row) => Number(row.order_id) === orderId);
    if (child.length !== 1 || !Number.isSafeInteger(Number(child[0].id))) {
      throw new Error('RLS fixture setup returned ambiguous pharmacy-order ownership.');
    }
    return Number(child[0].id);
  };
  const lines = await migrationClient.query(
    `INSERT INTO order_items (order_drugstore_id,medicine_id,quantity,unit_price_centavos)
     VALUES ($1,$3,1,1000),($2,$4,1,1000) RETURNING id,order_drugstore_id`,
    [childFor(fixture.orderA), childFor(fixture.orderB), fixture.medicineId, fixture.reservationMedicineId],
  );
  if (!Array.isArray(lines?.rows) || lines.rows.length !== 2) {
    throw new Error('RLS fixture setup did not create both order-line snapshots.');
  }
  const lineFor = (childId) => {
    const line = lines.rows.filter((row) => Number(row.order_drugstore_id) === childId);
    if (line.length !== 1 || !Number.isSafeInteger(Number(line[0].id)) || Number(line[0].id) <= 0) {
      throw new Error('RLS fixture setup returned ambiguous order-line ownership.');
    }
    return Number(line[0].id);
  };
  fixture.orderItemA = lineFor(childFor(fixture.orderA));
  fixture.orderItemB = lineFor(childFor(fixture.orderB));
  await migrationClient.query('COMMIT');
  transactionOpen = false;
  fixtureCommitted = true;

  await assertCustomerOrderRlsNegatives({ pool: appPool, fixture });
  // Price authority must be tested at the DB boundary under a legitimate
  // pharmacy-member context, not inferred from the HTTP admin-only route.
  // The policy may currently permit this write (NP-036): if so this verifier
  // must fail rather than mark Supabase RLS secure.
  await assertPartnerInventoryPriceDenied({ pool: appPool, fixture });
  await assertPartnerCrossPharmacyInventoryDenied({ pool: appPool, fixture });
  await assertPartnerInventoryInsertDenied({ pool: appPool, fixture });
  await assertPartnerReservedQuantityDenied({ pool: appPool, fixture });
  await assertPartnerReservationDeleteDenied({ pool: appPool, fixture });
  // NP-041: order ownership permits reading, never direct reservation deletion.
  // Reuses NP-040's consistent synthetic reservation, no new fixture/data path.
  await assertCustomerReservationDeleteDenied({ pool: appPool, fixture });


  const attempts = await settleFixtureAttempts(100, () =>
    attemptFixtureInventoryReservation({ pool: appPool, inventoryId: fixture.inventoryId }),
  'Inventory contention');
  const successes = attempts.filter(Boolean).length;
  if (successes !== 3) throw new Error(`Expected exactly 3 successful reservations, received ${successes}.`);
  const finalInventory = (await migrationClient.query('SELECT stock_on_hand,reserved_quantity FROM inventory WHERE id=$1', [fixture.inventoryId])).rows[0];
  if (Number(finalInventory.stock_on_hand) !== 3 || Number(finalInventory.reserved_quantity) !== 3) {
    throw new Error(`Inventory invariant failed after contention: ${JSON.stringify(finalInventory)}`);
  }

 } catch (error) {
  verificationError = error;
} finally {
  // Always settle the original transaction before issuing any DELETEs using
  // a separate migration-role pool connection. A failed rollback makes the
  // original session unsafe for reuse, so discard it.
  if (migrationClient) {
    let discard = false;
    if (transactionOpen) {
      try {
        await migrationClient.query('ROLLBACK');
      } catch (error) {
        discard = true;
        teardownErrors.push(new Error('Could not roll back RLS verifier transaction', { cause: error }));
      }
    }
    try {
      migrationClient.release(discard);
    } catch (error) {
      teardownErrors.push(new Error('Could not release RLS verifier connection', { cause: error }));
    }
  }
  try {
    await cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture, fixtureCommitted });
  } catch (error) {
    teardownErrors.push(error);
  }
  const poolClosures = await Promise.allSettled([appPool.end(), migratorPool.end()]);
  for (const result of poolClosures) {
    if (result.status === 'rejected') teardownErrors.push(result.reason);
  }
}
if (teardownErrors.length) {
  throw new AggregateError(
    [...(verificationError ? [verificationError] : []), ...teardownErrors],
    'RLS verification or synthetic fixture cleanup failed; results are not accepted.',
  );
}
if (verificationError) throw verificationError;

// Do not print PASS until all fixture removals and both pool closures finish.
console.log('PASS cross-customer order RLS');
console.log('PASS partner price/insert/delete/reserved-quantity/reservation DELETE denial, admin parity and cross-pharmacy isolation (rollback-only)');
console.log('PASS 100-way inventory contention: 3/100 reserved, stock_on_hand=3, reserved_quantity=3');
