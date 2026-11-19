import { createHash, randomInt } from 'node:crypto';
import { actorHasPermission } from '../domain/identity/permissions.js';
import { centavosToPesosNumber } from '../domain/money/centavos.js';
import { minimumPharmacyCheckoutCentavos } from '../domain/payments/policy.js';
import { validatePickup, validatePickupForHours } from '../domain/orders/pickup.js';
import { isSettledPayment } from '../domain/payments/status.js';
import {
  canTransitionOrder,
  normalizeOrderStatus,
  orderStatuses,
} from '../domain/orders/status.js';
import { assertOrderRepository } from '../ports/order-repository.js';
import { failure, success } from './result.js';

function formatDate(date) {
  if (!date) return null;
  try {
    return new Date(date).toLocaleString('en-US', {
      month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return date; }
}

function pickupFields(row) {
  const date = row?.pickupDate;
  const pickupDate = date == null ? null : (date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10));
  return { pickupDate, pickupWindow: row?.pickupWindow ?? null, pickupRescheduled: row?.pickupRescheduled === true };
}

function generateOrderReference(now = Date.now, nextRandom = randomInt, testCheckout = false) {
  return `NP-${testCheckout ? 'TEST-' : ''}${now()}-${nextRandom(1000, 9999)}`;
}

function normalizedIdempotency(value) {
  const key = String(value || '').trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(key) ? key : null;
}

function hasUnresolvedTestPayment(reference, paymentStatus) {
  return reference?.startsWith('NP-TEST-') && ['pending', 'reconciliation_required'].includes(paymentStatus);
}

function orderFingerprint(items) {
  const canonical = [...items]
    .sort((a, b) => a.drugstoreId - b.drugstoreId || a.medicineId - b.medicineId)
    .map((item) => `${item.drugstoreId}:${item.medicineId}:${item.quantity}${item.expectedSellingUnit === undefined ? '' : `:${encodeURIComponent(item.expectedSellingUnit)}`}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Customer-facing category label for an order line. Read from the medicine, so it works for past orders too. */
function orderLineCategory(value) {
  switch (String(value ?? '').trim().toLowerCase().replace(/ \(source list\)$/, '').replace(/\s*-\s*/g, '-')) {
    case 'prescription': case 'prescriptions':
      return 'Prescription';
    case 'non-prescription': case 'non-prescriptions': case 'otc': case 'general otc':
      return 'Non-prescription';
    case 'medical supplies': case 'non-medicine': case 'non-medicines': case 'non medicine': case 'non medicines':
      return 'Non-medicine';
    default:
      return null;
  }
}

function formatCustomerItems(itemRows) {
  return itemRows.map((item) => ({
    id: Number(item.medicineId),
    name: item.medicineName,
    genericName: item.genericName,
    ...(item.sellingUnit ? { sellingUnit: item.sellingUnit } : {}),
    ...(orderLineCategory(item.category) ? { category: orderLineCategory(item.category) } : {}),
    ...(item.dosageForm ? { dosageForm: item.dosageForm } : {}),
    ...(item.prescriptionRequired === true ? { prescriptionRequired: true } : {}),
    priceCentavos: Number(item.unitPriceCentavos),
    price: centavosToPesosNumber(item.unitPriceCentavos),
    quantity: Number(item.quantity),
    drugstoreId: Number(item.drugstoreId),
    drugstoreName: item.drugstoreName,
    status: item.drugstoreStatus,
    ...(item.drugstoreRejectionReason !== undefined ? { rejectionReason: item.drugstoreRejectionReason } : {}),
  }));
}

async function releaseReservations(transaction, orderId, actorId, reason) {
  const reservations = await transaction.listActiveReservationsForUpdate(orderId);
  for (const reservation of reservations) {
    const released = await transaction.releaseReservation({
      reservationId: Number(reservation.id),
      inventoryId: Number(reservation.inventoryId),
      orderId,
      quantity: Number(reservation.quantity),
      actorId,
      reason,
    });
    if (!released) throw new Error('Reservation was already released by another transaction.');
  }
}

async function fulfillReservations(transaction, orderId, actorId, drugstoreId) {
  const reservations = await transaction.listActiveReservationsForUpdate(orderId);
  if (reservations.length === 0) throw new Error('Order has no active reservation to fulfill.');
  if (drugstoreId !== undefined && reservations.some((reservation) => Number(reservation.drugstoreId) !== drugstoreId)) {
    throw new Error('Order reservations do not belong to the pickup pharmacy.');
  }
  for (const reservation of reservations) {
    const fulfilled = await transaction.fulfillReservation({
      reservationId: Number(reservation.id),
      inventoryId: Number(reservation.inventoryId),
      orderId,
      quantity: Number(reservation.quantity),
      actorId,
    });
    if (!fulfilled) throw new Error('Reservation was already finalized by another transaction.');
  }
}

export function createOrderService({ repository, now = Date.now, nextRandom = randomInt, reservationTtlMs = 3 * 24 * 60 * 60 * 1000, checkoutAvailable = false, testCheckout = false }) {
  assertOrderRepository(repository);

  return Object.freeze({
    async createOrder(userIdValue, body = {}) {
      const userId = Number(userIdValue);
      if (!Number.isInteger(userId) || userId <= 0) return failure(401, 'Unauthorized.');

      const requestItems = Array.isArray(body.items) ? body.items : [];
      if (requestItems.length === 0) return failure(400, 'At least one medicine is required.');

      let idempotencyKey = normalizedIdempotency(body.idempotencyKey);
      if (!idempotencyKey && body.requireIdempotency === true) return failure(400, 'Idempotency-Key is required.');
      if (!idempotencyKey) idempotencyKey = `legacy:${userId}:${now()}:${nextRandom(100000, 999999)}`;

      const pickup = validatePickup({ pickupDate: body.pickupDate, pickupWindow: body.pickupWindow }, now());
      if (!pickup.ok) return failure(422, pickup.message);

      const grouped = new Map();
      for (const item of requestItems) {
        const medicineId = Number(item?.id);
        const drugstoreId = Number(item?.drugstoreId);
        const quantity = Number(item?.quantity);
        const expectedUnitPriceCentavos = item?.expectedUnitPriceCentavos;
        const expectedSellingUnit = item?.expectedSellingUnit;
        if (!Number.isInteger(medicineId) || medicineId <= 0) return failure(400, 'Invalid medicine in order.');
        if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Invalid drugstore in order.');
        if (!Number.isInteger(quantity) || quantity <= 0) return failure(400, 'Order quantity must be greater than zero.');
        if (expectedUnitPriceCentavos !== undefined && (!Number.isSafeInteger(expectedUnitPriceCentavos) || expectedUnitPriceCentavos < 0)) {
          return failure(400, 'Invalid reviewed medicine price.');
        }
        const key = `${drugstoreId}:${medicineId}`;
        const existing = grouped.get(key);
        if (existing) {
          if (existing.expectedSellingUnit !== expectedSellingUnit) return failure(400, 'Conflicting selling units for the same medicine.');
          if (existing.expectedUnitPriceCentavos !== undefined && expectedUnitPriceCentavos !== undefined && existing.expectedUnitPriceCentavos !== expectedUnitPriceCentavos) {
            return failure(400, 'Conflicting reviewed prices for the same medicine.');
          }
          existing.expectedUnitPriceCentavos ??= expectedUnitPriceCentavos;
          existing.quantity += quantity;
        } else grouped.set(key, { medicineId, drugstoreId, quantity, expectedUnitPriceCentavos, expectedSellingUnit });
      }
      const finalItems = [...grouped.values()];
      const drugstoreIds = [...new Set(finalItems.map((item) => item.drugstoreId))];
      if (drugstoreIds.length !== 1) return failure(409, 'An order can contain medicines from only one pharmacy.');
      const drugstoreId = drugstoreIds[0];
      const idempotencyFingerprint = orderFingerprint(finalItems);

      try {
        return await repository.withTransaction(async (transaction) => {
          await transaction.lockIdempotencyKey(userId, idempotencyKey);
          const replay = await transaction.findOrderByIdempotency(userId, idempotencyKey);
          if (replay) {
            if (replay.idempotencyFingerprint && replay.idempotencyFingerprint !== idempotencyFingerprint) {
              return { rollback: true, value: failure(409, 'Idempotency key was already used for a different order request.') };
            }
            return { value: success({
              id: Number(replay.id), reference: replay.reference,
              totalCentavos: Number(replay.totalCentavos), total: centavosToPesosNumber(replay.totalCentavos),
              status: replay.status, stage: replay.status, expiresAt: replay.expiresAt,
              ...pickupFields(replay), idempotentReplay: true,
            }) };
          }

          if (!checkoutAvailable) {
            return { rollback: true, value: failure(503, 'GCash checkout is unavailable. No order was placed.') };
          }

          const customer = await transaction.findCustomerById(userId);
          if (!customer) return { rollback: true, value: failure(404, 'Customer account not found.') };
          const store = await transaction.findStoreById(drugstoreId);
          if (!store) throw new Error(`Drugstore ${drugstoreId} does not exist.`);
          if (Number(store.is_active) !== 1) throw new Error(`${store.name} is currently inactive.`);
          const closingCheck = validatePickupForHours(pickup, store.operating_hours, now());
          if (!closingCheck.ok) return { rollback: true, value: failure(422, closingCheck.message) };

          let totalCentavos = 0;
          const verifiedItems = [];
          for (const item of finalItems.sort((a, b) => a.medicineId - b.medicineId)) {
            const inventory = await transaction.findInventoryForUpdate(drugstoreId, item.medicineId, userId);
            if (!inventory) throw new Error(`Medicine ${item.medicineId} is not available at drugstore ${drugstoreId}.`);
            if (inventory.prescriptionRequired === true && inventory.prescriptionApproved !== true) {
              return { rollback: true, value: failure(403, `${inventory.medicineName} needs an approved prescription. Upload your prescription and wait for the pharmacy to approve it.`) };
            }
            if (Number(inventory.availability) !== 1) throw new Error(`${inventory.medicineName} is currently unavailable at ${inventory.drugstoreName}.`);
            const sellable = Number(inventory.sellableQuantity);
            if (sellable < item.quantity) throw new Error(`Not enough stock for ${inventory.medicineName} at ${inventory.drugstoreName}. Available stock: ${sellable}.`);
            const unitPriceCentavos = Number(inventory.priceCentavos);
            const sellingUnit = inventory.sellingUnit ?? undefined;
            if (item.expectedSellingUnit !== sellingUnit) {
              return { rollback: true, value: failure(409, 'Selling unit changed. Review the pharmacy listing again.') };
            }
            if (!Number.isSafeInteger(unitPriceCentavos) || unitPriceCentavos < 0) throw new Error('Invalid authoritative medicine price.');
            if (item.expectedUnitPriceCentavos !== undefined && item.expectedUnitPriceCentavos !== unitPriceCentavos) {
              return { rollback: true, value: failure(409, `The price of ${inventory.medicineName} changed. Review the current price and try again.`) };
            }
            const lineTotalCentavos = unitPriceCentavos * item.quantity;
            if (!Number.isSafeInteger(lineTotalCentavos)) throw new Error('Order amount is too large.');
            totalCentavos += lineTotalCentavos;
            if (!Number.isSafeInteger(totalCentavos)) throw new Error('Order total is too large.');
            verifiedItems.push({ ...item, inventoryId: Number(inventory.inventoryId), unitPriceCentavos, sellingUnit, medicineName: inventory.medicineName, drugstoreName: inventory.drugstoreName });
          }

          if (testCheckout && (totalCentavos < 100 || totalCentavos > 10_000_000)) {
            return { rollback: true, value: failure(422, 'Test orders must total between ₱1 and ₱100,000.') };
          }
          if (body.checkoutMode === 'grouped' && totalCentavos < minimumPharmacyCheckoutCentavos) {
            return { rollback: true, value: failure(422, 'Each pharmacy in grouped checkout needs a subtotal of at least ₱100.') };
          }
          const reference = generateOrderReference(now, nextRandom, testCheckout);
          const expiresAt = new Date(now() + reservationTtlMs);
          const orderId = await transaction.createOrder({ reference, userId, totalCentavos, expiresAt, idempotencyKey, idempotencyFingerprint, pickupDate: pickup.pickupDate, pickupWindow: pickup.pickupWindow });
          const orderDrugstoreId = await transaction.createOrderDrugstore(orderId, drugstoreId);

          for (const item of verifiedItems) {
            await transaction.createOrderItem({ orderDrugstoreId, medicineId: item.medicineId, quantity: item.quantity, unitPriceCentavos: item.unitPriceCentavos,
              ...(item.sellingUnit ? { sellingUnit: item.sellingUnit } : {}) });
            const reserved = await transaction.reserveInventory({ orderId, inventoryId: item.inventoryId, quantity: item.quantity, actorId: userId });
            if (!reserved) throw new Error(`Unable to reserve stock for ${item.medicineName}.`);
          }

          await transaction.appendAudit(userId, 'CREATE_ORDER', `Created reserved order ${reference} with total ${totalCentavos} centavos.`);

          return { value: success({
            id: orderId, reference, totalCentavos, total: centavosToPesosNumber(totalCentavos),
            status: 'reserved', stage: 'reserved', expiresAt,
            pickupDate: pickup.pickupDate, pickupWindow: pickup.pickupWindow, pickupRescheduled: false,
            storeName: store.name, stores: [store.name], idempotentReplay: false,
            items: verifiedItems.map((item) => ({
              id: item.medicineId, name: item.medicineName,
              priceCentavos: item.unitPriceCentavos, price: centavosToPesosNumber(item.unitPriceCentavos),
              ...(item.sellingUnit ? { sellingUnit: item.sellingUnit } : {}),
              quantity: item.quantity, drugstoreId, drugstoreName: item.drugstoreName,
            })),
          }, 201) };
        });
      } catch (error) {
        return failure(409, error.message || 'Unable to create order.');
      }
    },

    async listCustomerOrders(userIdValue) {
      const userId = Number(userIdValue);
      if (!Number.isInteger(userId) || userId <= 0) return failure(401, 'Unauthorized.');
      const orders = await repository.listCustomerOrders(userId);
      if (orders.length === 0) return success([]);
      const itemRows = await repository.listItemsForOrders(orders.map((order) => Number(order.id)));
      return success(orders.map((order) => {
        const items = formatCustomerItems(itemRows.filter((item) => Number(item.orderId) === Number(order.id)));
        const storeNames = [...new Set(items.map((item) => item.drugstoreName))];
        return {
          id: Number(order.id), reference: order.reference, storeName: storeNames.join(', '),
          itemSummary: items.map((item) => `${item.name} x${item.quantity}${item.sellingUnit ? ` (${item.sellingUnit})` : ''}`).join(', '),
          itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
          totalCentavos: Number(order.totalCentavos), total: centavosToPesosNumber(order.totalCentavos),
          status: order.status, stage: order.status, rejectionReason: order.rejectionReason,
          placedOn: formatDate(order.createdAt), createdAt: order.createdAt, expiresAt: order.expiresAt, ...pickupFields(order), items,
        };
      }));
    },

    async getCustomerOrder(userIdValue, orderIdValue) {
      const userId = Number(userIdValue); const orderId = Number(orderIdValue);
      if (!Number.isInteger(orderId) || orderId <= 0) return failure(400, 'Invalid order ID.');
      const order = await repository.findCustomerOrder(orderId, userId);
      if (!order) return failure(404, 'Order not found.');
      const items = formatCustomerItems(await repository.listItemsForOrder(orderId));
      return success({
        id: Number(order.id), reference: order.reference,
        totalCentavos: Number(order.totalCentavos), total: centavosToPesosNumber(order.totalCentavos),
        status: order.status, stage: order.status, rejectionReason: order.rejectionReason,
        storeName: [...new Set(items.map((item) => item.drugstoreName))].join(', '),
        placedOn: formatDate(order.createdAt), createdAt: order.createdAt, expiresAt: order.expiresAt, ...pickupFields(order), items,
      });
    },

    async listAdminOrders() {
      const orders = await repository.listAdminOrders();
      if (orders.length === 0) return success([]);
      const itemRows = await repository.listAdminItemsForOrders(orders.map((order) => Number(order.id)));
      return success(orders.map((order) => {
        const orderItems = itemRows.filter((item) => Number(item.orderId) === Number(order.id));
        const items = orderItems.map((item) => ({
          id: Number(item.medicineId), name: item.medicineName, genericName: item.genericName,
          quantity: Number(item.quantity), priceCentavos: Number(item.unitPriceCentavos),
          ...(item.sellingUnit ? { sellingUnit: item.sellingUnit } : {}),
          price: centavosToPesosNumber(item.unitPriceCentavos), drugstoreId: Number(item.drugstoreId),
          drugstoreName: item.storeName, status: item.drugstoreStatus,
        }));
        const storeNames = [...new Set(items.map((item) => item.drugstoreName))];
        return {
          id: Number(order.id), reference: order.reference, customerName: order.customerName, customerEmail: order.customerEmail,
          paymentId: order.paymentId == null ? null : Number(order.paymentId),
          paymentStatus: order.paymentStatus ?? null, paymentProvider: order.paymentProvider ?? null,
          storeName: storeNames.join(', '), store_id: storeNames.length === 1 ? Number(orderItems[0]?.drugstoreId) : null,
          items, totalCentavos: Number(order.totalCentavos), total: centavosToPesosNumber(order.totalCentavos),
          status: order.status, stage: order.status, rejectionReason: order.rejectionReason,
          placedOn: formatDate(order.createdAt), createdAt: order.createdAt, expiresAt: order.expiresAt, ...pickupFields(order),
        };
      }));
    },

    async listPartnerOrders(actor, query = {}) {
      const memberships = Array.isArray(actor?.memberships) ? actor.memberships.filter((item) => item.isActive !== false) : [];
      const requested = query.drugstoreId ?? query.pharmacyId;
      const drugstoreId = requested == null || String(requested).trim() === ''
        ? Number(memberships[0]?.drugstoreId)
        : Number(requested);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(403, 'No active pharmacy membership.');
      if (!actorHasPermission(actor, 'orders:read:pharmacy', drugstoreId)) return failure(403, 'Order access denied.');

      const rows = await repository.listPartnerOrderItems(drugstoreId);
      const grouped = new Map();
      for (const row of rows) {
        const orderId = Number(row.orderId);
        let order = grouped.get(orderId);
        if (!order) {
          order = {
            id: orderId,
            reference: row.reference || `Order #${orderId}`,
            drugstoreId,
            status: row.drugstoreStatus,
            pickupBalanceCentavos: row.pickupBalanceCentavos == null ? null : Number(row.pickupBalanceCentavos),
            pickupBalancePending: row.pickupBalancePending === true,
            pickupBalancePaidWithGCash: row.pickupBalancePaidWithGCash === true,
            rejectionReason: row.drugstoreRejectionReason ?? null,
            ...pickupFields(row),
            totalCentavos: 0,
            total: 0,
            items: [],
          };
          grouped.set(orderId, order);
        }
        const quantity = Number(row.quantity);
        const unitPriceCentavos = Number(row.unitPriceCentavos);
        order.totalCentavos += unitPriceCentavos * quantity;
        order.items.push({
          id: Number(row.medicineId),
          name: row.medicineName,
          genericName: row.genericName,
          ...(row.sellingUnit ? { sellingUnit: row.sellingUnit } : {}),
          quantity,
          priceCentavos: unitPriceCentavos,
          price: centavosToPesosNumber(unitPriceCentavos),
        });
      }
      for (const order of grouped.values()) order.total = centavosToPesosNumber(order.totalCentavos);
      return success([...grouped.values()]);
    },

    async getAdminOrder(orderIdValue) {
      const orderId = Number(orderIdValue);
      if (!Number.isInteger(orderId) || orderId <= 0) return failure(400, 'Invalid order ID.');
      const order = await repository.findAdminOrder(orderId);
      if (!order) return failure(404, 'Order not found.');
      const items = await repository.listAdminItemsForOrder(orderId);
      return success({
        id: Number(order.id), reference: order.reference,
        customer: { id: Number(order.customerId), name: order.customerName, email: order.customerEmail },
        totalCentavos: Number(order.totalCentavos), total: centavosToPesosNumber(order.totalCentavos),
        status: order.status, stage: order.status, rejectionReason: order.rejectionReason,
        placedOn: formatDate(order.createdAt), createdAt: order.createdAt, expiresAt: order.expiresAt, ...pickupFields(order),
        items: items.map((item) => ({
          id: Number(item.medicineId), name: item.medicineName, genericName: item.genericName,
          quantity: Number(item.quantity), priceCentavos: Number(item.unitPriceCentavos),
          ...(item.sellingUnit ? { sellingUnit: item.sellingUnit } : {}),
          price: centavosToPesosNumber(item.unitPriceCentavos), drugstoreId: Number(item.drugstoreId),
          drugstoreName: item.storeName, drugstoreStatus: item.drugstoreStatus, rejectionReason: item.drugstoreRejectionReason,
        })),
      });
    },

    async updateStatus(actorId, orderIdValue, body = {}) {
      const orderId = Number(orderIdValue); const requestedStatus = normalizeOrderStatus(body.status);
      const rejectionReason = body.rejectionReason ?? body.reason ?? null;
      if (!Number.isInteger(orderId) || orderId <= 0) return failure(400, 'Invalid order ID.');
      if (!orderStatuses.includes(requestedStatus)) return failure(400, 'Invalid order status.');

      return repository.withTransaction(async (transaction) => {
        const order = await transaction.findOrderForUpdate(orderId);
        if (!order) return { rollback: true, value: failure(404, 'Order not found.') };
        const previousStatus = normalizeOrderStatus(order.status);
        if (!canTransitionOrder(previousStatus, requestedStatus)) return { rollback: true, value: failure(409, `Invalid order transition: ${previousStatus} -> ${requestedStatus}.`) };
        if (previousStatus === requestedStatus) return { value: success({ success: true, id: orderId, reference: order.reference, previousStatus, status: requestedStatus, idempotentReplay: true }) };
        if (requestedStatus === 'awaiting_payment' || requestedStatus === 'confirmed') {
          return { rollback: true, value: failure(409, 'Payment status can only change through the payment service.') };
        }
        if (order.reference?.startsWith('NP-TEST-') && ['preparing', 'ready_for_pickup', 'completed'].includes(requestedStatus) &&
            !await transaction.hasEligiblePickupItems(orderId)) {
          return { rollback: true, value: failure(409, 'This order contains a listing that is no longer eligible for pickup. Contact support.') };
        }

        if (requestedStatus === 'cancelled') {
          const paymentStatus = await transaction.latestPaymentStatus(orderId);
          if (hasUnresolvedTestPayment(order.reference, paymentStatus)) {
            return { rollback: true, value: failure(409, 'Wait for the GCash test payment to be resolved before cancelling.') };
          }
          if (isSettledPayment(paymentStatus)) return { rollback: true, value: failure(409, 'Paid orders require refund reconciliation before cancellation.') };
          await releaseReservations(transaction, orderId, actorId, rejectionReason || 'Order cancelled.');
        } else if (requestedStatus === 'completed') {
          if (order.reference?.startsWith('NP-TEST-') && !await transaction.isPartnerPickupFullyPaid(orderId)) {
            return { rollback: true, value: failure(409, 'Ask the pharmacy to record the remaining balance when handing over this order.') };
          }
          await fulfillReservations(transaction, orderId, actorId);
        }

        await transaction.updateOrderStatus(orderId, requestedStatus, rejectionReason);
        await transaction.appendAudit(actorId, 'UPDATE_ORDER_STATUS', `Order ${order.reference} status changed from ${previousStatus} to ${requestedStatus}.`);
        return { value: success({ success: true, id: orderId, reference: order.reference, previousStatus, status: requestedStatus, message: 'Order status updated successfully.' }) };
      });
    },

    async updatePartnerPickup(actorId, actor, orderIdValue, { drugstoreId, status, balancePayment } = {}) {
      const orderId = Number(orderIdValue);
      if (!Number.isInteger(orderId) || orderId <= 0 || !['preparing', 'ready_for_pickup', 'completed'].includes(status)) return failure(400, 'Invalid pickup status.');
      if (balancePayment && status !== 'completed') return failure(400, 'Record the balance when completing pickup.');
      if (actor?.role !== 'partner' || !actorHasPermission(actor, 'orders:update:pharmacy', drugstoreId)) return failure(403, 'Order access denied.');
      if (balancePayment && !['cash', 'other'].includes(balancePayment.method)) return failure(400, 'Record cash or another in-person payment. Online GCash is verified automatically.');
      return repository.withTransaction(async (transaction) => {
        const order = await transaction.findPartnerPickupForUpdate(orderId, drugstoreId);
        if (!order) return { rollback: true, value: failure(404, 'Order not found for this pharmacy.') };
        if (order.paymentStatus !== 'confirmed') return { rollback: true, value: failure(409, 'Wait for payment confirmation before updating pickup.') };
        if (order.status !== order.branchStatus || !canTransitionOrder(order.status, status)) {
          return { rollback: true, value: failure(409, 'The pickup status changed. Refresh and try again.') };
        }
        if (order.status === status) return { value: success({ id: orderId, status }) };
        if (!await transaction.hasEligiblePickupItems(orderId)) {
          return { rollback: true, value: failure(409, 'This order contains a listing that is no longer eligible for pickup. Contact support.') };
        }
        if (status === 'completed') {
          if (balancePayment) {
            const balance = await transaction.findPartnerPickupBalance(orderId);
            if (!balance || balance.paymentPlan !== 'deposit' ||
                !Number.isSafeInteger(balancePayment.amountCentavos) || balancePayment.amountCentavos <= 0 ||
                balancePayment.amountCentavos !== Number(balance.balanceCentavos)) {
              return { rollback: true, value: failure(409, 'The pickup balance changed or is unavailable. Check the current payment status before collecting.') };
            }
            await transaction.appendAudit(actorId, 'RECORD_PICKUP_BALANCE', `Order ${order.reference} (${orderId}), pharmacy ${drugstoreId}: received PHP ${balancePayment.amountCentavos} centavos by ${balancePayment.method} at pickup.`);
          } else if (!await transaction.isPartnerPickupFullyPaid(orderId)) return { rollback: true, value: failure(409, 'The balance must be fully paid before handover.') };
          await fulfillReservations(transaction, orderId, actorId, drugstoreId);
        }
        if (!await transaction.advancePartnerPickup(orderId, drugstoreId, status)) {
          return { rollback: true, value: failure(409, 'The pickup status could not be saved. Refresh and try again.') };
        }
        await transaction.appendAudit(actorId, 'UPDATE_PARTNER_PICKUP', `Order ${order.reference} moved to ${status} at pharmacy ${drugstoreId}.`);
        return { value: success({ id: orderId, status }) };
      });
    },

    async cancelOwnOrder(userIdValue, orderIdValue) {
      const userId = Number(userIdValue); const orderId = Number(orderIdValue);
      if (!Number.isInteger(orderId) || orderId <= 0) return failure(400, 'Invalid order ID.');
      return repository.withTransaction(async (transaction) => {
        const order = await transaction.findOwnedOrderForUpdate(orderId, userId);
        if (!order) return { rollback: true, value: failure(404, 'Order not found.') };
        const currentStatus = normalizeOrderStatus(order.status);
        if (currentStatus === 'cancelled') return { value: success({ success: true, reference: order.reference, status: currentStatus }) };
        if (['expired', 'completed', 'ready_for_pickup'].includes(currentStatus)) return { rollback: true, value: failure(409, 'This order can no longer be cancelled.') };

        const paymentStatus = await transaction.latestPaymentStatus(orderId);
        if (hasUnresolvedTestPayment(order.reference, paymentStatus)) {
          return { rollback: true, value: failure(409, 'Wait for the GCash test payment to be resolved before cancelling.') };
        }
        const target = ['reserved', 'awaiting_payment'].includes(currentStatus) && !isSettledPayment(paymentStatus)
          ? 'cancelled' : 'cancellation_pending';
        if (!canTransitionOrder(currentStatus, target)) return { rollback: true, value: failure(409, 'Cancellation is not allowed from the current order state.') };
        if (target === 'cancelled') await releaseReservations(transaction, orderId, userId, 'Cancelled by customer.');
        await transaction.updateOrderStatus(orderId, target, 'Cancelled by customer.');
        await transaction.appendAudit(userId, target === 'cancelled' ? 'CANCEL_ORDER' : 'REQUEST_ORDER_CANCELLATION', `Customer requested cancellation for order ${order.reference}.`);
        return { value: success({ success: true, reference: order.reference, status: target, message: target === 'cancelled' ? 'Order cancelled successfully.' : 'Cancellation request recorded.' }) };
      });
    },

    async reschedulePickup(userIdValue, orderIdValue, body = {}) {
      const userId = Number(userIdValue); const orderId = Number(orderIdValue);
      if (!Number.isInteger(orderId) || orderId <= 0) return failure(400, 'Invalid order ID.');
      const pickup = validatePickup({ pickupDate: body.pickupDate, pickupWindow: body.pickupWindow }, now());
      if (!pickup.ok) return failure(422, pickup.message);
      if (!pickup.pickupDate) return failure(422, 'Choose a pickup date.');
      return repository.withTransaction(async (transaction) => {
        const order = await transaction.findOwnedOrderForUpdate(orderId, userId);
        if (!order) return { rollback: true, value: failure(404, 'Order not found.') };
        const currentStatus = normalizeOrderStatus(order.status);
        if (!['reserved', 'awaiting_payment', 'confirmed'].includes(currentStatus)) {
          return { rollback: true, value: failure(409, 'The pickup date can no longer be changed for this order.') };
        }
        if (order.pickupRescheduled === true) {
          return { rollback: true, value: failure(409, 'The pickup date was already changed once. Contact the pharmacy for another change.') };
        }
        for (const hours of await (transaction.listOrderOperatingHours?.(orderId) ?? [])) {
          const closingCheck = validatePickupForHours(pickup, hours, now());
          if (!closingCheck.ok) return { rollback: true, value: failure(422, closingCheck.message) };
        }
        await transaction.updateOrderPickup(orderId, pickup.pickupDate, pickup.pickupWindow);
        await transaction.appendAudit(userId, 'RESCHEDULE_PICKUP', `Pickup for order ${order.reference} changed to ${pickup.pickupDate}.`);
        return { value: success({ success: true, id: orderId, reference: order.reference, pickupDate: pickup.pickupDate, pickupWindow: pickup.pickupWindow, pickupRescheduled: true }) };
      });
    },

    async expireOldOrders() {
      return repository.withTransaction(async (transaction) => {
        const expired = await transaction.findExpiredOrdersForUpdate();
        let released = 0;
        for (const order of expired) {
          const orderId = Number(order.id);
          if (order.reference?.startsWith('NP-TEST-')) {
            // Read payments after taking the order lock so a concurrent checkout is visible.
            const paymentStatus = await transaction.latestPaymentStatus(orderId);
            if (hasUnresolvedTestPayment(order.reference, paymentStatus) || isSettledPayment(paymentStatus)) continue;
          }
          await releaseReservations(transaction, orderId, Number(order.user_id), 'Reservation expired.');
          await transaction.updateOrderStatus(orderId, 'expired', 'Order reservation expired.');
          await transaction.appendAudit(Number(order.user_id), 'EXPIRE_ORDER', `Order ${order.reference} reservation expired.`);
          released++;
        }
        return { value: released };
      });
    },
  });
}
