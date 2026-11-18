import { createHash } from 'node:crypto';

/**
 * Execute one of NearPill's existing reviewed SQL migrations on the checked-out
 * migrator connection. The journal read and DDL must share a transaction-scoped
 * lock so two authorized migration jobs cannot race on the same history entry.
 *
 * This is the sole SQL migration executor, not a second migration history.
 * The caller validates its target/connected role before invoking this helper.
 */
const MIGRATION_LOCK_KEYS = Object.freeze([1313886796, 1296646725]);

export async function executeReviewedMigration(client, { filename, sql, sha256, reviewedMigrations }) {
  if (!client || typeof client.query !== 'function' ||
      !/^\d{4}_[a-z0-9_]+\.sql$/.test(filename) ||
      typeof sql !== 'string' || !sql.trim() ||
      typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256) ||
      // A correct-looking manifest checksum must actually bind to the SQL
      // about to execute, including in the already-applied skip path.
      createHash('sha256').update(sql).digest('hex') !== sha256 ||
      !Array.isArray(reviewedMigrations) || reviewedMigrations.length === 0 ||
      reviewedMigrations.some((entry, index) =>
        !entry || !/^\d{4}_[a-z0-9_]+\.sql$/.test(entry.filename) ||
        Number(entry.filename.slice(0, 4)) !== index + 1 ||
        !/^[0-9a-f]{64}$/.test(entry.sha256)) ||
      !reviewedMigrations.some((entry) => entry.filename === filename && entry.sha256 === sha256)) {
    throw new Error('Migration refused: invalid reviewed SQL migration input.');
  }

  let inTransaction = false;
  try {
    await client.query('BEGIN');
    inTransaction = true;

    // Fail closed rather than waiting indefinitely behind a stalled migrator
    // or another DDL lock. SET LOCAL affects only this transaction, never a
    // reused pooled connection or another worker. PostgreSQL SQLSTATE 55P03
    // from a lock timeout propagates after the rollback below.
    await client.query("SET LOCAL lock_timeout = '30s'");

    // Lock *before* checking or creating the journal. PostgreSQL releases this
    // lock on COMMIT/ROLLBACK, including when a statement throws. Both runners
    // must use this same canonical executor and migration database.
    await client.query('SELECT pg_advisory_xact_lock($1::integer, $2::integer)', MIGRATION_LOCK_KEYS);
    await client.query(`
      CREATE TABLE IF NOT EXISTS nearpill_schema_migrations (
        filename TEXT PRIMARY KEY,
        sha256 CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Reject schema drift *before* applying any migration: a restored or
    // downgraded database may contain an unknown migration, a gap, or a
    // checksum mismatch in a file later than the one currently being run.
    // The applied journal must be a strict prefix of the reviewed source
    // batch. Do this under the same lock as DDL so cooperating runners see
    // one serialized history.
    const journal = await client.query(
      'SELECT filename, sha256 FROM nearpill_schema_migrations ORDER BY filename',
    );
    if (!Array.isArray(journal?.rows) || journal.rows.length > reviewedMigrations.length) {
      throw new Error('Migration refused: unexpected migration journal result.');
    }
    for (let index = 0; index < journal.rows.length; index++) {
      const actual = journal.rows[index];
      const reviewed = reviewedMigrations[index];
      if (actual?.filename !== reviewed.filename || actual.sha256 !== reviewed.sha256) {
        throw new Error('Migration refused: migration journal drift, missing predecessor or checksum mismatch.');
      }
    }
    const currentIndex = reviewedMigrations.findIndex((entry) => entry.filename === filename);
    if (currentIndex < journal.rows.length) {
      await client.query('COMMIT');
      inTransaction = false;
      return 'skipped';
    }
    if (currentIndex !== journal.rows.length) {
      throw new Error('Migration refused: an earlier reviewed migration has not been applied.');
    }

    await client.query(sql);
    await client.query(
      'INSERT INTO nearpill_schema_migrations (filename, sha256) VALUES ($1, $2)',
      [filename, sha256],
    );
    await client.query('COMMIT');
    inTransaction = false;
    return 'applied';
  } catch (error) {
    if (inTransaction) {
      try { await client.query('ROLLBACK'); } catch { /* preserve the original failure */ }
    }
    throw error;
  }
}
