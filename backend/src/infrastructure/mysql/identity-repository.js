import { assertIdentityRepository } from '../../ports/identity-repository.js';

const profileColumns = `
  id,
  name,
  email,
  phone,
  birthdate,
  role,
  created_at
`;

export function createMysqlIdentityRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A MySQL query-capable pool is required.');
  }

  const repository = {
    async findIdByEmail(email) {
      const [rows] = await pool.query(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [email],
      );
      return rows[0] ?? null;
    },

    async findAuthUserByEmail(email) {
      const [rows] = await pool.query(
        `SELECT * FROM users WHERE email = ? LIMIT 1`,
        [email],
      );
      return rows[0] ?? null;
    },

    async createCustomer({ name, email, passwordHash }) {
      const [result] = await pool.query(
        `
        INSERT INTO users
          (name, email, password, role)
        VALUES
          (?, ?, ?, 'customer')
        `,
        [name, email, passwordHash],
      );
      return Number(result.insertId);
    },

    async replacePasswordIfCurrent({ userId, newPasswordHash, currentPasswordHash }) {
      const [result] = await pool.query(
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
      const [rows] = await pool.query(
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

    async scrubPrescriptionPhotos() {},

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
