import type { CatalogListing, CheckoutItem, PublicPharmacyInventory } from '../../api/types';

export interface CartLine {
  listing: CatalogListing;
  quantity: number;
  /** Ticked for checkout. Missing means ticked. */
  selected?: boolean;
}

export const isSelected = (line: CartLine) => line.selected !== false;

export type CheckoutAttempt = { items: CheckoutItem[]; key: string; grouped: boolean };

const attemptPrefix = (accountId: string) => `nearpill:checkout:${accountId}:`;

export function storedCheckoutAttempt(accountId: string, storeId: number): CheckoutAttempt | undefined {
  try {
    const attempt = JSON.parse(sessionStorage.getItem(attemptPrefix(accountId) + storeId) ?? 'null') as CheckoutAttempt | null;
    if (attempt && /^[A-Za-z0-9._:-]{8,128}$/.test(attempt.key) && typeof attempt.grouped === 'boolean' &&
        Array.isArray(attempt.items) && attempt.items.length > 0 && attempt.items.every((item) =>
          positiveId(item.id) && item.drugstoreId === storeId && positiveId(item.quantity) && nonnegativeInteger(item.expectedUnitPriceCentavos) !== null)) return attempt;
  } catch {}
}

export function saveCheckoutAttempt(accountId: string, storeId: number, attempt: CheckoutAttempt | null) {
  try {
    const key = attemptPrefix(accountId) + storeId;
    if (attempt) sessionStorage.setItem(key, JSON.stringify(attempt));
    else sessionStorage.removeItem(key);
    return true;
  } catch { return false; }
}

export function clearCheckoutAttempts(accountId: string) {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(attemptPrefix(accountId))) sessionStorage.removeItem(key);
    }
  } catch {}
}

export function nonnegativeInteger(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function positiveId(value: unknown): number | undefined {
  return nonnegativeInteger(value) || undefined;
}

export function listingKey({ drugstoreId, id }: Pick<CatalogListing, 'drugstoreId' | 'id'>) {
  return `${drugstoreId}:${id}`;
}

export function listingPath(listing: CatalogListing) {
  return `/app/pharmacies/${positiveId(listing.drugstoreId)}/medicines/${positiveId(listing.id)}`;
}

export function cartCategory(category: CatalogListing['category']) {
  const label = category?.trim().toLowerCase().replace(/ \(source list\)$/, '').replace(/\s*-\s*/g, '-');
  if (label === 'prescription' || label === 'prescriptions') return 'Prescription';
  if (['non-prescription', 'non-prescriptions', 'otc', 'general otc'].includes(label ?? '')) return 'Non-prescription';
  if (['medical supplies', 'non-medicine', 'non-medicines', 'non medicine', 'non medicines'].includes(label ?? '')) return 'Non-medicine';
  return 'Category unavailable';
}

export function listingIssue(listing: CatalogListing) {
  const stock = nonnegativeInteger(listing.stockCount);
  if (stock === 0) return 'Out of stock';
  if (listing.canOrder !== true || stock === null) return 'Not available to order right now';
  return null;
}

export function quantityLimit(listing: CatalogListing) {
  return listingIssue(listing) === null ? Number(listing.stockCount) : 999;
}

export function removeReservedItems(cart: CartLine[], items: CheckoutItem[]) {
  const reserved = new Map(items.map((item) => [listingKey(item), item.quantity]));
  return cart.flatMap((line) => {
    const quantity = line.quantity - (reserved.get(listingKey(line.listing)) ?? 0);
    return quantity > 0 ? [{ ...line, quantity }] : [];
  });
}

export function cartTotal(lines: CartLine[]) {
  let total = 0;
  for (const { listing, quantity } of lines) {
    const price = nonnegativeInteger(listing.priceCentavos);
    if (price === null) return null;
    total += price * quantity;
    if (!Number.isSafeInteger(total)) return null;
  }
  return total;
}

export function reviewCart(lines: CartLine[], { store, inventory }: PublicPharmacyInventory) {
  const listings = new Map(inventory.map((listing) => [listingKey(listing), listing]));
  return lines.map((line) => {
    const current = listings.get(listingKey(line.listing));
    if (store.verified !== true || store.store_id !== positiveId(line.listing.drugstoreId) || !current) {
      return { ...line, issue: 'This listing is no longer available at this pharmacy.' };
    }
    const issue = listingIssue(current);
    if (issue) return { ...line, issue: `${issue}. Remove this item to continue.` };
    if ((current.sellingUnit ?? null) !== (line.listing.sellingUnit ?? null)) {
      return { ...line, issue: 'The selling unit changed. Remove the item and add it again to review the new unit.' };
    }
    const stock = Number(current.stockCount);
    if (stock < line.quantity) {
      return { ...line, issue: `Available stock: ${stock}. Reduce the quantity in your cart.` };
    }
    if (nonnegativeInteger(current.priceCentavos) === null) {
      return { ...line, issue: 'The current price is unavailable. Check again or remove this item.' };
    }
    return { ...line, listing: current, issue: null };
  });
}
