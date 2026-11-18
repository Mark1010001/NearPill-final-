import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Order } from '../../api/types';
import { pickupFlag, pickupText } from './pickup';

/**
 * Order updates are worked out from the customer's own orders: an order is "new" when its stage differs from
 * the stage the customer last saw. The last-seen stages stay on the device (nearpill_order_seen_user_<id>).
 */
export type OrderStage = 'placed' | 'preparing' | 'ready' | 'completed' | 'cancelled' | 'expired';
export type OrderUpdate = { order: Order; stage: OrderStage; message: string; unread: boolean };

const key = (accountId: string | number) => `nearpill_order_seen_user_${accountId}`;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}

export function stageOfOrder(order: Order): OrderStage {
  switch ((order.stage ?? order.status ?? 'placed').toLowerCase()) {
    case 'preparing': return 'preparing';
    case 'ready': case 'ready_for_pickup': return 'ready';
    case 'completed': return 'completed';
    case 'cancelled': return 'cancelled';
    case 'expired': return 'expired';
    default: return 'placed';
  }
}

const activeStage = (stage: OrderStage) => stage === 'placed' || stage === 'preparing' || stage === 'ready';

/** "today" or "missed" while an active order's pickup date is today or already passed. */
export function orderPickupFlag(order: Order, now = Date.now()) {
  return pickupFlag(order.pickupDate, activeStage(stageOfOrder(order)), now);
}
const seenKey = (order: Order) => `${stageOfOrder(order)}${orderPickupFlag(order) ? `:${orderPickupFlag(order)}` : ''}`;

export function updateMessage(order: Order, stage = stageOfOrder(order)): string {
  const store = order.storeName?.trim() || 'the pharmacy';
  const flag = orderPickupFlag(order);
  if (flag === 'today') return `Pickup is today at ${store}${order.pickupWindow ? ` (${pickupText(order.pickupDate, order.pickupWindow).split(' · ')[1]})` : ''}.`;
  if (flag === 'missed') return `Pickup missed at ${store}. Your pickup date was ${pickupText(order.pickupDate)}.`;
  switch (stage) {
    case 'preparing': return `${store} is preparing your order.`;
    case 'ready': return `Your order at ${store} is ready for pickup.`;
    case 'completed': return `You collected your order from ${store}.`;
    case 'cancelled': return `Your order at ${store} was cancelled.`;
    case 'expired': return `Your reservation at ${store} expired.`;
    default: return `Your order at ${store} was placed.`;
  }
}

export function readSeenRaw(accountId: string | null): string {
  if (!accountId) return '';
  try { return localStorage.getItem(key(accountId)) ?? ''; } catch { return ''; }
}

/** Returns null when this device has never recorded a baseline for the account. */
export function parseSeen(raw: string): Record<string, string> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, stage]) => typeof stage === 'string')) as Record<string, string>;
  } catch { return null; }
}

export function currentStages(orders: Order[]): Record<string, string> {
  return Object.fromEntries(orders.map((order) => [String(order.id), seenKey(order)]));
}

export function saveSeen(accountId: string | number, stages: Record<string, string>) {
  try { localStorage.setItem(key(accountId), JSON.stringify(stages)); } catch { /* storage unavailable */ }
  listeners.forEach((listener) => listener());
}

/** Newest orders first. With no baseline yet, nothing is unread (so a new device is not flooded). */
export function buildUpdates(orders: Order[], seen: Record<string, string> | null): OrderUpdate[] {
  return [...orders].sort((a, b) => b.id - a.id).map((order) => {
    const stage = stageOfOrder(order);
    return { order, stage, message: updateMessage(order, stage), unread: seen !== null && seen[String(order.id)] !== seenKey(order) };
  });
}

export function useOrderUpdates(accountId: string | null) {
  const orders = useQuery({
    queryKey: ['customer-order-updates', accountId],
    queryFn: ({ signal }) => api.customerOrders(accountId!, signal),
    enabled: accountId !== null, retry: false, staleTime: 30_000, refetchInterval: 60_000,
  });
  const raw = useSyncExternalStore(subscribe, () => readSeenRaw(accountId), () => '');
  const list = orders.data;
  useEffect(() => { if (accountId && list && readSeenRaw(accountId) === '') saveSeen(accountId, currentStages(list)); }, [accountId, list]);
  const updates = useMemo(() => buildUpdates(list ?? [], parseSeen(raw)), [list, raw]);
  const markAllRead = useCallback(() => { if (accountId && list) saveSeen(accountId, currentStages(list)); }, [accountId, list]);
  return { updates, unreadCount: updates.filter((update) => update.unread).length, markAllRead, query: orders };
}
