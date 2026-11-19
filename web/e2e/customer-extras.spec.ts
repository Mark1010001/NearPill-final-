import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const skipIntro = (context: BrowserContext) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } });
test.beforeEach(({ context }) => skipIntro(context));

const stores = [
  { store_id: 12, store_name: 'Test Central Pharmacy', verified: true, openNow: true, address: 'Cebu City', latitude: '10.3170', longitude: '123.8910' },
  { store_id: 21, store_name: 'Test West Pharmacy', verified: true, openNow: false, address: 'Guadalupe, Cebu City', latitude: '10.3300', longitude: '123.9000' },
];
const customer = { id: 7, email: 'first@example.test', fullName: 'First Customer', role: 'customer', phone: '09171234567' };
const order = (id: number, stage: string) => ({
  id, reference: `NP-${id}`, storeName: 'Test Central Pharmacy', itemSummary: 'Test Paracetamol 500 mg x2', totalCentavos: 1100, total: 11,
  status: stage, stage, placedOn: 'Nov 1, 2026', createdAt: '2026-11-01T00:00:00Z', items: [],
});

async function mock(page: Page, opts: { signedIn?: boolean; orders?: unknown[] } = {}) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return opts.signedIn ? route.fulfill({ json: customer }) : route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    if (path === '/stores') return route.fulfill({ json: stores });
    if (path === '/stores/12/inventory') return route.fulfill({ json: { store: stores[0], inventory: [] } });
    if (path === '/orders') return route.fulfill({ json: opts.orders ?? [] });
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
}

test('home can show only pharmacies that are open now', async ({ page }) => {
  await mock(page);
  await page.goto('/app/');
  await expect(page.getByRole('link', { name: /Test West Pharmacy/ })).toBeVisible();
  await page.getByRole('button', { name: 'Open now' }).click();
  await expect(page.getByRole('button', { name: 'Open now' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('link', { name: /Test Central Pharmacy/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Test West Pharmacy/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open now' }).click();
  await expect(page.getByRole('link', { name: /Test West Pharmacy/ })).toBeVisible();
});

test('guests do not see favourites controls', async ({ page }) => {
  await mock(page);
  await page.goto('/app/');
  await expect(page.getByRole('link', { name: /Test Central Pharmacy/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /favourites/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Favourites' })).toHaveCount(0);
});

test('a signed-in customer saves favourite pharmacies that stay after a reload', async ({ page }) => {
  await mock(page, { signedIn: true });
  await page.goto('/app/');
  await page.getByRole('button', { name: 'Add Test West Pharmacy to favourites' }).click();
  await expect(page.getByRole('button', { name: 'Remove Test West Pharmacy from favourites' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove Test West Pharmacy from favourites' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Test Central Pharmacy to favourites' })).toBeVisible();
  await page.getByRole('button', { name: 'Favourites', exact: true }).click();
  await expect(page.getByRole('link', { name: /Test West Pharmacy/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Test Central Pharmacy/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open now' }).click();
  await expect(page.getByText('None of your favourite pharmacies are open right now.')).toBeVisible();
  await page.getByRole('button', { name: 'Open now' }).click();
  await page.getByRole('button', { name: 'Remove Test West Pharmacy from favourites' }).click();
  await expect(page.getByText('You have no favourite pharmacies yet. Tap the heart on a pharmacy to add one.')).toBeVisible();
});

test('the pharmacy page has a favourites heart', async ({ page }) => {
  await mock(page, { signedIn: true });
  await page.goto('/app/pharmacies/12');
  await page.getByRole('button', { name: 'Add Test Central Pharmacy to favourites' }).click();
  await expect(page.getByRole('button', { name: 'Remove Test Central Pharmacy from favourites' })).toHaveAttribute('aria-pressed', 'true');
});

test('order updates mark changed orders as new and can be marked read', async ({ page, context }) => {
  await context.addInitScript(() => {
    try { if (!localStorage.getItem('nearpill_order_seen_user_7')) localStorage.setItem('nearpill_order_seen_user_7', JSON.stringify({ 31: 'completed', 32: 'placed' })); } catch { /* ignore */ }
  });
  await mock(page, { signedIn: true, orders: [order(32, 'preparing'), order(31, 'completed')] });
  await page.goto('/app/');
  const nav = page.getByRole('navigation', { name: 'NearPill customer navigation' });
  await expect(nav.getByRole('link', { name: 'Profile, 1 new order update' })).toBeVisible();
  await nav.getByRole('link', { name: /^Profile/ }).click();
  await page.getByRole('link', { name: 'Order updates, 1 new' }).click();
  await expect(page.getByRole('heading', { name: 'Order updates', level: 1 })).toBeVisible();
  await expect(page.getByText('Test Central Pharmacy is preparing your order.')).toBeVisible();
  await expect(page.getByText('You collected your order from Test Central Pharmacy.')).toBeVisible();
  await expect(page.getByText('1 new update')).toBeVisible();
  await expect(page.locator('.update-new')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(page.getByText('You are all caught up.')).toBeVisible();
  await expect(page.locator('.update-new')).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
});

test('a first visit on a device records a baseline instead of flooding the customer with updates', async ({ page }) => {
  await mock(page, { signedIn: true, orders: [order(32, 'ready'), order(31, 'completed')] });
  await page.goto('/app/notifications');
  await expect(page.getByText('You are all caught up.')).toBeVisible();
  await expect(page.getByText('Your order at Test Central Pharmacy is ready for pickup.')).toBeVisible();
  await expect(page.locator('.update-new')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nearpill_order_seen_user_7'))).toBe('{"31":"completed","32":"ready"}');
});
