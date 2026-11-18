export const paymentStatuses = Object.freeze([
  'pending',
  'confirmed',
  'failed',
  'refund_pending',
  'refunded',
  'reconciliation_required',
]);

export const refundStatuses = Object.freeze(['pending', 'confirmed', 'failed']);

export function isSettledPayment(status) {
  return ['confirmed', 'refund_pending', 'refunded'].includes(String(status || ''));
}

export function normalizeProviderEventType(type) {
  const value = String(type || '').trim().toLowerCase();
  return new Set(['payment.confirmed', 'payment.failed', 'refund.confirmed', 'refund.failed']).has(value) ? value : null;
}
