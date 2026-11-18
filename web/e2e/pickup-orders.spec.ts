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
  for (const expected of ['NP-2', 'Bing Pharmacy', 'Sam Customer', 'Cetirizine', 'PHP 50.00', 'Physical prescription check required', 'Capstone test payment, no real money was charged.']) expect(text).toContain(expected);
  const unpaid = await (async () => { await page.getByRole('button', { name: 'Back to My Orders' }).click(); await page.getByRole('button', { name: /Dobol B Pharmacy/ }).click(); return page.getByRole('button', { name: 'Download receipt (PDF)' }).count(); })();
  expect(unpaid).toBe(0);
});
