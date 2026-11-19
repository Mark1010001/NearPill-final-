import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const skipIntro = (context: BrowserContext) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } });
test.beforeEach(({ context }) => { void skipIntro(context); return context.route('https://maps.googleapis.com/**', (route) => route.abort()); });

const customer = { id: 7, email: 'first@example.test', fullName: 'First Customer', role: 'customer' };

async function mock(page: Page, opts: { sendOtpStatus?: number; signedIn?: boolean } = {}) {
  let user: typeof customer | null = opts.signedIn ? customer : null;
  const calls: { method: string; path: string; body?: unknown }[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace('/api/v1', '');
    calls.push({ method: request.method(), path, body: request.method() === 'POST' ? request.postDataJSON() : undefined });
    if (path === '/auth/me') return user ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    if (path === '/auth/send-otp') {
      if ((opts.sendOtpStatus ?? 200) !== 200) return route.fulfill({ status: opts.sendOtpStatus, json: { error: 'Invalid request. Please check your details and try again.' } });
      return route.fulfill({ json: { message: 'If this email can receive a code, we sent one.' } });
    }
    if (path === '/auth/verify-otp') return route.fulfill({ status: 400, json: { error: 'Wrong code, 4 tries left.' } });
    if (path === '/auth/login') { user = customer; return route.fulfill({ json: { user: customer } }); }
    if (path === '/auth/logout') { user = null; return route.fulfill({ json: { message: 'ok' } }); }
    if (path === '/auth/logout-all') { user = null; return route.fulfill({ json: { message: 'ok' } }); }
    if (path === '/orders' || path === '/stores' || path === '/medicines') return route.fulfill({ json: [] });
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
  return { calls };
}

async function openSignUp(page: Page) {
  await page.goto('/app/sign-in');
  await page.getByRole('button', { name: 'Create account' }).click();
}

test('a repeat password that does not match is flagged live and blocks Continue', async ({ page }) => {
  const { calls } = await mock(page);
  await openSignUp(page);
  await page.getByLabel('Email address').fill('ana@example.com');
  await page.getByLabel('Create password').fill('Strong1!pass');
  await page.getByLabel('Repeat password').fill('Strong1!pasx');
  await expect(page.getByText('Passwords do not match')).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByLabel('Repeat password').fill('Strong1!pass');
  await expect(page.getByText('Passwords do not match')).toBeHidden();
  expect(calls.filter((call) => call.path.startsWith('/auth/') && call.path !== '/auth/me')).toEqual([]);
});

test('a malformed email or a weak password stops sign-up before any request is sent', async ({ page }) => {
  const { calls } = await mock(page);
  await openSignUp(page);
  for (const bad of ['ana', 'ana@example', 'ana@example..com', 'ana@example.c1', 'ana @example.com']) {
    await page.getByLabel('Email address').fill(bad);
    await page.getByLabel('Create password').fill('Strong1!pass');
    await page.getByLabel('Repeat password').fill('Strong1!pass');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    await expect(page.getByText('Step 1 of 3')).toBeVisible();
  }
  await page.getByLabel('Email address').fill('ana@example.com');
  for (const weak of ['short1', 'onlyletterspassword', '12345678901234', 'Password123', 'ana@example.com']) {
    await page.getByLabel('Create password').fill(weak);
    await page.getByLabel('Repeat password').fill(weak);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByText('Step 1 of 3')).toBeVisible();
    await expect(page.locator('.auth-error').last()).toBeVisible();
  }
  expect(calls.filter((call) => call.path.startsWith('/auth/') && call.path !== '/auth/me')).toEqual([]);
});

test('a rejected email at the code step sends the person back to fix it', async ({ page }) => {
  await mock(page, { sendOtpStatus: 400 });
  await openSignUp(page);
  await page.getByLabel('Email address').fill('ana@throwaway-example.com');
  await page.getByLabel('Create password').fill('Strong1!pass');
  await page.getByLabel('Repeat password').fill('Strong1!pass');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Full name').fill('Ana Cruz');
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await expect(page.getByRole('alert').first()).toHaveText('Enter a valid email address.');
});

test('the code step shows tries left, and "Use a different email" goes back to step 1', async ({ page }) => {
  const { calls } = await mock(page);
  await openSignUp(page);
  await page.getByLabel('Email address').fill('ana@example.com');
  await page.getByLabel('Create password').fill('Strong1!pass');
  await page.getByLabel('Repeat password').fill('Strong1!pass');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel('Full name').fill('Ana Cruz');
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  await page.getByLabel('Verification code').fill('111111');
  await expect(page.getByRole('alert').first()).toHaveText('Wrong code, 4 tries left.');
  expect(calls.some((call) => call.path === '/auth/register')).toBe(false);
  await page.getByRole('button', { name: 'Use a different email' }).click();
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
});

test('Settings can sign out of all devices', async ({ page }) => {
  const { calls } = await mock(page, { signedIn: true });
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Sign out of all devices' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByText('You have been signed out of all devices.')).toBeVisible();
  expect(calls.some((call) => call.path === '/auth/logout-all')).toBe(true);
});

test('Remember me sits next to Forgot Password, is ticked by default and can be toggled', async ({ page }) => {
  await mock(page);
  await page.goto('/app/sign-in');
  const remember = page.getByLabel('Remember me');
  await expect(remember).toBeChecked();
  await expect(page.getByRole('link', { name: 'Forgot Password?' })).toBeVisible();
  await page.getByText('Remember me').click();
  await expect(remember).not.toBeChecked();
});

test('a login without Remember me ends the session after the site was closed for a while', async ({ page }) => {
  const { calls } = await mock(page);
  await page.goto('/app/sign-in');
  await page.getByLabel('Email address').fill('first@example.test');
  await page.getByLabel('Password').fill('Strong1!pass');
  await page.getByText('Remember me').click();
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('nearpill-remember'))).toBe('0');
  // Pretend the browser was closed 10 minutes ago, then open the site again.
  await page.addInitScript(() => { try { localStorage.setItem('nearpill-alive', String(Date.now() - 10 * 60_000)); } catch { /* ignore */ } });
  await page.reload();
  await expect.poll(() => calls.some((call) => call.path === '/auth/logout')).toBe(true);
  await expect(page.getByLabel('Remember me')).toBeVisible();
});
