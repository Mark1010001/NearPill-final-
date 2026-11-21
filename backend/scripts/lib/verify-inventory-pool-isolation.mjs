/**
 * Packet 0 live inventory-contention probe, executed with the ordinary app role.
 * Never reuse a pooled client after an uncertain transaction or leaked actor
 * context. This is a verification helper, not a production reservation adapter.
 */
export async function attemptFixtureInventoryReservation({ pool, inventoryId }) {
  if (!pool || typeof pool.connect !== 'function' ||
      !Number.isSafeInteger(inventoryId) || inventoryId <= 0) {
    throw new Error('Inventory verification requires an application pool and synthetic inventory ID.');
  }

  const client = await pool.connect();
  let inTransaction = false;
  let safeToReuse = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;
    await client.query(
      `SELECT set_config('app.user_id', '', true),
              set_config('app.role', 'system', true),
              set_config('app.capability', 'order_mutation', true)`,
    );
    const updated = await client.query(
      `UPDATE stock SET reserved_quantity = reserved_quantity + 1
       WHERE id = $1 AND stock_on_hand - reserved_quantity >= 1
       RETURNING id`,
      [inventoryId],
    );
    if (!updated || !Array.isArray(updated.rows) ||
        ![0, 1].includes(updated.rowCount) || updated.rows.length !== updated.rowCount ||
        (updated.rowCount === 1 && Number(updated.rows[0]?.id) !== inventoryId)) {
      throw new Error('Inventory verification received an invalid reservation result.');
    }
    await client.query('COMMIT');
    inTransaction = false;

    // Transaction-local identity and elevated mutation capability must not
    // persist into a future tenant operation on this same physical connection.
    const context = await client.query(
      `SELECT current_setting('app.user_id', true) AS user_id,
              current_setting('app.role', true) AS role,
              current_setting('app.capability', true) AS capability`,
    );
    if (!context || !Array.isArray(context.rows) || context.rows.length !== 1 ||
        ![null, ''].includes(context.rows[0]?.user_id) ||
        ![null, '', 'anonymous'].includes(context.rows[0]?.role) ||
        ![null, ''].includes(context.rows[0]?.capability)) {
      throw new Error('Inventory verification refused: actor/capability state leaked after COMMIT.');
    }
    safeToReuse = true;
    return updated.rowCount === 1;
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch { /* discard unsafe client */ }
    }
    throw error;
  } finally {
    // If BEGIN, COMMIT, ROLLBACK, or reset inspection fails, destroy the
    // session rather than returning an uncertain client to the app-role pool.
    client.release(!safeToReuse);
  }
}
