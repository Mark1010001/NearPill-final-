import { expect, test, type Page } from '@playwright/test';

// Runs against a dev server built with a fake browser key (see playwright.config.ts). Google's script is replaced by a stub.
test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

const stores = [
  { store_id: 12, store_name: 'Test Central Pharmacy', verified: true, openNow: true, address: 'Cebu City', latitude: '10.3170', longitude: '123.8910' },
  { store_id: 21, store_name: 'Test West Pharmacy', verified: true, openNow: false, address: 'Guadalupe, Cebu City', latitude: '10.3300', longitude: '123.9000' },
];
const customer = { id: 7, email: 'first@example.test', fullName: 'First Customer', role: 'customer' };

const fakeGoogle = `
(function () {
  var gm = { maps: [], markers: [], polylines: [], fits: [], center: null, zoom: null, info: null };
  window.__gm = gm;
  function FakeMarker(o) { this.o = o; this.l = {}; gm.markers.push(this); }
  FakeMarker.prototype.setMap = function (m) { this.o.map = m; };
  FakeMarker.prototype.addListener = function (e, h) { this.l[e] = h; };
  function FakeMap(el, o) { el.setAttribute('data-fake-map', '1'); gm.maps.push(o); }
  FakeMap.prototype.fitBounds = function (b, p) { gm.fits.push({ points: b.pts.length, padding: p }); };
  FakeMap.prototype.setCenter = function (c) { gm.center = c; };
  FakeMap.prototype.setZoom = function (z) { gm.zoom = z; };
  function FakeInfo() {}
  FakeInfo.prototype.setContent = function (n) { this.n = n; };
  FakeInfo.prototype.open = function () { gm.info = this.n.textContent; };
  FakeInfo.prototype.close = function () {};
  function FakeLine(o) { gm.polylines.push(o); }
  FakeLine.prototype.setMap = function () {};
  function FakeBounds() { this.pts = []; }
  FakeBounds.prototype.extend = function (p) { this.pts.push(p); };
  function FakeSize(w, h) { this.w = w; this.h = h; }
  function FakePoint(x, y) { this.x = x; this.y = y; }
  window.google = { maps: { Map: FakeMap, Marker: FakeMarker, InfoWindow: FakeInfo, Polyline: FakeLine, LatLngBounds: FakeBounds, Size: FakeSize, Point: FakePoint } };
})();
`;

async function mock(page: Page, calls: string[]) {
  await page.route('**/api/v1/**', (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v1', '');
    calls.push(path);
    if (path === '/auth/me') return route.fulfill({ json: customer });
    if (path === '/stores') return route.fulfill({ json: stores });
    if (path === '/stores/nearby') return route.fulfill({ json: { mode: 'gps', stores, center: { latitude: 10.3157, longitude: 123.8854 }, radiusKm: 5 } });
    if (path === '/stores/12/route') return route.fulfill({ json: { distanceMeters: 2450, durationSeconds: 400, coordinates: [[123.8854, 10.3157], [123.891, 10.317]] } });
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
}

test('the map screen uses Google Maps like the app: key, pins, You marker, info window and blue road route', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 10.3157, longitude: 123.8854 });
  const calls: string[] = [];
  const scriptUrls: string[] = [];
  await mock(page, calls);
  await page.route('https://maps.googleapis.com/maps/api/js**', (route) => {
    scriptUrls.push(route.request().url());
    return route.fulfill({ contentType: 'text/javascript', body: `${fakeGoogle}\nsetTimeout(function () { window.__nearpillMapsReady(); }, 0);` });
  });
  await page.goto('/app/map');
  await expect(page.locator('[data-fake-map]')).toBeVisible();
  await expect(page.locator('.tile-map')).toHaveCount(0);
  expect(scriptUrls).toHaveLength(1);
  const script = new URL(scriptUrls[0]!);
  expect(script.searchParams.get('key')).toBe('test-key-not-real');

  await expect.poll(() => page.evaluate(() => (window as unknown as { __gm: { markers: { o: { map: unknown } }[] } }).__gm.markers.filter((m) => m.o.map).length)).toBe(3);
  const markers = await page.evaluate(() => (window as unknown as { __gm: { markers: { o: { title: string; zIndex?: number; icon: { url: string; scaledSize: { w: number; h: number } } } }[] } }).__gm.markers.filter((m) => (m.o as unknown as { map: unknown }).map).map((m) => ({ title: m.o.title, z: m.o.zIndex, url: m.o.icon.url.slice(0, 18), w: m.o.icon.scaledSize.w, h: m.o.icon.scaledSize.h })));
  expect(markers.filter((m) => m.title.startsWith('Test '))).toHaveLength(2);
  expect(markers.find((m) => m.title === 'You are here')).toMatchObject({ z: 10, w: 40, h: 40 });
  expect(markers.every((m) => m.url === 'data:image/svg+xml')).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __gm: { fits: { padding: number }[] } }).__gm.fits.at(-1)?.padding)).toBe(48);

  // Tapping a pharmacy pin shows its name and address and requests the road route, drawn as the app's blue 6px line.
  await page.evaluate(() => (window as unknown as { __gm: { markers: { o: { map: unknown; title: string }; l: { click: () => void } }[] } }).__gm.markers.filter((m) => m.o.map && m.o.title === 'Test Central Pharmacy')[0]!.l.click());
  expect(await page.evaluate(() => (window as unknown as { __gm: { info: string } }).__gm.info)).toContain('Test Central Pharmacy');
  await expect(page.getByText('2.45 km by road · 7 min estimated')).toBeVisible();
  const line = await page.evaluate(() => (window as unknown as { __gm: { polylines: { strokeColor: string; strokeWeight: number; path: unknown[] }[] } }).__gm.polylines.at(-1));
  expect(line).toMatchObject({ strokeColor: '#1976D2', strokeWeight: 6 });
  expect(line!.path).toHaveLength(2);
  expect(calls).toContain('/stores/12/route');
  // The list under the map is still the keyboard equivalent.
  await expect(page.getByRole('button', { name: 'Navigate' })).toHaveCount(0);
});

for (const [name, body, status] of [
  ['the script cannot load', 'nope', 500],
  ['Google refuses the key', `${fakeGoogle}\nsetTimeout(function () { window.gm_authFailure(); }, 0);`, 200],
] as const) {
  test(`the map falls back to OpenStreetMap when ${name}`, async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 10.3157, longitude: 123.8854 });
    await mock(page, []);
    await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
    await page.route('https://maps.googleapis.com/maps/api/js**', (route) => route.fulfill({ status, contentType: 'text/javascript', body }));
    await page.goto('/app/map');
    await expect(page.locator('.tile-map')).toBeVisible();
    await expect(page.getByText('2 verified pharmacies')).toBeVisible();
  });
}
