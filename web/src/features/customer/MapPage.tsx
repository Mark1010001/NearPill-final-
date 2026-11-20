import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../api/client';
import type { DrivingRoute, PublicPharmacy } from '../../api/types';
import type { MapStore } from './TileMap';
import { MapView } from './MapView';
import { coordinate, currentPosition, distanceKm, watchPositions } from './location';
import { useCart } from './cartContext';
import { useToast } from './toast';
import { MaterialIcon } from './MaterialIcon';

type Store = PublicPharmacy & { km: number | null };
type LoadState = 'idle' | 'loading' | 'ready' | 'manualFallback' | 'error';

const coords = (store: PublicPharmacy) => {
  const lat = coordinate(store.latitude, 90);
  const lng = coordinate(store.longitude, 180);
  return lat === null || lng === null ? null : { lat, lng };
};
const directionsUrl = (store: PublicPharmacy) => {
  const c = coords(store);
  return c ? `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}` : null;
};

/** The app's Map screen: same search, location flow, messages, route card and actions. */
export function MapPage() {
  const navigate = useNavigate();
  const { signedIn } = useCart();
  const { show, toast } = useToast(4000);
  const [state, setState] = useState<LoadState>('idle');
  const [stores, setStores] = useState<Store[]>([]);
  const [you, setYou] = useState<{ lat: number; lng: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Store | null>(null);
  const [route, setRoute] = useState<DrivingRoute | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const request = useRef(0);
  const routeRequest = useRef(0);
  const stopTracking = useRef<(() => void) | null>(null);
  const lastRouteAt = useRef(0);

  const closeRoute = useCallback(() => {
    routeRequest.current += 1;
    stopTracking.current?.();
    stopTracking.current = null;
    setSelected(null); setRoute(null); setRouteLoading(false); setRouteError(null);
  }, []);

  const loadNearby = useCallback(async () => {
    closeRoute();
    const id = ++request.current;
    setState('loading'); setMessage(null); setStores([]); setYou(null);
    try {
      const location = await currentPosition();
      if (id !== request.current) return;
      const all = await api.publicPharmacies('', new AbortController().signal);
      if (id !== request.current) return;
      const base = (list: PublicPharmacy[]): Store[] => list.map((s) => ({ ...s, km: null }));
      if (!location.ok) {
        setState('manualFallback'); setMessage(location.error || 'Search by pharmacy or area instead.'); setStores(base(all));
        return;
      }
      setYou({ lat: location.lat, lng: location.lng });
      let listed = all;
      let note: string | null = null;
      try {
        const near = await api.nearbyStores({ latitude: location.lat, longitude: location.lng, radiusKm: 5 });
        if (id !== request.current) return;
        const merged = new Map<number, PublicPharmacy>(all.map((s) => [s.store_id, s]));
        for (const s of near.stores) merged.set(s.store_id, s);
        listed = [...merged.values()];
        note = near.stores.length === 0
          ? `No verified pharmacies within 5 km. Try searching by name or area.${listed.length > 0 ? ' Showing all listed pharmacies.' : ''}` : null;
      } catch {
        if (id !== request.current) return;
        note = 'Nearby availability could not be checked. Showing listed pharmacies; try again.';
      }
      setMessage(note);
      setStores(base(listed).map((s) => {
        const c = coords(s);
        return c ? { ...s, km: distanceKm({ lat: location.lat, lng: location.lng }, c) } : s;
      }).sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)));
      setState('ready');
    } catch {
      if (id !== request.current) return;
      setState('error'); setMessage('Nearby pharmacies could not be loaded. Search manually or try again.');
    }
  }, [closeRoute]);

  const search = useCallback(async (text: string) => {
    closeRoute();
    const id = ++request.current;
    const q = text.trim();
    setStores([]); setYou(null);
    if (!q) { setState('manualFallback'); setMessage('Enter a pharmacy, street, or area.'); return; }
    setState('loading'); setMessage(null);
    try {
      const result = await api.nearbyStores({ q });
      if (id !== request.current) return;
      setStores(result.stores.map((s) => ({ ...s, km: null })));
      setState('ready');
      setMessage(result.stores.length === 0 ? 'No verified pharmacies matched that search.' : null);
    } catch {
      if (id !== request.current) return;
      setState('error'); setMessage('Pharmacy search is unavailable. Please try again.');
    }
  }, [closeRoute]);

  const fetchRoute = useCallback(async (store: Store, position: { lat: number; lng: number }, id: number) => {
    setYou(position); setRouteLoading(true); setRoute(null); setRouteError(null);
    lastRouteAt.current = Date.now();
    try {
      const result = await api.storeRoute(store.store_id, position.lat, position.lng);
      if (id !== routeRequest.current) return;
      if (!Array.isArray(result.coordinates) || result.coordinates.length < 2) throw new Error('Invalid road route');
      setRoute(result);
    } catch {
      if (id !== routeRequest.current) return;
      setRouteError('Road route unavailable. Refresh or open Google Maps.');
    }
    setRouteLoading(false);
  }, []);

  const selectRoute = useCallback(async (store: Store) => {
    closeRoute();
    setSelected(store);
    const id = ++routeRequest.current;
    if (!signedIn) { setRouteError('Sign in to see a driving route.'); return; }
    setRouteLoading(true);
    const position = await currentPosition();
    if (id !== routeRequest.current) return;
    if (!position.ok) { setRouteLoading(false); setRouteError(position.error); return; }
    await fetchRoute(store, position, id);
    if (id !== routeRequest.current) return;
    stopTracking.current = watchPositions(
      (next) => {
        if (id !== routeRequest.current) return;
        setYou(next);
        if (Date.now() - lastRouteAt.current >= 15_000) void fetchRoute(store, next, id);
      },
      () => { if (id === routeRequest.current) setRouteError('Location updates paused. Refresh your route.'); },
    );
  }, [closeRoute, fetchRoute, signedIn]);

  useEffect(() => {
    void loadNearby();
    return () => { request.current += 1; routeRequest.current += 1; stopTracking.current?.(); };
  }, [loadNearby]);

  useEffect(() => {
    const pause = () => { if (document.hidden) { routeRequest.current += 1; stopTracking.current?.(); stopTracking.current = null; setRouteLoading(false); } else if (selected) void selectRoute(selected); };
    document.addEventListener('visibilitychange', pause);
    return () => document.removeEventListener('visibilitychange', pause);
  }, [selected, selectRoute]);

  const openStore = (store: Store) => { stopTracking.current?.(); stopTracking.current = null; void navigate(`/app/pharmacies/${store.store_id}`, { state: { from: '/app/map' } }); };

  const loading = state === 'loading';
  const mapStores: MapStore[] = stores.flatMap((s) => { const c = coords(s); return c ? [{ id: s.store_id, name: s.store_name, address: s.address, ...c }] : []; });
  const retry = () => query.trim() ? void search(query) : void loadNearby();

  return <>
    <div className="screen-header"><h1>NearPill</h1></div>
    <form className="map-search" role="search" onSubmit={(event) => { event.preventDefault(); void search(query); }}>
      <div className="map-field">
        <input id="map-query" type="search" value={query} maxLength={160} placeholder="Name, street, or area" onChange={(event) => setQuery(event.target.value)} />
        <label htmlFor="map-query">Search pharmacies</label>
        <button type="submit" className="map-field-button" aria-label="Search pharmacies" title="Search pharmacies"><MaterialIcon name="searchBaseline" size={24} /></button>
      </div>
      <button type="button" className="tonal-icon-button" aria-label="Use current location" title="Use current location" disabled={loading}
        onClick={() => { setQuery(''); void loadNearby(); }}><MaterialIcon name="myLocation" size={24} /></button>
    </form>
    <div className="map-legend" aria-label="Map legend">
      <span><svg width="22" height="22" viewBox="0 0 80 80" aria-hidden="true" focusable="false"><circle cx="40" cy="40" r="38" fill="#fff" /><circle cx="40" cy="40" r="33" fill="#1565C0" /><circle cx="40" cy="30" r="9" fill="#fff" /><rect x="24" y="43" width="32" height="19" rx="10" fill="#fff" /></svg>You</span>
      <span><svg width="14" height="22" viewBox="0 0 27 43" aria-hidden="true" focusable="false"><path d="M13.5 1.2C6.7 1.2 1.2 6.6 1.2 13.3c0 9.6 12.3 28.5 12.3 28.5s12.3-18.9 12.3-28.5C25.8 6.6 20.3 1.2 13.5 1.2z" fill="#34A853" stroke="#2B8A45" strokeWidth="1.2" /><circle cx="13.5" cy="13.5" r="5" fill="#1B5E20" /></svg>Pharmacies</span>
    </div>
    <MapView you={you} stores={mapStores} route={route?.coordinates ?? null} selectedId={selected?.store_id ?? null}
      onSelect={(pin) => { const store = stores.find((s) => s.store_id === pin.id); if (store) void selectRoute(store); }} />
    {selected ? <section className="card route-card" aria-label="Route">
      <div className="route-head"><MaterialIcon name="localPharmacy" size={24} color="#4CAF50" /><strong>{selected.store_name}</strong>
        <button type="button" className="icon-button" aria-label="Close route" title="Close route" onClick={closeRoute}><MaterialIcon name="close" size={24} color="var(--np-ink)" /></button></div>
      <p className="shop-muted route-address">{selected.address}</p>
      {routeLoading && <progress aria-label="Finding driving route" />}
      {route && <p><strong>{(route.distanceMeters / 1000).toFixed(2)} km by road · {Math.max(1, Math.ceil(route.durationSeconds / 60))} min estimated</strong></p>}
      {routeError && <p className="form-error" role="alert">{routeError}{!signedIn && <> <Link to="/app/sign-in" state={{ returnTo: '/app/map' }}>Sign in</Link></>}</p>}
      <p className="shop-muted route-fine">Driving route by Google Maps. Estimated time excludes live traffic.</p>
      <p className="shop-muted route-fine">Your location is shared with Google for routing while this route is open.</p>
      <div className="row route-actions">
        <button type="button" className="text-button" disabled={routeLoading} onClick={() => void selectRoute(selected)}><MaterialIcon name="refresh" size={18} />Refresh route</button>
        <button type="button" className="text-button" onClick={() => openStore(selected)}>View medicines</button>
      </div>
    </section> : <section aria-label="Pharmacy results">
      <p role="status"><strong>{loading ? 'Finding verified pharmacies…' : stores.length === 1 ? '1 verified pharmacy' : `${stores.length} verified pharmacies`}</strong></p>
      {loading ? <progress aria-label="Finding verified pharmacies" />
        : message ? <p role="status">{message}</p>
        : stores.length === 0 ? <p>Search by pharmacy or area to find verified pharmacies.</p> : null}
      {state === 'error' && <button type="button" className="shop-text-link" onClick={retry}>Try again</button>}
      <ul className="map-list">
        {stores.map((store) => <li key={store.store_id}>
          <button type="button" className="map-row-main linklike" onClick={() => openStore(store)}>
            <MaterialIcon name="localPharmacy" size={24} color="var(--np-green)" className="map-row-icon" />
            <span className="map-row-text"><span className="map-row-title">{store.store_name}</span>
              <span className="shop-muted">{store.address}</span>
              {store.km !== null && <span className="shop-muted">{store.km.toFixed(1)} km away</span>}</span>
          </button>
          <button type="button" className="icon-button" aria-label={`Directions to ${store.store_name}`} title={`Directions to ${store.store_name}`} disabled={!directionsUrl(store)}
            onClick={() => void selectRoute(store)}><MaterialIcon name="directions" size={24} color="var(--np-green)" /></button>
        </li>)}
      </ul>
    </section>}
    {toast}
  </>;
}
