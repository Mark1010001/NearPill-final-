/**
 * Packet 0 only: remove ONLY recorded synthetic RLS-verifier records.
 * Attempt every independent cleanup step even when a deletion fails. This
 * must run after the fixture writer has committed or rolled back, using a
 * separate migration-role pool client (never a possibly aborted session).
 */
export async function cleanupSyntheticRlsVerifierFixtures({ migratorPool, fixture, fixtureCommitted }) {
  if (typeof migratorPool?.query !== 'function') {
    throw new Error('RLS fixture cleanup requires a migration-role query adapter.');
  }
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) {
    throw new Error('RLS fixture cleanup requires recorded synthetic IDs.');
  }
  if (typeof fixtureCommitted !== 'boolean') {
    throw new Error('RLS fixture cleanup requires an explicit boolean commit state.');
  }
  const keys = ['userA', 'userB', 'userPartner', 'userAdmin', 'partnerMembershipId', 'orderA', 'orderB', 'inventoryId', 'otherInventoryId', 'medicineId', 'priceProbeMedicineId', 'reservationId', 'reservationInventoryId', 'reservationMedicineId', 'reservationMovementId', 'storeId', 'otherStoreId'];
  // Validate everything before issuing any DELETE; never coerce an ID from a
  // string or use client-provided IDs.
  for (const key of keys) {
    const value = fixture[key];
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`RLS fixture cleanup received an invalid synthetic ${key}.`);
    }
  }
  const steps = [
    ['orders', 'DELETE FROM orders WHERE id = ANY($1::int[])', [fixture.orderA, fixture.orderB].filter((id) => id !== undefined)],
    ['inventory', 'DELETE FROM stock WHERE id=$1', fixture.inventoryId],
    ['other_inventory', 'DELETE FROM stock WHERE id=$1', fixture.otherInventoryId],
    // Order deletion cascades the reservation; inventory deletion cascades the
    // matching stock movement. Explicit inventory removal is still checked.
    ['reservation_inventory', 'DELETE FROM stock WHERE id=$1', fixture.reservationInventoryId],
    ['pharmacy_memberships', 'DELETE FROM pharmacy_memberships WHERE id=$1', fixture.partnerMembershipId],
    ['medicines', 'DELETE FROM medicines WHERE id=$1', fixture.medicineId],
    ['price_probe_medicine', 'DELETE FROM medicines WHERE id=$1', fixture.priceProbeMedicineId],
    ['reservation_medicine', 'DELETE FROM medicines WHERE id=$1', fixture.reservationMedicineId],
    ['drugstores', 'DELETE FROM pharmacies WHERE id=$1', fixture.storeId],
    ['other_drugstore', 'DELETE FROM pharmacies WHERE id=$1', fixture.otherStoreId],
    ['users', 'DELETE FROM users WHERE id = ANY($1::int[])', [fixture.userA, fixture.userB, fixture.userPartner, fixture.userAdmin].filter((id) => id !== undefined)],
  ];
  const failures = [];
  for (const [name, sql, id] of steps) {
    if (Array.isArray(id) ? id.length === 0 : id === undefined) continue;
    try {
      const result = await migratorPool.query(sql, [id]);
      const expected = Array.isArray(id) ? id.length : 1;
      const affected = result?.rowCount;
      // An uncommitted fixture may have been rolled back, so zero rows is
      // legitimate. Once COMMIT has completed, every recorded ID MUST be
      // removed by the migration-role connection; a silent RLS-filtered DELETE
      // is not evidence of cleanup. Malformed row counts always fail closed.
      if (!Number.isSafeInteger(affected) || affected < 0 || affected > expected ||
          (fixtureCommitted && affected !== expected)) {
        throw new Error(`RLS fixture cleanup ${name}: expected ${fixtureCommitted ? expected : `0..${expected}`} deleted rows, received ${String(affected)}.`);
      }
    } catch (error) {
      failures.push(new Error(`Could not clean synthetic RLS ${name} fixture`, { cause: error }));
    }
  }
  if (failures.length) {
    throw new AggregateError(failures, 'RLS verifier synthetic fixture cleanup incomplete.');
  }
}
