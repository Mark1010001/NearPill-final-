import { createPostgresCompatPool } from './compat-pool.js';

// Reads what the partnership reminder job needs and hides a pharmacy whose partnership has expired.
// Reminders are remembered in audit_logs (action PARTNERSHIP_REMINDER_SENT), so no new table is needed.
export function createPostgresPartnershipRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool);
  if (!pool || typeof pool.query !== 'function') throw new TypeError('A PostgreSQL query-capable pool is required.');
  return {
    async listPartnerPharmacies() {
      const [rows] = await pool.query(`
        SELECT ds.id, ds.name, ds.created_at AS "createdAt",
               ds.public_profile_published_at AS "publishedAt", sub.tier
        FROM pharmacies ds
        LEFT JOIN LATERAL (
          SELECT tier FROM subscriptions
          WHERE pharmacy_id = ds.id AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
        ) sub ON TRUE
        WHERE ds.is_active = 1 AND ds.verification_status = 'verified'`);
      return rows.map((row) => ({ id: Number(row.id), name: row.name, createdAt: row.createdAt, publishedAt: row.publishedAt ?? null, tier: row.tier ?? null }));
    },
    async reminderSent(key) {
      const [rows] = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'PARTNERSHIP_REMINDER_SENT' AND description = ? LIMIT 1`, [key]);
      return rows.length > 0;
    },
    async recordReminder(key) {
      await pool.query(`INSERT INTO audit_logs (user_id, action, description) VALUES (NULL, 'PARTNERSHIP_REMINDER_SENT', ?)`, [key]);
    },
    async hideExpired(drugstoreId, expiry) {
      const [result] = await pool.query(`UPDATE pharmacies SET public_profile_published_at = NULL WHERE id = ? AND public_profile_published_at IS NOT NULL`, [drugstoreId]);
      if (Number(result?.affectedRows ?? 0) === 0) return false;
      await pool.query(`INSERT INTO audit_logs (user_id, action, description) VALUES (NULL, 'PARTNERSHIP_EXPIRED_HIDDEN', ?)`, [`Hid drugstore ${drugstoreId}: partnership expired on ${expiry}.`]);
      return true;
    },
  };
}
