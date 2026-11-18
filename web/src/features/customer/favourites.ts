import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useSession } from '../../auth/session';

/** Favourite pharmacies stay on the device for each account (nearpill_favourites_user_<id>), like the cart. */
const key = (accountId: string | number) => `nearpill_favourites_user_${accountId}`;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => { listeners.delete(listener); window.removeEventListener('storage', listener); };
}

function readRaw(accountId: string | null): string {
  if (!accountId) return '[]';
  try { return localStorage.getItem(key(accountId)) ?? '[]'; } catch { return '[]'; }
}

export function parseFavourites(raw: string): number[] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((entry): entry is number => Number.isSafeInteger(entry) && entry > 0))];
  } catch { return []; }
}

export function setFavourite(accountId: string | number, storeId: number, on: boolean) {
  const next = new Set(parseFavourites(readRaw(String(accountId))));
  if (on) next.add(storeId); else next.delete(storeId);
  try {
    if (next.size === 0) localStorage.removeItem(key(accountId));
    else localStorage.setItem(key(accountId), JSON.stringify([...next]));
  } catch { /* storage unavailable: favourites just do not persist */ }
  listeners.forEach((listener) => listener());
}

export function useFavourites() {
  const { user } = useSession();
  const accountId = user?.role === 'customer' ? String(user.id) : null;
  const raw = useSyncExternalStore(subscribe, () => readRaw(accountId), () => '[]');
  const ids = useMemo(() => new Set(parseFavourites(raw)), [raw]);
  const toggle = useCallback((storeId: number) => { if (accountId) setFavourite(accountId, storeId, !parseFavourites(readRaw(accountId)).includes(storeId)); }, [accountId]);
  return { signedIn: accountId !== null, ids, has: (storeId: number) => ids.has(storeId), toggle };
}
