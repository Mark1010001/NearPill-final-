import { useCallback, useEffect, useRef, useState } from 'react';

export type Coordinates = { lat: number; lng: number; accuracy: number };
export type LocationState = 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable';

/** Parses an API coordinate (the server may send numbers or numeric strings). Returns null when unusable. */
export function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= limit ? number : null;
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Same text as the app: "0.35 km away". */
export function formatDistance(km: number): string {
  return `${km.toFixed(2)} km away`;
}

const KEY = 'np-location-consent';

// Same wording as the app's LocationService.
export const locationMessages = {
  off: 'Location services are off. Search by pharmacy or area instead.',
  denied: 'Location permission was denied. Search by pharmacy or area instead.',
  unavailable: 'Current location is unavailable. Search by pharmacy or area instead.',
} as const;

/**
 * Asks the browser for the customer's position only after they press a button (or if they already agreed
 * earlier in this tab). The position stays in memory; it is never sent to the server.
 */
export function useUserLocation({ auto = false }: { auto?: boolean } = {}) {
  const [state, setState] = useState<LocationState>('idle');
  const [position, setPosition] = useState<Coordinates | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const watch = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current);
    watch.current = null;
    setPosition(null);
    setMessage(null);
    setState('idle');
    try { sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  }, []);

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) { setState('unavailable'); setMessage(locationMessages.off); return; }
    setState('asking'); setMessage(null);
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        setPosition({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy });
        setState('granted');
        try { sessionStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
      },
      (error) => {
        if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
        watch.current = null;
        setPosition(null);
        const denied = error.code === error.PERMISSION_DENIED;
        setState(denied ? 'denied' : 'unavailable');
        setMessage(denied ? locationMessages.denied : locationMessages.unavailable);
      },
      { enableHighAccuracy: false, maximumAge: 30_000, timeout: 15_000 },
    );
  }, []);

  useEffect(() => {
    let agreed = false;
    try { agreed = sessionStorage.getItem(KEY) === '1'; } catch { /* storage unavailable */ }
    if (agreed || auto) start();
    return () => { if (watch.current !== null) navigator.geolocation?.clearWatch(watch.current); };
  }, [start, auto]);

  return { state, position, message, start, stop };
}

export type PositionResult = { ok: true; lat: number; lng: number } | { ok: false; error: string };

/** One-shot position, with the app's wording for each failure. */
export function currentPosition(): Promise<PositionResult> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) { resolve({ ok: false, error: locationMessages.off }); return; }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ ok: true, lat: coords.latitude, lng: coords.longitude }),
      (error) => resolve({ ok: false, error: error.code === error.PERMISSION_DENIED ? locationMessages.denied : locationMessages.unavailable }),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/** Continuous updates (the app uses a 25 m distance filter). Returns a stop function. */
export function watchPositions(onPosition: (position: { lat: number; lng: number }) => void, onError: () => void): () => void {
  if (!('geolocation' in navigator)) return () => undefined;
  let last: { lat: number; lng: number } | null = null;
  const id = navigator.geolocation.watchPosition(
    ({ coords }) => {
      const next = { lat: coords.latitude, lng: coords.longitude };
      if (last && distanceKm(last, next) < 0.025) return;
      last = next;
      onPosition(next);
    },
    onError,
    { enableHighAccuracy: true, maximumAge: 10_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
