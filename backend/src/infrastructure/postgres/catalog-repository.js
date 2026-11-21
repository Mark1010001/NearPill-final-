import { assertCatalogRepository } from '../../ports/catalog-repository.js';
import { listingEligibleForCheckout } from './catalog-orderability.js';
import { createPostgresCompatPool } from './compat-pool.js';

const publicStorePredicate = `
  ds.is_active = 1
  AND ds.verification_status = 'verified'
  AND ds.public_profile_published_at IS NOT NULL
`;

export function createPostgresCatalogRepository(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool);
  const browsingPool = createPostgresCompatPool(postgresPool, { capability: 'catalog_browse' });
  if (!pool || typeof pool.query !== 'function' || typeof pool.getConnection !== 'function') {
    throw new TypeError('A PostgreSQL query-capable pool is required.');
  }

  const repository = {
    async searchAvailableMedicines({ search = '', category = '', storeId = null, limit = 30, offset = 0, includeCatalog = false, latitude = null, longitude = null } = {}) {
      const hasPosition = latitude !== null && longitude !== null;
      const distance = hasPosition ? `ROUND((nearpill_extensions.earth_distance(
        nearpill_extensions.ll_to_earth(?, ?),
        nearpill_extensions.ll_to_earth(ds.latitude::DOUBLE PRECISION, ds.longitude::DOUBLE PRECISION)
      ) / 1000.0)::NUMERIC, 2)` : 'NULL';
      let sql = `
        SELECT
          m.id AS id,
          m.brand_name AS name,
          m.generic_name AS genericName,
          i.selling_unit AS sellingUnit, i.package_size AS packageSize,
          i.price_centavos AS priceCentavos,
          (i.price_centavos::numeric / 100) AS price,
          ds.name AS drugstoreName,
          ds.id AS drugstoreId,
          m.category AS category,
          m.dosage_form AS dosageForm,
          CASE WHEN ${listingEligibleForCheckout} THEN 'published' ELSE m.publication_status END AS publicationStatus,
          i.availability AS availability,
          (${listingEligibleForCheckout}
            AND i.availability = 1 AND i.stock_on_hand - i.reserved_quantity > 0) AS canOrder,
          (i.stock_on_hand - i.reserved_quantity) AS stockCount,
          m.description AS description,
          i.updated_at AS availabilityUpdatedAt,
          NULL AS distance,
          ${distance} AS distanceKm,
          (SELECT COUNT(*) FROM medicine_evidence me WHERE me.medicine_id = m.id AND me.status = 'approved') AS evidenceCount
        FROM inventory i
        JOIN medicines m ON m.id = i.medicine_id
        JOIN drugstores ds ON ds.id = i.drugstore_id
        WHERE ${publicStorePredicate}
          ${includeCatalog
            ? "AND m.publication_status IN ('draft', 'published')"
            : `AND ${listingEligibleForCheckout} AND i.availability = 1 AND i.stock_on_hand - i.reserved_quantity > 0`}
      `;
      const params = hasPosition ? [latitude, longitude] : [];

      if (search) {
        sql += `
          AND (
            m.search_document @@ websearch_to_tsquery('simple', ?)
            OR m.brand_name ILIKE ?
            OR COALESCE(m.generic_name, '') ILIKE ?
            OR similarity(m.brand_name, ?) >= 0.25
            OR similarity(COALESCE(m.generic_name, ''), ?) >= 0.25
          )
        `;
        const searchValue = `%${search}%`;
        params.push(search, searchValue, searchValue, search, search);
      }

      if (category) {
        sql += ` AND m.category = ? `;
        params.push(category);
      }

      if (storeId !== null) {
        sql += ` AND ds.id = ? `;
        params.push(storeId);
      }

      if (search) {
        sql += ` ORDER BY ${hasPosition ? 'distanceKm ASC, ' : ''}GREATEST(similarity(m.brand_name, ?), similarity(COALESCE(m.generic_name, ''), ?)) DESC, m.brand_name ASC, ds.name ASC, i.id ASC `;
        params.push(search, search);
      } else {
        sql += ` ORDER BY ${hasPosition ? 'distanceKm ASC, ' : ''}m.brand_name ASC, ds.name ASC, i.id ASC `;
      }
      sql += ` LIMIT ? OFFSET ? `;
      params.push(limit, offset);

      const [rows] = await browsingPool.query(sql, params);
      return rows;
    },

    async findMedicineById(medicineId) {
      const [rows] = await browsingPool.query(
        `
        SELECT
          m.id AS id,
          m.brand_name AS name,
          m.generic_name AS genericName,
          m.dosage_form AS dosageForm,
          m.category AS category,
          m.description AS description,
          m.published_at AS publishedAt,
          m.created_at AS createdAt
        FROM medicines m
        WHERE m.id = ?
          AND (m.publication_status = 'published' OR EXISTS (
            SELECT 1 FROM inventory i JOIN drugstores ds ON ds.id = i.drugstore_id
            WHERE i.medicine_id = m.id AND ${publicStorePredicate} AND ${listingEligibleForCheckout}
          ))
        LIMIT 1
        `,
        [medicineId],
      );
      return rows[0] ?? null;
    },

    async findMedicineInventoryById(medicineId) {
      const [rows] = await browsingPool.query(
        `
        SELECT
          i.id AS inventoryId,
          i.drugstore_id AS drugstoreId,
          ds.name AS drugstoreName,
          ds.address AS address,
          ds.latitude AS latitude,
          ds.longitude AS longitude,
          i.selling_unit AS sellingUnit, i.package_size AS packageSize,
          i.price_centavos AS priceCentavos,
          (i.price_centavos::numeric / 100) AS price,
          (i.stock_on_hand - i.reserved_quantity) AS stockCount,
          i.availability AS availability,
          i.updated_at AS availabilityUpdatedAt
        FROM inventory i
        JOIN drugstores ds ON ds.id = i.drugstore_id
        JOIN medicines m ON m.id = i.medicine_id
        WHERE i.medicine_id = ?
          AND ${publicStorePredicate}
          AND ${listingEligibleForCheckout}
          AND i.availability = 1
          AND i.stock_on_hand - i.reserved_quantity > 0
        ORDER BY ds.name ASC
        `,
        [medicineId],
      );
      return rows;
    },

    async listMedicineEvidence(medicineId) {
      const [rows] = await pool.query(
        `
        SELECT
          source_name AS sourceName,
          source_url AS sourceUrl,
          source_version AS sourceVersion,
          reviewed_at AS reviewedAt
        FROM medicine_evidence
        WHERE medicine_id = ? AND status = 'approved'
        ORDER BY reviewed_at DESC, id DESC
        `,
        [medicineId],
      );
      return rows;
    },

    async listActiveStores() {
      const [rows] = await pool.query(`
        SELECT
          ds.id AS store_id,
          ds.name AS store_name,
          ds.address,
          ds.latitude,
          ds.longitude,
          ds.operating_hours,
          ds.is_active,
          ds.verified_at AS verifiedAt,
          ds.public_profile_published_at AS publicProfilePublishedAt
        FROM drugstores ds
        WHERE ${publicStorePredicate}
        ORDER BY ds.name ASC
      `);
      return rows;
    },

    async findPublicStoreById(storeId) {
      const [rows] = await pool.query(
        `
        SELECT
          ds.id,
          ds.name,
          ds.address,
          ds.latitude,
          ds.longitude,
          ds.operating_hours,
          ds.is_active,
          ds.verified_at AS verifiedAt,
          ds.public_profile_published_at AS publicProfilePublishedAt
        FROM drugstores ds
        WHERE ds.id = ? AND ${publicStorePredicate}
        LIMIT 1
        `,
        [storeId],
      );
      return rows[0] ?? null;
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
          is_active,
          verification_status,
          verified_at,
          public_profile_published_at
        FROM drugstores
        WHERE id = ?
        LIMIT 1
        `,
        [storeId],
      );
      return rows[0] ?? null;
    },

    async listStoreInventory(storeId, { includeCatalog = false } = {}) {
      const [rows] = await browsingPool.query(
        `
        SELECT
          m.id AS id,
          m.brand_name AS name,
          m.generic_name AS genericName,
          i.selling_unit AS sellingUnit, i.package_size AS packageSize,
          i.price_centavos AS priceCentavos,
          (i.price_centavos::numeric / 100) AS price,
          ds.name AS drugstoreName,
          ds.id AS drugstoreId,
          m.category AS category,
          m.dosage_form AS dosageForm,
          (i.stock_on_hand - i.reserved_quantity) AS stockCount,
          i.availability AS availability,
          CASE WHEN ${listingEligibleForCheckout} THEN 'published' ELSE m.publication_status END AS publicationStatus,
          (${listingEligibleForCheckout} AND i.availability = 1 AND i.stock_on_hand - i.reserved_quantity > 0) AS canOrder,
          m.description AS description,
          i.updated_at AS availabilityUpdatedAt,
          NULL AS distance
        FROM inventory i
        JOIN medicines m ON m.id = i.medicine_id
        JOIN drugstores ds ON ds.id = i.drugstore_id
        WHERE ds.id = ?
          AND ${publicStorePredicate}
          AND ${includeCatalog ? "m.publication_status IN ('draft', 'published')" : `${listingEligibleForCheckout} AND i.availability = 1 AND i.stock_on_hand - i.reserved_quantity > 0`}
        ORDER BY m.brand_name ASC, i.id ASC
        `,
        [storeId],
      );
      return rows;
    },

    async findNearbyStores({ latitude, longitude, radiusMeters, limit }) {
      const [rows] = await pool.query(
        `
        SELECT
          ds.id AS store_id,
          ds.name AS store_name,
          ds.address,
          ds.latitude,
          ds.longitude,
          ds.operating_hours,
          ds.verified_at AS verifiedAt,
          ROUND((nearpill_extensions.earth_distance(
            nearpill_extensions.ll_to_earth(?, ?),
            nearpill_extensions.ll_to_earth(ds.latitude::DOUBLE PRECISION, ds.longitude::DOUBLE PRECISION)
          ) / 1000.0)::NUMERIC, 2) AS distanceKm
        FROM drugstores ds
        WHERE ${publicStorePredicate}
          AND nearpill_extensions.earth_box(
            nearpill_extensions.ll_to_earth(?, ?), ?
          ) OPERATOR(nearpill_extensions.@>) nearpill_extensions.ll_to_earth(
            ds.latitude::DOUBLE PRECISION, ds.longitude::DOUBLE PRECISION
          )
          AND nearpill_extensions.earth_distance(
            nearpill_extensions.ll_to_earth(?, ?),
            nearpill_extensions.ll_to_earth(ds.latitude::DOUBLE PRECISION, ds.longitude::DOUBLE PRECISION)
          ) <= ?
        ORDER BY distanceKm ASC, ds.name ASC
        LIMIT ?
        `,
        [latitude, longitude, latitude, longitude, radiusMeters, latitude, longitude, radiusMeters, limit],
      );
      return rows;
    },

    async searchPublicStores({ query, limit }) {
      const pattern = `%${query}%`;
      const [rows] = await pool.query(
        `
        SELECT
          ds.id AS store_id,
          ds.name AS store_name,
          ds.address,
          ds.latitude,
          ds.longitude,
          ds.operating_hours,
          ds.verified_at AS verifiedAt,
          NULL AS distanceKm
        FROM drugstores ds
        WHERE ${publicStorePredicate}
          AND (
            ds.name ILIKE ?
            OR ds.address ILIKE ?
            OR similarity(ds.name, ?) >= 0.25
            OR similarity(ds.address, ?) >= 0.25
          )
        ORDER BY GREATEST(similarity(ds.name, ?), similarity(ds.address, ?)) DESC, ds.name ASC
        LIMIT ?
        `,
        [pattern, pattern, query, query, query, query, limit],
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
          ds.verification_status AS verificationStatus,
          ds.verified_at AS verifiedAt,
          ds.public_profile_published_at AS publicProfilePublishedAt,
          ds.created_at,
          ds.account_no AS accountNo,
          sub.tier AS subscriptionTier,
          pv.license_number AS licenseNumber,
          pv.evidence_reference AS evidenceReference,
          pv.notes AS verificationNotes,
          pv.reviewed_by AS reviewedBy, pv.reviewed_at AS reviewedAt
        FROM drugstores ds
        LEFT JOIN LATERAL (
          SELECT license_number, evidence_reference, notes, reviewed_by, reviewed_at
          FROM pharmacy_verifications
          WHERE drugstore_id = ds.id
          ORDER BY reviewed_at DESC, id DESC
          LIMIT 1
        ) pv ON TRUE
        LEFT JOIN LATERAL (
          SELECT tier FROM subscriptions
          WHERE drugstore_id = ds.id AND status = 'active'
          ORDER BY id DESC
          LIMIT 1
        ) sub ON TRUE
        ORDER BY ds.name ASC
      `);
      return rows;
    },

    async listDrugstoreSales() {
      const [rows] = await pool.query(`
        SELECT
          od.drugstore_id AS drugstoreId,
          COUNT(DISTINCT od.order_id) AS totalOrders,
          COALESCE(SUM(oi.quantity * oi.unit_price_centavos), 0)::numeric / 100 AS totalSales
        FROM order_drugstores od
        JOIN orders o ON o.id = od.order_id
        JOIN order_items oi ON oi.order_drugstore_id = od.id
        WHERE o.status IN ('confirmed', 'preparing', 'ready_for_pickup', 'completed')
        GROUP BY od.drugstore_id
      `);
      return rows;
    },

    async createDrugstore({ name, address, latitude, longitude, operatingHours, isActive }) {
      const [result] = await pool.query(
        `
        INSERT INTO drugstores
          (name, address, latitude, longitude, operating_hours, is_active, verification_status, account_no)
        VALUES
          (?, ?, ?, ?, ?, ?, 'verified', (SELECT COALESCE(
            (SELECT MIN(n) FROM generate_series(1, (SELECT COALESCE(MAX(account_no), 0) + 1 FROM drugstores)) AS n
              WHERE NOT EXISTS (SELECT 1 FROM drugstores x WHERE x.account_no = n)), 1)))
        `,
        [name, address, latitude, longitude, operatingHours, isActive],
      );
      return Number(result.insertId);
    },

    async getGoLiveFacts(drugstoreId) {
      const [rows] = await pool.query(
        `SELECT d.id, d.name, d.address, d.latitude, d.longitude, d.operating_hours AS "operatingHours", d.account_no AS "accountNo",
                d.verification_status AS "verificationStatus", d.is_active AS "isActive", d.public_profile_published_at AS "publishedAt",
                (SELECT COUNT(*) FROM drugstores o WHERE o.id <> d.id AND o.is_active = 1 AND lower(o.name) = lower(d.name)) AS "duplicateNames",
                (SELECT COUNT(*) FROM subscriptions s WHERE s.drugstore_id = d.id AND s.status = 'active'
                   AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)) AS "activePlans",
                (SELECT COUNT(*) FROM inventory i WHERE i.drugstore_id = d.id AND i.stock_on_hand > 0
                   AND i.price_centavos > 0 AND i.selling_unit IS NOT NULL) AS "stockedItems"
         FROM drugstores d WHERE d.id = ? LIMIT 1`, [drugstoreId]);
      return rows[0] ?? null;
    },

    async setPublication(drugstoreId, live) {
      const [result] = await pool.query(
        `UPDATE drugstores
         SET public_profile_published_at = ${live ? 'CURRENT_TIMESTAMP' : 'NULL'}
         WHERE id = ? AND is_active = 1 AND verification_status = 'verified'`, [drugstoreId]);
      return Number(result.affectedRows ?? 0) === 1;
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

    async setPharmacyVerification({ drugstoreId, status, licenseNumber, evidenceReference, notes, reviewedBy, publish }) {
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();
        const verifiedAt = status === 'verified' ? new Date() : null;
        const publicProfilePublishedAt = status === 'verified' && publish ? verifiedAt : null;
        const [updated] = await connection.query(
          `UPDATE drugstores
           SET verification_status = ?, verified_at = ?, public_profile_published_at = ?
           WHERE id = ?`,
          [status, verifiedAt, publicProfilePublishedAt, drugstoreId],
        );
        if (Number(updated.affectedRows ?? 0) !== 1) {
          await connection.rollback();
          return false;
        }
        await connection.query(
          `INSERT INTO pharmacy_verifications
            (drugstore_id, status, license_number, evidence_reference, notes, reviewed_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [drugstoreId, status, licenseNumber, evidenceReference, notes, reviewedBy],
        );
        await connection.commit();
        return true;
      } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
      } finally {
        connection.release();
      }
    },

    async listMasterMedicines() {
      const [rows] = await pool.query(`
        SELECT
          m.id,
          m.brand_name AS brandName,
          m.generic_name AS genericName,
          m.dosage_form AS dosageForm,
          m.category,
          m.description,
          m.publication_status AS publicationStatus,
          m.otc_eligible AS otcEligible,
          m.published_at AS publishedAt,
          m.created_at AS createdAt,
          COALESCE((SELECT json_agg(json_build_object('id', ds.id, 'name', ds.name,
            'inventoryId', i.id, 'priceCentavos', i.price_centavos::text,
            'sellingUnit', i.selling_unit, 'packageSize', i.package_size,
            'stockOnHand', i.stock_on_hand, 'sellableQuantity', i.stock_on_hand - i.reserved_quantity) ORDER BY ds.name, ds.id)
            FROM inventory i JOIN drugstores ds ON ds.id = i.drugstore_id WHERE i.medicine_id = m.id AND ds.is_active = 1), '[]'::json) AS linkedPharmacies,
          COALESCE((SELECT json_agg(json_build_object('id', me.id, 'name', me.source_name, 'status', me.status) ORDER BY me.id)
            FROM medicine_evidence me WHERE me.medicine_id = m.id), '[]'::json) AS savedEvidence,
          (SELECT COUNT(*) FROM medicine_evidence me WHERE me.medicine_id = m.id AND me.status = 'approved') AS approvedEvidenceCount
        FROM medicines m
        ORDER BY m.brand_name ASC
      `);
      return rows;
    },

    async createMedicine({ brandName, genericName, dosageForm, category, description }) {
      const [result] = await pool.query(
        `
        INSERT INTO medicines
          (brand_name, generic_name, dosage_form, category, description, publication_status)
        VALUES
          (?, ?, ?, ?, ?, 'draft')
        `,
        [brandName, genericName, dosageForm, category, description],
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
          description,
          publication_status,
          otc_eligible,
          published_at
        FROM medicines
        WHERE id = ?
        LIMIT 1
        `,
        [medicineId],
      );
      return rows[0] ?? null;
    },

    async updateMedicine(medicineId, { brandName, genericName, dosageForm, category, description }) {
      const [result] = await pool.query(
        `
        UPDATE medicines
        SET
          brand_name = ?,
          generic_name = ?,
          dosage_form = ?,
          category = ?,
          description = ?
        WHERE id = ?
        `,
        [brandName, genericName, dosageForm, category, description, medicineId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async listAdminMedicineEvidence(medicineId) {
      const [rows] = await pool.query(
        `SELECT id, medicine_id AS medicineId, source_name AS sourceName, source_url AS sourceUrl,
                source_version AS sourceVersion, status, reviewed_by AS reviewedBy,
                reviewed_at AS reviewedAt, created_at AS createdAt
         FROM medicine_evidence
         WHERE medicine_id = ?
         ORDER BY reviewed_at DESC, id DESC`,
        [medicineId],
      );
      return rows;
    },

    async addMedicineEvidence({ medicineId, sourceName, sourceUrl, sourceVersion, status, reviewedBy }) {
      const [result] = await pool.query(
        `INSERT INTO medicine_evidence
          (medicine_id, source_name, source_url, source_version, status, reviewed_by)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [medicineId, sourceName, sourceUrl, sourceVersion, status, reviewedBy],
      );
      return Number(result.insertId);
    },

    async countApprovedMedicineEvidence(medicineId) {
      const [rows] = await pool.query(
        `SELECT COUNT(*) AS count FROM medicine_evidence WHERE medicine_id = ? AND status = 'approved'`,
        [medicineId],
      );
      return Number(rows[0]?.count ?? 0);
    },

    async updateMedicinePublication(medicineId, status, reviewReference, category) {
      if (reviewReference) {
        const [result] = await pool.query(
          `UPDATE medicines m SET otc_eligible = true, otc_review_reference = ?, otc_reviewed_at = CURRENT_TIMESTAMP,
                  publication_status = 'published', published_at = CURRENT_TIMESTAMP
           WHERE m.id = ? AND m.publication_status = 'draft' AND NOT m.otc_eligible AND m.category = ?
             AND EXISTS (SELECT 1 FROM medicine_evidence e WHERE e.medicine_id = m.id AND e.status = 'approved')`,
          [reviewReference, medicineId, category],
        );
        return Number(result.affectedRows ?? 0);
      }
      const [result] = await pool.query(
        `UPDATE medicines
         SET publication_status = ?, published_at = CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END
         WHERE id = ?`,
        [status, status, medicineId],
      );
      return Number(result.affectedRows ?? 0);
    },

    async appendAudit(userId, action, description) {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, description) VALUES (?, ?, ?)`,
        [Number(userId), action, description],
      );
    },
  };

  return assertCatalogRepository(repository);
}
