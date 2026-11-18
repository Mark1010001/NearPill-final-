import { assertPaymentSubscriptionRepository } from '../../ports/payment-subscription-repository.js';

export function createMysqlPaymentSubscriptionRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A MySQL query-capable pool is required.');
  }

  const repository = {
    async listSubscriptions() {
      const [rows] = await pool.query(`
        SELECT
          s.id,
          s.drugstore_id AS drugstoreId,
          d.name AS drugstoreName,
          s.tier,
          s.status,
          s.start_date AS startDate,
          s.end_date AS endDate
        FROM subscriptions s
        INNER JOIN drugstores d ON d.id = s.drugstore_id
        ORDER BY s.start_date DESC, s.id DESC
      `);
      return rows;
    },

    async findDrugstoreById(drugstoreId) {
      const [rows] = await pool.query(
        `SELECT id FROM drugstores WHERE id = ? LIMIT 1`,
        [drugstoreId],
      );
      return rows[0] ?? null;
    },

    async expireActiveSubscriptions(drugstoreId) {
      await pool.query(
        `UPDATE subscriptions SET status = 'expired' WHERE drugstore_id = ? AND status = 'active'`,
        [drugstoreId],
      );
    },

    async createSubscription({ drugstoreId, tier, status, startDate, endDate }) {
      const [result] = await pool.query(
        `
        INSERT INTO subscriptions (drugstore_id, tier, status, start_date, end_date)
        VALUES (?, ?, ?, ?, ?)
        `,
        [drugstoreId, tier, status, startDate, endDate],
      );
      return Number(result.insertId);
    },

    async findSubscriptionById(subscriptionId) {
      const [rows] = await pool.query(
        `
        SELECT id, drugstore_id, tier, status, start_date, end_date
        FROM subscriptions
        WHERE id = ?
        LIMIT 1
        `,
        [subscriptionId],
      );
      return rows[0] ?? null;
    },

    async updateSubscription(subscriptionId, { tier, status, endDate }) {
      const [result] = await pool.query(
        `UPDATE subscriptions SET tier = ?, status = ?, end_date = ? WHERE id = ?`,
        [tier, status, endDate, subscriptionId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async appendAudit(userId, action, description) {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`,
        [Number(userId), action, description],
      );
    },

    async findOrderPaymentForActor(orderId, userId) {
      const [rows] = await pool.query(
        `
        SELECT
          p.id,
          p.order_id AS orderId,
          p.amount,
          p.payment_method AS paymentMethod,
          p.payment_status AS paymentStatus,
          p.payment_reference AS paymentReference,
          p.created_at AS createdAt
        FROM payments p
        INNER JOIN orders o ON o.id = p.order_id
        WHERE p.order_id = ?
          AND (
            o.user_id = ?
            OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'admin')
          )
        ORDER BY p.id DESC
        LIMIT 1
        `,
        [orderId, userId, userId],
      );
      return rows[0] ?? null;
    },

    async findOrderById(orderId) {
      const [rows] = await pool.query(
        `SELECT id, total FROM orders WHERE id = ? LIMIT 1`,
        [orderId],
      );
      return rows[0] ?? null;
    },

    async findLatestPaymentIdByOrder(orderId) {
      const [rows] = await pool.query(
        `SELECT id FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
        [orderId],
      );
      return rows[0]?.id ? Number(rows[0].id) : null;
    },

    async updatePayment(paymentId, { amount, paymentMethod, paymentStatus, paymentReference }) {
      await pool.query(
        `
        UPDATE payments
        SET amount = ?, payment_method = ?, payment_status = ?, payment_reference = ?
        WHERE id = ?
        `,
        [amount, paymentMethod, paymentStatus, paymentReference, paymentId],
      );
    },

    async createPayment(orderId, { amount, paymentMethod, paymentStatus, paymentReference }) {
      const [result] = await pool.query(
        `
        INSERT INTO payments (order_id, amount, payment_method, payment_status, payment_reference)
        VALUES (?, ?, ?, ?, ?)
        `,
        [orderId, amount, paymentMethod, paymentStatus, paymentReference],
      );
      return Number(result.insertId);
    },

    async findLatestPaymentByOrder(orderId) {
      const [rows] = await pool.query(
        `
        SELECT
          id,
          order_id AS orderId,
          amount,
          payment_method AS paymentMethod,
          payment_status AS paymentStatus,
          payment_reference AS paymentReference,
          created_at AS createdAt
        FROM payments
        WHERE order_id = ?
        ORDER BY id DESC
        LIMIT 1
        `,
        [orderId],
      );
      return rows[0] ?? null;
    },

    async findPaymentForActor(paymentId, userId) {
      const [rows] = await pool.query(
        `
        SELECT
          p.id,
          p.order_id AS orderId,
          p.amount,
          p.payment_method AS paymentMethod,
          p.payment_status AS paymentStatus,
          p.payment_reference AS paymentReference,
          p.created_at AS createdAt,
          o.reference
        FROM payments p
        INNER JOIN orders o ON o.id = p.order_id
        WHERE p.id = ?
          AND (
            o.user_id = ?
            OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'admin')
          )
        LIMIT 1
        `,
        [paymentId, userId, userId],
      );
      return rows[0] ?? null;
    },
  };

  return assertPaymentSubscriptionRepository(repository);
}
