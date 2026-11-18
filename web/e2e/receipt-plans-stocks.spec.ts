import { expect, test, type Page } from '@playwright/test';

function json(body: unknown, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }

test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

const customer = { id: '7', email: 'sam@example.test', fullName: 'Sam Customer', role: 'customer' };

test('a paid order shows a pickup receipt; an unpaid reservation does not', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(customer));
    if (pathname.endsWith('/orders')) return route.fulfill(json([
      { id: 1, reference: 'NP-1042', status: 'ready_for_pickup', totalCentavos: 18900, storeName: 'Dobol B Pharmacy', placedOn: 'Nov 14, 2026',
        items: [{ id: 5, name: 'Biogesic 500 mg', quantity: 2, priceCentavos: 4500, sellingUnit: 'Tablet', prescriptionRequired: true }, { id: 6, name: 'Vitamin C', quantity: 1, priceCentavos: 9900 }] },
      { id: 2, reference: 'NP-1043', status: 'awaiting_payment', totalCentavos: 5000, storeName: 'Bing Pharmacy', placedOn: 'Nov 14, 2026',
        items: [{ id: 7, name: 'Cetirizine', quantity: 1, priceCentavos: 5000 }] },
    ]));
    return route.fulfill(json([]));
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/orders?tab=orders');
  await page.getByRole('button', { name: /NP-1042/ }).click();
  const receipt = page.getByRole('region', { name: 'Pickup receipt' });
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Show this to the pharmacy staff');
  await expect(receipt.getByLabel('Order reference')).toHaveText('NP-1042');
  await expect(receipt).toContainText('Dobol B Pharmacy');
  await expect(receipt).toContainText('Sam Customer');
  await expect(receipt).toContainText('PICKUP CLAIM CODE');
  await expect(receipt).toContainText('Physical prescription check required');
  await expect(receipt).toContainText('Pay at pickup');
  await expect(receipt.getByRole('row', { name: /Biogesic 500 mg \(Tablet\)/ })).toContainText('₱90.00');
  await expect(receipt.getByRole('row', { name: /Total/ })).toContainText('₱189.00');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button', { name: 'Back to My Orders' }).click();
  await page.getByRole('button', { name: /Bing Pharmacy/ }).click();
  await expect(page.getByRole('region', { name: 'Pickup receipt' })).toHaveCount(0);
});

test('a deposit order receipt shows the balance the pharmacy still has to collect', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.endsWith('/auth/me')) return route.fulfill(json({ ...customer, xenditTestCheckout: true }));
    if (pathname.endsWith('/orders/9/payment')) return route.fulfill(json({ payment: { paymentPlan: 'deposit', paymentStatus: 'confirmed', amountCentavos: 10000 } }));
    if (pathname.endsWith('/orders')) return route.fulfill(json([
      { id: 9, reference: 'NP-TEST-9', status: 'confirmed', totalCentavos: 12000, storeName: 'Dobol B Pharmacy', placedOn: 'Nov 14, 2026',
        items: [{ id: 5, name: 'Biogesic 500 mg', quantity: 4, priceCentavos: 3000 }] },
    ]));
    return route.fulfill(json([]));
  });
  await page.goto('/app/orders?tab=orders');
  await page.getByRole('button', { name: /NP-TEST-9/ }).click();
  const receipt = page.getByRole('region', { name: 'Pickup receipt' });
  await expect(receipt).toContainText('Deposit paid');
  await expect(receipt).toContainText('Balance due at pickup');
  await expect(receipt).toContainText('Paid online');
  await expect(receipt).toContainText('₱100.00');
  await expect(receipt).toContainText('₱20.00');
  await expect(receipt.getByRole('row', { name: /Total/ })).toContainText('₱120.00');
});

const admin = { id: 1, role: 'admin', email: 'admin@example.test', memberships: [] };
const plans = [
  { tier: 'Basic', summary: 'Everything needed to take pickup orders.', features: ['Receive customer orders and update pickup status', 'Manage medicines, prices and stock'], entitlements: [] },
  { tier: 'Plus', summary: 'Basic, plus sales reporting.', features: ['Everything in Basic', 'Sales report for the last 90 days'], entitlements: ['reports:view:premium'] },
  { tier: 'Pro', summary: 'Plus, with your complete sales history.', features: ['Everything in Plus', 'Full sales report history with no date limit'], entitlements: ['reports:view:premium', 'reports:history:full'] },
];

async function mockAdmin(page: Page, posted: unknown[]) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(admin));
    if (pathname.endsWith('/subscription-plans')) return route.fulfill(json(plans));
    if (pathname.endsWith('/admin/subscriptions') && request.method() === 'POST') { posted.push(request.postDataJSON()); return route.fulfill(json({ id: 9 }, 201)); }
    if (pathname.endsWith('/admin/subscriptions')) return route.fulfill(json([{ id: 3, drugstoreId: 12, drugstoreName: 'Alpha Pharmacy', tier: 'Pro', status: 'active', planVersion: 'pro-v1', startDate: '2026-11-01', endDate: null }]));
    if (pathname.endsWith('/admin/pharmacies')) return route.fulfill(json([
      { store_id: 12, name: 'Alpha Pharmacy', status: 'active', verificationStatus: 'verified' },
      { store_id: 13, name: 'Pending Pharmacy', status: 'active', verificationStatus: 'pending' },
      { store_id: 14, name: 'Removed Pharmacy', status: 'inactive', verificationStatus: 'verified' },
    ]));
    if (pathname.endsWith('/admin/medicines')) return route.fulfill(json([
      { id: 1, brandName: 'Biogesic', genericName: 'Paracetamol', dosageForm: 'Tablet', category: 'Non-Prescription (source list)', publicationStatus: 'published', linkedPharmacies: [{ id: 12, name: 'Alpha Pharmacy', inventoryId: 4 }] },
      { id: 2, brandName: 'Amoxicillin', genericName: 'Amoxicillin', dosageForm: 'Capsule', category: 'Prescription (source list)', publicationStatus: 'published', linkedPharmacies: [{ id: 12, name: 'Alpha Pharmacy', inventoryId: 5 }] },
      { id: 3, brandName: 'Binder', genericName: '', dosageForm: 'Not applicable', category: 'Medical Supplies', publicationStatus: 'published', linkedPharmacies: [{ id: 12, name: 'Alpha Pharmacy', inventoryId: 6 }] },
      { id: 4, brandName: 'Unstocked Item', genericName: '', dosageForm: 'Tablet', category: 'General OTC', publicationStatus: 'draft', linkedPharmacies: [] },
      { id: 5, brandName: 'Old Label Item', genericName: '', dosageForm: 'Tablet', category: 'Classification Needs Review', publicationStatus: 'draft', linkedPharmacies: [{ id: 12, name: 'Alpha Pharmacy', inventoryId: 7 }] },
    ]));
    return route.fulfill(json([]));
  });
}

test('admin Subscriptions lists Basic, Plus and Pro with what each includes and can change a plan', async ({ page }) => {
  const posted: unknown[] = [];
  await mockAdmin(page, posted);
  await page.goto('/subscriptions');
  const list = page.getByRole('list', { name: 'Subscription plans' });
  for (const tier of ['Basic', 'Plus', 'Pro']) await expect(list.getByRole('heading', { name: tier })).toBeVisible();
  await expect(list).toContainText('Sales report for the last 90 days');
  await expect(list).toContainText('Full sales report history with no date limit');
  const form = page.getByRole('group', { name: 'Plan change' });
  await expect(form.getByRole('option', { name: 'Removed Pharmacy' })).toHaveCount(0);
  await expect(form.getByRole('option', { name: 'Pending Pharmacy' })).toHaveCount(0);
  await form.getByLabel('Pharmacy').selectOption('12');
  await form.getByLabel('Plan').selectOption('Plus');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByText(/Plan saved/)).toBeVisible();
  expect(posted).toEqual([expect.objectContaining({ drugstoreId: 12, tier: 'Plus', status: 'active', planVersion: 'plus-v1' })]);
});

test('admin Stocks lists only stocked items under the three categories', async ({ page }) => {
  await mockAdmin(page, []);
  await page.goto('/catalog');
  await expect(page.getByRole('heading', { name: 'Stocks', level: 1 })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Portal navigation' }).getByRole('link', { name: 'Stocks' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Portal navigation' }).getByRole('link', { name: 'Pharmacy Catalog' })).toHaveCount(0);
  const chips = page.getByRole('group', { name: 'Stocks by category' });
  await expect(chips.getByRole('button', { name: /^Prescription 1$/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: /^Non-prescription 1$/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: /^Non-medicine 1$/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: /^Category missing 1$/ })).toBeVisible();
  await expect(page.getByText('Unstocked Item')).toHaveCount(0);
  await expect(page.getByText('(source list)')).toHaveCount(0);
  await chips.getByRole('button', { name: /^Prescription 1$/ }).click();
  await expect(page.getByText('Amoxicillin').first()).toBeVisible();
  await expect(page.getByText('Biogesic')).toHaveCount(0);
});

test('admin Stocks has a search bar that narrows the list and the category counts', async ({ page }) => {
  await mockAdmin(page, []);
  await page.goto('/catalog');
  const search = page.getByLabel('Search stocks');
  await expect(search).toBeVisible();
  await search.fill('amoxi');
  await expect(page.getByText('Amoxicillin').first()).toBeVisible();
  await expect(page.getByText('Biogesic')).toHaveCount(0);
  const chips = page.getByRole('group', { name: 'Stocks by category' });
  await expect(chips.getByRole('button', { name: /^Prescription 1$/ })).toBeVisible();
  await expect(chips.getByRole('button', { name: /^Non-prescription 0$/ })).toBeVisible();
  await search.fill('zzzz-no-match');
  await expect(page.getByText('No stocked items match your search.')).toBeVisible();
  await search.fill('');
  await expect(page.getByText('Biogesic').first()).toBeVisible();
});
