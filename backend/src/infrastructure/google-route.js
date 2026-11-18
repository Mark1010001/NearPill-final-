export function createGoogleRoutePlanner(apiKey, fetchRoute = fetch) {
  const requests = new Map();
  return async (origin, destination, actorId) => {
    if (!apiKey) throw new Error('Routes API key not configured');
    const now = Date.now();
    for (const [id, at] of requests) if (now - at > 60000) requests.delete(id);
    if (now - (requests.get(actorId) ?? 0) < 1000 || requests.size >= 1000) throw new Error('Route request limit reached');
    requests.set(actorId, now);
    const response = await fetchRoute('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST', signal: AbortSignal.timeout(8000),
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.geoJsonLinestring' },
      body: JSON.stringify({ origin: { location: { latLng: origin } }, destination: { location: { latLng: destination } }, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_UNAWARE', polylineEncoding: 'GEO_JSON_LINESTRING' }),
    });
    if (!response.ok) throw new Error('Google Routes unavailable');
    const body = await response.json();
    const route = body.routes?.[0];
    const points = route?.polyline?.geoJsonLinestring?.coordinates;
    const duration = typeof route?.duration === 'string' && /^\d+(\.\d+)?s$/.test(route.duration) ? Number(route.duration.slice(0, -1)) : NaN;
    if (!Number.isFinite(route?.distanceMeters) || route.distanceMeters < 0 || !Number.isFinite(duration) || !Array.isArray(points) || points.length < 2 || points.length > 20000 || !points.every(p => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Math.abs(p[0]) <= 180 && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90)) throw new Error('No valid road route');
    return { distanceMeters: route.distanceMeters, durationSeconds: duration, coordinates: points };
  };
}
