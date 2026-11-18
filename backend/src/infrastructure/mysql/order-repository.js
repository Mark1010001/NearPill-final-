import { assertOrderRepository } from '../../ports/order-repository.js';

function transactionAdapter(connection) {
  return {
    async findCustomerById(userId) {
      const [rows] = await connection.query(
        `SELECT id, name, email FROM users WHERE id = ? LIMIT 1`,
        [userId],
      );
      return rows[0] ?? null;
    },

    async findInventoryForUpdate(drugstoreId, medicineId) {
      const [rows] = await connection.query(
        `
        SELECT
          i.id AS inventoryId,
          i.drugstore_id AS drugstoreId,
          i.medicine_id AS medicineId,
          i.price AS price,
          i.stock_count AS stockCount,
          i.availability AS availability,
          m.brand_name AS medicineName,
          m.rx_required AS rxRequired,
          ds.name AS drugstoreName
        FROM inventory i
        JOIN medicines m ON m.id = i.medicine_id
        JOIN drugstores ds ON ds.id = i.drugstore_id
        WHERE i.drugstore_id = ? AND i.medicine_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [drugstoreId, medicineId],
      );
      return rows[0] ?? null;
    },

    async createOrder({ reference, userId, total, expiresAt }) {
      const [result] = await connection.query(
        `
        INSERT INTO orders (reference, user_id, total, status, expires_at)
        VALUES (?, ?, ?, 'pending', ?)
        `,
        [reference, userId, total, expiresAt],
      );
      return Number(result.insertId);
    },

    async findStoreById(drugstoreId) {
      const [rows] = await connection.query(
        `SELECT id, name, is_active FROM drugstores WHERE id = ? LIMIT 1`,
        [drugstoreId],
      );
      return rows[0] ?? null;
    },

    async createOrderDrugstore(orderId, drugstoreId) {
      const [result] = await connection.query(
        `
        INSERT INTO order_drugstores (order_id, drugstore_id, status)
        VALUES (?, ?, 'pending')
        `,
        [orderId, drugstoreId],
      );
      return Number(result.insertId);
    },

    async createOrderItem({ orderDrugstoreId, medicineId, quantity, price }) {
      await connection.query(
        `
        INSERT INTO order_items (order_drugstore_id, medicine_id, quantity, price)
        VALUES (?, ?, ?, ?)
        `,
        [orderDrugstoreId, medicineId, quantity, price],
      );
    },

    async reserveInventory(drugstoreId, medicineId, quantity) {
      const [result] = await connection.query(
        `
        UPDATE inventory
        SET stock_count = stock_count - ?
        WHERE drugstore_id = ? AND medicine_id = ? AND stock_count >= ?
        `,
        [quantity, drugstoreId, medicineId, quantity],
      );
      return Number(result.affectedRows ?? 0);
    },

    async createPendingPayment(orderId, amount) {
      await connection.query(
        `
        INSERT INTO payments (order_id, amount, payment_method, payment_status)
        VALUES (?, ?, 'GCash', 'pending')
        `,
        [orderId, amount],
      );
    },

    async appendAudit(userId, action, description) {
      await connection.query(
        `INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`,
        [Number(userId), action, description],
      );
    },

    async findOrderForUpdate(orderId) {
      const [rows] = await connection.query(
        `
        SELECT id, reference, user_id, status, total
        FROM orders
        WHERE id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [orderId],
      );
      return rows[0] ?? null;
    },

    async findOwnedOrderForUpdate(orderId, userId) {
      const [rows] = await connection.query(
        `
        SELECT id, reference, status, expires_at AS expiresAt
        FROM orders
        WHERE id = ? AND user_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [orderId, userId],
      );
      return rows[0] ?? null;
    },

    async updateOrderStatus(orderId, status, rejectionReason) {
      await connection.query(
        `UPDATE orders SET status = ?, rejection_reason = ? WHERE id = ?`,
        [status, rejectionReason, orderId],
      );
    },

    async updateOrderDrugstoreStatus(orderId, status, rejectionReason) {
      await connection.query(
        `UPDATE order_drugstores SET status = ?, rejection_reason = ? WHERE order_id = ?`,
        [status, rejectionReason, orderId],
      );
    },

    async listRestockItems(orderId) {
      const [rows] = await connection.query(
        `
        SELECT od.drugstore_id AS drugstoreId, oi.medicine_id AS medicineId, oi.quantity
        FROM order_drugstores od
        JOIN order_items oi ON oi.order_drugstore_id = od.id
        WHERE od.order_id = ?
        `,
        [orderId],
      );
      return rows;
    },

    async addInventory(drugstoreId, medicineId, quantity) {
      await connection.query(
        `
        UPDATE inventory
        SET stock_count = stock_count + ?
        WHERE drugstore_id = ? AND medicine_id = ?
        `,
        [quantity, drugstoreId, medicineId],
      );
    },

    async markPaidPaymentRefundedLocally(orderId) {
      await connection.query(
        `
        UPDATE payments
        SET payment_status = CASE
          WHEN payment_status = 'paid' THEN 'refunded'
          ELSE payment_status
        END
        WHERE order_id = ?
        `,
        [orderId],
      );
    },

    async findExpiredOrdersForUpdate() {
      const [rows] = await connection.query(`
        SELECT id, reference, user_id, status
        FROM orders
        WHERE expires_at IS NOT NULL
          AND expires_at < NOW()
          AND LOWER(status) NOT IN ('cancelled', 'canceled', 'rejected', 'expired', 'completed')
        FOR UPDATE
      `);
      return rows;
    },
  };
}

export function createMysqlOrderRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') {
    throw new TypeError('A MySQL query-capable pool is required.');
  }

  const repository = {
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(transactionAdapter(connection));
        if (result?.rollback === true) {
          await connection.rollback();
          return result.value;
        }
        await connection.commit();
        return result?.value;
      } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
      } finally {
        connection.release();
      }
    },

    async listCustomerOrders(userId) {
      const [rows] = await pool.query(
        `
        SELECT o.id, o.reference, o.total, o.status,
          o.rejection_reason AS rejectionReason,
          o.created_at AS createdAt,
          o.expires_at AS expiresAt
        FROM orders o
        WHERE o.user_id = ?
        ORDER BY o.created_at DESC
        `,
        [userId],
      );
      return rows;
    },

    async listItemsForOrders(orderIds) {
      if (orderIds.length === 0) return [];
      const placeholders = orderIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `
        SELECT
          od.order_id AS orderId,
          oi.id AS orderItemId,
          oi.medicine_id AS medicineId,
          oi.quantity,
          oi.price,
          od.drugstore_id AS drugstoreId,
          od.status AS drugstoreStatus,
          od.rejection_reason AS rejectionReason,
          ds.name AS drugstoreName,
          m.brand_name AS medicineName,
          m.generic_name AS genericName,
          m.rx_required AS rxRequired
        FROM order_drugstores od
        JOIN order_items oi ON oi.order_drugstore_id = od.id
        JOIN drugstores ds ON ds.id = od.drugstore_id
        JOIN medicines m ON m.id = oi.medicine_id
        WHERE od.order_id IN (${placeholders})
        ORDER BY od.order_id DESC, oi.id ASC
        `,
        orderIds,
      );
      return rows;
    },

    async findCustomerOrder(orderId, userId) {
      const [rows] = await pool.query(
        `
        SELECT o.id, o.reference, o.total, o.status,
          o.rejection_reason AS rejectionReason,
          o.created_at AS createdAt,
          o.expires_at AS expiresAt
        FROM orders o
        WHERE o.id = ? AND o.user_id = ?
        LIMIT 1
        `,
        [orderId, userId],
      );
      return rows[0] ?? null;
    },

    async listItemsForOrder(orderId) {
      const [rows] = await pool.query(
        `
        SELECT
          oi.id AS orderItemId,
          oi.medicine_id AS medicineId,
          oi.quantity,
          oi.price,
          od.drugstore_id AS drugstoreId,
          od.status AS drugstoreStatus,
          od.rejection_reason AS drugstoreRejectionReason,
          ds.name AS drugstoreName,
          m.brand_name AS medicineName,
          m.generic_name AS genericName,
          m.rx_required AS rxRequired
        FROM order_drugstores od
        JOIN order_items oi ON oi.order_drugstore_id = od.id
        JOIN drugstores ds ON ds.id = od.drugstore_id
        JOIN medicines m ON m.id = oi.medicine_id
        WHERE od.order_id = ?
        ORDER BY oi.id ASC
        `,
        [orderId],
      );
      return rows;
    },

    async listAdminOrders() {
      const [rows] = await pool.query(`
        SELECT
          o.id, o.reference, o.total, o.status,
          o.rejection_reason AS rejectionReason,
          o.created_at AS createdAt,
          o.expires_at AS expiresAt,
          u.name AS customerName,
          u.email AS customerEmail
        FROM orders o
        JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC
      `);
      return rows;
    },

    async listAdminItemsForOrders(orderIds) {
      if (orderIds.length === 0) return [];
      const placeholders = orderIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `
        SELECT
          od.order_id AS orderId,
          od.drugstore_id AS drugstoreId,
          od.status AS drugstoreStatus,
          od.rejection_reason AS drugstoreRejectionReason,
          ds.name AS storeName,
          oi.medicine_id AS medicineId,
          oi.quantity,
          oi.price,
          m.brand_name AS medicineName,
          m.generic_name AS genericName,
          m.rx_required AS rxRequired
        FROM order_drugstores od
        JOIN order_items oi ON oi.order_drugstore_id = od.id
        JOIN drugstores ds ON ds.id = od.drugstore_id
        JOIN medicines m ON m.id = oi.medicine_id
        WHERE od.order_id IN (${placeholders})
        ORDER BY od.order_id DESC, oi.id ASC
        `,
        orderIds,
      );
      return rows;
    },

    async listPartnerOrderItems(drugstoreId) {
      const [rows] = await pool.query(
        `SELECT od.order_id AS orderId, od.status AS drugstoreStatus,
                od.rejection_reason AS drugstoreRejectionReason,
                oi.medicine_id AS medicineId, oi.quantity,
                ROUND(oi.price * 100) AS unitPriceCentavos,
                m.brand_name AS medicineName, m.generic_name AS genericName
         FROM order_drugstores od
         JOIN order_items oi ON oi.order_drugstore_id = od.id
         JOIN medicines m ON m.id = oi.medicine_id
         WHERE od.drugstore_id = ?
         ORDER BY od.order_id DESC, oi.id ASC`,
        [drugstoreId],
      );
      return rows;
    },
    async findAdminOrder(orderId) {
      const [rows] = await pool.query(
        `
        SELECT
          o.id, o.reference, o.total, o.status,
          o.rejection_reason AS rejectionReason,
          o.created_at AS createdAt,
          o.expires_at AS expiresAt,
          u.id AS customerId,
          u.name AS customerName,
          u.email AS customerEmail
        FROM orders o
        JOIN users u ON u.id = o.user_id
        WHERE o.id = ?
        LIMIT 1
        `,
        [orderId],
      );
      return rows[0] ?? null;
    },

    async listAdminItemsForOrder(orderId) {
      const [rows] = await pool.query(
        `
        SELECT
          od.id AS orderDrugstoreId,
          od.drugstore_id AS drugstoreId,
          od.status AS drugstoreStatus,
          od.rejection_reason AS drugstoreRejectionReason,
          ds.name AS storeName,
          ds.address AS storeAddress,
          oi.id AS orderItemId,
          oi.medicine_id AS medicineId,
          oi.quantity,
          oi.price,
          m.brand_name AS medicineName,
          m.generic_name AS genericName,
          m.rx_required AS rxRequired
        FROM order_drugstores od
        JOIN order_items oi ON oi.order_drugstore_id = od.id
        JOIN drugstores ds ON ds.id = od.drugstore_id
        JOIN medicines m ON m.id = oi.medicine_id
        WHERE od.order_id = ?
        ORDER BY oi.id ASC
        `,
        [orderId],
      );
      return rows;
    },
  };

  return assertOrderRepository(repository);
}
