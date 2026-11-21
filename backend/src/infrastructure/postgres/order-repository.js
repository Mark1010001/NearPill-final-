import { assertOrderRepository } from '../../ports/order-repository.js';
import { listingEligibleForCheckout, orderItemsEligibleForPickup } from './catalog-orderability.js';
import { createPostgresCompatPool } from './compat-pool.js';

function transactionAdapter(connection) {
  return {
    async findCustomerById(userId) {
      const [rows] = await connection.query(`SELECT id, name, email FROM users WHERE id = ? LIMIT 1`, [userId]);
      return rows[0] ?? null;
    },
    async lockIdempotencyKey(userId, key) {
      await connection.query(`SELECT pg_advisory_xact_lock(hashtextextended(?::text, 0)) AS locked`, [`${userId}:${key}`]);
    },
    async findOrderByIdempotency(userId, key) {
      const [rows] = await connection.query(
        `SELECT id, reference, total_centavos AS totalCentavos, status, expires_at AS expiresAt,
                pickup_date::text AS "pickupDate", pickup_window AS "pickupWindow", pickup_rescheduled AS "pickupRescheduled",
                idempotency_fingerprint AS idempotencyFingerprint
         FROM orders WHERE user_id = ? AND idempotency_key = ? LIMIT 1`,
        [userId, key],
      );
      return rows[0] ?? null;
    },
    async findInventoryForUpdate(drugstoreId, medicineId, customerId = null) {
      const [rows] = await connection.query(
        `SELECT i.id AS inventoryId, i.pharmacy_id AS drugstoreId, i.medicine_id AS medicineId,
                i.price_centavos AS priceCentavos, i.stock_on_hand AS stockOnHand, i.selling_unit AS sellingUnit,
                i.reserved_quantity AS reservedQuantity,
                (i.stock_on_hand - i.reserved_quantity) AS sellableQuantity,
                i.availability AS availability, m.brand_name AS medicineName, ds.name AS drugstoreName,
                (lower(btrim(m.category)) IN ('prescription', 'prescriptions', 'prescription (source list)')) AS "prescriptionRequired",
                EXISTS (SELECT 1 FROM nearpill.prescription_reviews pr WHERE pr.customer_id = ?::integer
                  AND pr.pharmacy_id = i.pharmacy_id AND pr.medicine_id = i.medicine_id AND pr.status = 'approved') AS "prescriptionApproved"
         FROM stock i
         JOIN medicines m ON m.id = i.medicine_id
         JOIN pharmacies ds ON ds.id = i.pharmacy_id
         WHERE i.pharmacy_id = ? AND i.medicine_id = ?
           AND ${listingEligibleForCheckout}
           AND ds.verification_status = 'verified'
           AND ds.public_profile_published_at IS NOT NULL
         LIMIT 1 FOR UPDATE OF i`,
        [customerId, drugstoreId, medicineId],
      );
      return rows[0] ?? null;
    },
    async createOrder({ reference, userId, totalCentavos, expiresAt, idempotencyKey, idempotencyFingerprint, pickupDate = null, pickupWindow = null }) {
      const [result] = await connection.query(
        `INSERT INTO orders (reference, user_id, total_centavos, status, expires_at, idempotency_key, idempotency_fingerprint, pickup_date, pickup_window)
         VALUES (?, ?, ?, 'reserved', ?, ?, ?, ?, ?)`,
        [reference, userId, totalCentavos, expiresAt, idempotencyKey, idempotencyFingerprint, pickupDate, pickupWindow],
      );
      return Number(result.insertId);
    },
    async findStoreById(drugstoreId) {
      const [rows] = await connection.query(`SELECT id, name, is_active, operating_hours FROM pharmacies WHERE id = ? LIMIT 1`, [drugstoreId]);
      return rows[0] ?? null;
    },
    async listOrderOperatingHours(orderId) {
      const [rows] = await connection.query(
        `SELECT ds.operating_hours AS "operatingHours" FROM order_pharmacies od JOIN pharmacies ds ON ds.id = od.pharmacy_id WHERE od.order_id = ?`, [orderId]);
      return rows.map((row) => row.operatingHours);
    },
    async createOrderDrugstore(orderId, drugstoreId) {
      const [result] = await connection.query(
        `INSERT INTO order_pharmacies (order_id, pharmacy_id, status) VALUES (?, ?, 'reserved')`,
        [orderId, drugstoreId],
      );
      return Number(result.insertId);
    },
    async createOrderItem({ orderDrugstoreId, medicineId, quantity, unitPriceCentavos, sellingUnit = null }) {
      const [result] = await connection.query(
        `INSERT INTO order_items (order_pharmacy_id, medicine_id, quantity, unit_price_centavos, selling_unit)
         VALUES (?, ?, ?, ?, ?)`,
        [orderDrugstoreId, medicineId, quantity, unitPriceCentavos, sellingUnit],
      );
      return Number(result.insertId);
    },
    async reserveInventory({ orderId, inventoryId, quantity, actorId }) {
      const [result] = await connection.query(
        `UPDATE stock
         SET reserved_quantity = reserved_quantity + ?,
             availability = CASE WHEN stock_on_hand - (reserved_quantity + ?) > 0 THEN 1 ELSE 0 END
         WHERE id = ? AND stock_on_hand - reserved_quantity >= ?`,
        [quantity, quantity, inventoryId, quantity],
      );
      if (Number(result.affectedRows ?? 0) !== 1) return false;
      await connection.query(
        `INSERT INTO reservations (order_id, stock_id, quantity, status) VALUES (?, ?, ?, 'active')`,
        [orderId, inventoryId, quantity],
      );
      await connection.query(
        `INSERT INTO stock_movements (stock_id, order_id, actor_id, movement_type, stock_change, held_change, reason)
         VALUES (?, ?, ?, 'reserve', 0, ?, 'Order reservation')`,
        [inventoryId, orderId, actorId, quantity],
      );
      return true;
    },
    async appendAudit(userId, action, description) {
      await connection.query(`INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`, [Number(userId), action, description]);
    },
    async findOrderForUpdate(orderId) {
      const [rows] = await connection.query(
        `SELECT id, reference, user_id, status, total_centavos AS totalCentavos
         FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
        [orderId],
      );
      return rows[0] ?? null;
    },
    async findPartnerPickupForUpdate(orderId, drugstoreId) {
      const [rows] = await connection.query(
        `SELECT o.id, o.reference, o.status, od.status AS branchStatus,
          (SELECT p.payment_status FROM payments p WHERE p.order_id = o.id AND p.provider = 'xendit-test' AND p.payment_plan IS DISTINCT FROM 'balance' ORDER BY p.id DESC LIMIT 1) AS paymentStatus
         FROM orders o JOIN order_pharmacies od ON od.order_id = o.id
         WHERE o.id = ? AND od.pharmacy_id = ? AND o.reference LIKE 'NP-TEST-%' FOR UPDATE OF o`,
        [orderId, drugstoreId],
      );
      return rows[0] ?? null;
    },
    async advancePartnerPickup(orderId, drugstoreId, status) {
      const [order] = await connection.query('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
      const [branch] = await connection.query('UPDATE order_pharmacies SET status = ? WHERE order_id = ? AND pharmacy_id = ?', [status, orderId, drugstoreId]);
      return order.affectedRows === 1 && branch.affectedRows === 1;
    },
    async hasEligiblePickupItems(orderId) {
      const [rows] = await connection.query(orderItemsEligibleForPickup, [orderId]);
      return rows[0]?.eligible === true;
    },
    async isPartnerPickupFullyPaid(orderId) {
      const [rows] = await connection.query(
        `SELECT o.total_centavos = SUM(p.amount_centavos) FILTER (WHERE p.payment_status = 'confirmed')
                AND NOT bool_or(p.payment_status IN ('pending','reconciliation_required')) AS fullyPaid
         FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE p.order_id = ? AND p.provider = 'xendit-test' AND p.currency = 'PHP' GROUP BY o.id`,
        [orderId],
      );
      return rows[0]?.fullyPaid === true;
    },
    async findPartnerPickupBalance(orderId) {
      const [rows] = await connection.query(
        `SELECT o.total_centavos - p.amount_centavos AS balanceCentavos, p.payment_plan AS paymentPlan
         FROM orders o JOIN LATERAL (SELECT amount_centavos, payment_status, payment_plan, currency FROM payments
           WHERE order_id = o.id AND provider = 'xendit-test' AND payment_plan IS DISTINCT FROM 'balance' ORDER BY id DESC LIMIT 1) p ON true
         WHERE o.id = ? AND p.payment_status = 'confirmed' AND p.currency = 'PHP'
           AND NOT EXISTS (SELECT 1 FROM payments b WHERE b.order_id = o.id AND b.payment_plan = 'balance'
             AND b.payment_status IN ('pending','confirmed','reconciliation_required'))`, [orderId]);
      return rows[0] ?? null;
    },
    async findOwnedOrderForUpdate(orderId, userId) {
      const [rows] = await connection.query(
        `SELECT id, reference, status, expires_at AS expiresAt, pickup_rescheduled AS "pickupRescheduled"
         FROM orders WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE`,
        [orderId, userId],
      );
      return rows[0] ?? null;
    },
    async updateOrderPickup(orderId, pickupDate, pickupWindow) {
      await connection.query(`UPDATE orders SET pickup_date = ?, pickup_window = ?, pickup_rescheduled = true WHERE id = ?`, [pickupDate, pickupWindow, orderId]);
    },
    async updateOrderStatus(orderId, status, rejectionReason) {
      await connection.query(`UPDATE orders SET status = ?, rejection_reason = ? WHERE id = ?`, [status, rejectionReason, orderId]);
      await connection.query(`UPDATE order_pharmacies SET status = ?, rejection_reason = ? WHERE order_id = ?`, [status, rejectionReason, orderId]);
    },
    async latestPaymentStatus(orderId) {
      const [rows] = await connection.query(
        `SELECT payment_status AS paymentStatus FROM payments WHERE order_id = ? ORDER BY id DESC LIMIT 1`,
        [orderId],
      );
      return rows[0]?.paymentStatus ?? null;
    },
    async listActiveReservationsForUpdate(orderId) {
      const [rows] = await connection.query(
        `SELECT r.id, r.stock_id AS inventoryId, r.quantity, i.pharmacy_id AS drugstoreId
         FROM reservations r JOIN stock i ON i.id = r.stock_id WHERE r.order_id = ? AND r.status = 'active'
         ORDER BY r.stock_id ASC FOR UPDATE OF r`,
        [orderId],
      );
      return rows;
    },
    async releaseReservation({ reservationId, inventoryId, orderId, quantity, actorId, reason }) {
      const [result] = await connection.query(
        `UPDATE reservations SET status = 'released', released_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'active'`,
        [reservationId],
      );
      if (Number(result.affectedRows ?? 0) !== 1) return false;
      const [inventoryResult] = await connection.query(
        `UPDATE stock
         SET reserved_quantity = reserved_quantity - ?, availability = CASE WHEN stock_on_hand - (reserved_quantity - ?) > 0 THEN 1 ELSE 0 END
         WHERE id = ? AND reserved_quantity >= ?`,
        [quantity, quantity, inventoryId, quantity],
      );
      if (Number(inventoryResult.affectedRows ?? 0) !== 1) throw new Error('Inventory reservation release invariant failed.');
      await connection.query(
        `INSERT INTO stock_movements (stock_id, order_id, actor_id, movement_type, stock_change, held_change, reason)
         VALUES (?, ?, ?, 'release', 0, ?, ?)`,
        [inventoryId, orderId, actorId, -quantity, reason],
      );
      return true;
    },
    async fulfillReservation({ reservationId, inventoryId, orderId, quantity, actorId }) {
      const [result] = await connection.query(
        `UPDATE reservations SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'active'`,
        [reservationId],
      );
      if (Number(result.affectedRows ?? 0) !== 1) return false;
      const [inventoryResult] = await connection.query(
        `UPDATE stock
         SET stock_on_hand = stock_on_hand - ?, reserved_quantity = reserved_quantity - ?,
             availability = CASE WHEN (stock_on_hand - ?) - (reserved_quantity - ?) > 0 THEN 1 ELSE 0 END
         WHERE id = ? AND stock_on_hand >= ? AND reserved_quantity >= ?`,
        [quantity, quantity, quantity, quantity, inventoryId, quantity, quantity],
      );
      if (Number(inventoryResult.affectedRows ?? 0) !== 1) throw new Error('Inventory fulfillment invariant failed.');
      await connection.query(
        `INSERT INTO stock_movements (stock_id, order_id, actor_id, movement_type, stock_change, held_change, reason)
         VALUES (?, ?, ?, 'fulfill', ?, ?, 'Order completed')`,
        [inventoryId, orderId, actorId, -quantity, -quantity],
      );
      return true;
    },
    async findExpiredOrdersForUpdate() {
      const [rows] = await connection.query(
        `SELECT id, reference, user_id, status FROM orders
         WHERE expires_at IS NOT NULL AND expires_at < NOW()
           AND status IN ('reserved','awaiting_payment')
         ORDER BY id ASC FOR UPDATE`,
      );
      return rows;
    },
  };
}

function moneySelect(prefix = 'o') {
  return `${prefix}.total_centavos AS totalCentavos, (${prefix}.total_centavos::numeric / 100) AS total`;
}
function itemMoneySelect(prefix = 'oi') {
  return `${prefix}.unit_price_centavos AS unitPriceCentavos, (${prefix}.unit_price_centavos::numeric / 100) AS price, ${prefix}.selling_unit AS sellingUnit`;
}

export function createPostgresOrderRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool, { capability: 'order_mutation' });
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') throw new TypeError('A PostgreSQL query-capable pool is required.');

  const repository = {
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(transactionAdapter(connection));
        if (result?.rollback === true) { await connection.rollback(); return result.value; }
        await connection.commit();
        return result?.value;
      } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
      } finally { connection.release(); }
    },
    async listCustomerOrders(userId) {
      const [rows] = await pool.query(
        `SELECT o.id, o.reference, ${moneySelect('o')}, o.status, o.rejection_reason AS rejectionReason,
                o.created_at AS createdAt, o.expires_at AS expiresAt,
                o.pickup_date::text AS "pickupDate", o.pickup_window AS "pickupWindow", o.pickup_rescheduled AS "pickupRescheduled"
         FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC`, [userId]);
      return rows;
    },
    async listItemsForOrders(orderIds) {
      if (orderIds.length === 0) return [];
      const placeholders = orderIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT od.order_id AS orderId, oi.id AS orderItemId, oi.medicine_id AS medicineId, oi.quantity,
                ${itemMoneySelect('oi')}, od.pharmacy_id AS drugstoreId, od.status AS drugstoreStatus,
                od.rejection_reason AS rejectionReason, ds.name AS drugstoreName,
                m.brand_name AS medicineName, m.generic_name AS genericName,
                m.category AS category, m.dosage_form AS "dosageForm",
                (lower(btrim(m.category)) IN ('prescription', 'prescriptions', 'prescription (source list)')) AS "prescriptionRequired"
         FROM order_pharmacies od JOIN order_items oi ON oi.order_pharmacy_id = od.id
         JOIN pharmacies ds ON ds.id = od.pharmacy_id JOIN medicines m ON m.id = oi.medicine_id
         WHERE od.order_id IN (${placeholders}) ORDER BY od.order_id DESC, oi.id ASC`, orderIds);
      return rows;
    },
    async findCustomerOrder(orderId, userId) {
      const [rows] = await pool.query(
        `SELECT o.id, o.reference, ${moneySelect('o')}, o.status, o.rejection_reason AS rejectionReason,
                o.created_at AS createdAt, o.expires_at AS expiresAt,
                o.pickup_date::text AS "pickupDate", o.pickup_window AS "pickupWindow", o.pickup_rescheduled AS "pickupRescheduled"
         FROM orders o WHERE o.id = ? AND o.user_id = ? LIMIT 1`, [orderId, userId]);
      return rows[0] ?? null;
    },
    async listItemsForOrder(orderId) {
      const [rows] = await pool.query(
        `SELECT oi.id AS orderItemId, oi.medicine_id AS medicineId, oi.quantity, ${itemMoneySelect('oi')},
                od.pharmacy_id AS drugstoreId, od.status AS drugstoreStatus,
                od.rejection_reason AS drugstoreRejectionReason, ds.name AS drugstoreName,
                m.brand_name AS medicineName, m.generic_name AS genericName,
                m.category AS category, m.dosage_form AS "dosageForm",
                (lower(btrim(m.category)) IN ('prescription', 'prescriptions', 'prescription (source list)')) AS "prescriptionRequired"
         FROM order_pharmacies od JOIN order_items oi ON oi.order_pharmacy_id = od.id
         JOIN pharmacies ds ON ds.id = od.pharmacy_id JOIN medicines m ON m.id = oi.medicine_id
         WHERE od.order_id = ? ORDER BY oi.id ASC`, [orderId]);
      return rows;
    },
    async listAdminOrders() {
      const [rows] = await pool.query(
        `SELECT o.id, o.reference, ${moneySelect('o')}, o.status, o.rejection_reason AS rejectionReason,
                o.created_at AS createdAt, o.expires_at AS expiresAt,
                o.pickup_date::text AS "pickupDate", o.pickup_window AS "pickupWindow", o.pickup_rescheduled AS "pickupRescheduled", u.name AS customerName, u.email AS customerEmail,
                p.id AS paymentId, p.payment_status AS paymentStatus, p.provider AS paymentProvider
         FROM orders o JOIN users u ON u.id = o.user_id
         LEFT JOIN LATERAL (
           SELECT id, payment_status, provider FROM payments WHERE order_id = o.id ORDER BY id DESC LIMIT 1
         ) p ON TRUE
         -- Finished orders that only belong to a removed (inactive) pharmacy are hidden here; their records are kept.
         WHERE NOT (o.status IN ('completed', 'cancelled', 'rejected', 'expired')
           AND EXISTS (SELECT 1 FROM order_pharmacies od0 WHERE od0.order_id = o.id)
           AND NOT EXISTS (SELECT 1 FROM order_pharmacies od JOIN pharmacies ds ON ds.id = od.pharmacy_id
                           WHERE od.order_id = o.id AND ds.is_active = 1))
         ORDER BY o.created_at DESC`);
      return rows;
    },
    async listAdminItemsForOrders(orderIds) {
      if (orderIds.length === 0) return [];
      const placeholders = orderIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT od.order_id AS orderId, od.pharmacy_id AS drugstoreId, od.status AS drugstoreStatus,
                od.rejection_reason AS drugstoreRejectionReason, ds.name AS storeName,
                oi.medicine_id AS medicineId, oi.quantity, ${itemMoneySelect('oi')},
                m.brand_name AS medicineName, m.generic_name AS genericName
         FROM order_pharmacies od JOIN order_items oi ON oi.order_pharmacy_id = od.id
         JOIN pharmacies ds ON ds.id = od.pharmacy_id JOIN medicines m ON m.id = oi.medicine_id
         WHERE od.order_id IN (${placeholders}) ORDER BY od.order_id DESC, oi.id ASC`, orderIds);
      return rows;
    },
    async listPartnerOrderItems(drugstoreId) {
      const [rows] = await pool.query(
        `SELECT od.order_id AS orderId, o.reference, od.status AS drugstoreStatus,
                o.pickup_date::text AS "pickupDate", o.pickup_window AS "pickupWindow", o.pickup_rescheduled AS "pickupRescheduled",
                CASE WHEN o.status = 'completed' THEN 0 WHEN NOT p.blocked AND p.paid > 0
                  THEN o.total_centavos - p.paid END AS pickupBalanceCentavos,
                p.balancePending AS pickupBalancePending,
                (NOT p.blocked AND p.balanceConfirmed AND p.paid = o.total_centavos) AS pickupBalancePaidWithGCash,
                od.rejection_reason AS drugstoreRejectionReason,
                oi.medicine_id AS medicineId, oi.quantity, ${itemMoneySelect('oi')},
                m.brand_name AS medicineName, m.generic_name AS genericName
         FROM order_pharmacies od
         JOIN orders o ON o.id = od.order_id
         LEFT JOIN LATERAL (SELECT SUM(amount_centavos) FILTER (WHERE payment_status = 'confirmed') AS paid,
           bool_or(payment_status IN ('pending','reconciliation_required')) AS blocked,
           bool_or(payment_plan = 'balance' AND payment_status IN ('pending','reconciliation_required')) AS balancePending,
           bool_or(payment_plan = 'balance' AND payment_status = 'confirmed') AS balanceConfirmed FROM payments
           WHERE order_id = o.id AND provider = 'xendit-test' AND currency = 'PHP') p ON true
         JOIN order_items oi ON oi.order_pharmacy_id = od.id
         JOIN medicines m ON m.id = oi.medicine_id
         WHERE od.pharmacy_id = ?
         ORDER BY od.order_id DESC, oi.id ASC`,
        [drugstoreId],
      );
      return rows;
    },
    async findAdminOrder(orderId) {
      const [rows] = await pool.query(
        `SELECT o.id, o.reference, ${moneySelect('o')}, o.status, o.rejection_reason AS rejectionReason,
                o.created_at AS createdAt, o.expires_at AS expiresAt,
                o.pickup_date::text AS "pickupDate", o.pickup_window AS "pickupWindow", o.pickup_rescheduled AS "pickupRescheduled",
                u.id AS customerId, u.name AS customerName, u.email AS customerEmail
         FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ? LIMIT 1`, [orderId]);
      return rows[0] ?? null;
    },
    async listAdminItemsForOrder(orderId) {
      const [rows] = await pool.query(
        `SELECT od.id AS orderDrugstoreId, od.pharmacy_id AS drugstoreId, od.status AS drugstoreStatus,
                od.rejection_reason AS drugstoreRejectionReason, ds.name AS storeName, ds.address AS storeAddress,
                oi.id AS orderItemId, oi.medicine_id AS medicineId, oi.quantity, ${itemMoneySelect('oi')},
                m.brand_name AS medicineName, m.generic_name AS genericName
         FROM order_pharmacies od JOIN order_items oi ON oi.order_pharmacy_id = od.id
         JOIN pharmacies ds ON ds.id = od.pharmacy_id JOIN medicines m ON m.id = oi.medicine_id
         WHERE od.order_id = ? ORDER BY oi.id ASC`, [orderId]);
      return rows;
    },
  };
  return assertOrderRepository(repository);
}
