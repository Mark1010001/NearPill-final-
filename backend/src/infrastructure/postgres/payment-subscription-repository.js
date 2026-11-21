import { assertPaymentSubscriptionRepository } from '../../ports/payment-subscription-repository.js';
import { createPostgresCompatPool } from './compat-pool.js';
import { orderItemsEligibleForPickup } from './catalog-orderability.js';

function paymentSelect(alias = 'p') {
  return `${alias}.id, ${alias}.order_id AS orderId, ${alias}.amount_centavos AS amountCentavos,
    (${alias}.amount_centavos::numeric / 100) AS amount, ${alias}.currency,
    ${alias}.provider, ${alias}.provider_payment_id AS providerPaymentId,
    ${alias}.payment_method AS paymentMethod, ${alias}.payment_plan AS paymentPlan,
    ${alias}.policy_version AS policyVersion, ${alias}.payment_status AS paymentStatus,
    ${alias}.payment_reference AS paymentReference, ${alias}.idempotency_key AS idempotencyKey,
    ${alias}.created_at AS createdAt, ${alias}.updated_at AS updatedAt`;
}

function transactionAdapter(connection) {
  async function lockOrderPayment(predicate, values) {
    const [orders] = await connection.query(
      `SELECT o.status AS orderStatus, o.user_id AS userId, o.reference AS orderReference
       FROM orders o WHERE o.id = (SELECT p.order_id FROM payments p WHERE ${predicate} LIMIT 1)
       FOR UPDATE OF o`,
      values,
    );
    if (!orders[0]) return null;
    const [payments] = await connection.query(
      `SELECT ${paymentSelect('p')} FROM payments p WHERE ${predicate} LIMIT 1 FOR UPDATE OF p`, values,
    );
    return payments[0] ? { ...payments[0], ...orders[0] } : null;
  }

  return {
    async findOrderForPaymentActorForUpdate(orderId, userId) {
      const [rows] = await connection.query(
        `SELECT o.id, o.reference, o.user_id AS userId, o.total_centavos AS totalCentavos, o.status, o.expires_at AS expiresAt
         FROM orders o
         WHERE o.id = ? AND (o.user_id = ? OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'admin'))
         LIMIT 1 FOR UPDATE`,
        [orderId, userId, userId],
      );
      return rows[0] ?? null;
    },
    async findPaymentByIdempotency(orderId, key) {
      const [rows] = await connection.query(
        `SELECT ${paymentSelect('p')} FROM payments p WHERE p.order_id = ? AND p.idempotency_key = ? LIMIT 1 FOR UPDATE`,
        [orderId, key],
      );
      return rows[0] ?? null;
    },
    async hasEligiblePickupItems(orderId) {
      // Read the same pharmacy-confirmed catalogue entries that customers can browse.
      await connection.query("SELECT set_config('app.capability', 'catalog_browse', true)");
      const [rows] = await connection.query(orderItemsEligibleForPickup, [orderId]);
      await connection.query("SELECT set_config('app.capability', 'payment_mutation', true)");
      return rows[0]?.eligible === true;
    },
    async createPaymentIntent(input) {
      const [result] = await connection.query(
        `INSERT INTO payments (
           order_id, amount_centavos, currency, provider, provider_payment_id, payment_method,
           payment_plan, policy_version, payment_status, payment_reference, idempotency_key, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, CURRENT_TIMESTAMP)`,
        [input.orderId, input.amountCentavos, input.currency, input.provider, input.providerPaymentId,
          input.paymentMethod, input.paymentPlan, input.policyVersion, input.paymentReference, input.idempotencyKey],
      );
      return Number(result.insertId);
    },
    async updateOrderStatus(orderId, status) {
      await connection.query(`UPDATE orders SET status = ? WHERE id = ?`, [status, orderId]);
      await connection.query(`UPDATE order_pharmacies SET status = ? WHERE order_id = ?`, [status, orderId]);
    },
    async insertProviderEvent(event) {
      const [result] = await connection.query(
        `INSERT INTO payment_events (
           provider, event_id, event_type, provider_payment_id, provider_refund_id,
           amount_centavos, currency, raw_body_hash, occurred_at, processing_status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')
         ON CONFLICT (provider, event_id) DO NOTHING`,
        [event.provider, event.eventId, event.eventType, event.providerPaymentId ?? null,
          event.providerRefundId ?? null, event.amountCentavos ?? null, event.currency ?? null,
          event.rawBodyHash, event.occurredAt ?? null],
      );
      return Number(result.affectedRows ?? 0) === 1;
    },
    async markProviderEvent(eventId, provider, status) {
      await connection.query(
        `UPDATE payment_events SET processing_status = ?, processed_at = CURRENT_TIMESTAMP WHERE provider = ? AND event_id = ?`,
        [status, provider, eventId],
      );
    },
    async findPaymentByExternalIdForUpdate(provider, providerPaymentId) {
      return lockOrderPayment('p.provider = ? AND p.provider_payment_id = ?', [provider, providerPaymentId]);
    },
    async findPaymentByIdForUpdate(paymentId) {
      return lockOrderPayment('p.id = ?', [paymentId]);
    },
    async updatePaymentStatus(paymentId, status, reference = null) {
      await connection.query(
        `UPDATE payments SET payment_status = ?, payment_reference = COALESCE(?, payment_reference), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, reference, paymentId],
      );
    },
    async createReconciliation(input) {
      const [result] = await connection.query(
        `INSERT INTO payment_issues (payment_id, provider, event_id, reason, details, status)
         VALUES (?, ?, ?, ?, ?, 'open')`,
        [input.paymentId ?? null, input.provider, input.eventId ?? null, input.reason, input.details ?? null],
      );
      return Number(result.insertId);
    },
    async createRefund(input) {
      const [result] = await connection.query(
        `INSERT INTO refunds (payment_id, amount_centavos, provider, provider_refund_id, idempotency_key, status, reason, requested_by)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [input.paymentId, input.amountCentavos, input.provider, input.providerRefundId, input.idempotencyKey, input.reason, input.requestedBy],
      );
      return Number(result.insertId);
    },
    async findRefundByExternalIdForUpdate(provider, providerRefundId) {
      const [rows] = await connection.query(
        `SELECT id, payment_id AS paymentId, amount_centavos AS amountCentavos, status
         FROM refunds WHERE provider = ? AND provider_refund_id = ? LIMIT 1 FOR UPDATE`,
        [provider, providerRefundId],
      );
      return rows[0] ?? null;
    },
    async findPendingRefundForPaymentForUpdate(paymentId) {
      const [rows] = await connection.query(
        `SELECT id, payment_id AS paymentId, amount_centavos AS amountCentavos, provider, provider_refund_id AS providerRefundId, status
         FROM refunds WHERE payment_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [paymentId],
      );
      return rows[0] ?? null;
    },
    async updateRefundStatus(refundId, status) {
      await connection.query(
        `UPDATE refunds SET status = ?, confirmed_at = CASE WHEN ? = 'confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END,
         updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [status, status, refundId],
      );
    },
    async listActiveReservationsForUpdate(orderId) {
      const [rows] = await connection.query(
        `SELECT id, stock_id AS inventoryId, quantity FROM reservations
         WHERE order_id = ? AND status = 'active' ORDER BY stock_id ASC FOR UPDATE`,
        [orderId],
      );
      return rows;
    },
    async releaseReservation({ reservationId, inventoryId, orderId, quantity, actorId, reason }) {
      const [result] = await connection.query(
        `UPDATE reservations SET status = 'released', released_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'active'`,
        [reservationId],
      );
      if (Number(result.affectedRows ?? 0) !== 1) return false;
      const [inventoryResult] = await connection.query(
        `UPDATE stock SET reserved_quantity = reserved_quantity - ?,
           availability = CASE WHEN stock_on_hand - (reserved_quantity - ?) > 0 THEN 1 ELSE 0 END
         WHERE id = ? AND reserved_quantity >= ?`,
        [quantity, quantity, inventoryId, quantity],
      );
      if (Number(inventoryResult.affectedRows ?? 0) !== 1) throw new Error('Inventory refund release invariant failed.');
      await connection.query(
        `INSERT INTO stock_movements (stock_id, order_id, actor_id, movement_type, stock_change, held_change, reason)
         VALUES (?, ?, ?, 'release', 0, ?, ?)`,
        [inventoryId, orderId, actorId, -quantity, reason],
      );
      return true;
    },
    async appendAudit(userId, action, description) {
      await connection.query(`INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`, [Number(userId), action, description]);
    },
  };
}

export function createPostgresPaymentSubscriptionRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool);
  const mutationPool = createPostgresCompatPool(postgresPool, { capability: 'payment_mutation' });
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') {
    throw new TypeError('A PostgreSQL query-capable pool is required.');
  }

  const repository = {
    async withTransaction(work) {
      const connection = await mutationPool.getConnection();
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
    async partnerDashboardForDrugstore(drugstoreId) {
      const [rows] = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN o.status = 'completed'
             THEN oi.quantity * oi.unit_price_centavos ELSE 0 END), 0)::numeric / 100 AS totalSales,
           COUNT(DISTINCT o.id) AS totalOrders,
           COUNT(DISTINCT CASE WHEN o.status = 'completed' THEN o.id END) AS completedOrders,
           COUNT(DISTINCT CASE WHEN o.status IN ('reserved','awaiting_payment','confirmed','preparing','ready_for_pickup','cancellation_pending') THEN o.id END) AS pendingOrders,
           COUNT(DISTINCT CASE WHEN o.status = 'expired' THEN o.id END) AS expiredOrders,
           COUNT(DISTINCT CASE WHEN o.status = 'cancelled' THEN o.id END) AS cancelledOrders
         FROM order_pharmacies od INNER JOIN orders o ON o.id = od.order_id
         LEFT JOIN order_items oi ON oi.order_pharmacy_id = od.id WHERE od.pharmacy_id = ?`, [drugstoreId]);
      const [[branch]] = await pool.query(
        `SELECT name, address, latitude, longitude, operating_hours AS operatingHours,
                (is_active = 1 AND verification_status = 'verified' AND public_profile_published_at IS NOT NULL) AS isPublic
         FROM pharmacies WHERE id = ?`, [drugstoreId]);
      return { ...rows[0], branch: branch ?? null };
    },
    async activeSubscriptionForDrugstore(drugstoreId) {
      const [rows] = await pool.query(
        `SELECT id, pharmacy_id AS drugstoreId, tier, status, plan_version AS planVersion,
                start_date AS startDate, end_date AS endDate
         FROM subscriptions WHERE pharmacy_id = ? AND status = 'active'
         AND (end_date IS NULL OR end_date >= CURRENT_DATE)
         ORDER BY start_date DESC, id DESC LIMIT 1`, [drugstoreId]);
      return rows[0] ?? null;
    },
    async listSubscriptions() {
      const [rows] = await pool.query(
        `SELECT s.id, s.pharmacy_id AS drugstoreId, d.name AS drugstoreName, s.tier, s.status,
                s.plan_version AS planVersion, s.start_date AS startDate, s.end_date AS endDate
         FROM subscriptions s INNER JOIN pharmacies d ON d.id = s.pharmacy_id
         WHERE d.is_active = 1
         ORDER BY s.start_date DESC, s.id DESC`);
      return rows;
    },
    async findDrugstoreById(drugstoreId) {
      const [rows] = await pool.query(`SELECT id FROM pharmacies WHERE id = ? LIMIT 1`, [drugstoreId]);
      return rows[0] ?? null;
    },
    async expireActiveSubscriptions(drugstoreId) {
      await pool.query(`UPDATE subscriptions SET status = 'expired' WHERE pharmacy_id = ? AND status = 'active'`, [drugstoreId]);
    },
    async createSubscription({ drugstoreId, tier, status, planVersion, startDate, endDate }) {
      const [result] = await pool.query(
        `INSERT INTO subscriptions (pharmacy_id, tier, status, plan_version, start_date, end_date)
         VALUES (?, ?, ?, ?, ?, ?)`, [drugstoreId, tier, status, planVersion, startDate, endDate]);
      return Number(result.insertId);
    },
    async findSubscriptionById(subscriptionId) {
      const [rows] = await pool.query(
        `SELECT id, pharmacy_id, tier, status, plan_version, start_date, end_date FROM subscriptions WHERE id = ? LIMIT 1`,
        [subscriptionId]);
      return rows[0] ?? null;
    },
    async updateSubscription(subscriptionId, { tier, status, planVersion, endDate }) {
      const [result] = await pool.query(
        `UPDATE subscriptions SET tier = ?, status = ?, plan_version = ?, end_date = ? WHERE id = ?`,
        [tier, status, planVersion, endDate, subscriptionId]);
      return Number(result.affectedRows ?? 0);
    },
    async replaceEntitlements(drugstoreId, subscriptionId, entitlementKeys) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        await connection.query(`UPDATE plan_features SET revoked_at = CURRENT_TIMESTAMP WHERE pharmacy_id = ? AND revoked_at IS NULL`, [drugstoreId]);
        for (const key of entitlementKeys) {
          await connection.query(
            `INSERT INTO plan_features (pharmacy_id, subscription_id, entitlement_key) VALUES (?, ?, ?)`,
            [drugstoreId, subscriptionId, key]);
        }
        await connection.commit();
      } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
      } finally { connection.release(); }
    },
    async listEntitlementsForDrugstore(drugstoreId) {
      const [rows] = await pool.query(
        `SELECT entitlement_key AS entitlementKey FROM plan_features
         WHERE pharmacy_id = ? AND revoked_at IS NULL ORDER BY entitlement_key`, [drugstoreId]);
      return rows.map((row) => row.entitlementKey);
    },
    async appendAudit(userId, action, description) {
      await pool.query(`INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`, [Number(userId), action, description]);
    },
    async findOrderPaymentForActor(orderId, userId) {
      const [rows] = await pool.query(
        `SELECT ${paymentSelect('p')}, o.status AS orderStatus FROM payments p INNER JOIN orders o ON o.id = p.order_id
         WHERE p.order_id = ? AND (o.user_id = ? OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'admin'))
         ORDER BY p.id DESC LIMIT 1`, [orderId, userId, userId]);
      return rows[0] ?? null;
    },
    async listDueTestPayments(afterId) {
      const [rows] = await pool.query(
        `SELECT ${paymentSelect('p')} FROM payments p JOIN orders o ON o.id = p.order_id
         WHERE p.id > ? AND p.provider = 'xendit-test' AND p.payment_status = 'pending'
           AND o.reference LIKE 'NP-TEST-%'
           AND (CASE WHEN p.payment_plan = 'balance' THEN p.created_at + INTERVAL '20 minutes' ELSE o.expires_at END) <= CURRENT_TIMESTAMP
         ORDER BY p.id LIMIT 20`,
        [afterId],
      );
      return rows;
    },
    async findPaymentForActor(paymentId, userId) {
      const [rows] = await pool.query(
        `SELECT ${paymentSelect('p')}, o.reference FROM payments p INNER JOIN orders o ON o.id = p.order_id
         WHERE p.id = ? AND (o.user_id = ? OR EXISTS (SELECT 1 FROM users u WHERE u.id = ? AND u.role = 'admin')) LIMIT 1`,
        [paymentId, userId, userId]);
      return rows[0] ?? null;
    },
    async findPendingRefundForPayment(paymentId) {
      const [rows] = await pool.query(
        `SELECT id, payment_id AS paymentId, amount_centavos AS amountCentavos, provider,
                provider_refund_id AS providerRefundId, idempotency_key AS idempotencyKey, status
         FROM refunds WHERE payment_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`, [paymentId]);
      return rows[0] ?? null;
    },
    async findPaymentById(paymentId) {
      const [rows] = await pool.query(`SELECT ${paymentSelect('p')} FROM payments p WHERE p.id = ? LIMIT 1`, [paymentId]);
      return rows[0] ?? null;
    },
  };

  return assertPaymentSubscriptionRepository(repository);
}
