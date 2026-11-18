import { assertInventoryRepository } from '../../ports/inventory-repository.js';

function createTransactionRepository(connection) {
  return {
    async findInventoryForUpdate(drugstoreId, medicineId) {
      const [rows] = await connection.query(
        `
        SELECT id, stock_count, availability
        FROM inventory
        WHERE drugstore_id = ? AND medicine_id = ?
        LIMIT 1
        FOR UPDATE
        `,
        [drugstoreId, medicineId],
      );
      return rows[0] ?? null;
    },
    async updateInventoryStock(drugstoreId, medicineId, stockCount, availability) {
      await connection.query(
        `
        UPDATE inventory
        SET stock_count = ?, availability = ?
        WHERE drugstore_id = ? AND medicine_id = ?
        `,
        [stockCount, availability, drugstoreId, medicineId],
      );
    },
    async appendAudit(userId, action, description) {
      await connection.query(
        `INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`,
        [Number(userId), action, description],
      );
    },
  };
}

export function createMysqlInventoryRepository(pool) {
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') {
    throw new TypeError('A MySQL query-capable pool is required.');
  }

  const repository = {
    async withTransaction(work) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(createTransactionRepository(connection));
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

    async findInventoryForUpdate() {
      throw new Error('findInventoryForUpdate() is transaction-scoped.');
    },
    async updateInventoryStock() {
      throw new Error('updateInventoryStock() is transaction-scoped.');
    },
    async appendAudit() {
      throw new Error('appendAudit() is transaction-scoped.');
    },

    async listAdminInventory(drugstoreId = null) {
      let sql = `
        SELECT
          i.id AS inventoryId,
          i.drugstore_id AS drugstoreId,
          i.medicine_id AS medicineId,
          i.price,
          i.stock_count AS stockCount,
          i.availability,
          ds.name AS drugstoreName,
          m.brand_name AS medicineName,
          m.generic_name AS genericName,
          m.category,
          m.rx_required AS rxRequired
        FROM inventory i
        JOIN drugstores ds ON ds.id = i.drugstore_id
        JOIN medicines m ON m.id = i.medicine_id
        WHERE 1 = 1
      `;
      const params = [];
      if (drugstoreId !== null) {
        sql += ` AND i.drugstore_id = ? `;
        params.push(drugstoreId);
      }
      sql += ` ORDER BY ds.name ASC, m.brand_name ASC `;
      const [rows] = await pool.query(sql, params);
      return rows;
    },
  };

  return assertInventoryRepository(repository);
}
