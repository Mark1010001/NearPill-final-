import { expect, test } from '@playwright/test';

const partnerEmail = process.env.NEARPILL_E2E_PARTNER_EMAIL;
const partnerPassword = process.env.NEARPILL_E2E_PARTNER_PASSWORD;
const otherDrugstoreId = process.env.NEARPILL_E2E_OTHER_DRUGSTORE_ID;

const configured = Boolean(partnerEmail && partnerPassword && otherDrugstoreId);

test.describe('live partner tenant isolation', () => {
  test.skip(!configured, 'Requires seeded staging partner credentials and another pharmacy ID.');

  test('partner cannot cross pharmacy scope or call administrator collections', async ({ page }) => {
    await page.goto('/portal');
    await page.getByLabel('Email').fill(partnerEmail!);
    await page.getByLabel('Password').fill(partnerPassword!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Pharmacy overview')).toBeVisible();

    const crossTenant = await page.request.get(`/api/v1/partner/orders?drugstoreId=${encodeURIComponent(otherDrugstoreId!)}`);
    expect(crossTenant.status()).toBe(403);

    const adminOrders = await page.request.get('/api/v1/admin/orders');
    expect(adminOrders.status()).toBe(403);
  });
});
