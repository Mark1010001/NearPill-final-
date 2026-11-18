export const orderStatuses = Object.freeze([
  'reserved',
  'awaiting_payment',
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'cancellation_pending',
  'cancelled',
  'expired',
  'completed',
]);

const aliases = Object.freeze({
  pending: 'reserved',
  approved: 'confirmed',
  rejected: 'cancelled',
  canceled: 'cancelled',
});

const transitions = Object.freeze({
  reserved: new Set(['awaiting_payment', 'confirmed', 'cancelled', 'expired']),
  awaiting_payment: new Set(['confirmed', 'cancelled', 'expired']),
  confirmed: new Set(['preparing', 'cancellation_pending']),
  preparing: new Set(['ready_for_pickup', 'cancellation_pending']),
  ready_for_pickup: new Set(['completed']),
  cancellation_pending: new Set(['cancelled']),
  cancelled: new Set(),
  expired: new Set(),
  completed: new Set(),
});

export function normalizeOrderStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return aliases[normalized] ?? normalized;
}

export function canTransitionOrder(from, to) {
  const source = normalizeOrderStatus(from);
  const target = normalizeOrderStatus(to);
  return source === target || Boolean(transitions[source]?.has(target));
}

export function isReservationReleaseStatus(status) {
  return ['cancelled', 'expired'].includes(normalizeOrderStatus(status));
}

export function isTerminalOrderStatus(status) {
  return ['cancelled', 'expired', 'completed'].includes(normalizeOrderStatus(status));
}
