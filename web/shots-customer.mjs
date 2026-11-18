import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
mkdirSync('../logs/shots-customer', { recursive: true });
const J = (b, s = 200) => ({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
const tile = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const stores = [
  { store_id: 12, store_name: 'Test Central Pharmacy', verified: true, openNow: true, address: 'Cebu City', latitude: '10.3170', longitude: '123.8910', operating_hours: '8am - 9pm', distanceKm: 0.35 },
  { store_id: 21, store_name: 'Test West Pharmacy', verified: true, openNow: false, address: 'Guadalupe, Cebu City', latitude: '10.3300', longitude: '123.9000', distanceKm: 1.9 },
];
const para = { id: 5, name: 'Test Paracetamol 500 mg', genericName: 'Paracetamol', dosageForm: 'Tablet', category: 'Non-Prescription (source list)', drugstoreId: 12, drugstoreName: 'Test Central Pharmacy', publicationStatus: 'published', canOrder: true, stockCount: 4, priceCentavos: 550, sellingUnit: 'Tablet', distanceKm: 0.354 };
const rx = { ...para, id: 9, name: 'Test Prescription Drug', category: 'Prescription (source list)', canOrder: false };
const user = { id: 7, email: 'first@example.test', fullName: 'First Customer', role: 'customer', phone: '09171234567', birthDate: '01/02/1990' };
const order = { id: 31, reference: 'NP-31', storeName: 'Test Central Pharmacy', itemSummary: 'Test Paracetamol 500 mg x2', itemCount: 2, totalCentavos: 1100, status: 'reserved', stage: 'reserved', placedOn: 'Nov 1, 2026', createdAt: '2026-11-01T00:00:00Z', drugstoreId: 12,
  items: [{ id: 5, name: para.name, quantity: 2, drugstoreId: 12, priceCentavos: 550 }] };
const cart = JSON.stringify({ grouped: false, items: [{ listing: para, quantity: 2 }] });
const browser = await chromium.launch({ channel: 'chrome' });
const pages = [
  ['welcome', '/app/welcome', false], ['sign-in', '/app/sign-in', false], ['home', '/app/', true], ['search', '/app/search', true],
  ['pharmacies', '/app/pharmacies', true], ['store', '/app/pharmacies/12', true], ['product', '/app/pharmacies/12/medicines/5', true],
  ['map', '/app/map', true], ['assistant', '/app/assistant', true], ['cart', '/app/orders?tab=cart', true],
  ['checkout', '/app/checkout', true], ['orders', '/app/orders?tab=orders', true], ['order-detail', '/app/orders?tab=orders&testOrder=31', true], ['profile', '/app/profile', true],
];
const report = [];
for (const width of [390, 768, 1280]) for (const [name, path, signed] of pages) {
  const ctx = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, baseURL: 'http://127.0.0.1:5173', geolocation: { latitude: 10.3157, longitude: 123.8854 }, permissions: ['geolocation'] });
  await ctx.addInitScript(([c, s]) => { try { localStorage.setItem('np-onboarding-done', '1'); if (s) localStorage.setItem('nearpill_cart_user_7', c); } catch {} }, [cart, signed]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.route('**/tile.openstreetmap.org/**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: tile }));
  await page.route('**/api/v1/**', (route) => {
    const u = new URL(route.request().url()); const p = u.pathname.replace('/api/v1', '');
    if (p === '/auth/me') return signed ? route.fulfill(J(user)) : route.fulfill(J({ error: 'x' }, 401));
    if (p === '/medicines') return route.fulfill(J([para, rx]));
    if (p === '/medicines/5') return route.fulfill(J({ ...para, description: 'Pain and fever relief.' }));
    if (p === '/stores') return route.fulfill(J(stores));
    if (p === '/stores/nearby') return route.fulfill(J({ mode: 'gps', stores, center: { latitude: 10.3157, longitude: 123.8854 }, radiusKm: 5 }));
    if (p === '/stores/12/inventory') return route.fulfill(J({ store: stores[0], inventory: [para, rx] }));
    if (p === '/stores/12/route') return route.fulfill(J({ distanceMeters: 2450, durationSeconds: 400, coordinates: [[123.8854, 10.3157], [123.891, 10.317]] }));
    if (p === '/orders') return route.fulfill(J([order]));
    return route.fulfill(J({ error: 'not mocked' }, 404));
  });
  await page.goto(path); await page.waitForTimeout(1800);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const h1 = await page.evaluate(() => (document.querySelector('h1')?.textContent ?? '').slice(0, 50));
  report.push({ width, name, overflow, h1, errors });
  await page.screenshot({ path: `../logs/shots-customer/${name}-${width}.png`, fullPage: false });
  await ctx.close();
}
writeFileSync('../logs/shots-customer/report.json', JSON.stringify(report, null, 1));
await browser.close();
console.log(report.filter((r) => r.overflow !== 0 || r.errors.length).length + ' pages with overflow/errors of ' + report.length);
