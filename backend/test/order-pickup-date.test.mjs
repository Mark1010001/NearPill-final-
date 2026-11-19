import assert from 'node:assert/strict';
import test from 'node:test';

import { createOrderService } from '../src/application/order-service.js';
import { manilaToday, parseOperatingHours, validatePickup, validatePickupForHours } from '../src/domain/orders/pickup.js';

// 2026-11-16 10:00 Philippine time.
const now = Date.parse('2026-11-16T02:00:00Z');

test('Manila calendar date is used for "today"', () => {
  assert.equal(manilaToday(Date.parse('2026-11-15T17:00:00Z')), '2026-11-16');
  assert.equal(manilaToday(Date.parse('2026-11-15T15:59:00Z')), '2026-11-15');
});

test('no pickup date is allowed for old clients', () => {
  assert.deepEqual(validatePickup({}, now), { ok: true, pickupDate: null, pickupWindow: null });
});

test('today up to 7 days ahead is accepted', () => {
  assert.equal(validatePickup({ pickupDate: '2026-11-16' }, now).ok, true);
  assert.equal(validatePickup({ pickupDate: '2026-11-23', pickupWindow: 'evening' }, now).ok, true);
});

test('past, too far ahead, malformed and window-without-date are rejected', () => {
  assert.match(validatePickup({ pickupDate: '2026-11-15' }, now).message, /past/);
  assert.match(validatePickup({ pickupDate: '2026-11-24' }, now).message, /within 7 days/);
  assert.match(validatePickup({ pickupDate: '2026-02-30' }, now).message, /valid date/);
  assert.match(validatePickup({ pickupDate: '16/11/2026' }, now).message, /valid date/);
  assert.match(validatePickup({ pickupWindow: 'morning' }, now).message, /Choose a pickup date/);
  assert.match(validatePickup({ pickupDate: '2026-11-17', pickupWindow: 'night' }, now).message, /morning, afternoon or evening/);
});

test('a time window that already ended today is rejected, later ones and later days are fine', () => {
  const evening = Date.parse('2026-11-16T10:00:00Z'); // 18:00 Philippine time
  assert.match(validatePickup({ pickupDate: '2026-11-16', pickupWindow: 'afternoon' }, evening).message, /already passed/);
  assert.equal(validatePickup({ pickupDate: '2026-11-16', pickupWindow: 'evening' }, evening).ok, true);
  assert.equal(validatePickup({ pickupDate: '2026-11-17', pickupWindow: 'morning' }, evening).ok, true);
});

function serviceWith(order) {
  const calls = { updated: null, audits: [] };
  const noop = async () => [];
  const repository = {
    withTransaction: async (work) => {
      const result = await work({
        findOwnedOrderForUpdate: async () => order,
        updateOrderPickup: async (...args) => { calls.updated = args; },
        appendAudit: async (...args) => { calls.audits.push(args); },
      });
      return result?.value;
    },
    listCustomerOrders: noop, listItemsForOrders: noop, findCustomerOrder: noop, listItemsForOrder: noop,
    listAdminOrders: noop, listAdminItemsForOrders: noop, findAdminOrder: noop, listAdminItemsForOrder: noop, listPartnerOrderItems: noop,
  };
  return { service: createOrderService({ repository, now: () => now }), calls };
}

test('reschedule works once while reserved or paid-not-preparing', async () => {
  for (const status of ['reserved', 'awaiting_payment', 'confirmed']) {
    const { service, calls } = serviceWith({ id: 5, reference: 'NP-TEST-1', status, pickupRescheduled: false });
    const result = await service.reschedulePickup(1, 5, { pickupDate: '2026-11-18', pickupWindow: 'afternoon' });
    assert.equal(result.status, 200, status);
    assert.deepEqual(calls.updated, [5, '2026-11-18', 'afternoon']);
    assert.equal(calls.audits.length, 1);
  }
});

test('second reschedule, finished orders and bad dates are rejected', async () => {
  const again = serviceWith({ id: 5, reference: 'R', status: 'reserved', pickupRescheduled: true });
  assert.equal((await again.service.reschedulePickup(1, 5, { pickupDate: '2026-11-18' })).status, 409);
  assert.equal(again.calls.updated, null);
  for (const status of ['preparing', 'ready_for_pickup', 'completed', 'cancelled', 'expired']) {
    const { service } = serviceWith({ id: 5, reference: 'R', status, pickupRescheduled: false });
    assert.equal((await service.reschedulePickup(1, 5, { pickupDate: '2026-11-18' })).status, 409, status);
  }
  const ok = serviceWith({ id: 5, reference: 'R', status: 'reserved', pickupRescheduled: false });
  assert.equal((await ok.service.reschedulePickup(1, 5, { pickupDate: '2026-12-31' })).status, 422);
  assert.equal((await ok.service.reschedulePickup(1, 5, {})).status, 422);
  assert.equal((await ok.service.createOrder(1, { items: [{ id: 1, drugstoreId: 1, quantity: 1 }], pickupDate: '2026-11-01' })).status, 422);
});

test('pickup today closes one hour before the pharmacy closes and "any time" is not allowed for today', () => {
  const hours = '8:00 AM - 6:00 PM';
  const at = (time) => Date.parse(`2026-11-16T${time}:00+08:00`);
  assert.deepEqual(parseOperatingHours(hours), { openMinute: 480, closeMinute: 1080 });
  assert.equal(parseOperatingHours('Open 24 hours'), null);
  // 4:59 pm: still one minute over an hour before closing
  assert.equal(validatePickupForHours({ pickupDate: '2026-11-16', pickupWindow: 'afternoon' }, hours, at('15:59')).ok, true);
  assert.match(validatePickupForHours({ pickupDate: '2026-11-16', pickupWindow: 'afternoon' }, hours, at('17:00')).message, /closing soon/);
  assert.match(validatePickupForHours({ pickupDate: '2026-11-16', pickupWindow: 'evening' }, hours, at('17:30')).message, /closing soon/);
  assert.match(validatePickupForHours({ pickupDate: '2026-11-16' }, hours, at('10:00')).message, /Choose a pickup time/);
  // the evening window (5-8) starts after the 5 pm cutoff
  assert.match(validatePickupForHours({ pickupDate: '2026-11-16', pickupWindow: 'evening' }, hours, at('10:00')).message, /too close to closing/);
  // later days and unreadable hours are not restricted
  assert.equal(validatePickupForHours({ pickupDate: '2026-11-17' }, hours, at('17:30')).ok, true);
  assert.equal(validatePickupForHours({ pickupDate: '2026-11-16' }, 'Open 24 hours', at('23:00')).ok, true);
});
