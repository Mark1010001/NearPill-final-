import { chromium } from '@playwright/test';
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA7sAAAAASUVORK5CYII=';
const partner = { id: 7, role: 'partner', email: 'p@example.test', memberships: [{ drugstoreId: 12, membershipRole: 'staff', isActive: true }] };
const admin = { id: 1, role: 'admin', email: 'a@example.test' };
const orders = [
  { id: 1, reference: 'NP-1', status: 'confirmed', totalCentavos: 30000, storeName: 'Alpha', customerName: 'Ana', items: [{ name: 'Paracetamol', quantity: 2 }], paymentStatus: 'confirmed' },
  { id: 2, reference: 'NP-2', status: 'preparing', totalCentavos: 10000, storeName: 'Beta', customerName: 'Ben', items: [], paymentStatus: 'confirmed' },
  { id: 3, reference: 'NP-3', status: 'ready_for_pickup', totalCentavos: 20000, storeName: 'Alpha', customerName: 'Cy', items: [], paymentStatus: 'confirmed' },
];
const inventory = [
  { inventoryId: 3, drugstoreId: 12, medicineId: 8, medicineName: 'Paracetamol 500 mg', category: 'Non-Prescription', priceCentavos: 550, stockOnHand: 4, reservedQuantity: 1, sellableQuantity: 3, sellingUnit: 'Tablet', orderingState: 'orderable' },
  { inventoryId: 4, drugstoreId: 12, medicineId: 9, medicineName: 'Amoxicillin 500 mg', category: 'Non-Prescription', priceCentavos: 1250, stockOnHand: 0, reservedQuantity: 0, sellableQuantity: 0, sellingUnit: 'Capsule', orderingState: 'out_of_stock' },
  { inventoryId: 5, drugstoreId: 12, medicineId: 10, medicineName: 'Cetirizine 10 mg', category: 'Non-Prescription', priceCentavos: 800, stockOnHand: 120, reservedQuantity: 0, sellableQuantity: 120, sellingUnit: 'Tablet', orderingState: 'orderable' },
];
const browser = await chromium.launch({ channel: 'chrome' });
async function shot(name, user, viewport, path, act) {
  const ctx = await browser.newContext({ viewport, baseURL: 'http://127.0.0.1:5173' });
  const page = await ctx.newPage();
  await page.route('**/api/v1/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/auth/me')) return route.fulfill(json(user));
    if (p.endsWith('/partner/dashboard')) return route.fulfill(json({ drugstoreId: 12, membershipRole: 'staff', totalSales: 12500, totalOrders: 3, completedOrders: 1, pendingOrders: 2 }));
    if (p.endsWith('/partner/orders')) return route.fulfill(json(orders));
    if (p.endsWith('/partner/inventory')) return route.fulfill(json(inventory));
    if (p.endsWith('/partner/subscription')) return route.fulfill(json({ subscription: null, entitlements: [] }));
    if (p.endsWith('/partner/prescription-reviews')) return route.fulfill(json([{ id: 4, productName: 'Amoxicillin 500 mg', medicineId: 9, version: '1794480000.000000', expiresAt: new Date(Date.now() + 3600000).toISOString(), customerId: 31 }]));
    if (p.endsWith('/photo')) return route.fulfill(json({ mimeType: 'image/png', photo: png }));
    if (p.endsWith('/admin/metrics')) return route.fulfill(json({ totalGMV: 6000000, activePharmaciesCount: 4, totalOrdersCount: 3 }));
    if (p.endsWith('/admin/orders')) return route.fulfill(json(orders));
    if (p.endsWith('/admin/pharmacies')) return route.fulfill(json([{ id: 5, store_id: 5, name: 'Alpha Pharmacy', address: '1 Road', status: 'active', verificationStatus: 'pending', latitude: 10, longitude: 123 }, { id: 6, store_id: 6, name: 'Beta Pharmacy', address: '2 Road', status: 'active', verificationStatus: 'verified', publicProfilePublishedAt: '2026-11-01', latitude: 10, longitude: 123 }]));
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto(path);
  await page.waitForTimeout(800);
  if (act) await act(page);
  await page.screenshot({ path: `../logs/shots/${name}.png` });
  await ctx.close();
}
await shot('partner-overview-1280', partner, { width: 1280, height: 800 }, '/partner');
await shot('partner-inventory-768', partner, { width: 768, height: 1000 }, '/partner/inventory');
await shot('partner-review-768', partner, { width: 768, height: 1000 }, '/partner/orders', async (p) => { await p.getByRole('button', { name: 'Open photo' }).click(); await p.waitForTimeout(600); });
await shot('admin-pharmacies-1280', admin, { width: 1280, height: 800 }, '/pharmacies');
await shot('admin-orders-collapsed-1280', admin, { width: 1280, height: 800 }, '/orders', async (p) => { await p.getByRole('button', { name: 'Collapse sidebar' }).click(); await p.getByLabel('Select NP-1').check(); });
await shot('admin-dashboard-1280', admin, { width: 1280, height: 700 }, '/');
await browser.close();
console.log('shots done');
