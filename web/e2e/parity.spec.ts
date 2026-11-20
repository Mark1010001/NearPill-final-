import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// The customer website must do what the Android app does, with the same wording.
const skipIntro = (context: BrowserContext) => context.addInitScript(() => { try { localStorage.setItem('np-onboarding-done', '1'); } catch { /* ignore */ } });
// Tests run without Google: if a real browser key is in .env, block Google's script so the page uses its built-in map.
test.beforeEach(({ context }) => context.route('https://maps.googleapis.com/**', (route) => route.abort()));

const stores = [
  { store_id: 12, store_name: 'Test Central Pharmacy', verified: true, openNow: true, address: 'Cebu City', latitude: '10.3170', longitude: '123.8910', operating_hours: '8am - 9pm' },
  { store_id: 21, store_name: 'Test West Pharmacy', verified: true, openNow: false, address: 'Guadalupe, Cebu City', latitude: '10.3300', longitude: '123.9000' },
];
const paracetamol = {
  id: 5, name: 'Test Paracetamol 500 mg', genericName: 'Paracetamol', dosageForm: 'Tablet', category: 'Non-Prescription (source list)',
  drugstoreId: 12, drugstoreName: 'Test Central Pharmacy', publicationStatus: 'published', canOrder: true, stockCount: 4, priceCentavos: 550,
  distanceKm: 0.354, activeIngredients: ['paracetamol'], adultUseReviewed: true, otcEligible: true,
};
const rx = { ...paracetamol, id: 9, name: 'Test Prescription Drug', category: 'Prescription (source list)', canOrder: false, activeIngredients: [], distanceKm: undefined };
const customer = { id: 7, email: 'first@example.test', fullName: 'First Customer', role: 'customer', phone: '09171234567' };
const pastOrder = {
  id: 31, reference: 'NP-31', storeName: 'Test Central Pharmacy', itemSummary: 'Test Paracetamol 500 mg x2', itemCount: 2, totalCentavos: 1100, total: 11,
  status: 'completed', stage: 'completed', placedOn: 'Nov 1, 2026', createdAt: '2026-11-01T00:00:00Z',
  items: [{ id: 5, name: 'Test Paracetamol 500 mg', quantity: 2, drugstoreId: 12, drugstoreName: 'Test Central Pharmacy', priceCentavos: 550 }],
};
const activeOrder = { ...pastOrder, id: 32, reference: 'NP-32', status: 'reserved', stage: 'reserved' };

async function mock(page: Page, opts: { signedIn?: boolean; chatFails?: boolean } = {}) {
  let user: typeof customer | null = opts.signedIn ? customer : null;
  const calls: string[] = [];
  const chats: { messages: { role: string; content: string }[]; cart?: unknown[] }[] = [];
  let chatFails = opts.chatFails ?? false;
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png',
    body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api/v1', '');
    calls.push(`${request.method()} ${path}${url.search}`);
    if (path === '/auth/me' && request.method() === 'PUT') { Object.assign(user ?? {}, request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
    if (path === '/auth/me') return user ? route.fulfill({ json: user }) : route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    if (path === '/auth/send-otp') return route.fulfill({ json: { sent: true } });
    if (path === '/auth/verify-otp') return request.postDataJSON().code === '123456' ? route.fulfill({ json: { verified: true } }) : route.fulfill({ status: 400, json: { error: 'Invalid code' } });
    if (path === '/auth/register') return route.fulfill({ status: 201, json: { ok: true } });
    if (path === '/auth/login') { user = { ...customer, email: request.postDataJSON().email }; return route.fulfill({ json: { user } }); }
    if (path === '/auth/logout') { user = null; return route.fulfill({ json: { success: true } }); }
    if (path === '/auth/forgot-password') return route.fulfill({ json: { ok: true } });
    if (path === '/medicines') return route.fulfill({ json: [paracetamol, rx] });
    if (path === '/medicines/5') return route.fulfill({ json: { ...paracetamol, description: 'Pain and fever relief.' } });
    if (path === '/stores') return route.fulfill({ json: stores });
    if (path === '/stores/nearby') return route.fulfill({ json: { mode: 'gps', stores: url.searchParams.get('q') === 'West' ? [stores[1]] : [stores[0]], center: { latitude: 10.3157, longitude: 123.8854 }, radiusKm: 5 } });
    if (path === '/stores/12/inventory') return route.fulfill({ json: { store: stores[0], inventory: [paracetamol, rx] } });
    if (path === '/stores/12/route') return route.fulfill({ json: { distanceMeters: 2450, durationSeconds: 400, coordinates: [[123.8854, 10.3157], [123.891, 10.317]] } });
    if (path === '/orders') return route.fulfill({ json: [activeOrder, pastOrder] });
    if (path === '/assistant/chat') {
      chats.push(request.postDataJSON());
      return chatFails ? route.fulfill({ status: 503, json: { error: 'The assistant is not available right now.' } })
        : route.fulfill({ json: { reply: 'Your order NP-32 is reserved at Test Central Pharmacy.' } });
    }
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
  return { calls, chats, recover: () => { chatFails = false; } };
}

test('first visit shows the four intro pages like the app, then sign-in', async ({ page, context }) => {
  void context;
  await mock(page);
  await page.goto('/app/');
  await expect(page).toHaveURL(/\/app\/welcome$/);
  await expect(page.getByRole('heading', { name: 'Find Medicines Nearby' })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('heading', { name: 'Browse Pharmacies' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByRole('heading', { name: 'Verified Pharmacies' })).toBeVisible();
  await page.getByRole('button', { name: 'Get Started' }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await page.goto('/app/');
  await expect(page.getByRole('heading', { name: 'NearPill', exact: true })).toBeVisible();
});

test('create account uses the app’s three steps with an email code', async ({ page, context }) => {
  await skipIntro(context);
  const { calls } = await mock(page);
  await page.goto('/app/sign-in');
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByLabel('Email address').fill('new@example.test');
  await page.getByLabel('Create password').fill('Strong1!pass');
  await page.getByLabel('Repeat password').fill('Strong1!pass');
  await expect(page.getByText('Strong', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByLabel('Full name').fill('New Person');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Agree to the Terms and Conditions and Privacy Policy to continue.')).toBeVisible();
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  // The sixth digit sends the code by itself.
  await page.getByLabel('Verification code').fill('000000');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await page.getByLabel('Verification code').fill('123456');
  await expect(page).toHaveURL(/\/app\/$/);
  expect(calls.some((call) => call.startsWith('POST /auth/register'))).toBe(true);
});

test('forgot password sends a reset link', async ({ page, context }) => {
  await skipIntro(context);
  const { calls } = await mock(page);
  await page.goto('/app/sign-in');
  await page.getByRole('link', { name: 'Forgot Password?' }).click();
  await page.getByLabel('Email address').fill('first@example.test');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect.poll(() => calls.some((call) => call.startsWith('POST /auth/forgot-password'))).toBe(true);
});

test('home, search and pharmacy pages follow the app', async ({ page, context }) => {
  await skipIntro(context);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 10.3157, longitude: 123.8854 });
  await mock(page, { signedIn: true });
  await page.goto('/app/');
  await expect(page.getByText('Cebu City, Philippines')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Nearby Drugstores' })).toBeVisible();
  await expect(page.getByText('OPEN', { exact: true })).toBeVisible();
  await expect(page.getByText('CLOSED', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^Prescriptions/ }).click();
  await expect(page.getByRole('heading', { name: 'Search products' })).toBeVisible();
  await expect(page.getByText('Test Prescription Drug')).toBeVisible();
  await expect(page.getByText('Test Paracetamol 500 mg')).toHaveCount(0);
  await page.getByRole('button', { name: 'All Items' }).click();
  await expect(page.getByText('0.35 km away', { exact: false })).toBeVisible();
  await page.getByLabel('Search products, brands, or symptoms').fill('zzz');
  await expect(page.getByText('No products match your search.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.goto('/app/pharmacies/12');
  await expect(page.getByRole('heading', { name: 'Test Central Pharmacy' })).toBeVisible();
  await expect(page.getByText('Open now')).toBeVisible();
  await expect(page.getByText('Hours 8am - 9pm')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Call' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Increase quantity for Test Paracetamol 500 mg' }).click();
  await page.getByRole('button', { name: 'Add to cart' }).first().click();
  await expect(page.getByText('Added 2 Test Paracetamol 500 mg to cart')).toBeVisible();
  await page.getByRole('link', { name: 'Orders, cart has 2 items' }).click();
  await expect(page.getByRole('tab', { name: 'Cart (2)' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Selected subtotal ₱11.00')).toBeVisible();
  await expect(page.getByText('Estimated cart total')).toBeVisible();
  await page.getByRole('tab', { name: 'My Orders' }).click();
  await expect(page.getByRole('button', { name: 'All (2)' })).toBeVisible();
  await page.getByRole('button', { name: 'Completed (1)' }).click();
  await expect(page.getByText('NP-31 · Nov 1, 2026')).toBeVisible();
  await page.getByRole('button', { name: 'Buy Again' }).click();
  await expect(page.getByText('Order items added to cart.')).toBeVisible();
  await page.getByRole('tab', { name: /Cart \(/ }).click();
  await expect(page.getByText('Selected subtotal ₱22.00')).toBeVisible();
});

test('the cart is kept for the account across a reload and cleared on sign-out', async ({ page, context }) => {
  await skipIntro(context);
  await mock(page, { signedIn: true });
  await page.goto('/app/pharmacies/12/medicines/5');
  await expect(page.getByRole('heading', { name: 'Medicine Details' })).toBeVisible();
  await expect(page.getByText('Pain and fever relief.')).toBeVisible();
  await page.getByRole('button', { name: 'Add 1 to cart' }).click();
  await expect(page.getByText('Added 1 item to cart')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('link', { name: 'Orders, cart has 1 item' })).toBeVisible();
  await page.getByRole('link', { name: 'Profile' }).click();
  await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('nearpill_cart_user_')))).toEqual([]);
});

test('profile shows account details with order chips and edits contact details on a full page', async ({ page, context }) => {
  await skipIntro(context);
  const { calls } = await mock(page, { signedIn: true });
  await page.goto('/app/profile');
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
  await expect(page.getByText('09171234567')).toBeVisible();
  await expect(page.getByText('Reserved', { exact: true })).toBeVisible();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View all' })).toBeVisible();
  await page.getByRole('link', { name: 'View all' }).click();
  await expect(page).toHaveURL(/\/app\/profile\/orders$/);
  await expect(page.getByRole('heading', { name: 'Order History' })).toBeVisible();
  await expect(page.getByText('Reserved', { exact: true })).toBeVisible();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to profile' }).click();
  await page.getByRole('button', { name: 'Edit contact details' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Account Details' })).toBeVisible();
  await expect(page.getByText('Required')).toHaveCount(0);
  await expect(page.getByText('Pharmacies use these details for order pickup.')).toHaveCount(0);
  await expect(page.getByLabel('Birthdate')).toHaveCount(0);
  await page.getByLabel('Phone Number').fill('0917');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Enter an 11-digit mobile number starting with 09.')).toBeVisible();
  await page.getByLabel('Phone Number').fill('09179998888');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Contact details saved.')).toBeVisible();
  expect(calls.some((call) => call.startsWith('PUT /auth/me'))).toBe(true);
  await page.getByRole('button', { name: /^Phone Number/ }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Account Details' })).toHaveCount(0);
});

test('map shows you and pharmacies, then a road route with the app’s actions', async ({ page, context }) => {
  await skipIntro(context);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 10.3157, longitude: 123.8854 });
  await mock(page, { signedIn: true });
  await page.goto('/app/map');
  await expect(page.getByText('You', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Test Central Pharmacy, Cebu City' })).toBeVisible();
  await expect(page.getByText('2 verified pharmacies')).toBeVisible();
  await expect(page.getByRole('img', { name: 'You are here. Your current location' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use current location' })).toBeVisible();
  await page.getByRole('button', { name: 'Directions to Test Central Pharmacy' }).click();
  await expect(page.getByText('2.45 km by road · 7 min estimated')).toBeVisible();
  await expect(page.getByText('Driving route by Google Maps. Estimated time excludes live traffic.')).toBeVisible();
  await expect(page.getByText('Your location is shared with Google for routing while this route is open.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Navigate' })).toHaveCount(0);
  await page.getByRole('button', { name: 'View medicines' }).click();
  await expect(page).toHaveURL(/\/app\/pharmacies\/12$/);
});

test('map with blocked location falls back to manual search with the app’s message', async ({ page, context }) => {
  await skipIntro(context);
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (_ok: unknown, fail: (e: { code: number; PERMISSION_DENIED: number }) => void) => setTimeout(() => fail({ code: 1, PERMISSION_DENIED: 1 }), 10),
      watchPosition: () => 1, clearWatch: () => undefined,
    } });
  });
  await mock(page);
  await page.goto('/app/map');
  await expect(page.getByText('Location permission was denied. Search by pharmacy or area instead.')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search pharmacies' }).fill('West');
  await page.getByRole('button', { name: 'Search pharmacies' }).click();
  await expect(page.getByText('1 verified pharmacy')).toBeVisible();
});

test('Ask NearPill is a plain chat with no preset questions', async ({ page, context }) => {
  await skipIntro(context);
  const { chats } = await mock(page, { signedIn: true });
  await page.goto('/app/assistant');
  await expect(page.getByText('Ask me anything about using NearPill', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find a medicine' })).toHaveCount(0);
  await expect(page.getByText('Medicine suggestions')).toHaveCount(0);
  await expect(page.locator('.chat-page')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByLabel('Message Ask NearPill').fill('Where is my order?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('Where is my order?')).toBeVisible();
  await expect(page.getByText('Your order NP-32 is reserved at Test Central Pharmacy.')).toBeVisible();
  expect(chats[0].messages).toEqual([{ role: 'user', content: 'Where is my order?' }]);
  await page.getByLabel('Message Ask NearPill').fill('What do I bring?');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByText('What do I bring?')).toBeVisible();
  expect(chats[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  await page.getByRole('button', { name: 'New chat' }).click();
  await expect(page.getByText('Where is my order?')).toHaveCount(0);
});

test('Ask NearPill shows the server reason when it is unavailable and can try again', async ({ page, context }) => {
  await skipIntro(context);
  const { chats, recover } = await mock(page, { signedIn: true, chatFails: true });
  await page.goto('/app/assistant');
  await page.getByLabel('Message Ask NearPill').fill('hello there');
  await page.getByRole('button', { name: 'Send question' }).click();
  await expect(page.getByRole('alert')).toContainText('The assistant is not available right now.');
  recover();
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText('Your order NP-32 is reserved at Test Central Pharmacy.')).toBeVisible();
  expect(chats.length).toBe(2);
  expect(chats[1].messages).toEqual([{ role: 'user', content: 'hello there' }]);
});

for (const width of [390, 768, 1280]) {
  test(`navigation matches the app at ${width}px`, async ({ page, context }) => {
    await skipIntro(context);
    await mock(page, { signedIn: true });
    await context.addInitScript(() => { try { localStorage.setItem('nearpill_cart_user_7', JSON.stringify({ grouped: false, items: [{ listing: { id: 5, name: 'Test Paracetamol 500 mg', drugstoreId: 12, priceCentavos: 550, category: 'Non-Prescription', canOrder: true, stockCount: 4 }, quantity: 1 }] })); } catch { /* ignore */ } });
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/app/map');
    const nav = page.getByRole('navigation', { name: 'NearPill customer navigation' });
    await expect(nav.getByRole('link')).toHaveText(['Home', 'Search', 'Map', 'Orders', 'Profile']);
    const box = await nav.boundingBox();
    if (width < 900) {
      expect(Math.round(box!.height)).toBe(68);
      expect(Math.round(box!.y + box!.height)).toBe(800);
    } else {
      // Wide screens: the same five links sit in the header instead of a bottom bar.
      await expect(page.locator('.shop-header').getByRole('navigation', { name: 'NearPill customer navigation' })).toBeVisible();
      expect(box!.y).toBeLessThan(120);
      expect(Math.round(box!.height)).toBeLessThan(68);
    }
    await expect(nav.getByRole('link', { name: 'Map' })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current', 'page');
    await expect(nav.locator('.shop-dot')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

for (const [width, height] of [[320, 640], [390, 800], [768, 1024], [1024, 768], [1280, 800], [1920, 1080]]) {
  test(`customer pages fit a ${width}px screen with no sideways scrolling`, async ({ page, context }) => {
    await skipIntro(context);
    await mock(page, { signedIn: true });
    await page.setViewportSize({ width, height });
    for (const path of ['/app/', '/app/search', '/app/map', '/app/orders', '/app/profile']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'NearPill customer navigation' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} at ${width}px`).toBe(width);
    }
  });
}
