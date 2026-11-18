/**
 * Create a disposable identity for token rotation/replay verification.
 * Never run these destructive assertions against an existing NearPill account.
 * Call only after fixture target and live app/migrator role preflights succeed.
 */
export async function withIsolatedRefreshProbeUser({ pool, marker, verify }) {
  if (!pool || typeof pool.query !== 'function' || typeof verify !== 'function') {
    throw new TypeError('An approved migrator pool and verification callback are required.');
  }
  if (typeof marker !== 'string' || !/^[a-z0-9-]{1,72}$/i.test(marker)) {
    throw new Error('Refresh probe marker must be a short safe unique identifier.');
  }

  const email = `${marker}-refresh@example.invalid`;
  // INSERT cannot reuse an account: email is unique, and an existing fixture collision fails.
  const inserted = await pool.query(
    'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id',
    ['Packet 0 Refresh Probe', email, 'fixture-no-login', 'customer'],
  );
  const id = Number(inserted.rows?.[0]?.id);
  try {
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error('Fixture INSERT did not return a valid synthetic user id.');
    }
    return await verify(id);
  } finally {
    // The synthetic address is unique. Cascading FK cleanup also removes probe sessions.
    // Do not silently mask an orphaned fixture as a successful verification.
    const deletion = await pool.query('DELETE FROM users WHERE id = $1 AND email = $2', [id, email]);
    if (deletion.rowCount !== 1) {
      throw new Error('Synthetic identity fixture cleanup failed; manual test-database reconciliation required.');
    }
  }
}
