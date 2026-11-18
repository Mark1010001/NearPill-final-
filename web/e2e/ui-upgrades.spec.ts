import { expect, test, type Page } from '@playwright/test';

test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

function json(body: unknown, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA7sAAAAASUVORK5CYII=';

/** Dependency-free accessibility audit (axe-core cannot be installed without network access). */
async function audit(page: Page) {
  return page.evaluate(() => {
    const problems: string[] = [];
    const visible = (el: Element) => (el as HTMLElement).checkVisibility?.() !== false;
    const nameOf = (el: Element): string => {
      const html = el as HTMLElement & { labels?: NodeListOf<HTMLLabelElement>; value?: string };
      const labelledby = el.getAttribute('aria-labelledby');
      return (el.getAttribute('aria-label')
        || (labelledby ? labelledby.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '')
        || html.labels?.[0]?.textContent
        || html.textContent
        || el.querySelector('img')?.getAttribute('alt')
        || el.getAttribute('title')
        || (['button', 'submit'].includes(el.getAttribute('type') ?? '') ? html.value : '')
        || '').trim();
    };
    for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button]')) {
      if (visible(el) && !nameOf(el)) problems.push(`No accessible name: ${el.outerHTML.slice(0, 100)}`);
    }
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) problems.push(`Image without alt: ${img.outerHTML.slice(0, 80)}`);
    if (document.querySelectorAll('h1').length !== 1) problems.push(`Expected one h1, found ${document.querySelectorAll('h1').length}`);
    if (!document.documentElement.lang) problems.push('Missing html lang');
    if (!document.querySelector('main, [role=main]')) problems.push('Missing main landmark');
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    for (const id of new Set(ids.filter((value, index) => ids.indexOf(value) !== index))) problems.push(`Duplicate id: ${id}`);
    for (const el of document.querySelectorAll('[tabindex]')) if (Number(el.getAttribute('tabindex')) > 0) problems.push('Positive tabindex');
    return problems;
  });
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

test('portal pages pass the accessibility audit', async ({ page }) => {
  await mockPartner(page);
  for (const path of ['/partner', '/partner/orders', '/partner/inventory']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await audit(page), path).toEqual([]);
  }
  await page.unroute('**/api/v1/**');
  await mockAdmin(page);
  for (const path of ['/', '/pharmacies', '/orders']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await audit(page), path).toEqual([]);
  }
});

test('partner overview shows a needs-action queue with counts and links', async ({ page }) => {
  await mockPartner(page);
  await page.goto('/partner');
  const queue = page.getByRole('region', { name: 'Needs action' }).or(page.locator('section[aria-labelledby="needs-action-title"]'));
  await expect(queue.getByText('Paid and ready to prepare')).toBeVisible();
  await expect(queue.getByRole('link', { name: /Low or out of stock/ })).toContainText('2');
  await queue.getByRole('link', { name: /Low or out of stock/ }).click();
  await expect(page).toHaveURL(/\/partner\/inventory$/);
});

test('admin orders sort, select and export rows; columns can be hidden', async ({ page }) => {
  await mockAdmin(page);
  await page.goto('/orders');
  await page.getByRole('button', { name: /^Amount/ }).click();
  await expect(page.getByRole('columnheader', { name: /Amount/ })).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.getByRole('row').nth(1)).toContainText('NP-2');
  await page.getByRole('button', { name: /^Amount/ }).click();
  await expect(page.getByRole('row').nth(1)).toContainText('NP-1');
  await page.getByLabel('Select NP-1').check();
  await page.getByLabel('Select NP-3').check();
  await expect(page.getByText('2 selected')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toBe('orders.csv');
  await page.getByText('Columns', { exact: true }).click();
  await page.getByLabel('Customer', { exact: true }).uncheck();
  await expect(page.getByRole('columnheader', { name: 'Customer' })).toHaveCount(0);
});

test('desktop sidebar collapses to icons and remembers the choice', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockAdmin(page);
  await page.goto('/portal');
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.locator('.portal-shell')).toHaveAttribute('data-collapsed', 'true');
  await expect(page.getByRole('link', { name: 'Pharmacies', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.portal-shell')).toHaveAttribute('data-collapsed', 'true');
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.locator('.portal-shell')).toHaveAttribute('data-collapsed', 'false');
});

test('admin cancel order asks first and says what will happen', async ({ page }) => {
  const calls: unknown[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(json(admin));
    if (path.endsWith('/admin/orders')) return route.fulfill(json([{ id: 9, reference: 'NP-9', status: 'reserved', totalCentavos: 1000, storeName: 'Alpha', customerName: 'Ana', items: [], paymentStatus: 'pending' }]));
    if (path.includes('/status') && request.method() !== 'GET') { calls.push(request.postDataJSON()); return route.fulfill(json({ id: 9, status: 'cancelled' })); }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel NP-9?' });
  await expect(dialog).toContainText('reserved stock released');
  await dialog.getByRole('button', { name: 'Keep order' }).click();
  expect(calls).toHaveLength(0);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
  await expect.poll(() => calls.length).toBe(1);
});

test('quick stock edit validates, saves and can be undone', async ({ page }) => {
  const stock = { value: 4 };
  const writes: { stockOnHand: number; expectedStockOnHand: number }[] = [];
  await mockPartner(page, async (path, route) => {
    if (path.endsWith('/partner/inventory')) { await route.fulfill(json(inventory.map((item) => item.inventoryId === 3 ? { ...item, stockOnHand: stock.value } : item))); return true; }
    if (path.endsWith('/inventory/update')) {
      const body = route.request().postDataJSON();
      writes.push(body); stock.value = body.stockOnHand;
      await route.fulfill(json({ ok: true })); return true;
    }
    return false;
  });
  await page.goto('/partner/inventory');
  const field = page.getByLabel('Quick stock count for OTC Item');
  await field.fill('abc');
  await expect(page.getByText('Enter a whole number from 0.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await field.fill('12');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/changed from 4 to 12/)).toBeVisible();
  expect(writes[0]).toMatchObject({ stockOnHand: 12, expectedStockOnHand: 4 });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({ stockOnHand: 4, expectedStockOnHand: 12 });
  await expect(page.getByRole('status').filter({ hasText: 'changed from' })).toHaveCount(0);
  await expect(page.locator('.status-out-of-stock')).toBeVisible();
});

test('pharmacy confirms a draft product category with one button', async ({ page }) => {
  let confirmed = false;
  const bodies: { saleProduct?: unknown }[] = [];
  await mockPartner(page, async (path, route) => {
    if (path.endsWith('/partner/inventory')) {
      await route.fulfill(json([{ ...inventory[0], orderingState: confirmed ? 'orderable' : 'pharmacy_confirmation', saleProduct: ['OTC Item', null, 'Tablet', 'Non-Prescription'] }])); return true;
    }
    if (path.endsWith('/inventory/update')) { bodies.push(route.request().postDataJSON()); confirmed = true; await route.fulfill(json({ ok: true })); return true; }
    return false;
  });
  await page.goto('/partner/inventory');
  await page.getByRole('button', { name: 'Confirm product and category for Paracetamol' }).or(page.getByRole('button', { name: /Confirm product and category for/ })).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0].saleProduct).toEqual(['OTC Item', null, 'Tablet', 'Non-Prescription']);
});

test('prescription review: zoom, rotate, required reject reason, confirmed shortcuts', async ({ page }) => {
  const decisions: unknown[] = [];
  let pending = true;
  await mockPartner(page, async (path, route) => {
    const request = route.request();
    if (path.endsWith('/partner/prescription-reviews') && request.method() === 'GET') {
      await route.fulfill(json(pending ? [{ id: 4, productName: 'Sample Rx', medicineId: 9, version: '1794480000.000000', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), customerId: 31, customerName: 'Maria', submittedAt: new Date().toISOString() }] : [])); return true;
    }
    if (path.endsWith('/partner/prescription-reviews/4/photo')) { await route.fulfill(json({ mimeType: 'image/png', photo: png })); return true; }
    if (path.endsWith('/partner/prescription-reviews/4') && request.method() === 'PUT') { decisions.push(request.postDataJSON()); pending = false; await route.fulfill(json({ review: { id: 4, status: 'x' } })); return true; }
    return false;
  });
  await page.goto('/partner/orders');
  await page.getByRole('button', { name: 'Open photo' }).click();
  await expect(page.getByRole('img', { name: 'Sample prescription for Sample Rx' })).toBeVisible();
  const facts = page.getByRole('group', { name: 'What you are approving' }).or(page.locator('dl[aria-label="What you are approving"]'));
  await expect(facts).toContainText('#31');
  await expect(facts).toContainText('Sample Rx');
  await expect(facts).toContainText('Maria (#31)');
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect(page.getByRole('button', { name: 'Reset zoom' })).toHaveText('125%');
  await page.getByRole('button', { name: 'Rotate 90 degrees' }).click();
  await expect(page.getByRole('img', { name: /Sample prescription/ })).toHaveCSS('transform', /matrix/);
  // X opens the reject dialog; it cannot be submitted without a reason.
  await page.locator('.rx-stage').focus();
  await page.keyboard.press('x');
  const dialog = page.getByRole('dialog', { name: 'Reject this prescription?' });
  const reject = dialog.getByRole('button', { name: 'Reject and request replacement' });
  await expect(reject).toBeDisabled();
  await dialog.getByLabel('Reason shown to the customer').fill('Photo is too blurry to read');
  await expect(reject).toBeEnabled();
  await reject.click();
  await expect.poll(() => decisions.length).toBe(1);
  expect(decisions[0]).toEqual({ decision: 'rejected', version: '1794480000.000000', reason: 'Photo is too blurry to read' });
});
