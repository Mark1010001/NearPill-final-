import { expect, test, type Page } from '@playwright/test';

function json(body: unknown, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }
const admin = { id: 1, role: 'admin', email: 'admin@example.test', memberships: [] };

async function mockAdmin(page: Page, state: { members: unknown[]; posted: unknown[]; removed: string[]; mailed: string[] }) {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(admin));
    if (pathname.endsWith('/admin/pharmacies') && method === 'GET') return route.fulfill(json([{ store_id: 12, name: 'Alpha Pharmacy', status: 'active', accountNo: 1, subscriptionTier: 'Plus', partnershipStartedAt: '2098-07-01T00:00:00Z', partnershipExpiresAt: '2099-01-01' }, { store_id: 14, name: 'Beta Pharmacy', status: 'active', accountNo: 2, subscriptionTier: 'Basic', partnershipStartedAt: '2019-10-01T00:00:00Z', partnershipExpiresAt: '2020-01-01' }, { store_id: 15, name: 'Gamma Pharmacy', status: 'active', accountNo: 3, subscriptionTier: null, partnershipStartedAt: '2026-01-01T00:00:00Z', partnershipExpiresAt: null }, { store_id: 13, name: 'Closed Pharmacy', status: 'inactive' }]));
    if (pathname.endsWith('/admin/pharmacies') && method === 'POST') { state.posted.push(request.postDataJSON()); return route.fulfill(json({ id: 12, store_id: 12 }, 201)); }
    if (pathname.endsWith('/login-email') && method === 'POST') { state.mailed.push(pathname); return route.fulfill(json({ userId: 90, drugstoreId: 12, email: 'new@example.test', sent: true })); }
    if (pathname.endsWith('/admin/pharmacies/12/memberships') && method === 'GET') return route.fulfill(json(state.members));
    if (pathname.endsWith('/admin/pharmacies/12/partner-accounts') && method === 'POST') {
      const body = request.postDataJSON();
      state.posted.push(body);
      state.members = [...state.members, { userId: 90, name: 'New Person', email: body.email, drugstoreId: 12, membershipRole: 'owner', isActive: true }];
      return route.fulfill(json({ userId: 90, drugstoreId: 12, email: body.email, membershipRole: 'owner', role: 'partner' }, 201));
    }
    if (pathname.endsWith('/admin/pharmacies/12/memberships') && method === 'POST') {
      const body = request.postDataJSON();
      state.posted.push(body);
      state.members = [...state.members, { userId: body.userId, name: 'New Person', email: 'new@example.test', drugstoreId: 12, membershipRole: body.membershipRole, isActive: true }];
      return route.fulfill(json({ userId: body.userId, drugstoreId: 12, membershipRole: body.membershipRole, isActive: true }, 201));
    }
    if (pathname.includes('/admin/pharmacies/12/memberships/') && method === 'DELETE') {
      state.removed.push(pathname.split('/').pop() || '');
      state.members = (state.members as { userId: number }[]).map((item) => ({ ...item, isActive: false }));
      return route.fulfill(json({ userId: 7, drugstoreId: 12, isActive: false }));
    }
    if (pathname.endsWith('/admin/reports/sales')) return route.fulfill(json([]));
    if (pathname.endsWith('/admin/reports/medicines')) return route.fulfill(json([{ medicineId: 8, brandName: 'Biogesic', genericName: 'Paracetamol', quantitySold: 14, orderCount: 5 }]));
    if (pathname.endsWith('/admin/reports/drugstores')) return route.fulfill(json([{ drugstoreId: 12, drugstoreName: 'Alpha Pharmacy', orderCount: 6, revenue: 1250.5, cancelledCount: 1, expiredCount: 0 }]));
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
}

test('admin menu lists the new screens', async ({ page }) => {
  await mockAdmin(page, { members: [], posted: [], removed: [], mailed: [] });
  await page.goto('/dashboard');
  const nav = page.getByRole('navigation', { name: 'Portal navigation' });
  await expect(nav.getByRole('link', { name: 'Partner pharmacy accounts' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Stock submissions' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
});

test('admin adds and removes pharmacy staff access', async ({ page }) => {
  const state = { members: [{ userId: 7, name: 'Pat Staff', email: 'pat@example.test', drugstoreId: 12, membershipRole: 'staff', isActive: true }], posted: [] as unknown[], removed: [] as string[], mailed: [] as string[] };
  await mockAdmin(page, state);
  await page.goto('/staff');
  await expect(page.getByRole('heading', { name: 'Partner pharmacy accounts', level: 1 })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Closed Pharmacy' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Add partner pharmacy' })).toBeVisible();
  await expect(page.getByLabel('Role')).toHaveCount(0);
  await page.getByRole('combobox').selectOption('12');
  await expect(page.getByText('Pat Staff')).toBeVisible();
  await expect(page.getByText('Account ID 1')).toBeVisible();
  await page.getByLabel('Pharmacy name').fill('Beta Pharmacy');
  await page.getByLabel('Address').fill('2 Main St');
  await page.getByLabel('Latitude').fill('14.5');
  await page.getByLabel('Longitude').fill('121');
  await page.getByLabel('Email').fill('new@example.test');
  await expect(page.getByLabel('Password')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add pharmacy' }).click();
  await expect(page.getByText(/Beta Pharmacy was added. A login email .* was sent to new@example.test/)).toBeVisible();
  expect(state.posted).toEqual([
    { name: 'Beta Pharmacy', address: '2 Main St', latitude: 14.5, longitude: 121, status: 'active' },
    { email: 'new@example.test' },
  ]);
  await expect(page.getByText('New Person')).toBeVisible();
  await page.getByRole('button', { name: 'Email login details again to new@example.test' }).click();
  await expect(page.getByText(/Login details emailed/)).toBeVisible();
  await page.getByRole('row', { name: /Pat Staff/ }).getByRole('button', { name: 'Email login details' }).click();
  expect(state.mailed).toEqual([
    '/api/v1/admin/pharmacies/12/memberships/90/login-email',
    '/api/v1/admin/pharmacies/12/memberships/90/login-email',
    '/api/v1/admin/pharmacies/12/memberships/7/login-email',
  ]);
  await page.getByRole('row', { name: /Pat Staff/ }).getByRole('button', { name: 'Remove access' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove access' }).click();
  await expect(page.getByText('Access removed.')).toBeVisible();
  expect(state.removed).toEqual(['7']);
});

test('admin reports include medicines sold and pharmacy performance', async ({ page }) => {
  await mockAdmin(page, { members: [], posted: [], removed: [], mailed: [] });
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Medicines sold' })).toBeVisible();
  await expect(page.getByText('Biogesic')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Pharmacy performance' })).toBeVisible();
  await expect(page.getByText('Alpha Pharmacy')).toBeVisible();
  await expect(page.getByText('₱1,250.50')).toBeVisible();
});

test('partner pharmacy accounts show the account number and partnership expiry', async ({ page }) => {
  await mockAdmin(page, { members: [], posted: [], removed: [], mailed: [] });
  await page.goto('/staff');
  const table = page.getByRole('region', { name: 'Partnership expiry' });
  await expect(table.getByRole('columnheader', { name: 'Account No.' })).toBeVisible();
  const alpha = table.getByRole('row', { name: /Alpha Pharmacy/ });
  await expect(alpha).toContainText('1');
  await expect(alpha).toContainText('Plus');
  await expect(alpha).toContainText('Jan 1, 2099');
  await expect(alpha).toContainText('Active');
  await expect(table.getByRole('row', { name: /Beta Pharmacy/ })).toContainText('Expired');
  const gamma = table.getByRole('row', { name: /Gamma Pharmacy/ });
  await expect(gamma).toContainText('No plan');
  await expect(table.getByRole('row', { name: /Closed Pharmacy/ })).toHaveCount(0);
});

test('admin cannot publish a pharmacy until its go-live checklist passes', async ({ page }) => {
  const state = { stocked: false, live: false, puts: [] as unknown[] };
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(admin));
    if (pathname.endsWith('/admin/pharmacies') && method === 'GET') return route.fulfill(json([{ store_id: 21, name: 'New Pharmacy', address: '1 Main St', status: 'active', verificationStatus: 'verified', publicProfilePublishedAt: state.live ? '2098-01-01T00:00:00Z' : null }]));
    if (pathname.endsWith('/admin/pharmacies/21/go-live') && method === 'GET') {
      const checks = [
        { id: 'details', label: 'Pharmacy details are complete', ok: true, hint: 'x' },
        { id: 'stock', label: 'At least one approved item has stock, a price and a selling unit', ok: state.stocked, hint: 'Approve the pharmacy stock file (Stock submissions).' },
      ];
      return route.fulfill(json({ drugstoreId: 21, name: 'New Pharmacy', live: state.live, canGoLive: state.stocked, checks }));
    }
    if (pathname.endsWith('/admin/pharmacies/21/go-live') && method === 'PUT') {
      const body = request.postDataJSON(); state.puts.push(body); state.live = body.live;
      return route.fulfill(json({ drugstoreId: 21, live: body.live }));
    }
    return route.fulfill(json([]));
  });
  await page.goto('/pharmacies');
  await page.getByText('Go-live checklist', { exact: true }).click();
  await expect(page.getByText('Approve the pharmacy stock file')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go live' })).toBeDisabled();
  state.stocked = true;
  await page.reload();
  await page.getByText('Go-live checklist', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Go live' })).toBeEnabled();
  await page.getByRole('button', { name: 'Go live' }).click();
  await expect(page.getByText('Pharmacy is live in the app.')).toBeVisible();
  expect(state.puts).toEqual([{ live: true }]);
  await expect(page.getByRole('button', { name: 'Take down' })).toBeVisible();
});

test('admin sees uploaded stock as a read-only record with nothing to approve', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    if (pathname.endsWith('/auth/me')) return route.fulfill(json(admin));
    if (pathname.endsWith('/admin/stock-submissions') && request.method() === 'GET') {
      return route.fulfill(json([{ id: 31, drugstoreId: 21, drugstoreName: 'New Pharmacy', accountNo: 4, source: 'csv', status: 'approved', fileName: 'stock.csv', rowCount: 2, reviewNote: 'Passed the template check and was applied automatically.', createdAt: '2098-01-01T00:00:00Z', reviewedAt: '2098-01-01T00:00:00Z',
        rows: [{ line: 2, catalogId: 5, medicineId: 5, name: 'Neozep', genericName: null, form: 'Tablet', category: 'Non-prescription', sellingUnit: 'Tablet', price: '2.50', stock: 9, match: 'existing' },
          { line: 3, catalogId: null, name: 'Brand New 10 mg', genericName: null, form: 'Syrup', category: 'Non-prescription', sellingUnit: 'Bottle', price: '20.00', stock: 4, match: 'new' }] }]));
    }
    return route.fulfill(json([]));
  });
  await page.goto('/stock-submissions');
  await expect(page.getByRole('heading', { name: 'Stock submissions', level: 1 })).toBeVisible();
  await expect(page.getByText('Account No. 4')).toBeVisible();
  await expect(page.getByText('Added new medicine')).toBeVisible();
  await expect(page.getByText('Updated catalog item')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reject' })).toHaveCount(0);
});
