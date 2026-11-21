import { assertReportRepository } from '../../ports/report-repository.js';
import { createPostgresCompatPool } from './compat-pool.js';

// "Order value" counts orders the customer has paid for: confirmed through completed. Reserved or awaiting-payment
// orders are not revenue yet, and cancelled, rejected and expired orders never are.
// Reports group orders by the Philippine calendar day, not the database server's (UTC) day.
const REPORT_TIME_ZONE = 'Asia/Manila';
const PAID_ORDER_STATUSES = "('confirmed', 'preparing', 'ready_for_pickup', 'completed')";

export function createPostgresReportRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool);
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A PostgreSQL query-capable pool is required.');
  }

  const repository = {
    async getMetrics() {
      const [[gmvRow]] = await pool.query(`
        SELECT COALESCE(SUM(total_centavos), 0)::numeric / 100 AS totalGMV
        FROM orders
        WHERE status IN ${PAID_ORDER_STATUSES}
      `);
      const [[pharmacyRow]] = await pool.query(`
        SELECT COUNT(*) AS activePharmaciesCount
        FROM pharmacies
        WHERE is_active = 1
      `);
      const [[orderRow]] = await pool.query(`SELECT COUNT(*) AS totalOrdersCount FROM orders`);
      return { gmvRow, pharmacyRow, orderRow };
    },

    async getSalesReport({ startDate, endDate } = {}) {
      const conditions = [];
      const params = [];
      if (startDate) {
        conditions.push(`o.created_at >= (?::date)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'`);
        params.push(startDate);
      }
      if (endDate) {
        conditions.push(`o.created_at < ((?::date) + 1)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'`);
        params.push(endDate);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `
        SELECT to_char(o.created_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD') AS reportDate,
          COUNT(*) AS orderCount,
          COALESCE(SUM(CASE WHEN o.status IN ${PAID_ORDER_STATUSES} THEN o.total_centavos ELSE 0 END), 0)::numeric / 100 AS revenue
        FROM orders o
        ${whereClause}
        GROUP BY 1
        ORDER BY reportDate ASC
        `,
        params,
      );
      return rows;
    },

    async getSalesReportForDrugstore(drugstoreId, { startDate, endDate } = {}) {
      const conditions = ['od.pharmacy_id = ?'];
      const params = [drugstoreId];
      if (startDate) { conditions.push(`o.created_at >= (?::date)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'`); params.push(startDate); }
      if (endDate) { conditions.push(`o.created_at < ((?::date) + 1)::timestamp AT TIME ZONE '${REPORT_TIME_ZONE}'`); params.push(endDate); }
      const [rows] = await pool.query(
        `SELECT to_char(o.created_at AT TIME ZONE '${REPORT_TIME_ZONE}', 'YYYY-MM-DD') AS reportDate, COUNT(DISTINCT o.id) AS orderCount,
                COALESCE(SUM(oi.unit_price_centavos * oi.quantity), 0) AS revenueCentavos
         FROM orders o
         JOIN order_pharmacies od ON od.order_id = o.id
         JOIN order_items oi ON oi.order_pharmacy_id = od.id
         WHERE ${conditions.join(' AND ')} AND o.status = 'completed'
         GROUP BY 1 ORDER BY reportDate ASC`, params);
      return rows;
    },

    async getMedicineReport() {
      const [rows] = await pool.query(`
        SELECT
          m.id AS medicineId,
          m.brand_name AS brandName,
          m.generic_name AS genericName,
          SUM(oi.quantity) AS quantitySold,
          COUNT(DISTINCT od.order_id) AS orderCount
        FROM order_items oi
        INNER JOIN medicines m ON m.id = oi.medicine_id
        INNER JOIN order_pharmacies od ON od.id = oi.order_pharmacy_id
        INNER JOIN orders o ON o.id = od.order_id
        WHERE o.status IN ${PAID_ORDER_STATUSES}
        GROUP BY m.id, m.brand_name, m.generic_name
        ORDER BY quantitySold DESC
      `);
      return rows;
    },

    async getDrugstoreReport() {
      const [rows] = await pool.query(`
        SELECT
          d.id AS drugstoreId,
          d.name AS drugstoreName,
          COUNT(DISTINCT od.order_id) AS orderCount,
          COALESCE(SUM(CASE
            WHEN o.status IN ${PAID_ORDER_STATUSES}
              THEN (oi.unit_price_centavos::numeric / 100) * oi.quantity
            ELSE 0
          END), 0) AS revenue,
          SUM(CASE WHEN o.status IN ('cancelled', 'rejected') THEN 1 ELSE 0 END) AS cancelledCount,
          SUM(CASE WHEN o.status = 'expired' THEN 1 ELSE 0 END) AS expiredCount
        FROM pharmacies d
        LEFT JOIN order_pharmacies od ON od.pharmacy_id = d.id
        LEFT JOIN orders o ON o.id = od.order_id
        LEFT JOIN order_items oi ON oi.order_pharmacy_id = od.id
        WHERE d.is_active = 1
        GROUP BY d.id, d.name
        ORDER BY revenue DESC
      `);
      return rows;
    },

    async listAuditLogs() {
      const [rows] = await pool.query(`
        SELECT
          a.id,
          a.user_id AS userId,
          u.name AS userName,
          u.email AS userEmail,
          u.role AS userRole,
          a.action,
          a.description,
          a.created_at AS createdAt
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 500
      `);
      return rows;
    },
  };

  return assertReportRepository(repository);
}
