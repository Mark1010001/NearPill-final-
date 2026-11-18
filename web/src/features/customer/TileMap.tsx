import { useEffect, useMemo, useRef, useState } from 'react';

export type MapStore = { id: number; name: string; address: string; lat: number; lng: number };
type Point = { lat: number; lng: number };

const TILE = 256;
const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
};
const lngAt = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
const latAt = (y: number, z: number) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z)));

/**
 * A real street map (OpenStreetMap tiles) with no extra dependency: pharmacy pins, a "You" pin, the driving route,
 * zoom buttons and drag-to-pan. The list under it is the keyboard/screen-reader equivalent of the pins.
 */
export function TileMap({ you, stores, route, selectedId, onSelect }: {
  you: Point | null;
  stores: MapStore[];
  route: [number, number][] | null;
  selectedId: number | null;
  onSelect: (store: MapStore) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 320 });
  const [view, setView] = useState<{ center: Point; zoom: number }>({ center: { lat: 10.3157, lng: 123.8854 }, zoom: 12 });
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(200, el.clientWidth), h: Math.max(200, el.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitPoints = useMemo(() => {
    const points: Point[] = (selectedId === null ? stores : stores.filter((s) => s.id === selectedId)).map((s) => ({ lat: s.lat, lng: s.lng }));
    for (const [lng, lat] of route ?? []) points.push({ lat, lng });
    if (you) points.push(you);
    return points;
  }, [stores, selectedId, route, you]);
  const signature = fitPoints.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');

  useEffect(() => {
    if (fitPoints.length === 0) return;
    if (fitPoints.length === 1) { setView({ center: fitPoints[0], zoom: 15 }); return; }
    const south = Math.min(...fitPoints.map((p) => p.lat)), north = Math.max(...fitPoints.map((p) => p.lat));
    const west = Math.min(...fitPoints.map((p) => p.lng)), east = Math.max(...fitPoints.map((p) => p.lng));
    let zoom = 3;
    for (let z = 17; z >= 3; z -= 1) {
      const width = worldX(east, z) - worldX(west, z);
      const height = worldY(south, z) - worldY(north, z);
      if (width <= size.w - 96 && height <= size.h - 96) { zoom = z; break; }
    }
    setView({ center: { lat: (south + north) / 2, lng: (west + east) / 2 }, zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, size.w, size.h]);

  const { zoom, center } = view;
  const cx = worldX(center.lng, zoom);
  const cy = worldY(center.lat, zoom);
  const left = cx - size.w / 2;
  const top = cy - size.h / 2;
  const n = 2 ** zoom;
  const tiles: { key: string; x: number; y: number; src: string }[] = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty += 1) {
    if (ty < 0 || ty >= n) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + size.w) / TILE); tx += 1) {
      const wrapped = ((tx % n) + n) % n;
      tiles.push({ key: `${zoom}/${tx}/${ty}`, x: tx * TILE - left, y: ty * TILE - top, src: `https://tile.openstreetmap.org/${zoom}/${wrapped}/${ty}.png` });
    }
  }
  const at = (p: Point) => ({ x: worldX(p.lng, zoom) - left, y: worldY(p.lat, zoom) - top });
  const zoomBy = (delta: number) => setView((v) => ({ ...v, zoom: Math.max(3, Math.min(18, v.zoom + delta)) }));
  const routePath = route?.map(([lng, lat]) => { const p = at({ lat, lng }); return `${p.x.toFixed(1)},${p.y.toFixed(1)}`; }).join(' ');

  return <div className="tile-map" ref={box} role="group" aria-label="Map of nearby pharmacies"
    onPointerDown={(event) => {
      if ((event.target as HTMLElement).closest('button')) return;
      drag.current = { x: event.clientX, y: event.clientY, cx, cy };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={(event) => {
      const d = drag.current;
      if (!d) return;
      const x = d.cx - (event.clientX - d.x), y = d.cy - (event.clientY - d.y);
      setView((v) => ({ ...v, center: { lat: latAt(y, v.zoom), lng: lngAt(x, v.zoom) } }));
    }}
    onPointerUp={() => { drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }}>
    {tiles.map((tile) => <img key={tile.key} className="tile-map-tile" src={tile.src} alt="" draggable={false}
      style={{ left: tile.x, top: tile.y }} loading="lazy" />)}
    {routePath && <svg className="tile-map-route" width={size.w} height={size.h} aria-hidden="true">
      <polyline points={routePath} fill="none" stroke="#1976d2" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>}
    {stores.map((store) => {
      const p = at(store);
      return <button key={store.id} type="button" className={`tile-pin${selectedId === store.id ? ' tile-pin-on' : ''}`}
        style={{ left: p.x, top: p.y }} aria-label={`${store.name}, ${store.address}`} title={`${store.name} — ${store.address}`}
        onClick={() => onSelect(store)}>
        <svg width="27" height="43" viewBox="0 0 27 43" aria-hidden="true" focusable="false">
          <path d="M13.5 1.2C6.7 1.2 1.2 6.6 1.2 13.3c0 9.6 12.3 28.5 12.3 28.5s12.3-18.9 12.3-28.5C25.8 6.6 20.3 1.2 13.5 1.2z" fill="#34A853" stroke="#2B8A45" strokeWidth="1.2" />
          <circle cx="13.5" cy="13.5" r="5" fill="#1B5E20" />
        </svg>
      </button>;
    })}
    {(() => { const store = stores.find((s) => s.id === selectedId); if (!store) return null; const p = at(store);
      return <div className="tile-info" role="status" style={{ left: p.x, top: p.y }}><strong>{store.name}</strong><span>{store.address}</span></div>; })()}
    {you && (() => { const p = at(you); return <svg className="tile-you" width="40" height="40" viewBox="0 0 80 80" style={{ left: p.x, top: p.y }} role="img" aria-label="You are here. Your current location">
        <title>You are here — Your current location</title>
        <circle cx="40" cy="40" r="38" fill="#fff" /><circle cx="40" cy="40" r="33" fill="#1565C0" />
        <circle cx="40" cy="30" r="9" fill="#fff" /><rect x="24" y="43" width="32" height="19" rx="10" fill="#fff" />
      </svg>; })()}
    <div className="tile-zoom">
      <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>＋</button>
      <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>−</button>
    </div>
    <a className="tile-attrib" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>
  </div>;
}
