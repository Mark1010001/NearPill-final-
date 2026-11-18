import { assertCatalogRepository } from '../../ports/catalog-repository.js';

export function createMysqlCatalogRepository(pool) {
  if (!pool || typeof pool.query !== 'function') {
    throw new TypeError('A MySQL query-capable pool is required.');
  }

  const repository = {
    async searchAvailableMedicines({ search = '', category = '' } = {}) {
      let sql = `
        SELECT
          m.id AS id,
          m.brand_name AS name,
          m.generic_name AS genericName,
          i.price AS price,
          ds.name AS drugstoreName,
          ds.id AS drugstoreId,
          m.dosage_form AS category,
          i.stock_count AS stockCount,
          m.rx_required AS rxRequired,
          m.description AS description,
          i.created_at AS createdAt,
          NULL AS distance
        FROM inventory i
        JOIN medicines m ON m.id = i.medicine_id
        JOIN drugstores ds ON ds.id = i.drugstore_id
        WHERE ds.is_active = 1
          AND i.availability = 1
      `;
      const params = [];

      if (search) {
        sql += `
          AND (
            m.brand_name LIKE ?
            OR m.generic_name LIKE ?
            OR m.description LIKE ?
          )
        `;
        const searchValue = `%${search}%`;
        params.push(searchValue, searchValue, searchValue);
      }

      if (category) {
        sql += ` AND m.category = ? `;
        params.push(category);
      }

      sql += ` ORDER BY m.brand_name ASC, ds.name ASC `;
      const [rows] = await pool.query(sql, params);
      return rows;
    },

    async findMedicineById(medicineId) {
      const [rows] = await pool.query(
        `
        SELECT
          m.id AS id,
          m.brand_name AS name,
          m.generic_name AS genericName,
          m.dosage_form AS dosageForm,
          m.category AS category,
          m.rx_required AS rxRequired,
          m.description AS description,
          m.created_at AS createdAt
        FROM medicines m
        WHERE m.id = ?
        LIMIT 1
        `,
        [medicineId],
      );
      return rows[0] ?? null;
    },

    async findMedicineInventoryById(medicineId) {
      const [rows] = await pool.query(
        `
        SELECT
          i.id AS inventoryId,
          i.drugstore_id AS drugstoreId,
          ds.name AS drugstoreName,
          ds.address AS address,
          ds.latitude AS latitude,
          ds.longitude AS longitude,
          i.price AS price,
          i.stock_count AS stockCount,
          i.availability AS availability
        FROM inventory i
        JOIN drugstores ds ON ds.id = i.drugstore_id
        WHERE i.medicine_id = ?
          AND ds.is_active = 1
        ORDER BY ds.name ASC
        `,
        [medicineId],
      );
      return rows;
    },

    async listActiveStores() {
      const [rows] = await pool.query(`
        SELECT
          id AS store_id,
          name AS store_name,
          address,
          latitude,
          longitude,
          operating_hours,
          is_active
        FROM drugstores
        WHERE is_active = 1
        ORDER BY name ASC
      `);
      return rows;
    },

    async findStoreById(storeId) {
      const [rows] = await pool.query(
        `
        SELECT
          id,
          name,
          address,
          latitude,
          longitude,
          operating_hours,
          is_active
        FROM drugstores
        WHERE id = ?
        LIMIT 1
        `,
        [storeId],
      );
      return rows[0] ?? null;
    },

    async listStoreInventory(storeId) {
      const [rows] = await pool.query(
        `
        SELECT
          m.id AS id,
          m.brand_name AS name,
          m.generic_name AS genericName,
          i.price AS price,
          ds.name AS drugstoreName,
          ds.id AS drugstoreId,
          m.dosage_form AS category,
          m.category AS medicineCategory,
          i.stock_count AS stockCount,
          i.availability AS availability,
          m.rx_required AS rxRequired,
          m.description AS description,
          i.created_at AS createdAt,
          NULL AS distance
        FROM inventory i
        JOIN medicines m ON m.id = i.medicine_id
        JOIN drugstores ds ON ds.id = i.drugstore_id
        WHERE ds.id = ?
        ORDER BY m.brand_name ASC
        `,
        [storeId],
      );
      return rows;
    },

    async listAdminPharmacies() {
      const [rows] = await pool.query(`
        SELECT
          ds.id AS store_id,
          ds.id AS id,
          ds.name,
          ds.address,
          ds.latitude,
          ds.longitude,
          ds.operating_hours,
          ds.is_active,
          ds.created_at
        FROM drugstores ds
        ORDER BY ds.name ASC
      `);
      return rows;
    },

    async listDrugstoreSales() {
      const [rows] = await pool.query(`
        SELECT
          od.drugstore_id AS drugstoreId,
          COUNT(DISTINCT od.order_id) AS totalOrders,
          COALESCE(SUM(oi.quantity * oi.price), 0) AS totalSales
        FROM order_drugstores od
        JOIN order_items oi ON oi.order_drugstore_id = od.id
        WHERE od.status <> 'cancelled'
        GROUP BY od.drugstore_id
      `);
      return rows;
    },

    async createDrugstore({ name, address, latitude, longitude, operatingHours, isActive }) {
      const [result] = await pool.query(
        `
        INSERT INTO drugstores
          (name, address, latitude, longitude, operating_hours, is_active)
        VALUES
          (?, ?, ?, ?, ?, ?)
        `,
        [name, address, latitude, longitude, operatingHours, isActive],
      );
      return Number(result.insertId);
    },

    async updateDrugstore(drugstoreId, { name, address, latitude, longitude, operatingHours, isActive }) {
      const [result] = await pool.query(
        `
        UPDATE drugstores
        SET
          name = ?,
          address = ?,
          latitude = ?,
          longitude = ?,
          operating_hours = ?,
          is_active = ?
        WHERE id = ?
        `,
        [name, address, latitude, longitude, operatingHours, isActive, drugstoreId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async deactivateDrugstore(drugstoreId) {
      const [result] = await pool.query(
        `UPDATE drugstores SET is_active = 0 WHERE id = ?`,
        [drugstoreId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async listMasterMedicines() {
      const [rows] = await pool.query(`
        SELECT
          id,
          brand_name AS brandName,
          generic_name AS genericName,
          dosage_form AS dosageForm,
          category,
          rx_required AS rxRequired,
          description,
          created_at AS createdAt
        FROM medicines
        ORDER BY brand_name ASC
      `);
      return rows;
    },

    async createMedicine({ brandName, genericName, dosageForm, category, rxRequired, description }) {
      const [result] = await pool.query(
        `
        INSERT INTO medicines
          (brand_name, generic_name, dosage_form, category, rx_required, description)
        VALUES
          (?, ?, ?, ?, ?, ?)
        `,
        [brandName, genericName, dosageForm, category, rxRequired, description],
      );
      return Number(result.insertId);
    },

    async findMasterMedicineById(medicineId) {
      const [rows] = await pool.query(
        `
        SELECT
          id,
          brand_name,
          generic_name,
          dosage_form,
          category,
          rx_required,
          description
        FROM medicines
        WHERE id = ?
        LIMIT 1
        `,
        [medicineId],
      );
      return rows[0] ?? null;
    },

    async updateMedicine(medicineId, { brandName, genericName, dosageForm, category, rxRequired, description }) {
      const [result] = await pool.query(
        `
        UPDATE medicines
        SET
          brand_name = ?,
          generic_name = ?,
          dosage_form = ?,
          category = ?,
          rx_required = ?,
          description = ?
        WHERE id = ?
        `,
        [brandName, genericName, dosageForm, category, rxRequired, description, medicineId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async appendAudit(userId, action, description) {
      await pool.query(
        `
        INSERT INTO audit_logs
          (user_id, action, description)
        VALUES
          (?, ?, ?)
        `,
        [Number(userId), action, description],
      );
    },
  };

  return assertCatalogRepository(repository);
}
