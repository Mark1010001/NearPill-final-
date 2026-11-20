import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('public site: landing, navigation and FAQ', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/NearPill/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find the medicines you need at a pharmacy near you.');
  await expect(page.getByRole('link', { name: 'Open web app' }).first()).toHaveAttribute('href', '/app/');
  await expect(page.getByText('Verified pharmacies')).toBeVisible();
  await expect(page.getByText('Pay in full or a deposit').first()).toBeVisible();
  await expect(page.getByText('Non-Prescriptions').first()).toBeVisible();
  await page.getByText('Is my location stored or shared?').click();
  await expect(page.getByText('NearPill does not store it on its servers.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'For pharmacies' }).click();
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('NearPill for pharmacies');
  await page.goto('/site/features');
  await expect(page).toHaveURL(/\/features$/);
  await page.goto('/nowhere');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  expect(errors).toEqual([]);
});

test('public site: mobile menu works and nothing overflows', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open menu' });
  await menu.click();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Features' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('public site has no accessibility violations', async ({ page }) => {
  for (const path of ['/', '/features', '/partners', '/about', '/contact', '/policies']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations, path).toEqual([]);
  }
});

test('policies page shows the real policy sections as accessible tabs', async ({ page }) => {
  await page.goto('/policies');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Policies');
  const tabs = page.getByRole('tab');
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel')).toContainText(/\S/);
  await tabs.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.st-callout')).toContainText('NearPill does not provide medical advice.');
});

test('the sign-in page links to the public website', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) }));
  await page.goto('/portal');
  await page.getByRole('link', { name: 'Visit the NearPill website' }).click();
  await expect(page).toHaveURL('/');
});

test('the root address opens the public website and the website links to the portal sign-in', async ({ page }) => {
  await page.route('**/api/v1/auth/me', (route) => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Unauthorized' }) }));
  await page.goto('/');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('link', { name: 'Pharmacy and admin sign in' })).toHaveAttribute('href', '/portal');
});

test('robots.txt and sitemap.xml are real files, not the app shell', async ({ request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(robots.headers()['content-type']).toMatch(/^text\/plain/);
  expect(await robots.text()).toContain('Sitemap: https://nearpill.xyz/sitemap.xml');
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  const xml = await sitemap.text();
  expect(xml).toContain('<urlset');
  for (const path of ['/', '/features', '/partners', '/about', '/contact', '/policies']) expect(xml).toContain(`<loc>https://nearpill.xyz${path}</loc>`);
});

test('the shell title is the public homepage title, not the portal title', async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('<title>NearPill - Find medicine at a pharmacy near you in Cebu City</title>');
  expect(html).not.toContain('Operations Portal');
});

test('canonical follows the page and noindex does not leak after leaving "Page not found"', async ({ page }) => {
  await page.goto('/features');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nearpill.xyz/features');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'For pharmacies' }).click();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nearpill.xyz/partners');
  await page.goto('/nowhere');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Find the medicines you need at a pharmacy near you.');
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nearpill.xyz/');
});

test('client-side navigation from "Page not found" back to a real page removes noindex', async ({ page }) => {
  await page.goto('/features');
  await page.evaluate(() => { window.history.pushState({}, '', '/nowhere'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(1);
  await page.evaluate(() => { window.history.pushState({}, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.locator('meta[name="robots"][content="noindex"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://nearpill.xyz/');
});
