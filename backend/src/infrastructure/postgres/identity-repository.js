import { assertIdentityRepository } from '../../ports/identity-repository.js';
import { createPostgresCompatPool } from './compat-pool.js';

const profileColumns = `
  id,
  name,
  email,
  phone,
  birthdate,
  role,
  created_at
`;

export function createPostgresIdentityRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool);
  const scopedPool = (capability) => createPostgresCompatPool(postgresPool, { capability });
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL query-capable pool is required.');
  }

  const repository = {
    async findIdByEmail(email) {
      const [rows] = await scopedPool(`identity_lookup:${email.toLowerCase()}`).query(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [email],
      );
      return rows[0] ?? null;
    },

    async findAuthUserByEmail(email) {
      const [rows] = await scopedPool(`identity_lookup:${email.toLowerCase()}`).query(
        `SELECT * FROM users WHERE email = ? LIMIT 1`,
        [email],
      );
      return rows[0] ?? null;
    },

    async createCustomer({ name, email, passwordHash, termsVersion = null }) {
      const pool = scopedPool(`identity_register:${email.toLowerCase()}`);
      let result;
      if (termsVersion) {
        try {
          [result] = await pool.query(
            `INSERT INTO users (name, email, password, role, terms_accepted_at, terms_version)
             VALUES (?, ?, ?, 'customer', CURRENT_TIMESTAMP, ?)`,
            [name, email, passwordHash, termsVersion],
          );
        } catch (error) {
          // Migration 0038 not applied yet: create the account without the terms record.
          if (error?.code !== '42703' && error?.code !== '42501') throw error;
          console.error('terms_record_unavailable', { code: error.code });
        }
      }
      if (!result) {
        [result] = await pool.query(
          `INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, 'customer')`,
          [name, email, passwordHash],
        );
      }
      return Number(result.insertId);
    },

    async replacePasswordIfCurrent({ userId, newPasswordHash, currentPasswordHash }) {
      const [result] = await scopedPool(`identity_password:${userId}`).query(
        `UPDATE users SET password = ? WHERE id = ? AND CAST(password AS BINARY) = CAST(? AS BINARY)`,
        [newPasswordHash, userId, currentPasswordHash],
      );
      return Number(result.affectedRows ?? 0);
    },

    async replacePassword(userId, passwordHash) {
      const [result] = await pool.query(
        `UPDATE users SET password = ? WHERE id = ?`,
        [passwordHash, userId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async findRecoveryAccountByEmail(email) {
      const [rows] = await scopedPool(`identity_lookup:${email.toLowerCase()}`).query(
        `SELECT id, email FROM users WHERE email = ? LIMIT 1`,
        [email],
      );
      return rows[0] ?? null;
    },

    async findProfileById(userId) {
      const [rows] = await pool.query(
        `SELECT ${profileColumns} FROM users WHERE id = ? LIMIT 1`,
        [userId],
      );
      return rows[0] ?? null;
    },

    async findAuthorizationUserById(userId) {
      const [rows] = await pool.query(
        `SELECT id, name, email, role FROM users WHERE id = ? LIMIT 1`,
        [userId],
      );
      return rows[0] ?? null;
    },

    async countOpenOrders(userId) {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS count FROM orders WHERE user_id = ? AND status NOT IN ('cancelled','expired','completed')`,
        [userId],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async scrubPrescriptionPhotos(userId) {
      await scopedPool('account_delete').query(
        `UPDATE nearpill.prescription_reviews
           SET status = 'expired', photo = NULL, mime_type = NULL, customer_name = NULL
         WHERE customer_id = ?`,
        [userId],
      );
    },

    async anonymizeCustomer(userId, { name, email, passwordHash }) {
      const [result] = await pool.query(
        `UPDATE users SET name = ?, email = ?, phone = NULL, birthdate = NULL, password = ?
         WHERE id = ? AND role = 'customer'`,
        [name, email, passwordHash, userId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async updateProfile(userId, { phone, birthDate }) {
      await pool.query(
        `UPDATE users SET phone = ?, birthdate = ? WHERE id = ?`,
        [phone, birthDate, userId],
      );
      return this.findProfileById(userId);
    },
  };

  return assertIdentityRepository(repository);
}
