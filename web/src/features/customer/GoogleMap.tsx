import { useEffect, useRef } from 'react';
import type { MapStore } from './TileMap';

type Point = { lat: number; lng: number };

/* The few parts of the Google Maps JavaScript API this screen uses (no extra type dependency). */
type GLatLngLiteral = { lat: number; lng: number };
type GMarker = { setMap(map: GMap | null): void; addListener(event: string, handler: () => void): void };
type GInfoWindow = { setContent(node: Node): void; open(options: { map: GMap; anchor: GMarker }): void; close(): void };
type GPolyline = { setMap(map: GMap | null): void };
type GBounds = { extend(point: GLatLngLiteral): void };
type GMap = { fitBounds(bounds: GBounds, padding: number): void; setCenter(point: GLatLngLiteral): void; setZoom(zoom: number): void };
type GMapsApi = {
  Map: new (el: HTMLElement, options: Record<string, unknown>) => GMap;
  Marker: new (options: Record<string, unknown>) => GMarker;
  InfoWindow: new () => GInfoWindow;
  Polyline: new (options: Record<string, unknown>) => GPolyline;
  LatLngBounds: new () => GBounds;
  Size: new (w: number, h: number) => unknown;
  Point: new (x: number, y: number) => unknown;
};

declare global {
  interface Window { google?: { maps?: GMapsApi }; gm_authFailure?: () => void; __nearpillMapsReady?: () => void }
}

export const googleMapsKey = (import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY ?? '').trim();

let loading: Promise<GMapsApi> | null = null;
/** Loads Google's script once. Rejects if it cannot load or the key is refused, so the page can fall back. */
export function loadGoogleMaps(key: string): Promise<GMapsApi> {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  loading ??= new Promise<GMapsApi>((resolve, reject) => {
    const fail = (reason: string) => { loading = null; reject(new Error(reason)); };
    window.__nearpillMapsReady = () => { if (window.google?.maps?.Map) resolve(window.google.maps); else fail('Google Maps unavailable'); };
    window.gm_authFailure = () => fail('Google Maps key was refused');
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__nearpillMapsReady&v=weekly`;
    script.async = true;
    script.onerror = () => fail('Google Maps script failed to load');
    document.head.appendChild(script);
  });
  return loading;
}

// The app's markers: green pharmacy pin, and a blue circle with a white ring and person for "You".
const svgUrl = (svg: string) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
const pharmacyPin = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="27" height="43" viewBox="0 0 27 43"><path d="M13.5 1.2C6.7 1.2 1.2 6.6 1.2 13.3c0 9.6 12.3 28.5 12.3 28.5s12.3-18.9 12.3-28.5C25.8 6.6 20.3 1.2 13.5 1.2z" fill="#34A853" stroke="#2B8A45" stroke-width="1.2"/><circle cx="13.5" cy="13.5" r="5" fill="#1B5E20"/></svg>');
const youPin = svgUrl('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 80 80"><circle cx="40" cy="40" r="38" fill="#fff"/><circle cx="40" cy="40" r="33" fill="#1565C0"/><circle cx="40" cy="30" r="9" fill="#fff"/><rect x="24" y="43" width="32" height="19" rx="10" fill="#fff"/></svg>');

function infoNode(title: string, text: string): HTMLElement {
  const box = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = title;
  const line = document.createElement('div');
  line.textContent = text;
  box.append(strong, line);
  return box;
}

/**
 * The same map the Android app shows: Google Maps with green pharmacy pins, the blue "You" marker,
 * the blue road route, and the camera fitted to what is on screen. Same props as TileMap.
 */
export function GoogleMap({ apiKey, you, stores, route, selectedId, onSelect, onUnavailable }: {
  apiKey: string;
  you: Point | null;
  stores: MapStore[];
  route: [number, number][] | null;
  selectedId: number | null;
  onSelect: (store: MapStore) => void;
  onUnavailable: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const api = useRef<GMapsApi | null>(null);
  const map = useRef<GMap | null>(null);
  const drawn = useRef<{ markers: GMarker[]; line: GPolyline | null; info: GInfoWindow | null }>({ markers: [], line: null, info: null });
  const latest = useRef({ you, stores, route, selectedId, onSelect });
  latest.current = { you, stores, route, selectedId, onSelect };

  const draw = () => {
    const g = api.current, m = map.current;
    if (!g || !m) return;
    const { you: me, stores: list, route: path, selectedId: chosen, onSelect: select } = latest.current;
    for (const marker of drawn.current.markers) marker.setMap(null);
    drawn.current.line?.setMap(null);
    drawn.current.info?.close();
    const info = new g.InfoWindow();
    const markers: GMarker[] = list.map((store) => {
      const marker = new g.Marker({ map: m, position: { lat: store.lat, lng: store.lng }, title: store.name,
        icon: { url: pharmacyPin, scaledSize: new g.Size(27, 43), anchor: new g.Point(13.5, 43) } });
      marker.addListener('click', () => { info.setContent(infoNode(store.name, store.address)); info.open({ map: m, anchor: marker }); select(store); });
      return marker;
    });
    if (me) {
      const marker = new g.Marker({ map: m, position: me, title: 'You are here', zIndex: 10,
        icon: { url: youPin, scaledSize: new g.Size(40, 40), anchor: new g.Point(20, 20) } });
      marker.addListener('click', () => { info.setContent(infoNode('You are here', 'Your current location')); info.open({ map: m, anchor: marker }); });
      markers.push(marker);
    }
    const line = path && path.length > 1
      ? new g.Polyline({ map: m, path: path.map(([lng, lat]) => ({ lat, lng })), strokeColor: '#1976D2', strokeWeight: 6, strokeOpacity: 1 }) : null;
    drawn.current = { markers, line, info };

    const points: Point[] = (chosen === null ? list : list.filter((s) => s.id === chosen)).map((s) => ({ lat: s.lat, lng: s.lng }));
    for (const [lng, lat] of path ?? []) points.push({ lat, lng });
    if (me) points.push(me);
    if (points.length === 1) { m.setCenter(points[0]!); m.setZoom(15); }
    else if (points.length > 1) { const bounds = new g.LatLngBounds(); for (const p of points) bounds.extend(p); m.fitBounds(bounds, 48); }
  };

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(apiKey).then((g) => {
      if (cancelled || !box.current) return;
      api.current = g;
      map.current = new g.Map(box.current, {
        center: { lat: 10.3157, lng: 123.8854 }, zoom: 12,
        mapTypeControl: false, streetViewControl: false, fullscreenControl: false, clickableIcons: false,
      });
      draw();
    }).catch((error: unknown) => { if (!cancelled) { console.warn(String(error)); onUnavailable(); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const signature = JSON.stringify([you, stores.map((s) => [s.id, s.lat, s.lng]), route?.length ?? 0, route?.[0], route?.[route.length - 1], selectedId]);
  useEffect(() => { draw(); }, [signature]);

  return <div className="google-map" ref={box} role="group" aria-label="Map of nearby pharmacies" />;
}
