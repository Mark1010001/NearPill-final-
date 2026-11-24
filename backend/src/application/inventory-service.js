import { actorHasPermission } from '../domain/identity/permissions.js';
import { centavosToPesosNumber, pesosToCentavos } from '../domain/money/centavos.js';
import { assertInventoryRepository } from '../ports/inventory-repository.js';
import { failure, success } from './result.js';

export function createInventoryService({ repository }) {
  assertInventoryRepository(repository);

  return Object.freeze({
    async listIntakeProducts(actor, drugstoreIdValue) {
      const drugstoreId = Number(drugstoreIdValue);
      if (actor?.role !== 'partner' || !actorHasPermission(actor, 'inventory:adjust', drugstoreId)) return failure(403, 'Inventory access denied.');
      return success(await repository.listIntakeProducts(drugstoreId));
    },

    async addApprovedListing(actorId, actor, body = {}) {
      const { drugstoreId, items } = body;
      if (actor?.role !== 'partner' || !actorHasPermission(actor, 'inventory:adjust', drugstoreId)) return failure(403, 'Inventory access denied.');
      const inputs = items ?? [body];
      if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100) return failure(400, 'Submit 1 to 100 products.');
      const rows = new Map();
      for (const input of inputs) {
        const { medicineId, stock, price, sellingUnit, packageSize } = input ?? {};
        const priceCentavos = pesosToCentavos(price);
        if (!Number.isSafeInteger(medicineId) || medicineId <= 0 || !Number.isSafeInteger(stock) ||
            stock < 1 || stock > 2_147_483_647 || priceCentavos === null || priceCentavos < 1) {
          return failure(400, 'Select a catalog item and enter positive stock and a valid price.');
        }
        if (rows.has(medicineId)) return failure(400, `Catalog #${medicineId} appears more than once.`);
        rows.set(medicineId, { stock, priceCentavos, sellingUnit, packageSize });
      }
      return repository.withTransaction(async (transaction) => {
        const created = [];
        for (const medicineId of [...rows.keys()].sort((a, b) => a - b)) {
          const { stock, priceCentavos, sellingUnit, packageSize } = rows.get(medicineId);
          const inventoryId = await transaction.addApprovedListing(drugstoreId, medicineId, stock, priceCentavos, sellingUnit, packageSize, actorId);
          if (!inventoryId) return { rollback: true, value: failure(409,
            `Catalog #${medicineId}: the item is already listed, does not exist, or the pharmacy is not public.`) };
          await transaction.appendStockMovement({ inventoryId, actorId, countDelta: stock, reason: 'Partner initial stock intake' });
          await transaction.appendAudit(actorId, 'ADD_APPROVED_INVENTORY', `Added catalog item ${medicineId} to pharmacy ${drugstoreId} with ${stock} units at ${priceCentavos} centavos.`);
          created.push({ inventoryId, medicineId, drugstoreId, stockOnHand: stock, priceCentavos });
        }
        return { value: success(items ? { items: created } : created[0], 201) };
      }, { intake: true });
    },

    async createPharmacyProduct(actorId, actor, body = {}) {
      const { drugstoreId, stock, price, sellingUnit, packageSize, category } = body;
      if (actor?.role !== 'partner' || !actorHasPermission(actor, 'inventory:adjust', drugstoreId)) return failure(403, 'Inventory access denied.');
      const brandName = String(body.brandName ?? '').trim();
      const genericName = String(body.genericName ?? '').trim() || null;
      const dosageForm = String(body.dosageForm ?? '').trim();
      const priceCentavos = pesosToCentavos(price);
      if (brandName.length < 2 || dosageForm.length < 2 || !['Non-prescription', 'Prescription', 'Non-medicine'].includes(category) ||
          !Number.isSafeInteger(stock) || stock < 1 || stock > 2_147_483_647 || priceCentavos === null || priceCentavos < 1 || !sellingUnit) {
        return failure(400, 'Enter the medicine name, form, category, selling unit, a price above zero and at least 1 unit of stock.');
      }
      return repository.withTransaction(async (transaction) => {
        const medicineId = await transaction.createPharmacyProduct({ brandName, genericName, dosageForm, category });
        if (!medicineId) return { rollback: true, value: failure(409, 'The medicine could not be created.') };
        const inventoryId = await transaction.addNewProductListing(drugstoreId, medicineId, stock, priceCentavos, sellingUnit, packageSize ?? null, Number(actorId));
        if (!inventoryId) return { rollback: true, value: failure(409, 'The pharmacy must be verified and public to add products.') };
        await transaction.appendStockMovement({ inventoryId, actorId, countDelta: stock, reason: 'Partner new product intake' });
        await transaction.appendAudit(actorId, 'ADD_APPROVED_INVENTORY', `Created ${category} product ${medicineId} for pharmacy ${drugstoreId} with ${stock} units at ${priceCentavos} centavos.`);
        return { value: success({ inventoryId, medicineId, drugstoreId, category, stockOnHand: stock, priceCentavos }, 201) };
      }, { intake: true });
    },

    async updateStock(actorId, actor, body = {}) {
      const drugstoreId = Number(body.pharmacyId ?? body.drugstoreId);
      const medicineId = Number(body.medId ?? body.medicineId);
      const { stockOnHand: requestedStock, expectedStockOnHand, sellingUnit, packageSize } = body;
      const setsTotal = requestedStock !== undefined || expectedStockOnHand !== undefined;
      const setsPrice = body.price !== undefined || body.expectedPriceCentavos !== undefined;
      const requestedPrice = setsPrice ? pesosToCentavos(body.price) : null;
      const adjustment = Number(body.countDelta);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Invalid pharmacy ID.');
      if (!Number.isInteger(medicineId) || medicineId <= 0) return failure(400, 'Invalid medicine ID.');
      if (setsTotal && (body.countDelta !== undefined || !Number.isInteger(requestedStock) || requestedStock < 0 || requestedStock > 2_147_483_647 ||
          !Number.isInteger(expectedStockOnHand) || expectedStockOnHand < 0 || expectedStockOnHand > 2_147_483_647)) {
        return failure(400, 'Enter a whole stock count from zero to 2,147,483,647.');
      }
      if (!setsTotal && (!Number.isSafeInteger(adjustment) || adjustment === 0 || Math.abs(adjustment) > 2_147_483_647)) {
        return failure(400, 'Enter a nonzero whole number within the supported stock adjustment range.');
      }
      if (!actorHasPermission(actor, 'inventory:adjust', drugstoreId)) return failure(403, 'Inventory access denied.');
      const { expiryDate, lowStockThreshold } = body;
      const setsTracking = expiryDate !== undefined || lowStockThreshold !== undefined;
      if (setsTracking && !setsTotal) return failure(400, 'Provide the stock count together with the expiry date or low-stock level.');
      if (expiryDate) {
        const parsed = new Date(`${expiryDate}T00:00:00Z`);
        if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expiryDate) return failure(400, 'Enter a valid expiry date.');
      }
      const { saleProduct } = body;
      if (saleProduct !== undefined) {
        if (actor?.role !== 'partner') return failure(403, 'Pharmacy membership is required to confirm a listing.');
        if (!setsTotal || !Array.isArray(saleProduct) || saleProduct.length !== 4) {
          return failure(400, 'Confirm the category for the selected product.');
        }
      }
      if (setsPrice && (!setsTotal || requestedPrice === null || !Number.isSafeInteger(body.expectedPriceCentavos) || body.expectedPriceCentavos < 0)) {
        return failure(400, 'Enter a valid unit price with up to two decimal places.');
      }
      if ((sellingUnit !== undefined || packageSize !== undefined) && !setsPrice) {
        return failure(400, 'Provide stock and price in the selected selling unit.');
      }

      return repository.withTransaction(async (transaction) => {
        const inventory = await transaction.findInventoryForUpdate(drugstoreId, medicineId);
        if (!inventory) return { rollback: true, value: failure(404, 'Inventory record not found.') };
        const stockOnHand = Number(inventory.stockOnHand);
        const reservedQuantity = Number(inventory.reservedQuantity);
        const priceCentavos = Number(inventory.priceCentavos);
        const currentUnit = inventory.sellingUnit ?? null;
        const currentPackage = inventory.packageSize ?? null;
        if ((body.expectedSellingUnit ?? null) !== currentUnit ||
            (packageSize !== undefined && (body.expectedPackageSize ?? null) !== currentPackage)) {
          return { rollback: true, value: failure(409, 'Selling unit or package size changed. Refresh inventory and review the stock and price.') };
        }
        const nextUnit = sellingUnit ?? currentUnit;
        const nextPackage = packageSize === undefined ? currentPackage : packageSize;
        const unitsChanged = nextUnit !== currentUnit || nextPackage !== currentPackage;
        if (unitsChanged && reservedQuantity > 0) {
          return { rollback: true, value: failure(409, 'Selling unit and package size cannot change while stock is reserved.') };
        }
        if ((setsTotal && stockOnHand !== expectedStockOnHand) || (setsPrice && priceCentavos !== body.expectedPriceCentavos)) {
          return { rollback: true, value: failure(409, 'Stock or price changed. Reopen the editor to check the latest values.') };
        }
        const nextStockOnHand = setsTotal ? requestedStock : stockOnHand + adjustment;
        if (nextStockOnHand > 2_147_483_647) {
          return { rollback: true, value: failure(409, 'Stock on hand exceeds the supported limit.') };
        }
        if (nextStockOnHand < reservedQuantity) {
          return { rollback: true, value: failure(409, 'Stock on hand cannot be reduced below reserved quantity.') };
        }
        const sellableQuantity = nextStockOnHand - reservedQuantity;
        if (saleProduct) {
          if (!await transaction.confirmPharmacySale(Number(inventory.id), actorId, saleProduct)) {
            return { rollback: true, value: failure(409, 'This listing changed or cannot be confirmed for standard checkout. Refresh inventory and check the product category.') };
          }
          await transaction.appendAudit(actorId, 'CONFIRM_PHARMACY_ONLINE_SALE', `Confirmed online sale for inventory ${inventory.id} at pharmacy ${drugstoreId}.`);
        }
        if (nextStockOnHand !== stockOnHand) {
          await transaction.updateInventoryStock(drugstoreId, medicineId, nextStockOnHand, sellableQuantity > 0 ? 1 : 0);
          await transaction.appendStockMovement({ inventoryId: Number(inventory.id), actorId, countDelta: nextStockOnHand - stockOnHand, reason: 'Manual inventory adjustment' });
          await transaction.appendAudit(actorId, 'UPDATE_INVENTORY', `Adjusted inventory for drugstore ${drugstoreId}, medicine ${medicineId}: ${stockOnHand} -> ${nextStockOnHand}; reserved=${reservedQuantity}.`);
        }
        if (setsPrice && requestedPrice !== priceCentavos) {
          await transaction.updateInventoryPrice(Number(inventory.id), requestedPrice);
          await transaction.appendAudit(actorId, 'UPDATE_INVENTORY_PRICE', `Updated inventory ${inventory.id} price from ${priceCentavos} to ${requestedPrice} centavos.`);
        }
        if (setsTracking) {
          const nextExpiry = expiryDate === undefined ? (inventory.expiryDate ?? null) : expiryDate;
          const nextThreshold = lowStockThreshold === undefined ? (inventory.lowStockThreshold ?? null) : lowStockThreshold;
          if (nextExpiry !== (inventory.expiryDate ?? null) || nextThreshold !== (inventory.lowStockThreshold == null ? null : Number(inventory.lowStockThreshold))) {
            await transaction.updateInventoryTracking(Number(inventory.id), nextExpiry, nextThreshold);
            await transaction.appendAudit(actorId, 'UPDATE_INVENTORY_TRACKING', `Inventory ${inventory.id}: expiry ${inventory.expiryDate ?? 'none'} -> ${nextExpiry ?? 'none'}; low-stock level ${inventory.lowStockThreshold ?? 'none'} -> ${nextThreshold ?? 'none'}.`);
          }
        }
        if (unitsChanged) {
          await transaction.updateInventoryUnits(Number(inventory.id), nextUnit, nextPackage);
          await transaction.appendAudit(actorId, 'UPDATE_INVENTORY_UNIT', `Inventory ${inventory.id}: selling unit ${currentUnit ?? 'unspecified'} -> ${nextUnit ?? 'unspecified'}; package ${currentPackage ?? 'unspecified'} -> ${nextPackage ?? 'unspecified'}.`);
        }
        return { value: success({
          success: true, pharmacyId: drugstoreId, medicineId,
          previousStockOnHand: stockOnHand, stockOnHand: nextStockOnHand,
          reservedQuantity, sellableQuantity, availability: sellableQuantity > 0,
        }) };
      });
    },

    async listPartnerInventory(actor, query = {}) {
      const memberships = Array.isArray(actor?.memberships) ? actor.memberships.filter((item) => item.isActive !== false) : [];
      const requested = query.drugstoreId ?? query.pharmacyId;
      const drugstoreId = requested == null || String(requested).trim() === ''
        ? Number(memberships[0]?.drugstoreId)
        : Number(requested);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(403, 'No active pharmacy membership.');
      if (!actorHasPermission(actor, 'inventory:adjust', drugstoreId)) return failure(403, 'Inventory access denied.');
      const rows = await repository.listAdminInventory(drugstoreId, { includeDrafts: true });
      return success(rows.map((row) => ({
        ...row,
        priceCentavos: Number(row.priceCentavos),
        price: centavosToPesosNumber(row.priceCentavos),
        stockOnHand: Number(row.stockOnHand),
        reservedQuantity: Number(row.reservedQuantity),
        sellableQuantity: Number(row.sellableQuantity),
      })));
    },

    async listAdminInventory(query = {}) {
      const raw = query.pharmacyId ?? query.drugstoreId;
      let drugstoreId = null;
      if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
        drugstoreId = Number(raw);
        if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Invalid pharmacy ID.');
      }
      const rows = await repository.listAdminInventory(drugstoreId);
      return success(rows.map((row) => ({
        ...row,
        priceCentavos: Number(row.priceCentavos),
        price: centavosToPesosNumber(row.priceCentavos),
        stockOnHand: Number(row.stockOnHand),
        reservedQuantity: Number(row.reservedQuantity),
        sellableQuantity: Number(row.sellableQuantity),
      })));
    },
  });
}
