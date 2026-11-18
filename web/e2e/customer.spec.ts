import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext } from '@playwright/test';

test.beforeEach(({ context }) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } }));

const store = { store_id: 12, store_name: 'Test Central Pharmacy', verified: true, openNow: true, address: 'Cebu City' };
const otherStore = { store_id: 21, store_name: 'Test West Pharmacy', verified: true, openNow: false, address: 'Guadalupe, Cebu City' };
const medicine = {
  id: 5, name: 'Test Paracetamol 500 mg', genericName: 'Paracetamol', dosageForm: 'Tablet', category: 'Non-Prescription (source list)',
  drugstoreId: store.store_id, drugstoreName: store.store_name, publicationStatus: 'published', canOrder: true, stockCount: 2, priceCentavos: '550',
};
const draft = {
  ...medicine, id: 9, name: 'Test Prescription Listing', genericName: 'Sample', category: 'Prescription (source list)',
  drugstoreId: otherStore.store_id, drugstoreName: otherStore.store_name, publicationStatus: 'draft', canOrder: false,
};
const firstCustomer = { id: '7', email: 'first@example.test', fullName: 'First Customer', role: 'customer' };
const secondCustomer = { id: '8', email: 'second@example.test', fullName: 'Second Customer', role: 'customer' };
const testCheckoutOrigin = 'https://checkout-staging.xendit.co';

async function mockShop(context: BrowserContext, initiallySignedIn = false, testCheckout = false, sellingUnit?: string) {
  let account = initiallySignedIn ? firstCustomer : null;
  const listedMedicine = { ...medicine, sellingUnit };
  let currentMedicine = listedMedicine;
  const orderRequests: string[] = [];
  const pickupSent: { date: string; window?: string }[] = [];
  let paymentStatus: string | null = null;
  if (testCheckout) {
    await context.route('**/local-gcash-simulation', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<title>Local GCash simulation</title><main><h1>Local GCash simulation</h1><p>No payment is collected. This is a capstone test.</p><form method="post" action="/local-gcash-confirm"><button>Simulate successful payment</button></form></main>',
    }));
    await context.route('**/local-gcash-confirm', (route) => {
      if (route.request().method() !== 'POST' || paymentStatus !== 'pending') return route.fulfill({ status: 409 });
      paymentStatus = 'confirmed';
      return route.fulfill({ contentType: 'text/html', body: '<h1>Simulation complete</h1><p>Return to NearPill Orders and check payment status.</p>' });
    });
  }
  await context.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    if (path === '/auth/me') return account ? route.fulfill({ json: { ...account, ...(testCheckout ? { xenditTestCheckout: true } : {}) } }) : route.fulfill({ status: 401, json: { error: 'Unauthorized.' } });
    if (path === '/auth/login') {
      const { email, password } = request.postDataJSON();
      if (password !== 'example-password') return route.fulfill({ status: 401, json: { error: 'Invalid sign-in details.' } });
      account = email === secondCustomer.email ? secondCustomer : firstCustomer;
      return route.fulfill({ json: { user: account } });
    }
    if (path === '/auth/logout') {
      account = null;
      return route.fulfill({ json: { success: true } });
    }
    if (path === '/medicines') {
      expect(url.searchParams.get('view')).toBe('catalog');
      const search = url.searchParams.get('search')?.toLowerCase() ?? '';
      const storeId = url.searchParams.get('storeId');
      return route.fulfill({ json: [listedMedicine, draft].filter((listing) =>
        listing.name.toLowerCase().includes(search) && (!storeId || storeId === String(listing.drugstoreId))) });
    }
    if (path === '/stores') return route.fulfill({ json: [store, otherStore, { ...otherStore, store_id: 30, store_name: 'Unverified Test Pharmacy', verified: false }] });
    if (path === '/stores/nearby') return route.fulfill({ json: { stores: url.searchParams.get('q') === 'Guadalupe' ? [otherStore] : [] } });
    if (path === '/stores/12/inventory') {
      return route.fulfill({ json: { store, inventory: [currentMedicine] } });
    }
    if (path === '/stores/21/inventory') return route.fulfill({ json: { store: otherStore, inventory: [draft] } });
    // The page now refreshes a pending payment by itself (POST /orders/:id/payment); those polls are not counted.
    if (path.startsWith('/orders') && !(request.method() === 'POST' && path.endsWith('/payment'))) orderRequests.push(request.method());
    if (testCheckout && path === '/orders' && request.method() === 'POST') {
      expect(request.headers()['x-nearpill-account']).toBe(firstCustomer.id);
      expect(request.postDataJSON().items).toEqual([{ id: 5, drugstoreId: 12, quantity: 1, expectedUnitPriceCentavos: 550, ...(sellingUnit ? { expectedSellingUnit: sellingUnit } : {}) }]);
      expect(request.postDataJSON().idempotencyKey).toBeTruthy();
      expect(request.postDataJSON().pickupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      pickupSent.push({ date: request.postDataJSON().pickupDate, window: request.postDataJSON().pickupWindow });
      return route.fulfill({ status: 201, json: { id: 17 } });
    }
    if (testCheckout && path === '/orders/17/payments') {
      expect(request.postDataJSON().provider).toBe('xendit-test');
      paymentStatus = 'pending';
      return route.fulfill({ json: { payment: { paymentStatus, checkoutUrl: testCheckoutOrigin + '/local-gcash-simulation' } } });
    }
    if (testCheckout && path === '/orders/17/payment') {
      return route.fulfill({ json: { payment: paymentStatus ? { paymentStatus } : null } });
    }
    if (path === '/orders' && request.method() === 'GET') {
      if (!account) return route.fulfill({ status: 401, json: { error: 'Unauthorized.' } });
      if (request.headers()['x-nearpill-account'] !== account.id) return route.fulfill({ status: 409, json: { error: 'Your signed-in account changed.' } });
      return route.fulfill({ json: account.id === firstCustomer.id ? [{
        id: 17, reference: testCheckout ? 'NP-TEST-FIRST' : 'NP-FIRST', totalCentavos: 1100, status: 'awaiting_payment',
        storeName: store.store_name, createdAt: '2026-11-09T16:00:00.000Z',
        items: [{ id: medicine.id, name: medicine.name, quantity: 2, drugstoreId: store.store_id, sellingUnit }],
      }] : [] });
    }
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request.' } });
  });
  return { orderRequests, pickupSent, setStock: (quantity: number) => {
    currentMedicine = { ...medicine, sellingUnit, stockCount: quantity, priceCentavos: '700' };
  } };
}

test('GCash Test Mode reserves pickup and displays confirmation only after a payment status refresh', async ({ page, context }) => {
  const fixture = await mockShop(context, true, true, 'Tablet');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/search');
  await page.getByRole('link', { name: medicine.name, exact: true }).click();
  await expect(page.getByText('Per Tablet', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.goto('/app/orders?tab=cart');
  await page.getByRole('link', { name: 'Review checkout' }).click();
  await expect(page.getByRole('heading', { name: `${medicine.name} × 1 (Tablet)` })).toBeVisible();
  const dates = page.getByRole('group', { name: 'Pickup date' });
  await expect(dates.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  await expect(dates.getByRole('button')).toHaveCount(8);
  await dates.getByRole('button', { name: 'Tomorrow' }).click();
  await page.getByRole('group', { name: 'Pickup time' }).getByRole('button', { name: /^Afternoon/ }).click();
  await page.getByRole('button', { name: 'Place test order' }).click();
  await expect(page).toHaveURL(/\/app\/orders\?testOrder=17$/);
  expect(fixture.pickupSent).toHaveLength(1);
  expect(fixture.pickupSent[0].window).toBe('afternoon');
  expect(fixture.pickupSent[0].date).not.toBe(new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Open GCash test checkout' }).click();
  const checkout = page.getByRole('link', { name: /Open GCash test checkout/ });
  await expect(checkout).toHaveAttribute('href', testCheckoutOrigin + '/local-gcash-simulation');
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toHaveCount(0);
  if (process.env.NEARPILL_CAPSTONE_DEMO === '1') await page.pause();
  const [simulation] = await Promise.all([context.waitForEvent('page'), checkout.click()]);
  await simulation.getByRole('button', { name: 'Simulate successful payment' }).click();
  await expect(simulation.getByRole('heading', { name: 'Simulation complete' })).toBeVisible();
  await simulation.close();
  await expect(page.getByRole('heading', { name: 'Payment confirmed' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('link', { name: /Open GCash test checkout/ })).toHaveCount(0);
  expect(fixture.orderRequests.filter((method) => method === 'POST')).toHaveLength(2);
});

test('grouped checkout keeps the other pharmacy and safely retries a lost reservation response', async ({ page }) => {
  const first = { ...medicine, priceCentavos: '12000' };
  const second = { ...draft, name: 'Test Non-medicine', category: 'Non-medicine', publicationStatus: 'published', canOrder: true, priceCentavos: '20000' };
  let secondRequest: unknown;
  let firstRequests = 0;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { ...firstCustomer, xenditTestCheckout: true, xenditTestDeposit: true } });
    if (path.endsWith('/medicines')) return route.fulfill({ json: [first, second] });
    if (path.endsWith('/stores/12/inventory')) return route.fulfill({ json: { store, inventory: [first] } });
    if (path.endsWith('/stores/21/inventory')) return route.fulfill({ json: { store: otherStore, inventory: [
      secondRequest ? { ...second, stockCount: 0, canOrder: false } : second,
    ] } });
    if (path.endsWith('/orders') && request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(body.checkoutMode).toBe('grouped');
      if (body.items[0].drugstoreId === 12) {
        firstRequests++;
        expect(body.items).toEqual([{ id: 5, drugstoreId: 12, quantity: 1, expectedUnitPriceCentavos: 12000 }]);
        return route.fulfill({ status: 201, json: { id: 17 } });
      }
      expect(body.items).toEqual([{ id: 9, drugstoreId: 21, quantity: 1, expectedUnitPriceCentavos: 20000 }]);
      if (!secondRequest) {
        secondRequest = body;
        return route.abort('failed');
      }
      expect(body).toEqual(secondRequest);
      return route.fulfill({ json: { id: 18, idempotentReplay: true } });
    }
    if (path.endsWith('/orders')) return route.fulfill({ json: firstRequests ? [{ id: 17, reference: 'NP-TEST-17', status: 'awaiting_payment', totalCentavos: 12000, storeName: store.store_name, items: [] }] : [] });
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request.' } });
  });
  await page.goto('/app/search');
  await page.getByRole('link', { name: first.name, exact: true }).click();
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: second.name, exact: true }).click();
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.goto('/app/orders?tab=cart');
  await page.getByRole('button', { name: 'Review pickups by pharmacy' }).click();
  await expect(page.getByRole('link', { name: new RegExp(otherStore.store_name) })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(store.store_name) }).click();
  await page.getByRole('button', { name: 'Place test order' }).click();
  await expect(page).toHaveURL(/\/app\/orders\?testOrder=17$/);
  await expect(page.getByRole('link', { name: 'Back to remaining cart items' })).toBeVisible();
  await page.goto('/app/orders?tab=cart');
  await expect(page.getByRole('link', { name: second.name })).toBeVisible();
  await expect(page.getByRole('link', { name: first.name })).toHaveCount(0);
  const openNext = async () => {
    await page.getByRole('button', { name: 'Review pickups by pharmacy' }).click();
    await page.getByRole('link', { name: new RegExp(otherStore.store_name) }).click();
  };
  await openNext();
  await page.getByRole('button', { name: 'Place test order' }).click();
  await expect(page.getByRole('button', { name: 'Retry order reservation' })).toBeVisible();
  await page.getByRole('link', { name: 'Edit cart quantities' }).click();
  await openNext();
  await expect(page.getByText(/Out of stock/)).toBeVisible();
  await page.getByRole('button', { name: 'Retry order reservation' }).click();
  await expect(page).toHaveURL(/\/app\/orders\?testOrder=18$/);
  expect(firstRequests).toBe(1);
});

test('a confirmed deposit leaves only that order’s balance due at pickup', async ({ page }) => {
  let paid = false;
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { ...firstCustomer, xenditTestCheckout: true, xenditTestDeposit: true } });
    if (path.endsWith('/orders/17/payments')) {
      expect(request.postDataJSON().paymentPlan).toBe('deposit');
      paid = true;
      return route.fulfill({ json: { payment: { paymentPlan: 'deposit', paymentStatus: 'pending', amountCentavos: 10000 } } });
    }
    if (path.endsWith('/orders/17/payment')) return route.fulfill({ json: { payment: paid ? { paymentPlan: 'deposit', paymentStatus: 'confirmed', amountCentavos: 10000 } : null } });
    if (path.endsWith('/orders/18/payment')) return route.fulfill({ json: { payment: null } });
    if (path.endsWith('/orders')) return route.fulfill({ json: [
      { id: 17, reference: 'NP-TEST-17', status: paid ? 'confirmed' : 'reserved', totalCentavos: 12000, storeName: 'Dobol B', items: [] },
      { id: 18, reference: 'NP-TEST-18', status: 'awaiting_payment', totalCentavos: 20000, storeName: 'Bing', items: [] },
    ] });
    return route.fulfill({ status: 404, json: { error: 'Unexpected test request.' } });
  });
  await page.goto('/app/orders?testOrder=17');
  for (const width of [320, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const full = page.locator('.shop-payment-option').filter({ has: page.getByRole('heading', { name: 'Pay in full' }) });
    const deposit = page.locator('.shop-payment-option').filter({ has: page.getByRole('heading', { name: 'Pay a deposit' }) });
    await expect(full).toContainText('₱120.00');
    await expect(full).toContainText('₱0.00');
    await expect(deposit).toContainText('₱100.00');
    await expect(deposit).toContainText('₱20.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.getByRole('button', { name: 'Pay ₱100.00 deposit with GCash' }).click();
  await expect(page.getByText('Deposit confirmed. Balance due: ₱20.00.')).toBeVisible({ timeout: 15000 });
});

test('ready order offers a separate GCash checkout for its balance', async ({ page }) => {
  let balanceStarted = false;
  await page.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { ...firstCustomer, xenditTestCheckout: true, xenditTestDeposit: true } });
    if (path.endsWith('/orders/17/payments')) {
      expect(request.postDataJSON()).toMatchObject({ provider: 'xendit-test', paymentPlan: 'balance' });
      balanceStarted = true;
      return route.fulfill({ json: { payment: { paymentPlan: 'balance', paymentStatus: 'pending', amountCentavos: 6000, checkoutUrl: testCheckoutOrigin + '/local-balance-simulation' } } });
    }
    if (path.endsWith('/orders/17/payment')) return route.fulfill({ json: { payment: balanceStarted
      ? { paymentPlan: 'balance', paymentStatus: 'pending', amountCentavos: 6000 }
      : { paymentPlan: 'deposit', paymentStatus: 'confirmed', amountCentavos: 10000 } } });
    if (path.endsWith('/orders')) return route.fulfill({ json: [{ id: 17, reference: 'NP-TEST-17', status: 'ready_for_pickup', totalCentavos: 16000, storeName: 'Dobol B', items: [] }] });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/app/orders?testOrder=17');
  await expect(page.getByText('Deposit confirmed. Balance due: ₱60.00.')).toBeVisible();
  await page.getByRole('button', { name: 'Pay ₱60.00 with GCash' }).click();
  await expect(page.getByRole('link', { name: 'Open GCash balance checkout' })).toHaveAttribute('href', testCheckoutOrigin + '/local-balance-simulation');
});

test('a closed GCash session lets the customer cancel the unpaid reservation', async ({ page }) => {
  let status = 'awaiting_payment';
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { ...firstCustomer, xenditTestCheckout: true } });
    if (path.endsWith('/orders/17/payment')) return route.fulfill({ json: { payment: { paymentPlan: 'full', paymentStatus: 'failed' } } });
    if (path.endsWith('/orders/17/cancel')) {
      expect(request.method()).toBe('PUT');
      expect(request.headers()['x-nearpill-account']).toBe(firstCustomer.id);
      status = 'cancelled';
      return route.fulfill({ json: { status } });
    }
    if (path.endsWith('/orders')) return route.fulfill({ json: [{ id: 17, reference: 'NP-TEST-17', status, totalCentavos: 10000, items: [] }] });
    return route.fulfill({ status: 404 });
  });
  await page.goto('/app/orders?testOrder=17');
  await expect(page.getByText('The test checkout ended without payment.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Get GCash|Resume GCash/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel reservation' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel reservation' }).click();
  await expect(page.getByText('Order Cancelled', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(0);
});

test('phone-width customer can sign in from a medicine, adjust quantities and review current pickup prices', async ({ page, context }) => {
  const fixture = await mockShop(context);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/app/search');
  await expect(page).toHaveTitle('NearPill Web App');
  await page.getByRole('searchbox', { name: /search/i }).fill('Paracetamol');
  await expect(page.getByRole('link', { name: draft.name, exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: medicine.name, exact: true }).click();
  await expect(page.locator('#customer-content')).toBeFocused();
  await page.getByRole('link', { name: 'Sign in to add to cart' }).click();
  await page.getByLabel('Email').fill(firstCustomer.email);
  await expect(page.getByLabel('Email')).toHaveValue(firstCustomer.email);
  await page.locator('input[type="password"]').fill('wrong-password');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Unable to sign in. Check your details or try again later.');
  await expect(page.getByLabel('Email')).toHaveValue(firstCustomer.email);
  await page.locator('input[type="password"]').fill('example-password');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByRole('heading', { name: medicine.name })).toBeVisible();
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 in your cart' })).toBeVisible();
  await page.goto('/app/orders?tab=cart');
  const plus = page.getByRole('button', { name: /Increase quantity of Test Paracetamol/ });
  const minus = page.getByRole('button', { name: /Decrease quantity of Test Paracetamol/ });
  await expect(minus).toBeDisabled();
  await plus.press('Enter');
  await expect(plus).toBeDisabled();
  await expect(plus).toBeFocused();
  await minus.click();
  await plus.click();
  await expect(page.getByRole('region', { name: 'Cart summary' }).getByText('₱11.00')).toBeVisible();
  await expect(page.getByText('Item subtotal')).toBeVisible();
  await expect(page.getByText('Review pickup to check stock, prices, and GCash availability.')).toBeVisible();
  fixture.setStock(1);
  await page.getByRole('link', { name: 'Review checkout' }).click();
  await expect(page.getByText(/GCash unavailable/)).toBeInViewport();
  await expect(page.getByText('Available stock: 1. Reduce the quantity in your cart.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  fixture.setStock(2);
  await page.reload();
  await expect(page.getByText('Unit price updated from ₱5.50.')).toBeVisible();
  await expect(page.getByText('₱14.00', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/GCash unavailable/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  expect(fixture.orderRequests.filter((method) => method !== 'GET')).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('desktop pharmacy discovery excludes unverified stores and cart review blocks mixed and unreviewed listings', async ({ page, context }) => {
  await mockShop(context, true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/app/pharmacies');
  await expect(page.getByRole('heading', { name: store.store_name })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unverified Test Pharmacy' })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Pharmacy or area' }).fill('Unlisted neighborhood');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('No verified pharmacies found.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Pharmacy or area' }).fill('Guadalupe');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('link', { name: `Browse medicines at ${otherStore.store_name}` }).click();
  await expect(page).toHaveURL(/\/app\/pharmacies\/21$/);
  await expect(page.getByText(medicine.name)).toHaveCount(0);
  await page.goto('/app/search');
  await page.getByRole('link', { name: draft.name, exact: true }).click();
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.goto('/app/search');
  await page.getByRole('link', { name: medicine.name, exact: true }).click();
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.goto('/app/orders?tab=cart');
  await expect(page.getByRole('button', { name: 'Review checkout' })).toBeDisabled();
  await expect(page.getByText(/Checkout supports one pharmacy at a time/)).toBeVisible();
  await expect(page.getByText('Prescription required', { exact: true })).toBeVisible();
  await expect(page.getByText('Non-prescription', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /^Select Test Prescription Listing/ }).uncheck();
  await expect(page.getByRole('link', { name: 'Review checkout' })).toBeVisible();
  await expect(page.getByText('1 of 2 selected')).toBeVisible();
  await page.getByRole('checkbox', { name: /^Select Test Prescription Listing/ }).check();
  await expect(page.getByRole('button', { name: 'Review checkout' })).toBeDisabled();
  await page.getByRole('button', { name: /Remove Test Paracetamol/ }).click();
  await expect(page.getByRole('link', { name: 'Review checkout' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(Checking prescription…|Upload prescription to continue)$/ })).toBeDisabled();
  await page.goto('/app/checkout');
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280);
  await page.reload();
});

function validPng(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const size = 16;
  const header = Buffer.alloc(13); header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.concat(Array.from({ length: size }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 200)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

test('a customer submits a prescription sample and the pharmacy records its decision', async ({ page, context }) => {
  await mockShop(context, true);
  const sample = validPng().toString('base64');
  let review: { id: number; status: string } | null = null;
  let version = '1794480000.000001';
  await page.route(/\/api\/v1\/prescription-reviews(?:\?|$)/, (route) => {
    const request = route.request();
    expect(request.headers()['x-nearpill-account']).toBe(firstCustomer.id);
    if (request.method() === 'POST') {
      // The app resizes and re-encodes every photo as JPEG before upload.
      const body = request.postDataJSON();
      expect(body).toMatchObject({ drugstoreId: 21, medicineId: 9, mimeType: 'image/jpeg' });
      expect(body.photo.startsWith('/9j/')).toBe(true);
      review = { id: 4, status: 'pending' };
      return route.abort('failed');
    }
    return route.fulfill({ json: { review } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/search');
  await page.getByRole('link', { name: draft.name, exact: true }).click();
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.goto('/app/orders?tab=cart');
  await page.getByLabel('Prescription photo').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from(sample, 'base64') });
  await page.getByRole('button', { name: 'Upload prescription', exact: true }).click();
  await expect(page.getByText('Waiting for the pharmacy to review your prescription.')).toBeVisible();

  const partner = await context.newPage();
  await partner.route('**/api/v1/**', (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/auth/me')) return route.fulfill({ json: { id: 19, role: 'partner', email: 'staff@example.test',
      memberships: [{ drugstoreId: 21, drugstoreName: otherStore.store_name, membershipRole: 'staff', isActive: true }] } });
    if (path.endsWith('/partner/orders')) return route.fulfill({ json: [] });
    expect(request.headers()['x-nearpill-account']).toBe('19');
    expect(new URL(request.url()).searchParams.get('drugstoreId')).toBe('21');
    if (path.endsWith('/prescription-reviews')) return route.fulfill({ json: review?.status === 'pending'
      ? [{ id: 4, productName: draft.name, medicineId: 9, version, expiresAt: new Date(Date.now() + 60_000).toISOString() }] : [] });
    if (path.endsWith('/4/photo')) {
      expect(new URL(request.url()).searchParams.get('version')).toBe(version);
      return route.fulfill({ json: { mimeType: 'image/png', photo: sample } });
    }
    expect(request.method()).toBe('PUT');
    expect(request.postDataJSON()).toEqual({ decision: 'approved', version });
    review = { id: 4, status: 'approved' };
    return route.fulfill({ json: { review } });
  });
  await partner.goto('/partner/orders');
  await partner.getByRole('button', { name: 'Open photo' }).press('Enter');
  await expect(partner.getByRole('img', { name: `Sample prescription for ${draft.name}` })).toBeVisible();
  version = '1794480000.000002';
  await expect(partner.getByRole('img', { name: `Sample prescription for ${draft.name}` })).toHaveCount(0, { timeout: 15_000 });
  await partner.getByRole('button', { name: 'Open photo' }).click();
  await partner.getByRole('button', { name: 'Approve sample prescription' }).press('Enter');
  await expect(partner.getByText('No pending prescription reviews for this pharmacy.')).toBeVisible();
  await expect(partner.getByRole('img', { name: `Sample prescription for ${draft.name}` })).toHaveCount(0);
  await partner.close();

  await page.getByRole('button', { name: 'Check review status' }).click();
  await expect(page.getByText('Prescription approved. You can place your order. Bring this prescription when you pick it up.')).toBeVisible();
  await page.getByRole('link', { name: 'Review checkout' }).click();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled();
});

test('keyboard users can sign in from a medicine and land back on that medicine', async ({ page, context }) => {
  await mockShop(context);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto('/app/search');
  const search = page.getByRole('searchbox', { name: /search/i });
  await search.fill('Paracetamol');
  await page.getByRole('link', { name: medicine.name, exact: true }).press('Enter');
  await page.getByRole('link', { name: 'Sign in to add to cart' }).press('Enter');
  const email = page.getByLabel('Email');
  const password = page.locator('input[type="password"]');
  const signIn = page.getByRole('button', { name: 'Log In', exact: true });
  await email.fill(firstCustomer.email);
  await password.fill('example-password');
  await signIn.press('Enter');
  await expect(page.getByRole('heading', { name: medicine.name })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
});

test('an account switch in another tab clears the previous customer’s cart and order history', async ({ page, context }) => {
  const fixture = await mockShop(context, true);
  await page.goto('/app/pharmacies/12/medicines/5');
  await page.getByRole('button', { name: /^Add \d+ to cart$/ }).click();
  await page.goto('/app/orders?tab=orders');
  // An unpaid order does not show its reference; the card is identified by its status instead.
  await expect(page.getByText('NP-TEST-FIRST')).toHaveCount(0);
  await expect(page.getByText('Reserved', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('nearpill:checkout:7:12', 'fixture'));

  const otherTab = await context.newPage();
  await otherTab.goto('/app/');
  await otherTab.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await expect(page.getByText('NP-FIRST')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('nearpill:checkout:7:12'))).toBeNull();
  await otherTab.getByRole('link', { name: 'Sign in', exact: true }).click();
  await otherTab.getByLabel('Email').fill(secondCustomer.email);
  await otherTab.locator('input[type="password"]').fill('example-password');
  await otherTab.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(otherTab.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByText('No orders yet')).toBeVisible();
  await expect(page.getByText('NP-FIRST')).toHaveCount(0);
  await page.goto('/app/orders?tab=cart');
  await expect(page.getByText('Your cart is empty')).toBeVisible();
  expect(fixture.orderRequests.every((method) => method === 'GET')).toBe(true);
});
