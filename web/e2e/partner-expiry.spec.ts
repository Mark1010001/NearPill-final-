import { expect, test, type Page } from '@playwright/test';

function json(body: unknown, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }
const partner = { id: 7, role: 'partner', email: 'partner@example.test', memberships: [{ drugstoreId: 12, membershipRole: 'staff', isActive: true }] };
const day = (offset: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };

function item(id: number, name: string, stock: number, extra: Record<string, unknown> = {}) {
  return { inventoryId: id, drugstoreId: 12, medicineId: id + 100, medicineName: name, category: 'Non-Prescription', priceCentavos: 5000, stockOnHand: stock,
    reservedQuantity: 0, sellableQuantity: stock, sellingUnit: 'Tablet', orderingState: 'orderable', ...extra };
}

async function mock(page: Page, inventory: unknown[], posted: Record<string, unknown>[]) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(partner));
    if (pathname.endsWith('/partner/dashboard')) return route.fulfill(json({ drugstoreId: 12, membershipRole: 'staff', totalSales: 0, totalOrders: 0, completedOrders: 0, pendingOrders: 0 }));
    if (pathname.endsWith('/partner/orders')) return route.fulfill(json([]));
    if (pathname.endsWith('/partner/prescription-reviews')) return route.fulfill(json([]));
    if (pathname.endsWith('/partner/subscription')) return route.fulfill(json({ subscription: null, entitlements: [] }));
    if (pathname.endsWith('/partner/stock-submissions')) return route.fulfill(json({ pharmacyName: 'Alpha Pharmacy', submissions: [] }));
    if (pathname.endsWith('/partner/inventory/catalog')) return route.fulfill(json([]));
    if (pathname.endsWith('/partner/inventory')) return route.fulfill(json(inventory));
    if (pathname.endsWith('/inventory/update') && request.method() === 'POST') { posted.push(request.postDataJSON()); return route.fulfill(json({ success: true })); }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
}

test('inventory flags expired, soon-to-expire and low-stock items using each pharmacy level', async ({ page }) => {
  await mock(page, [
    item(1, 'Expired Syrup', 40, { expiryDate: day(-3) }),
    item(2, 'Soon Tablets', 40, { expiryDate: day(10) }),
    item(3, 'Fresh Capsules', 40, { expiryDate: day(200) }),
    item(4, 'Custom Level Drops', 12, { lowStockThreshold: 15 }),
    item(5, 'Default Level Gel', 12),
  ], []);
  await page.goto('/partner/inventory');
  const row = (name: string) => page.getByRole('row', { name: new RegExp(name) });
  await expect(row('Expired Syrup').getByText('Expired', { exact: true })).toBeVisible();
  await expect(row('Soon Tablets').getByText('Expires soon')).toBeVisible();
  await expect(row('Fresh Capsules').getByText('Expires soon')).toHaveCount(0);
  await expect(row('Fresh Capsules').getByText('Expired', { exact: true })).toHaveCount(0);
  await expect(row('Custom Level Drops').getByText('Low stock')).toBeVisible();
  await expect(row('Default Level Gel').getByText('Low stock')).toHaveCount(0);
});

test('overview counts expired or expiring items and saving sends the expiry date and level', async ({ page }) => {
  const posted: Record<string, unknown>[] = [];
  await mock(page, [item(1, 'Expired Syrup', 40, { expiryDate: day(-3) }), item(2, 'Fresh Capsules', 40)], posted);
  await page.goto('/partner');
  await expect(page.getByRole('link', { name: /Expired or expiring within 30 days/ })).toContainText('1');
  await page.goto('/partner/inventory');
  await page.getByRole('button', { name: 'Edit stock and price for Fresh Capsules' }).click();
  await page.getByLabel('Expiry date (optional)').fill(day(90));
  await page.getByLabel('Low-stock warning at (optional)').fill('20');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ medicineId: 102, stockOnHand: 40, expiryDate: day(90), lowStockThreshold: 20 });
});

test('clearing the expiry date and level sends null so the backend removes them', async ({ page }) => {
  const posted: Record<string, unknown>[] = [];
  await mock(page, [item(1, 'Expired Syrup', 40, { expiryDate: day(-3), lowStockThreshold: 8 })], posted);
  await page.goto('/partner/inventory');
  await page.getByRole('button', { name: 'Edit stock and price for Expired Syrup' }).click();
  await page.getByLabel('Expiry date (optional)').fill('');
  await page.getByLabel('Low-stock warning at (optional)').fill('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0]).toMatchObject({ expiryDate: null, lowStockThreshold: null });
});
