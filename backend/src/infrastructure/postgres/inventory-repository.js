import { assertInventoryRepository } from '../../ports/inventory-repository.js';
import { eligibleForStandardCheckout, listingEligibleForCheckout, pharmacyCanConfirmSale, productIdentity } from './catalog-orderability.js';
import { createPostgresCompatPool } from './compat-pool.js';

function createTransactionRepository(connection) {
  return {
    async addApprovedListing(drugstoreId, medicineId, stock, priceCentavos, sellingUnit = null, packageSize = null, actorId = null) {
      // Any catalog item may be listed. Only a draft non-prescription/non-medicine item that is not already
      // eligible for standard checkout gets the pharmacy sale confirmation; prescription items get none.
      const [result] = await connection.query(
        `INSERT INTO inventory (drugstore_id, medicine_id, stock_on_hand, price_centavos, availability, selling_unit, package_size, pharmacy_sale_confirmation)
         SELECT d.id, m.id, ?, ?, 1, ?, ?,
           CASE WHEN (${eligibleForStandardCheckout}) THEN NULL
             WHEN (${pharmacyCanConfirmSale}) AND NOT m.otc_eligible
               THEN jsonb_build_object('product', ${productIdentity}, 'actorId', ?::integer, 'confirmedAt', CURRENT_TIMESTAMP)
             ELSE NULL END
         FROM drugstores d CROSS JOIN medicines m
         WHERE d.id = ? AND m.id = ? AND d.is_active = 1 AND d.verification_status = 'verified'
           AND d.public_profile_published_at IS NOT NULL
         ON CONFLICT (drugstore_id, medicine_id) DO NOTHING`,
        [stock, priceCentavos, sellingUnit, packageSize, actorId, drugstoreId, medicineId]);
      return Number(result.insertId) || null;
    },
    async createPharmacyProduct({ brandName, genericName, dosageForm, category }) {
      const [result] = await connection.query(
        `INSERT INTO medicines (brand_name, generic_name, dosage_form, category, publication_status)
         VALUES (?, ?, ?, ?, 'draft')`, [brandName, genericName, dosageForm, category]);
      return Number(result.insertId) || null;
    },
    async addNewProductListing(drugstoreId, medicineId, stock, priceCentavos, sellingUnit, packageSize, actorId) {
      const [result] = await connection.query(
        `INSERT INTO inventory (drugstore_id, medicine_id, stock_on_hand, price_centavos, availability, selling_unit, package_size, pharmacy_sale_confirmation)
         SELECT d.id, m.id, ?, ?, 1, ?, ?,
           CASE WHEN m.category = 'Prescription' THEN NULL
             ELSE jsonb_build_object('product', ${productIdentity}, 'actorId', ?::integer, 'confirmedAt', CURRENT_TIMESTAMP) END
         FROM drugstores d CROSS JOIN medicines m
         WHERE d.id = ? AND m.id = ? AND m.publication_status = 'draft' AND d.is_active = 1 AND d.verification_status = 'verified'
           AND d.public_profile_published_at IS NOT NULL`,
        [stock, priceCentavos, sellingUnit, packageSize, actorId, drugstoreId, medicineId]);
      return Number(result.insertId) || null;
    },
    async lockStockSubmission(id) {
      const [rows] = await connection.query(
        `SELECT id, drugstore_id AS "drugstoreId", status, rows FROM stock_submissions WHERE id = ? LIMIT 1 FOR UPDATE`, [id]);
      return rows[0] ?? null;
    },
    async insertReviewedListing(drugstoreId, medicineId, stock, priceCentavos, sellingUnit, actorId) {
      // Admin approval may list stock for a verified pharmacy that is not live yet, so (unlike partner intake) this
      // does not require the public profile to be published. Going live is a separate, checklist-gated step.
      const [result] = await connection.query(
        `INSERT INTO inventory (drugstore_id, medicine_id, stock_on_hand, price_centavos, availability, selling_unit, pharmacy_sale_confirmation)
         SELECT d.id, m.id, ?, ?, ?, ?,
           CASE WHEN (${eligibleForStandardCheckout}) THEN NULL
             WHEN lower(btrim(coalesce(m.category, ''))) IN ('prescription', 'prescriptions', 'prescription (source list)') THEN NULL
             WHEN (${pharmacyCanConfirmSale}) AND NOT m.otc_eligible
               THEN jsonb_build_object('product', ${productIdentity}, 'actorId', ?::integer, 'confirmedAt', CURRENT_TIMESTAMP)
             ELSE NULL END
         FROM drugstores d CROSS JOIN medicines m
         WHERE d.id = ? AND m.id = ? AND d.is_active = 1 AND d.verification_status = 'verified'`,
        [stock, priceCentavos, stock > 0 ? 1 : 0, sellingUnit, actorId, drugstoreId, medicineId]);
      return Number(result.insertId) || null;
    },
    async decideStockSubmission(id, status, note, reviewerId) {
      const [result] = await connection.query(
        `UPDATE stock_submissions SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'`, [status, note, reviewerId, id]);
      return Number(result.affectedRows ?? 0) === 1;
    },
    async findInventoryForUpdate(drugstoreId, medicineId) {
      const [rows] = await connection.query(
        `SELECT id, stock_on_hand AS stockOnHand, reserved_quantity AS reservedQuantity, price_centavos AS priceCentavos, availability,
                selling_unit AS sellingUnit, package_size AS packageSize,
                expiry_date::text AS "expiryDate", low_stock_threshold AS "lowStockThreshold"
         FROM inventory WHERE drugstore_id = ? AND medicine_id = ? LIMIT 1 FOR UPDATE`,
        [drugstoreId, medicineId],
      );
      return rows[0] ?? null;
    },
    async updateInventoryStock(drugstoreId, medicineId, stockOnHand, availability) {
      await connection.query(`UPDATE inventory SET stock_on_hand = ?, availability = ? WHERE drugstore_id = ? AND medicine_id = ?`, [stockOnHand, availability, drugstoreId, medicineId]);
    },
    async updateInventoryTracking(inventoryId, expiryDate, lowStockThreshold) {
      await connection.query(`UPDATE inventory SET expiry_date = ?, low_stock_threshold = ? WHERE id = ?`, [expiryDate, lowStockThreshold, inventoryId]);
    },
    async updateInventoryUnits(inventoryId, sellingUnit, packageSize) {
      await connection.query(`UPDATE inventory SET selling_unit = ?, package_size = ? WHERE id = ?`, [sellingUnit, packageSize, inventoryId]);
    },
    async confirmPharmacySale(inventoryId, actorId, product) {
      const [result] = await connection.query(
        `UPDATE inventory i SET pharmacy_sale_confirmation = jsonb_build_object(
           'product', ${productIdentity}, 'actorId', ?::integer, 'confirmedAt', CURRENT_TIMESTAMP)
         FROM medicines m, drugstores ds
         WHERE i.id = ? AND m.id = i.medicine_id AND ds.id = i.drugstore_id
           AND ds.is_active = 1 AND ds.verification_status = 'verified' AND ds.public_profile_published_at IS NOT NULL
           AND ${pharmacyCanConfirmSale}
           AND ${productIdentity} = ?::jsonb
           AND (i.pharmacy_sale_confirmation -> 'product') IS DISTINCT FROM ${productIdentity}`,
        [actorId, inventoryId, JSON.stringify(product)],
      );
      return Number(result.affectedRows ?? 0) === 1;
    },
    async findInventoryByIdForUpdate(inventoryId) {
      const [rows] = await connection.query(
        `SELECT id, drugstore_id, medicine_id, price_centavos AS priceCentavos, selling_unit AS sellingUnit,
                stock_on_hand AS stockOnHand, reserved_quantity AS reservedQuantity, availability
         FROM inventory WHERE id = ? LIMIT 1 FOR UPDATE`, [inventoryId]);
      return rows[0] ?? null;
    },
    async updateInventoryPrice(inventoryId, priceCentavos) {
      await connection.query(`UPDATE inventory SET price_centavos = ? WHERE id = ?`, [priceCentavos, inventoryId]);
    },
    async appendStockMovement({ inventoryId, actorId, countDelta, reason }) {
      await connection.query(
        `INSERT INTO stock_movements (inventory_id, actor_id, movement_type, stock_on_hand_delta, reserved_delta, reason)
         VALUES (?, ?, 'adjustment', ?, 0, ?)`, [inventoryId, Number(actorId), countDelta, reason]);
    },
    async appendAudit(userId, action, description) {
      await connection.query(`INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`, [Number(userId), action, description]);
    },
  };
}

export function createPostgresInventoryRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool, { capability: 'inventory_mutation' });
  const browsingPool = createPostgresCompatPool(postgresPool, { capability: 'catalog_browse' });
  const intakePool = createPostgresCompatPool(postgresPool, { capability: 'inventory_intake' });
  const submitPool = createPostgresCompatPool(postgresPool, { capability: 'stock_submission' });
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') throw new TypeError('A PostgreSQL query-capable pool is required.');
  const repository = {
    async withTransaction(work, { intake = false } = {}) {
      const connection = await (intake ? intakePool : pool).getConnection();
      try {
        await connection.beginTransaction();
        const result = await work(createTransactionRepository(connection));
        if (result?.rollback === true) { await connection.rollback(); return result.value; }
        await connection.commit(); return result?.value;
      } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
      } finally { connection.release(); }
    },
    async findInventoryForUpdate() { throw new Error('findInventoryForUpdate() is transaction-scoped.'); },
    async updateInventoryStock() { throw new Error('updateInventoryStock() is transaction-scoped.'); },
    async findInventoryByIdForUpdate() { throw new Error('findInventoryByIdForUpdate() is transaction-scoped.'); },
    async updateInventoryPrice() { throw new Error('updateInventoryPrice() is transaction-scoped.'); },
    async appendAudit() { throw new Error('appendAudit() is transaction-scoped.'); },
    async findDrugstoreName(drugstoreId) {
      const [rows] = await submitPool.query(`SELECT name FROM drugstores WHERE id = ? AND is_active = 1 AND verification_status = 'verified' LIMIT 1`, [drugstoreId]);
      return rows[0]?.name ?? null;
    },
    async findCatalogMatches({ ids, names }) {
      const idList = ids.length ? ids : [0];
      const nameList = names.length ? names : [''];
      const [rows] = await browsingPool.query(
        `SELECT id, brand_name AS "brandName", dosage_form AS "dosageForm" FROM medicines
         WHERE id IN (${idList.map(() => '?').join(',')}) OR lower(brand_name) IN (${nameList.map(() => '?').join(',')})`,
        [...idList, ...nameList.map((name) => name.toLowerCase())]);
      return rows;
    },
    async createStockSubmission({ drugstoreId, userId, source, fileName, rows }) {
      const [result] = await submitPool.query(
        `INSERT INTO stock_submissions (drugstore_id, submitted_by, source, file_name, rows, row_count) VALUES (?, ?, ?, ?, ?::jsonb, ?)`,
        [drugstoreId, userId, source, fileName, JSON.stringify(rows), rows.length]);
      return Number(result.insertId) || null;
    },
    async listStockSubmissions({ drugstoreId = null, status = null, withRows = false } = {}) {
      let sql = `SELECT s.id, s.drugstore_id AS "drugstoreId", d.name AS "drugstoreName", d.account_no AS "accountNo", s.source, s.status,
                        s.file_name AS "fileName", s.row_count AS "rowCount", s.review_note AS "reviewNote",
                        s.created_at AS "createdAt", s.reviewed_at AS "reviewedAt"${withRows ? ', s.rows' : ''}
                 FROM stock_submissions s JOIN drugstores d ON d.id = s.drugstore_id WHERE 1 = 1`;
      const params = [];
      if (drugstoreId) { sql += ' AND s.drugstore_id = ?'; params.push(drugstoreId); }
      if (status) { sql += ' AND s.status = ?'; params.push(status); }
      sql += ' ORDER BY s.created_at DESC, s.id DESC LIMIT 200';
      const [rows] = await pool.query(sql, params);
      return rows;
    },
    async listIntakeProducts(drugstoreId) {
      // The catalog a pharmacy can pick from is every medicine that at least one public pharmacy already sells,
      // plus a flag for the ones this pharmacy already sells ("alreadyStocked").
      const [rows] = await browsingPool.query(
        `SELECT m.id, m.brand_name AS brandName, m.generic_name AS genericName, m.dosage_form AS dosageForm, m.category,
                EXISTS (SELECT 1 FROM inventory i WHERE i.medicine_id = m.id AND i.drugstore_id = ?) AS "alreadyStocked"
         FROM medicines m
         WHERE EXISTS (SELECT 1 FROM inventory s WHERE s.medicine_id = m.id)
         ORDER BY m.brand_name, m.id`, [drugstoreId]);
      return rows;
    },
    async listAdminInventory(drugstoreId = null, { includeDrafts = false } = {}) {
      if (includeDrafts && (!Number.isInteger(drugstoreId) || drugstoreId <= 0)) {
        throw new Error('Partner inventory browsing requires a pharmacy ID.');
      }
      let sql = `SELECT i.id AS inventoryId, i.drugstore_id AS drugstoreId, i.medicine_id AS medicineId,
                        i.price_centavos AS priceCentavos, i.stock_on_hand AS stockOnHand,
                        i.selling_unit AS sellingUnit, i.package_size AS packageSize,
                        i.reserved_quantity AS reservedQuantity,
                        i.expiry_date::text AS "expiryDate", i.low_stock_threshold AS "lowStockThreshold",
                        (i.stock_on_hand - i.reserved_quantity) AS sellableQuantity,
                        i.availability, ds.name AS drugstoreName, m.brand_name AS medicineName,
                        CASE WHEN ${pharmacyCanConfirmSale} THEN ${productIdentity} END AS saleProduct,
                        m.generic_name AS genericName, m.category, m.publication_status AS publicationStatus,
                        CASE
                          WHEN ds.is_active <> 1 OR ds.verification_status <> 'verified' OR ds.public_profile_published_at IS NULL THEN 'pharmacy_review'
                          WHEN (${listingEligibleForCheckout}) IS NOT TRUE THEN
                            CASE WHEN ${pharmacyCanConfirmSale} THEN 'pharmacy_confirmation' ELSE 'catalog_review' END
                          WHEN i.stock_on_hand <= i.reserved_quantity THEN 'out_of_stock'
                          WHEN i.availability <> 1 THEN 'unavailable'
                          ELSE 'orderable'
                        END AS orderingState
                 FROM inventory i JOIN drugstores ds ON ds.id = i.drugstore_id JOIN medicines m ON m.id = i.medicine_id
                 WHERE 1 = 1`;
      const params = [];
      if (drugstoreId !== null) { sql += ` AND i.drugstore_id = ?`; params.push(drugstoreId); }
      if (includeDrafts) sql += ` AND m.publication_status IN ('draft', 'published')`;
      sql += ` ORDER BY ds.name ASC, m.brand_name ASC`;
      // The medicine join needs catalogue read access; the service has already checked pharmacy membership.
      const [rows] = await (includeDrafts ? browsingPool : pool).query(sql, params);
      return rows;
    },
  };
  return assertInventoryRepository(repository);
}
