import { expect, test } from '@playwright/test';

test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

const stores = [
  { store_id: 1, store_name: 'Far Pharmacy', address: '9 Far Road', latitude: '10.4000', longitude: '123.9500', openNow: true, verified: true },
  { store_id: 2, store_name: 'Near Pharmacy', address: '1 Near Street', latitude: '10.3170', longitude: '123.8910', openNow: true, verified: true },
  { store_id: 3, store_name: 'No Coordinates Pharmacy', address: 'Somewhere', latitude: null, longitude: null, openNow: null, verified: true },
];

async function mock(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    if (path.endsWith('/stores')) return route.fulfill({ json: stores });
    return route.fulfill({ json: [] });
  });
}

test('customer shares their location and sees pharmacies nearest first with a map', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 10.3157, longitude: 123.8854, accuracy: 40 });
  await mock(page);
  await page.goto('/app/pharmacies');
  await expect(page.getByRole('heading', { name: 'Your location' })).toBeVisible();
  // Nothing is requested until the customer asks.
  await expect(page.getByText('Near Pharmacy')).toBeVisible();
  await expect(page.getByText(/m away|km away/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByRole('status')).toContainText('nearest to you');
  const names = await page.locator('.shop-listing h3').allTextContents();
  expect(names).toEqual(['Near Pharmacy', 'Far Pharmacy', 'No Coordinates Pharmacy']);
  await expect(page.getByText('Distance unavailable')).toBeVisible();
  await expect(page.getByRole('img', { name: /Map showing your location and the 2 nearest pharmacies/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Nearest pharmacies' })).toContainText('Near Pharmacy');
  await expect(page.getByRole('link', { name: /Directions to Near Pharmacy/ })).toHaveAttribute('href', /destination=10\.317,123\.891/);
  await page.getByRole('button', { name: 'Stop using my location' }).click();
  await expect(page.getByRole('button', { name: 'Use my location' })).toBeVisible();
  await expect(page.getByText(/m away|km away/)).toHaveCount(0);
});

test('a blocked location explains what to do and the list still works', async ({ page }) => {
  await mock(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      watchPosition: (_ok: unknown, fail: (e: { code: number; PERMISSION_DENIED: number }) => void) => { setTimeout(() => fail({ code: 1, PERMISSION_DENIED: 1 }), 10); return 1; },
      clearWatch: () => undefined,
    } });
  });
  await page.goto('/app/pharmacies');
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText('Location permission was denied. Search by pharmacy or area instead.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText('Near Pharmacy')).toBeVisible();
});
