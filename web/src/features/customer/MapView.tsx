import { useState } from 'react';
import { GoogleMap, googleMapsKey } from './GoogleMap';
import { TileMap, type MapStore } from './TileMap';

type Props = { you: { lat: number; lng: number } | null; stores: MapStore[]; route: [number, number][] | null; selectedId: number | null; onSelect: (store: MapStore) => void };

/** Google Maps (as in the app) when a browser key is configured; the OpenStreetMap map if it is not or cannot load. */
export function MapView(props: Props) {
  const [unavailable, setUnavailable] = useState(false);
  if (!googleMapsKey || unavailable) return <TileMap {...props} />;
  return <GoogleMap apiKey={googleMapsKey} {...props} onUnavailable={() => setUnavailable(true)} />;
}
