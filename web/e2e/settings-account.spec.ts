import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const skipIntro = (context: BrowserContext) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } });
test.beforeEach(({ context }) => { void skipIntro(context); return context.route('https://maps.googleapis.com/**', (route) => route.abort()); });

const customer = { id: 7, email: 'first@example.test', fullName: 'First Customer', role: 'customer', phone: '09171234567' };

async function mock(page: Page, opts: { signedIn?: boolean; deleteStatus?: number } = {}) {
  let user: typeof customer | null = opts.signedIn ? customer : null;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    calls.push({ method: request.method(), path, body: request.method() === 'POST' ? request.postDataJSON() : undefined });
    if (path === '/auth/me') return user ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    if (path === '/auth/delete-account') {
      if ((opts.deleteStatus ?? 200) !== 200) return route.fulfill({ status: opts.deleteStatus, json: { error: 'Finish or cancel your active orders before deleting your account.' } });
      user = null; return route.fulfill({ json: { message: 'Your account has been deleted.' } });
    }
    if (path === '/auth/logout') { user = null; return route.fulfill({ json: { success: true } }); }
    if (path === '/orders') return route.fulfill({ json: [] });
    if (path === '/stores' || path === '/medicines') return route.fulfill({ json: [] });
    if (path === '/stores/nearby') return route.fulfill({ json: { mode: 'gps', stores: [], center: { latitude: 10.3157, longitude: 123.8854 }, radiusKm: 5 } });
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
  return { calls };
}

test('profile has a Settings gear that opens the account settings', async ({ page }) => {
  await mock(page, { signedIn: true });
  await page.goto('/app/profile');
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('first@example.test')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy and service information' })).toBeVisible();
});

test('delete account needs a password, asks to confirm, then signs out with a notice', async ({ page }) => {
  const { calls } = await mock(page, { signedIn: true });
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter your password to delete your account.');
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByText('Delete your account?')).toBeVisible();
  await page.getByRole('button', { name: 'Keep account' }).click();
  expect(calls.some((c) => c.path === '/auth/delete-account')).toBe(false);
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('group', { name: 'Confirm account deletion' }).getByRole('button', { name: 'Delete account' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByText('Your account has been deleted.')).toBeVisible();
  expect(calls.find((c) => c.path === '/auth/delete-account')?.body).toEqual({ password: 'correct-password' });
});

test('delete account shows the server reason when an order is still active', async ({ page }) => {
  await mock(page, { signedIn: true, deleteStatus: 409 });
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByLabel('Password').fill('correct-password');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await page.getByRole('group', { name: 'Confirm account deletion' }).getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByRole('alert')).toHaveText('Finish or cancel your active orders before deleting your account.');
  await expect(page).toHaveURL(/\/app\/settings$/);
});

test('settings lists change password and a Sign out button, and profile no longer has Sign out', async ({ page }) => {
  const { calls } = await mock(page, { signedIn: true });
  await page.goto('/app/profile');
  await expect(page.getByRole('main').getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('link', { name: /Change password/ })).toBeVisible();
  await page.getByRole('link', { name: /Change password/ }).click();
  await expect(page).toHaveURL(/\/app\/forgot-password$/);
  await page.goBack();
  await page.getByRole('main').getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => calls.some((c) => c.path === '/auth/logout')).toBe(true);
});
