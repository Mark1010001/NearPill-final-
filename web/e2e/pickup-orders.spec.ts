import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

function json(body: unknown, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }
const customer = { id: '7', email: 'sam@example.test', fullName: 'Sam Customer', role: 'customer' };
const day = (offset: number) => new Date(Date.now() + 8 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

const orders = () => [
  { id: 1, reference: 'NP-1', status: 'awaiting_payment', totalCentavos: 13000, storeName: 'Dobol B Pharmacy', placedOn: 'Nov 14, 2026', pickupDate: day(1), pickupWindow: 'morning', pickupRescheduled: false,
    items: [{ id: 5, name: 'Biogesic 500 mg', quantity: 2, priceCentavos: 6500 }] },
  { id: 2, reference: 'NP-2', status: 'preparing', totalCentavos: 5000, storeName: 'Bing Pharmacy', placedOn: 'Nov 14, 2026', pickupDate: day(0), pickupRescheduled: false,
    items: [{ id: 7, name: 'Cetirizine', quantity: 1, priceCentavos: 5000, prescriptionRequired: true }] },
  { id: 3, reference: 'NP-3', status: 'ready_for_pickup', totalCentavos: 7000, storeName: 'Bing Pharmacy', placedOn: 'Nov 10, 2026', pickupDate: day(-1), pickupRescheduled: true,
    items: [{ id: 8, name: 'Vitamin C', quantity: 1, priceCentavos: 7000 }] },
  { id: 4, reference: 'NP-4', status: 'completed', totalCentavos: 3000, storeName: 'Bing Pharmacy', placedOn: 'Nov 1, 2026',
    items: [{ id: 9, name: 'Mask', quantity: 1, priceCentavos: 3000 }] },
  { id: 5, reference: 'NP-5', status: 'cancelled', totalCentavos: 3000, storeName: 'Bing Pharmacy', placedOn: 'Nov 1, 2026',
    items: [{ id: 9, name: 'Mask', quantity: 1, priceCentavos: 3000 }] },
];

async function mock(page: Page) {
  const puts: unknown[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(customer));
    if (pathname.endsWith('/orders/1/pickup') && request.method() === 'PUT') { puts.push(request.postDataJSON()); return route.fulfill(json({ success: true })); }
    if (pathname.endsWith('/orders')) return route.fulfill(json(orders()));
    return route.fulfill(json([]));
  });
  return puts;
}

test('My Orders filters by payment and pickup state and shows each pickup date', async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/orders?tab=orders');
  const filters = page.getByRole('group', { name: 'Order filter' });
  for (const name of ['All (5)', 'To pay (1)', 'To pick up (1)', 'Ready (1)', 'Completed (1)', 'Cancelled (1)']) await expect(filters.getByRole('button', { name })).toBeVisible();
  await expect(page.getByRole('button', { name: /Dobol B Pharmacy/ })).toContainText('Pick up');
  await expect(page.getByRole('button', { name: /Dobol B Pharmacy/ })).toContainText('Morning (8–12)');
  await expect(page.getByRole('button', { name: /NP-2/ })).toContainText('Today');
  await expect(page.getByRole('button', { name: /NP-3/ })).toContainText('Pickup date passed');
  await expect(page.getByRole('button', { name: /NP-4/ })).toContainText('No pickup date');
  await expect(page.getByRole('button', { name: 'Pay now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'View receipt' })).toBeVisible();
  await filters.getByRole('button', { name: /^To pay/ }).click();
  await expect(page.getByRole('button', { name: /Dobol B Pharmacy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /NP-2/ })).toHaveCount(0);
  await filters.getByRole('button', { name: /^Ready/ }).click();
  await expect(page.getByRole('button', { name: /NP-3/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('the pickup date can be changed once and a paid order receipt downloads as a PDF', async ({ page }) => {
  const puts = await mock(page);
  await page.goto('/app/orders?tab=orders');
  await page.getByRole('button', { name: /Dobol B Pharmacy/ }).click();
  const card = page.getByRole('region', { name: 'Pickup date' });
  await expect(card).toContainText('Morning (8–12)');
  await card.getByRole('button', { name: 'Change pickup date' }).click();
  await page.getByRole('group', { name: 'New pickup date' }).getByRole('button').nth(3).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => puts.length).toBe(1);
  expect((puts[0] as { pickupDate: string }).pickupDate).toBe(day(3));

  await page.getByRole('button', { name: 'Back to My Orders' }).click();
  await page.getByRole('button', { name: /NP-3/ }).click();
  await expect(page.getByRole('region', { name: 'Pickup date' })).toContainText('Pickup date changed once');
  await expect(page.getByRole('button', { name: 'Change pickup date' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Back to My Orders' }).click();
  await page.getByRole('button', { name: /NP-2/ }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download receipt (PDF)' }).click()]);
  expect(download.suggestedFilename()).toBe('NearPill-receipt-NP-2.pdf');
  const bytes = await readFile(await download.path());
  const text = bytes.toString('latin1');
  expect(text.startsWith('%PDF-1.4')).toBe(true);
  for (const expected of ['NP-2', 'Bing Pharmacy', 'Sam Customer', 'Cetirizine', 'PHP 50.00', 'Capstone test payment, no real money was charged.']) expect(text).toContain(expected);
  const unpaid = await (async () => { await page.getByRole('button', { name: 'Back to My Orders' }).click(); await page.getByRole('button', { name: /Dobol B Pharmacy/ }).click(); return page.getByRole('button', { name: 'Download receipt (PDF)' }).count(); })();
  expect(unpaid).toBe(0);
});

const detailOrder = {
  id: 1, reference: 'NP-1', status: 'awaiting_payment', totalCentavos: 17000, storeName: 'Bing Pharmacy', placedOn: 'Nov 18, 2026',
  pickupDate: '2026-11-20', pickupRescheduled: false,
  items: [
    { id: 5, name: 'Zyloric', genericName: 'Allopurinol', quantity: 2, priceCentavos: 6500, drugstoreId: 3, drugstoreName: 'Bing Pharmacy', category: 'Prescription', dosageForm: 'Tablet' },
    { id: 6, name: 'Melmag', genericName: 'Aluminum + Magnesium', quantity: 1, priceCentavos: 4000, drugstoreId: 3, drugstoreName: 'Bing Pharmacy', category: 'Non-prescription', dosageForm: 'Capsule' },
  ],
};
const bingPharmacy = { store_id: 3, store_name: 'Bing Pharmacy', address: 'Cebu', latitude: null, longitude: null, openNow: true, verified: true, operating_hours: '8:00 AM - 6:00 PM' };

async function mockDetailOrder(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(customer));
    if (pathname.endsWith('/orders')) return route.fulfill(json([detailOrder]));
    if (pathname.endsWith('/stores')) return route.fulfill(json([bingPharmacy]));
    return route.fulfill(json([]));
  });
}

test('My Orders lines show the category icon, generic name, pharmacy, category and price', async ({ page }) => {
  await mockDetailOrder(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/orders?tab=orders');
  const lines = page.locator('.order-line');
  await expect(lines).toHaveCount(2);
  await expect(lines.nth(0)).toContainText('Zyloric');
  await expect(lines.nth(0)).toContainText('Allopurinol');
  await expect(lines.nth(0)).toContainText('Bing Pharmacy · Prescription');
  await expect(lines.nth(0)).toContainText('₱65.00 each × 2');
  await expect(lines.nth(0)).toContainText('₱130.00');
  await expect(lines.nth(1)).toContainText('Aluminum + Magnesium');
  await expect(lines.nth(1)).toContainText('Bing Pharmacy · Non-prescription');
  // Rx lines show the Rx mark; the others show an icon. Every tile is white.
  await expect(lines.nth(0).locator('.cat-thumb img')).toBeVisible();
  await expect(lines.nth(1).locator('.cat-thumb svg, .cat-thumb .mi')).toBeVisible();
  for (const index of [0, 1]) await expect(lines.nth(index).locator('.cat-thumb')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

async function openPickupEditor(page: Page, isoTime: string) {
  await mockDetailOrder(page);
  await page.clock.install({ time: new Date(isoTime) });
  await page.goto('/app/orders?tab=orders');
  await page.getByRole('button', { name: /Bing Pharmacy/ }).click();
  await page.getByRole('region', { name: 'Pickup date' }).getByRole('button', { name: 'Change pickup date' }).click();
}

test('pickup today needs a time window that fits before closing, so Any time is not allowed for today', async ({ page }) => {
  await openPickupEditor(page, '2026-11-19T02:00:00Z'); // 10:00 Philippine time, pharmacy closes 6 pm
  const days = page.getByRole('group', { name: 'New pickup date' });
  const times = page.getByRole('group', { name: 'New pickup time' });
  await expect(days.getByRole('button', { name: /^Today/ })).toBeEnabled();
  await days.getByRole('button', { name: /^Today/ }).click();
  await expect(times.getByRole('button', { name: 'Any time' })).toBeDisabled();
  await expect(times.getByRole('button', { name: /^Morning/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(times.getByRole('button', { name: /^Evening/ })).toBeDisabled(); // 5-8 starts at the 5 pm cutoff
  await days.getByRole('button', { name: /^Tomorrow/ }).click();
  await expect(times.getByRole('button', { name: 'Any time' })).toBeEnabled();
});

test('pickup today is not offered in the last hour before the pharmacy closes', async ({ page }) => {
  await openPickupEditor(page, '2026-11-19T09:30:00Z'); // 5:30 pm Philippine time, pharmacy closes 6 pm
  const days = page.getByRole('group', { name: 'New pickup date' });
  await expect(days.getByRole('button', { name: /^Today/ })).toBeDisabled();
  await expect(days.getByRole('button', { name: /^Tomorrow/ })).toBeEnabled();
});

test('on a phone, signed-in users have no top brand row but keep the bottom tabs', async ({ page }) => {
  await mock(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/orders?tab=orders');
  await expect(page.getByRole('navigation', { name: 'NearPill customer navigation' })).toBeVisible();
  await expect(page.locator('.shop-brand')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeHidden();
});

test('on a phone, the sign-in page has no bottom tabs or footer links before login', async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.fulfill({ status: 401, json: { error: 'unauthorized' } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/sign-in');
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.locator('.shop-brand')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'NearPill customer navigation' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Operations Portal' })).toBeHidden();
  await expect(page.getByRole('link', { name: 'Privacy and service information' })).toBeHidden();
});
