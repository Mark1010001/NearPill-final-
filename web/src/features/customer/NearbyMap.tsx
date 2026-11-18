import type { Coordinates } from './location';

export type MapPharmacy = { id: number; name: string; lat: number; lng: number };

/**
 * A light, dependency-free map: the customer's position and the nearest pharmacies drawn to scale,
 * with a scale bar. The list beside it is the accessible equivalent, so the SVG is described, not read pin by pin.
 */
export function NearbyMap({ position, pharmacies }: { position: Coordinates; pharmacies: MapPharmacy[] }) {
  const width = 640;
  const height = 320;
  const pad = 36;
  const kmPerDegLat = 111.32;
  const kmPerDegLng = 111.32 * Math.cos((position.lat * Math.PI) / 180);
  const points = pharmacies.map((p) => ({ ...p, x: (p.lng - position.lng) * kmPerDegLng, y: (p.lat - position.lat) * kmPerDegLat }));
  const reach = Math.max(0.5, ...points.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const scale = Math.min((width / 2 - pad) / reach, (height / 2 - pad) / reach);
  const at = (x: number, y: number) => ({ cx: width / 2 + x * scale, cy: height / 2 - y * scale });
  const barKm = reach > 6 ? 5 : reach > 2.5 ? 2 : reach > 1 ? 1 : 0.5;
  const accuracyRadius = Math.min(Math.max((position.accuracy / 1000) * scale, 6), 90);
  return <figure className="nearby-map">
    <svg viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Map showing your location and the ${points.length} nearest pharmacies. The numbered list below gives the same information.`}>
      <rect width={width} height={height} rx="12" className="nearby-map-bg" />
      <circle cx={width / 2} cy={height / 2} r={reach * scale * 0.5} className="nearby-map-ring" />
      <circle cx={width / 2} cy={height / 2} r={reach * scale} className="nearby-map-ring" />
      <circle cx={width / 2} cy={height / 2} r={accuracyRadius} className="nearby-map-accuracy" />
      {points.map((p, index) => {
        const { cx, cy } = at(p.x, p.y);
        return <g key={p.id} transform={`translate(${cx} ${cy})`}>
          <circle r="13" className="nearby-map-pin" />
          <text textAnchor="middle" dy="4.5" className="nearby-map-pin-text">{index + 1}</text>
        </g>;
      })}
      <circle cx={width / 2} cy={height / 2} r="8" className="nearby-map-you" />
      <text x={width / 2} y={height / 2 - 14} textAnchor="middle" className="nearby-map-you-text">You</text>
      <g transform={`translate(${pad / 2} ${height - 16})`}>
        <line x2={barKm * scale} stroke="currentColor" strokeWidth="2" />
        <line y1="-4" y2="4" stroke="currentColor" strokeWidth="2" />
        <line x1={barKm * scale} x2={barKm * scale} y1="-4" y2="4" stroke="currentColor" strokeWidth="2" />
        <text x={barKm * scale + 8} dy="4" className="nearby-map-scale">{barKm < 1 ? `${barKm * 1000} m` : `${barKm} km`}</text>
      </g>
    </svg>
    <figcaption className="shop-muted">North is up. Pharmacy positions are drawn to scale around you.</figcaption>
  </figure>;
}
