import type { CatalogListing, Order } from '../../api/types';
import { type CartLine, nonnegativeInteger, positiveId } from './cart';

/** The app keeps each account's cart on the device (nearpill_cart_user_<id>) and clears it on sign-out. */
const key = (accountId: string | number) => `nearpill_cart_user_${accountId}`;

export function loadCart(accountId: string | number): { lines: CartLine[]; grouped: boolean } {
  try {
    const decoded = JSON.parse(localStorage.getItem(key(accountId)) ?? 'null') as { items?: unknown; grouped?: unknown } | unknown[] | null;
    const raw = Array.isArray(decoded) ? decoded : decoded?.items;
    const lines = (Array.isArray(raw) ? raw : []).flatMap((entry): CartLine[] => {
      const line = entry as Partial<CartLine> | null;
      const listing = line?.listing;
      const quantity = positiveId(line?.quantity);
      if (!listing || !quantity || !positiveId(listing.id) || !positiveId(listing.drugstoreId) || nonnegativeInteger(listing.priceCentavos) === null) return [];
      return [{ listing, quantity, ...(line?.selected === false ? { selected: false } : {}) }];
    });
    return { lines, grouped: !Array.isArray(decoded) && decoded?.grouped === true };
  } catch { return { lines: [], grouped: false }; }
}

export function saveCart(accountId: string | number, lines: CartLine[], grouped: boolean) {
  try {
    if (lines.length === 0) localStorage.removeItem(key(accountId));
    else localStorage.setItem(key(accountId), JSON.stringify({ grouped, items: lines }));
  } catch { /* storage unavailable: the cart still works for this tab */ }
}

export function clearCart(accountId: string | number) {
  try { localStorage.removeItem(key(accountId)); } catch { /* storage unavailable */ }
}

/** Reorder: turns a past order's items into cart lines. Stock and category are re-checked at "Review pickup". */
export function orderToCartLines(order: Order): CartLine[] {
  if (!order.items?.length) throw new Error('This order has no items to add.');
  return order.items.map((item): CartLine => {
    const id = positiveId(item.id);
    const drugstoreId = positiveId(item.drugstoreId ?? order.drugstoreId ?? order.store_id);
    const quantity = positiveId(item.quantity);
    const price = nonnegativeInteger(item.priceCentavos);
    if (!id || !drugstoreId || !quantity || price === null) throw new Error('Invalid order item.');
    const listing: CatalogListing = {
      id, name: item.name ?? item.medicineName ?? '', genericName: item.genericName ?? null, dosageForm: null, category: null,
      drugstoreId, drugstoreName: item.drugstoreName ?? order.storeName ?? '', publicationStatus: 'published',
      canOrder: true, stockCount: 999, priceCentavos: price, sellingUnit: item.sellingUnit ?? null, packageSize: null,
    };
    return { listing, quantity };
  });
}
