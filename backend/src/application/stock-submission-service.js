import { actorHasPermission } from '../domain/identity/permissions.js';
import { STOCK_HEADERS, validateStockCsv, validateStockRows } from '../domain/inventory/stock-template.js';
import { pesosToCentavos } from '../domain/money/centavos.js';
import { failure, success } from './result.js';

const rejected = (error, rowErrors) => Object.freeze({ ok: false, status: 400, body: { error, rowErrors: rowErrors.slice(0, 50) } });
const lower = (value) => String(value ?? '').trim().toLowerCase();

export function createStockSubmissionService({ repository }) {
  for (const method of ['withTransaction', 'findDrugstoreName', 'findCatalogMatches', 'createStockSubmission', 'listStockSubmissions']) {
    if (typeof repository?.[method] !== 'function') throw new TypeError(`Stock submission repository must implement ${method}().`);
  }

  return Object.freeze({
    async submit(actorId, actor, body = {}) {
      const drugstoreId = Number(body.drugstoreId);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Choose a pharmacy.');
      if (actor?.role !== 'partner' || !actorHasPermission(actor, 'inventory:adjust', drugstoreId)) return failure(403, 'Inventory access denied.');
      const hasCsv = typeof body.csv === 'string';
      if (hasCsv === (body.row !== undefined)) return failure(400, 'Send either a CSV file or one row.');
      const pharmacyName = await repository.findDrugstoreName(drugstoreId);
      if (!pharmacyName) return failure(404, 'Pharmacy not found, or it is not verified.');

      const { rows, errors } = hasCsv
        ? validateStockCsv(body.csv, { pharmacyName })
        : validateStockRows([Object.fromEntries(STOCK_HEADERS.map((name) => [name, name === 'pharmacy' ? (body.row?.pharmacy || pharmacyName) : body.row?.[name]]))], { pharmacyName, firstLine: 1 });
      if (errors.length) return rejected('The stock does not follow the template.', errors);

      const matches = await repository.findCatalogMatches({
        ids: rows.filter((row) => row.catalogId).map((row) => row.catalogId),
        names: rows.map((row) => row.name),
      });
      const byId = new Map(matches.map((item) => [Number(item.id), item]));
      const problems = [];
      const checked = rows.map((row) => {
        if (row.catalogId) {
          const found = byId.get(row.catalogId);
          if (found) {
            if (lower(found.brandName) !== lower(row.name) && lower(found.brandName) !== lower(row.brand)) {
              problems.push({ line: row.line, message: `catalog_id ${row.catalogId} is ${found.brandName}, not ${row.name}.` });
            }
            return { ...row, match: 'existing', medicineId: Number(found.id) };
          }
          return { ...row, catalogId: null, match: 'new', note: `catalog_id ${row.catalogId} was not found, so it will be added as a new medicine.` };
        }
        const same = matches.find((item) => lower(item.brandName) === lower(row.name) && lower(item.dosageForm) === lower(row.form));
        if (same) problems.push({ line: row.line, message: `${row.name} (${row.form}) is already in the catalog as catalog_id ${same.id}. Put that number in catalog_id.` });
        return { ...row, match: 'new' };
      });
      if (problems.length) return rejected('The stock does not match the catalog.', problems);

      const fileName = hasCsv ? String(body.fileName ?? '').trim().slice(0, 120) || null : null;
      const id = await repository.createStockSubmission({ drugstoreId, userId: Number(actorId), source: hasCsv ? 'csv' : 'single', fileName, rows: checked });
      if (!id) return failure(409, 'The submission could not be saved.');
      return success({ id, status: 'pending', rowCount: checked.length, newMedicines: checked.filter((row) => row.match === 'new').length }, 201);
    },

    async listForPartner(actor, query = {}) {
      const memberships = Array.isArray(actor?.memberships) ? actor.memberships.filter((item) => item.isActive !== false) : [];
      const requested = Number(query.drugstoreId ?? memberships[0]?.drugstoreId);
      if (!Number.isInteger(requested) || requested <= 0) return failure(403, 'No active pharmacy membership.');
      if (actor?.role !== 'partner' || !actorHasPermission(actor, 'inventory:adjust', requested)) return failure(403, 'Inventory access denied.');
      const pharmacyName = await repository.findDrugstoreName(requested);
      return success({ pharmacyName, submissions: await repository.listStockSubmissions({ drugstoreId: requested }) });
    },

    async listForAdmin(query = {}) {
      return success(await repository.listStockSubmissions({ status: query.status ?? null, withRows: true }));
    },

    async decide(actorId, idValue, body = {}) {
      const id = Number(idValue);
      if (!Number.isInteger(id) || id <= 0) return failure(400, 'Invalid submission ID.');
      const note = String(body.note ?? '').trim() || null;
      if (body.decision === 'reject' && (!note || note.length < 3)) return failure(400, 'Tell the pharmacy why it was rejected.');
      if (body.decision !== 'approve' && body.decision !== 'reject') return failure(400, 'Choose approve or reject.');

      return repository.withTransaction(async (transaction) => {
        const submission = await transaction.lockStockSubmission(id);
        if (!submission) return { rollback: true, value: failure(404, 'Submission not found.') };
        if (submission.status !== 'pending') return { rollback: true, value: failure(409, 'This submission was already reviewed.') };
        const drugstoreId = Number(submission.drugstoreId);

        if (body.decision === 'approve') {
          const rows = [...(Array.isArray(submission.rows) ? submission.rows : [])].sort((a, b) => a.line - b.line);
          for (const row of rows) {
            const priceCentavos = pesosToCentavos(row.price);
            const stock = Number(row.stock);
            if (priceCentavos === null || priceCentavos < 1 || !Number.isSafeInteger(stock) || stock < 0) {
              return { rollback: true, value: failure(409, `Line ${row.line} has an invalid price or stock.`) };
            }
            let medicineId = row.medicineId ? Number(row.medicineId) : null;
            if (!medicineId) {
              medicineId = await transaction.createPharmacyProduct({ brandName: row.name, genericName: row.genericName, dosageForm: row.form, category: row.category });
              if (!medicineId) return { rollback: true, value: failure(409, `Line ${row.line}: the medicine could not be created.`) };
            }
            const existing = await transaction.findInventoryForUpdate(drugstoreId, medicineId);
            let inventoryId; let before = 0;
            if (existing) {
              inventoryId = Number(existing.id);
              before = Number(existing.stockOnHand);
              const reserved = Number(existing.reservedQuantity);
              if (stock < reserved) return { rollback: true, value: failure(409, `Line ${row.line}: stock cannot be below the ${reserved} units reserved for orders.`) };
              if (reserved > 0 && (existing.sellingUnit ?? null) !== row.sellingUnit) {
                return { rollback: true, value: failure(409, `Line ${row.line}: the selling unit cannot change while stock is reserved.`) };
              }
              await transaction.updateInventoryStock(drugstoreId, medicineId, stock, stock - reserved > 0 ? 1 : 0);
              if (Number(existing.priceCentavos) !== priceCentavos) await transaction.updateInventoryPrice(inventoryId, priceCentavos);
              if ((existing.sellingUnit ?? null) !== row.sellingUnit) await transaction.updateInventoryUnits(inventoryId, row.sellingUnit, existing.packageSize ?? null);
            } else {
              inventoryId = await transaction.insertReviewedListing(drugstoreId, medicineId, stock, priceCentavos, row.sellingUnit, Number(actorId));
              if (!inventoryId) return { rollback: true, value: failure(409, `Line ${row.line}: the pharmacy must be verified and active, and the medicine must exist.`) };
            }
            if (stock - before !== 0) {
              await transaction.appendStockMovement({ inventoryId, actorId, countDelta: stock - before, reason: `Approved stock submission #${id}` });
            }
          }
          await transaction.appendAudit(actorId, 'APPROVE_STOCK_SUBMISSION', `Approved stock submission ${id} (${rows.length} rows) for pharmacy ${drugstoreId}.`);
        } else {
          await transaction.appendAudit(actorId, 'REJECT_STOCK_SUBMISSION', `Rejected stock submission ${id} for pharmacy ${drugstoreId}.`);
        }
        if (!(await transaction.decideStockSubmission(id, body.decision === 'approve' ? 'approved' : 'rejected', note, Number(actorId)))) {
          return { rollback: true, value: failure(409, 'This submission was already reviewed.') };
        }
        return { value: success({ id, status: body.decision === 'approve' ? 'approved' : 'rejected' }) };
      });
    },
  });
}
