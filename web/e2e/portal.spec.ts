import { expect, test } from '@playwright/test';

function json(body: unknown, status = 200) { return { status, contentType: 'application/json', body: JSON.stringify(body) }; }

test('partner sends a medicine that follows the template for admin review', async ({ page }) => {
  const submissions: unknown[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/me')) return route.fulfill(json({ id: 7, role: 'partner', email: 'partner@example.test',
      memberships: [{ drugstoreId: 12, membershipRole: 'staff', isActive: true }] }));
    if (url.pathname.endsWith('/partner/inventory/catalog')) return route.fulfill(json([{ id: 90, brandName: 'Test Item', genericName: 'Testgen', dosageForm: 'Unit', category: 'Non-medicine' }]));
    if (url.pathname.endsWith('/partner/stock-submissions') && request.method() === 'GET') {
      return route.fulfill(json({ pharmacyName: 'Test Pharmacy', submissions: submissions.length ? [{ id: 1, drugstoreId: 12, drugstoreName: 'Test Pharmacy', accountNo: 1, source: 'single', status: 'pending', fileName: null, rowCount: 1, reviewNote: null, createdAt: '2098-01-01T00:00:00Z', reviewedAt: null }] : [] }));
    }
    if (url.pathname.endsWith('/partner/stock-submissions') && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body.row.price === '0') return route.fulfill(json({ error: 'The stock does not follow the template.', rowErrors: [{ line: 1, message: 'price must be above zero with at most 2 decimals, for example 12.50.' }] }, 400));
      submissions.push(body);
      return route.fulfill(json({ id: 1, status: 'pending', rowCount: 1, newMedicines: 0 }, 201));
    }
    if (url.pathname.endsWith('/partner/inventory')) return route.fulfill(json([]));
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/partner/inventory');
  await expect(page.getByRole('button', { name: 'Download CSV template' })).toBeEnabled();
  await page.getByLabel('Fill from catalog (optional)').selectOption('90');
  await expect(page.getByLabel('Brand')).toHaveValue('Test Item');
  await page.getByLabel('Selling unit', { exact: true }).fill('Box of 10');
  await page.getByLabel('Price per unit (₱)', { exact: true }).fill('0');
  await page.getByLabel('Stock quantity', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByRole('alert')).toContainText('Line 1: price must be above zero');
  await page.getByLabel('Price per unit (₱)', { exact: true }).fill('7.50');
  await page.getByRole('button', { name: 'Send for review' }).click();
  await expect(page.getByText(/Sent for admin review \(1 row\)/)).toBeVisible();
  expect(submissions).toEqual([{ drugstoreId: 12, row: { pharmacy: 'Test Pharmacy', catalog_id: '90', brand: 'Test Item', generic_name: 'Testgen', strength: '', form: 'Unit', category: 'Non-medicine', selling_unit: 'Box of 10', price: '7.50', stock_quantity: '8' } }]);
  await expect(page.getByRole('cell', { name: 'pending' })).toBeVisible();
});

test('admin order actions follow pickup stage and display server payment separately', async ({ page }) => {
  const order = { id: 17, reference: 'NP-TEST-17', storeName: 'Test Pharmacy', status: 'awaiting_payment',
    paymentId: 51, paymentStatus: 'pending', paymentProvider: 'xendit-test', totalCentavos: 100, items: [] };
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(json({ id: 1, role: 'admin', email: 'admin@example.test' }));
    if (path.endsWith('/admin/orders')) return route.fulfill(json([order]));
    if (path.endsWith('/admin/payments/51/reconcile')) {
      order.paymentStatus = 'confirmed';
      order.status = 'confirmed';
      return route.fulfill(json({ reconciled: true }));
    }
    if (path.endsWith('/orders/17/status')) {
      const expected = { confirmed: 'preparing', preparing: 'ready_for_pickup', ready_for_pickup: 'completed' }[order.status];
      expect(request.postDataJSON()).toEqual({ status: expected });
      order.status = expected!;
      return route.fulfill(json({ status: order.status }));
    }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/orders');
  await page.getByRole('combobox', { name: 'Pharmacy', exact: true }).selectOption('Test Pharmacy');
  await expect(page.getByText('Test order', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'pending', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start preparing' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Check with Xendit' }).click();
  await expect(page.getByRole('cell', { name: 'confirmed', exact: true })).toHaveCount(2);
  for (const name of ['Start preparing', 'Mark ready', 'Complete pickup']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await expect(page.getByRole('cell', { name: 'completed', exact: true })).toBeVisible();
});

test('catalog identifies pharmacy records without draft or evidence actions', async ({ page }) => {
  let priceCentavos = '700';
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(json({ id: 1, email: 'admin@example.test', role: 'admin' }));
    if (path.endsWith('/admin/inventory/100/price')) {
      expect(request.postDataJSON()).toEqual({ price: '8.50' });
      priceCentavos = '850';
      return route.fulfill(json({ id: 100, priceCentavos: 850 }));
    }
    if (path.endsWith('/admin/medicines')) return route.fulfill(json([
      { id: 84, brandName: 'Test Product', category: 'Prescription (source list)', otcEligible: false, publicationStatus: 'draft', approvedEvidenceCount: 1,
        linkedPharmacies: [{ id: 24, name: 'Other Pharmacy' }] },
      { id: 85, brandName: 'Test Product', category: 'Non-Prescription (source list)', publicationStatus: 'draft',
        linkedPharmacies: [{ id: 27, name: 'Test Pharmacy', inventoryId: 100, priceCentavos }] },
    ]));
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/catalog');
  const other = page.getByRole('row').filter({ hasText: 'Catalog #84' });
  const item = page.getByRole('row').filter({ hasText: 'Catalog #85' });
  await expect(other.getByText('Other Pharmacy', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /create draft|add evidence|publish/i })).toHaveCount(0);
  await expect(page.getByLabel(/evidence source|evidence url/i)).toHaveCount(0);
  await expect(item.getByText('Test Pharmacy', { exact: true })).toBeVisible();
  await item.getByText('Pharmacy prices', { exact: true }).click();
  await expect(item.getByLabel('Price for Test Pharmacy (₱)')).toHaveValue('7.00');
  await item.getByLabel('Price for Test Pharmacy (₱)').fill('8.50');
  await item.getByRole('button', { name: 'Save price' }).click();
  await expect(item.getByText('Price saved.')).toBeVisible();
});

test('partner session never loads administrator order or inventory collections', async ({ page }) => {
  const requested: string[] = [];
  let confirmed = false;
  let inventoryWrites = 0;
  const saleProduct = ['OTC Item', null, 'Tablet', 'Non-Prescription'];
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url()); requested.push(url.pathname);
    if (url.pathname.endsWith('/auth/me')) return route.fulfill(json({ id: 7, email: 'partner@example.test', role: 'partner', memberships: [{ drugstoreId: 12, drugstoreName: 'Test Pharmacy', membershipRole: 'staff', isActive: true }] }));
    if (url.pathname.endsWith('/partner/dashboard')) return route.fulfill(json({ drugstoreId: 12, membershipRole: 'staff', totalSales: 0, totalOrders: 1, completedOrders: 0, pendingOrders: 1, expiredOrders: 0, cancelledOrders: 0,
      branch: { name: 'Test Pharmacy', address: 'Test branch address', latitude: 10.3, longitude: 123.8, operatingHours: null, isPublic: false } }));
    if (url.pathname.endsWith('/partner/subscription')) return route.fulfill(json({ drugstoreId: 12, subscription: null, entitlements: [] }));
    if (url.pathname.endsWith('/partner/orders')) return route.fulfill(json([{ id: 1, reference: 'Order #1', drugstoreId: 12, totalCentavos: 5000, status: 'reserved', items: [{ name: 'OTC Item', quantity: 1 }] }]));
    if (url.pathname.endsWith('/partner/inventory')) return route.fulfill(json([{ inventoryId: 3, drugstoreId: 12, medicineId: 8, medicineName: 'OTC Item', category: 'Non-Prescription', priceCentavos: 5000, stockOnHand: 4, reservedQuantity: 1, sellableQuantity: 3, saleProduct, orderingState: confirmed ? 'orderable' : 'pharmacy_confirmation' }]));
    if (url.pathname.endsWith('/inventory/update')) {
      expect(route.request().postDataJSON()).toMatchObject({ drugstoreId: 12, medicineId: 8, ...(!confirmed && { saleProduct }) });
      inventoryWrites++;
      confirmed = true;
      return route.fulfill(json({ stockOnHand: 4 }));
    }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/portal');
  await expect(page.getByText('Pharmacy overview')).toBeVisible();
  await expect(page.getByText('Test branch address')).toBeVisible();
  await expect(page.getByText('Not public', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.getByText('Order #1')).toBeVisible();
  await page.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByText('OTC Item')).toBeVisible();
  await expect(page.getByText('Confirm this product and its category before it can be offered online.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit stock and price for OTC Item' }).click();
  await expect(page.getByLabel('Stock on hand for OTC Item')).toBeEnabled();
  await expect(page.getByLabel('Unit price for OTC Item')).toBeEnabled();
  await expect(page.getByRole('checkbox', { name: /Confirm Non-Prescription/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm product and category for OTC Item' }).click();
  await expect(page.getByText('Orderable', { exact: true })).toBeVisible();
  expect(inventoryWrites).toBe(1);
  expect(requested).not.toContain('/api/v1/admin/orders');
  expect(requested).not.toContain('/api/v1/admin/inventory');
});

test('pharmacy prepares and completes a paid test pickup', async ({ page }) => {
  let status = 'awaiting_payment';
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(json({ id: 7, role: 'partner', memberships: [{ drugstoreId: 12, membershipRole: 'staff' }] }));
    if (path.endsWith('/partner/orders')) return route.fulfill(json([{ id: 17, reference: 'NP-TEST-17', status, totalCentavos: 12000, pickupBalanceCentavos: status === 'completed' ? 0 : 2000, items: [] }]));
    if (path.endsWith('/partner/orders/17/pickup')) {
      const expected = status === 'confirmed' ? 'preparing' : status === 'preparing' ? 'ready_for_pickup' : 'completed';
      expect(request.postDataJSON()).toEqual({ drugstoreId: 12, status: expected, ...(expected === 'completed' ? { balancePayment: { method: 'cash', amountCentavos: 2000 } } : {}) });
      status = expected;
      return route.fulfill(json({ id: 17, status }));
    }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/partner/orders');
  await expect(page.getByText('Wait for payment confirmation.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start preparing' })).toHaveCount(0);
  status = 'confirmed';
  await page.reload();
  await page.getByRole('button', { name: 'Start preparing' }).click();
  await page.getByRole('button', { name: 'Mark ready for pickup' }).click();
  const complete = page.getByRole('button', { name: 'Complete pickup' });
  await expect(complete).toBeVisible();
  await expect(page.getByRole('option', { name: 'GCash', exact: true })).toHaveCount(0);
  await expect(page.getByRole('option', { name: 'Other in-person payment' })).toHaveCount(1);
  await page.getByLabel('Balance received (₱20.00)').selectOption('cash');
  await expect(page.getByRole('button', { name: /Hide finished order/ })).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.dismiss());
  await complete.click();
  expect(status).toBe('ready_for_pickup');
  page.once('dialog', (dialog) => dialog.accept());
  await complete.click();
  await expect(page.getByText('Collected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Hide finished order NP-TEST-17' }).click();
  await expect(page.getByText('No visible orders.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore hidden orders' }).click();
  await expect(page.getByRole('button', { name: 'Hide finished order NP-TEST-17' })).toBeVisible();
});

test('pharmacy sees the Xendit balance automatically and completes pickup without recording payment', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let status = 'ready_for_pickup';
  let verified = false;
  await page.clock.install();
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(json({ id: 7, role: 'partner', memberships: [{ drugstoreId: 12, membershipRole: 'staff' }] }));
    if (path.endsWith('/partner/orders')) return route.fulfill(json([{
      id: 17, reference: 'NP-TEST-17', status, totalCentavos: 12000, items: [],
      pickupBalanceCentavos: verified ? 0 : null, pickupBalancePending: !verified, pickupBalancePaidWithGCash: verified,
    }]));
    if (path.endsWith('/partner/orders/17/pickup')) {
      expect(request.postDataJSON()).toEqual({ drugstoreId: 12, status: 'completed' });
      status = 'completed';
      return route.fulfill(json({ id: 17, status }));
    }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/partner/orders');
  await expect(page.getByText('Waiting for Xendit to verify the GCash balance payment.')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.getByRole('button', { name: 'Complete pickup' })).toHaveCount(0);
  verified = true;
  await page.clock.fastForward(16_000);
  await expect(page.getByText('Balance paid with GCash · Verified by Xendit')).toBeVisible();
  await expect(page.getByText('₱0.00 due', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox')).toHaveCount(0);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Complete pickup' }).click();
  await expect(page.getByText('Collected', { exact: true })).toBeVisible();
});

test('customer role cannot enter privileged portal routes', async ({ page }) => {
  let signedIn = true;
  await page.route('**/api/v1/auth/me', (route) => route.fulfill(signedIn
    ? json({ id: 9, email: 'customer@example.test', role: 'customer', memberships: [] })
    : json({ error: 'Unauthorized.' }, 401)));
  await page.route('**/api/v1/auth/logout', (route) => {
    signedIn = false;
    return route.fulfill(json({ message: 'Logged out.' }));
  });
  await page.goto('/dashboard');
  await expect(page.getByText('This account does not have portal access.')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out to switch accounts' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('partner inventory allows edits and handles sign-out errors', async ({ page, context, baseURL }) => {
  let signedIn = false;
  let logoutAttempts = 0;
  let inventoryItem: { inventoryId: number; medicineId: number; medicineName: string; stockOnHand: number; reservedQuantity: number; priceCentavos: number; sellingUnit?: string } | undefined = { inventoryId: 3, medicineId: 8, medicineName: 'OTC Item', stockOnHand: 100, reservedQuantity: 1, priceCentavos: 2500 };
  const user = { id: 7, email: 'partner@example.test', role: 'partner' };
  await context.addCookies([{ name: 'nearpill_csrf', value: 'partner-csrf', url: baseURL! }]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/login')) {
      signedIn = true;
      return route.fulfill(json({ user }));
    }
    if (url.pathname.endsWith('/auth/me')) {
      return route.fulfill(signedIn ? json({ ...user, memberships: [{ drugstoreId: 12, drugstoreName: 'Test Pharmacy', membershipRole: 'staff' }] }) : json({ error: 'Unauthorized' }, 401));
    }
    if (url.pathname.endsWith('/partner/inventory') && request.method() === 'GET') {
      expect(url.searchParams.get('drugstoreId')).toBe('12');
      return route.fulfill(json(inventoryItem ? [inventoryItem] : []));
    }
    if (url.pathname.endsWith('/partner/stock-submissions')) return route.fulfill(json({ pharmacyName: 'Test Pharmacy', submissions: [] }));
    if (url.pathname.endsWith('/partner/inventory/catalog')) return route.fulfill(json([{ id: 8, brandName: 'OTC Item', category: 'Non-Prescription' }]));
    if (url.pathname.endsWith('/inventory/update')) {
      const body = request.postDataJSON();
      expect(body).toEqual({ drugstoreId: 12, medicineId: 8, stockOnHand: expect.any(Number), expectedStockOnHand: 100, price: expect.any(String), expectedPriceCentavos: 2500 });
      expect(request.headers()['x-csrf-token']).toBe('partner-csrf');
      if (body.stockOnHand === 0) return route.fulfill(json({ error: 'Stock on hand cannot be reduced below reserved quantity.' }, 409));
      expect(body.stockOnHand).toBe(10);
      expect(body.price).toBe('27.50');
      Object.assign(inventoryItem!, { stockOnHand: 10, priceCentavos: 2750 });
      return route.fulfill(json({ stockOnHand: 10 }));
    }
    if (url.pathname.endsWith('/auth/logout')) {
      if (++logoutAttempts === 1) return route.fulfill(json({ error: 'Try again later.' }, 503));
      signedIn = false;
      return route.fulfill(json({ message: 'Logged out.' }));
    }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.setViewportSize({ width: 320, height: 680 });
  await page.goto('/partner/inventory');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('example-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('rowheader', { name: 'OTC Item' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  const inventory = page.getByRole('region', { name: 'Pharmacy inventory table' });
  await expect(inventory.getByRole('cell', { name: '100', exact: true })).toBeVisible();
  await expect(inventory.getByRole('cell', { name: /₱25.00.*Selling unit unconfirmed/ })).toBeVisible();
  await expect(inventory.getByRole('columnheader')).toHaveCount(4);
  expect((await page.getByRole('complementary').boundingBox())?.height).toBeLessThan(170);
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  await expect(page.getByRole('navigation', { name: 'Portal navigation' })).toBeHidden();
  await menu.focus();
  await menu.press('Enter');
  await expect(page.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('link', { name: 'Inventory', exact: true }).press('Enter');
  await expect(page.getByRole('navigation', { name: 'Portal navigation' })).toBeHidden();
  await expect(page.locator('#portal-content')).toBeFocused();
  await page.getByRole('button', { name: 'Edit stock and price for OTC Item' }).click();
  const stock = page.getByLabel('Stock on hand for OTC Item');
  const price = page.getByLabel('Unit price for OTC Item');
  await expect(stock).toHaveValue('100');
  await expect(price).toHaveValue('25.00');
  await stock.fill('0');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('alert')).toContainText('below reserved quantity');
  await expect(stock).toHaveValue('0');
  await stock.fill('10');
  await price.fill('27.50');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Inventory saved.')).toBeVisible();
  await expect(inventory.getByRole('cell', { name: '10', exact: true })).toBeVisible();
  await expect(inventory.getByRole('cell', { name: /₱27.50.*Selling unit unconfirmed/ })).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByText('Could not sign out. Try again later.')).toBeVisible();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('public policies show readable sections and recover from a failed load', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  let requests = 0;
  await page.route('**/policies.json', (route) => ++requests === 1 ? route.abort() : route.continue());
  await page.goto('/policies.html');
  await expect(page.getByRole('status')).toContainText('Could not load service information');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy notice' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Last updated');
  await page.getByRole('link', { name: 'Cookies, browser storage and third parties' }).click();
  await expect(page).toHaveURL(/#storage$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('admin reports and subscriptions use readable tables on a tablet', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.route('**/api/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill(json({ id: 1, email: 'admin@example.test', role: 'admin' }));
    if (path.endsWith('/admin/reports/sales')) return route.fulfill(json([{ reportDate: '2026-11-09T16:00:00.000Z', orderCount: 2, revenue: 123.45 }]));
    if (path.endsWith('/admin/subscriptions')) return route.fulfill(json([{
      id: 4, drugstoreId: 7, drugstoreName: 'Sample Pharmacy', tier: 'premium', status: 'active',
      planVersion: 'v1', startDate: '2026-11-10', endDate: null,
    }]));
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });
  await page.goto('/reports');
  await expect(page.getByRole('region', { name: 'Sales report' }).getByText('₱123.45')).toBeVisible();
  await expect(page.getByRole('rowheader', { name: 'Nov 10, 2026' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('link', { name: 'Subscriptions' }).click();
  await expect(page.getByRole('rowheader', { name: /Sample Pharmacy/ })).toBeVisible();
  await expect(page.getByText('No end date')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
});

test('admin pharmacy removal supports cancellation, failure retry, and retained inactive records', async ({ page, context, baseURL }) => {
  const pharmacies = [
    { id: 41, name: 'Removal test pharmacy', address: 'Cebu City', latitude: 10.3, longitude: 123.8, status: 'active', verificationStatus: 'verified' },
    { id: 42, name: 'Other pharmacy', address: 'Cebu City', status: 'active', verificationStatus: 'pending' },
    { id: 43, name: 'Previously removed pharmacy', address: 'Cebu City', status: 'inactive', verificationStatus: 'verified' },
  ];
  let deleteAttempts = 0;
  let finishRemoval!: () => void;
  const pendingRemoval = new Promise<void>((resolve) => { finishRemoval = resolve; });
  await context.addCookies([{ name: 'nearpill_csrf', value: 'removal-test-token', url: baseURL! }]);
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/auth/me')) {
      return route.fulfill(json({ id: 1, email: 'admin@example.test', role: 'admin', memberships: [] }));
    }
    if (pathname === '/api/v1/admin/pharmacies/41' && request.method() === 'DELETE') {
      deleteAttempts++;
      expect(request.headers()['x-csrf-token']).toBe('removal-test-token');
      if (deleteAttempts === 1) return route.fulfill(json({ error: 'Removal unavailable. Please try again.' }, 503));
      await pendingRemoval;
      pharmacies[0].status = 'inactive';
      return route.fulfill(json({ success: true, id: 41, status: 'inactive' }));
    }
    if (pathname === '/api/v1/admin/pharmacies/41' && request.method() === 'PUT') {
      expect(request.postDataJSON()).toEqual({ address: 'Updated staging address', latitude: 10.3, longitude: 123.8, operatingHours: null });
      pharmacies[0].address = 'Updated staging address';
      return route.fulfill(json(pharmacies[0]));
    }
    if (pathname === '/api/v1/admin/pharmacies' && request.method() === 'GET') {
      return route.fulfill(json(pharmacies));
    }
    return route.fulfill(json({ error: 'Not mocked' }, 404));
  });

  await page.goto('/pharmacies');
  const targetRow = page.getByRole('row').filter({ hasText: 'Removal test pharmacy' });
  const remove = page.getByRole('button', { name: 'Remove Removal test pharmacy', exact: true });
  await expect(targetRow).toBeVisible();
  await expect(page.getByText('Previously removed pharmacy', { exact: true })).toHaveCount(0);
  await page.getByLabel('Show inactive pharmacies').check();
  await expect(page.getByText('Previously removed pharmacy', { exact: true })).toBeVisible();
  await page.getByLabel('Show inactive pharmacies').uncheck();
  await targetRow.getByText('Edit storefront', { exact: true }).click();
  await targetRow.getByLabel('Address', { exact: true }).fill('Updated staging address');
  await targetRow.getByRole('button', { name: 'Save storefront' }).click();
  await expect(targetRow.getByText('Storefront saved.')).toBeVisible();
  await expect(targetRow.getByText('Updated staging address', { exact: true })).toBeVisible();
  await remove.click();
  const confirmation = page.getByRole('dialog', { name: 'Remove Removal test pharmacy?' });
  await expect(confirmation).toContainText('Existing orders and records will be kept.');
  await confirmation.getByRole('button', { name: 'Keep pharmacy' }).click();
  expect(deleteAttempts).toBe(0);
  await expect(targetRow).toBeVisible();

  await remove.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove pharmacy' }).click();
  await expect(page.getByRole('alert')).toHaveText('Removal unavailable. Please try again.');
  await expect(targetRow).toBeVisible();
  await expect(remove).toBeEnabled();

  await remove.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove pharmacy' }).click();
  try {
    await expect(remove).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Remove Other pharmacy', exact: true })).toBeDisabled();
  } finally {
    finishRemoval();
  }
  await expect(targetRow).toHaveCount(0);
  await expect(page.getByText('Other pharmacy', { exact: true })).toBeVisible();
  expect(deleteAttempts).toBe(2);
  expect(pharmacies).toHaveLength(3);
  expect(pharmacies[0].status).toBe('inactive');
  await page.reload();
  await expect(page.getByText('Other pharmacy', { exact: true })).toBeVisible();
  await expect(page.getByText('Removal test pharmacy', { exact: true })).toHaveCount(0);
});
