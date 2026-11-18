import { assertReportRepository } from '../../ports/report-repository.js';

export function createMysqlReportRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A MySQL query-capable pool is required.');
  }

  const repository = {
    async getMetrics() {
      const [[gmvRow]] = await pool.query(`
        SELECT COALESCE(SUM(total), 0) AS totalGMV
        FROM orders
        WHERE status <> 'cancelled'
      `);
      const [[pharmacyRow]] = await pool.query(`
        SELECT COUNT(*) AS activePharmaciesCount
        FROM drugstores
        WHERE is_active = 1
      `);
      const [[orderRow]] = await pool.query(`SELECT COUNT(*) AS totalOrdersCount FROM orders`);
      const [[rxRow]] = await pool.query(`
        SELECT COUNT(*) AS rxPendingVerificationCount
        FROM orders
        WHERE LOWER(status) IN ('rx_pending', 'pending_rx', 'rx_verification_pending')
      `);
      return { gmvRow, pharmacyRow, orderRow, rxRow };
    },

    async getSalesReport({ startDate, endDate } = {}) {
      const conditions = [];
      const params = [];
      if (startDate) {
        conditions.push('o.created_at >= ?');
        params.push(`${startDate} 00:00:00`);
      }
      if (endDate) {
        conditions.push('o.created_at <= ?');
        params.push(`${endDate} 23:59:59`);
      }
      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const [rows] = await pool.query(
        `
        SELECT DATE(o.created_at) AS reportDate,
          COUNT(*) AS orderCount,
          COALESCE(SUM(o.total), 0) AS revenue
        FROM orders o
        ${whereClause}
        GROUP BY DATE(o.created_at)
        ORDER BY reportDate ASC
        `,
        params,
      );
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
        INNER JOIN order_drugstores od ON od.id = oi.order_drugstore_id
        INNER JOIN orders o ON o.id = od.order_id
        WHERE o.status NOT IN ('cancelled', 'rejected', 'expired')
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
            WHEN o.status NOT IN ('cancelled', 'rejected', 'expired')
              THEN oi.price * oi.quantity
            ELSE 0
          END), 0) AS revenue,
          SUM(CASE WHEN o.status IN ('cancelled', 'rejected') THEN 1 ELSE 0 END) AS cancelledCount,
          SUM(CASE WHEN o.status = 'expired' THEN 1 ELSE 0 END) AS expiredCount
        FROM drugstores d
        LEFT JOIN order_drugstores od ON od.drugstore_id = d.id
        LEFT JOIN orders o ON o.id = od.order_id
        LEFT JOIN order_items oi ON oi.order_drugstore_id = od.id
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
