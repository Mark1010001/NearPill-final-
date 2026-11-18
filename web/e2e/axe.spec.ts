import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

function json(body: unknown, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }

// Real axe-core scan. Needs: npm i --no-save axe-core @axe-core/playwright (scripts\audit.ps1 does this).
async function axeViolations(page: Page) {
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  for (const v of result.violations) console.log(`AXE ${v.impact} ${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`);
  return result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

const partner = { id: 7, role: 'partner', email: 'partner@example.test', memberships: [{ drugstoreId: 12, membershipRole: 'staff', isActive: true }] };
const admin = { id: 1, role: 'admin', email: 'admin@example.test' };
const orders = [
  { id: 1, reference: 'NP-1', status: 'confirmed', totalCentavos: 30000, storeName: 'Alpha', customerName: 'Ana', items: [] },
  { id: 2, reference: 'NP-2', status: 'preparing', totalCentavos: 10000, storeName: 'Beta', customerName: 'Ben', items: [] },
  { id: 3, reference: 'NP-3', status: 'ready_for_pickup', totalCentavos: 20000, storeName: 'Alpha', customerName: 'Cy', items: [] },
];
const inventory = [
  { inventoryId: 3, drugstoreId: 12, medicineId: 8, medicineName: 'OTC Item', category: 'Non-Prescription', priceCentavos: 5000, stockOnHand: 4, reservedQuantity: 1, sellableQuantity: 3, sellingUnit: 'Tablet', orderingState: 'orderable' },
  { inventoryId: 4, drugstoreId: 12, medicineId: 9, medicineName: 'Empty Item', category: 'Non-Prescription', priceCentavos: 2500, stockOnHand: 0, reservedQuantity: 0, sellableQuantity: 0, sellingUnit: 'Tablet', orderingState: 'out_of_stock' },
];

async function mockPartner(page: Page, extra?: (path: string, route: import('@playwright/test').Route) => Promise<boolean> | boolean) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (extra && await extra(path, route)) return;
    if (path.endsWith('/auth/me')) return route.fulfill(json(partner));
    if (path.endsWith('/partner/dashboard')) return route.fulfill(json({ drugstoreId: 12, membershipRole: 'staff', totalSales: 0, totalOrders: 3, completedOrders: 0, pendingOrders: 3 }));
    if (path.endsWith('/partner/orders')) return route.fulfill(json(orders));
    if (path.endsWith('/partner/inventory')) return route.fulfill(json(inventory));
    if (path.endsWith('/partner/subscription')) return route.fulfill(json({ subscription: null, entitlements: [] }));
    if (path.endsWith('/partner/stock-submissions')) return route.fulfill(json({ pharmacyName: 'Alpha Pharmacy', submissions: [] }));
    if (path.endsWith('/partner/inventory/catalog')) return route.fulfill(json([]));
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
}
async function mockAdmin(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(json(admin));
    if (path.endsWith('/admin/metrics')) return route.fulfill(json({ totalGMV: 0, activePharmaciesCount: 1, totalOrdersCount: 3 }));
    if (path.endsWith('/admin/orders')) return route.fulfill(json(orders));
    if (path.endsWith('/admin/pharmacies')) return route.fulfill(json([{ id: 5, store_id: 5, name: 'Alpha', address: '1 Road', status: 'active', verificationStatus: 'pending', latitude: 10, longitude: 123 }]));
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
}


const pages: [string, 'partner' | 'admin', string][] = [
  ['partner overview', 'partner', '/partner'],
  ['partner inventory', 'partner', '/partner/inventory'],
  ['partner orders', 'partner', '/partner/orders'],
  ['admin dashboard', 'admin', '/'],
  ['admin orders', 'admin', '/orders'],
  ['admin pharmacies', 'admin', '/pharmacies'],
];
for (const [name, role, path] of pages) {
  test(`axe: ${name} has no serious or critical violations`, async ({ page }) => {
    try { await import('@axe-core/playwright'); } catch { test.skip(true, 'axe not installed'); }
    if (role === 'partner') await mockPartner(page); else await mockAdmin(page);
    await page.goto(path);
    await page.getByRole('main').waitFor();
    await page.waitForLoadState('networkidle');
    expect(await axeViolations(page)).toEqual([]);
  });
}
