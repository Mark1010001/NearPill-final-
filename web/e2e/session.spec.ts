import { expect, test } from '@playwright/test';

test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

const customer = { id: '7', role: 'customer', email: 'customer@example.test' };
const admin = { id: '1', role: 'admin', email: 'admin@example.test' };
const store = { store_id: 12, store_name: 'Fixture Pharmacy', verified: true, address: 'Cebu City' };
const listing = { id: 5, name: 'Fixture Medicine', drugstoreId: 12, drugstoreName: store.store_name,
  publicationStatus: 'published', canOrder: true, stockCount: 2, priceCentavos: 500 };

test('a staff tab clears its private orders when another tab signs out', async ({ page, context }) => {
  let signedIn = true;
  await context.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return signedIn ? route.fulfill({ json: admin })
      : route.fulfill({ status: 401, json: { error: 'Signed out' } });
    if (path.endsWith('/auth/logout')) { signedIn = false; return route.fulfill({ json: { success: true } }); }
    if (path.endsWith('/admin/orders') && signedIn) return route.fulfill({ json: [{
      id: 1, reference: 'PRIVATE-FIXTURE-ORDER', items: [], status: 'reserved', totalCentavos: 500,
    }] });
    return route.fulfill({ status: 401, json: { error: 'Signed out' } });
  });
  await page.goto('/orders');
  await expect(page.getByText('PRIVATE-FIXTURE-ORDER')).toBeVisible();
  const shop = await context.newPage();
  await shop.goto('/app/sign-in');
  await shop.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'NearPill Operations Portal' })).toBeVisible();
  await expect(page.getByText('PRIVATE-FIXTURE-ORDER')).toHaveCount(0);
});

test('a session outage leaves the public catalogue and unfinished search usable', async ({ page }) => {
  let offline = true;
  let hold = false;
  let sessionReads = 0;
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      sessionReads++;
      if (hold) await pending;
      return route.fulfill({ status: offline ? 503 : 401, json: { error: 'Session service unavailable' } });
    }
    return route.fulfill({ json: [listing] });
  });
  await page.goto('/app/search');
  await expect(page.getByRole('link', { name: listing.name, exact: true })).toBeVisible();
  const search = page.getByRole('searchbox', { name: /search/i });
  await search.fill('Unfinished search');
  offline = false;
  hold = true;
  const previousReads = sessionReads;
  await page.evaluate(() => {
    const channel = new BroadcastChannel('nearpill-session-change');
    channel.postMessage('sign-in');
    channel.close();
  });
  try {
    await expect.poll(() => sessionReads).toBeGreaterThan(previousReads);
    await expect(search).toHaveValue('Unfinished search');
  }
  finally { release(); }
  await expect(search).toHaveValue('Unfinished search');
  await page.getByRole('link', { name: /^Orders/ }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
});

test('customer session expiry removes loaded orders without a focus change', async ({ page }) => {
  let expired = false;
  await page.clock.install();
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return !expired
      ? route.fulfill({ json: { ...customer, sessionExpiresInMs: 10_000 } })
      : route.fulfill({ status: 401, json: { error: 'Session expired' } });
    return route.fulfill({ json: [{ id: 1, reference: 'EXPIRING-ORDER', storeName: 'Expiring Pharmacy', status: 'reserved', totalCentavos: 500, items: [] }] });
  });
  await page.goto('/app/orders?tab=orders');
  await expect(page.getByText('Expiring Pharmacy').first()).toBeVisible();
  expired = true;
  await page.clock.fastForward(11_000);
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByText('Expiring Pharmacy')).toHaveCount(0);
});

test('same-account revalidation preserves the cart and pickup refresh keeps focus and prevents duplicates', async ({ page }) => {
  let holdSession = false;
  let releaseSession!: () => void;
  const sessionPending = new Promise<void>((resolve) => { releaseSession = resolve; });
  let inventoryReads = 0;
  let failStock = false;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) {
      if (holdSession) await sessionPending;
      return route.fulfill({ json: customer });
    }
    if (path.endsWith('/inventory')) {
      inventoryReads++;
      return failStock ? route.fulfill({ status: 503, json: { error: 'Stock unavailable' } })
        : route.fulfill({ json: { store, inventory: [listing] } });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected request' } });
  });
  await page.goto('/app/pharmacies/12/medicines/5');
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.goto('/app/orders?tab=cart');
  holdSession = true;
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  try {
    await expect(page.getByText('Checking your session…')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Review checkout' })).toHaveCount(0);
  } finally { releaseSession(); }
  await page.getByRole('link', { name: 'Review checkout' }).click();
  await expect(page.getByText('Stock and prices checked.', { exact: false })).toBeVisible();
  const before = inventoryReads;
  failStock = true;
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('Stock unavailable');
  expect(inventoryReads).toBeGreaterThan(before);
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
});
