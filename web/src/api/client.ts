import type {
  DrivingRoute,
  NearbyResponse,
  CatalogListing,
  CheckoutItem,
  InventoryItem,
  Medicine,
  Metrics,
  DrugstoreReportRow,
  GoLiveChecklist,
  MedicineReportRow,
  PharmacyMembership,
  Order,
  PartnerDashboard,
  PartnerSubscription,
  Pharmacy,
  PublicPharmacy,
  PublicPharmacyInventory,
  SalesRow,
  SessionUser,
  StockSubmission,
  Subscription,
  SubscriptionPlan,
} from './types';

const API_BASE = '/api/v1';
type TestPayment = { payment: { paymentStatus: string; paymentPlan?: 'full' | 'deposit' | 'balance'; amountCentavos?: number; checkoutUrl?: string } | null };

/** An administrator's password was right and a code was emailed; sign in again with the same password plus that code. */
export class CodeRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodeRequiredError';
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}

function csrfFromCookie() {
  const part = document.cookie.split('; ').find((value) => value.startsWith('nearpill_csrf='));
  if (!part) return null;
  try { return decodeURIComponent(part.slice('nearpill_csrf='.length)); }
  catch { return null; }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers || {});
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const token = csrfFromCookie();
    if (token) headers.set('X-CSRF-Token', token);
  }
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const response = await fetch(`${API_BASE}${path}`, { ...init, method, headers, credentials: 'same-origin' })
    .catch((error) => {
      if (init.signal?.aborted) throw error;
      throw new ApiError(0, 'Could not connect to NearPill. Check your connection and try again.');
    });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body?.error || `Request failed (${response.status}).`, body?.rowErrors);
  if (response.status !== 204 && body === null) throw new ApiError(502, 'The server returned an invalid response.');
  return body as T;
}

function queryString(params: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

export const api = {
  login: async (email: string, password: string, code?: string) => {
    const result = await request<{ verificationRequired?: boolean; message?: string } | null>('/auth/login', {
      method: 'POST', body: JSON.stringify(code ? { email, password, code } : { email, password }),
    });
    if (result?.verificationRequired) throw new CodeRequiredError(result.message || 'Enter the code we emailed you.');
  },
  assistantChat: (accountId: string, body: { messages: { role: 'user' | 'assistant'; content: string }[]; cart?: { name: string; quantity: number; pharmacy: string }[] }, signal?: AbortSignal) =>
    request<{ reply: string }>('/assistant/chat', { method: 'POST', signal, headers: { 'X-NearPill-Account': accountId }, body: JSON.stringify(body) }),
  deleteAccount: (accountId: string, body: { password: string }) =>
    request<{ message: string }>('/auth/delete-account', { method: 'POST', headers: { 'X-NearPill-Account': accountId }, body: JSON.stringify(body) }),
  register: (body: { fullName: string; email: string; password: string; acceptedTerms: true; company: string; formMs: number }) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  sendOtp: (email: string) => request<{ devCode?: string; testInbox?: boolean }>('/auth/send-otp', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyOtp: (email: string, code: string) => request('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ email, code }) }),
  forgotPassword: (email: string) => request('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) }),
  updateProfile: (body: { phone: string | null }) =>
    request('/auth/me', { method: 'PUT', body: JSON.stringify(body) }),
  me: (signal?: AbortSignal) => request<SessionUser>('/auth/me', { signal }),
  changePassword: (currentPassword: string, password: string) => request('/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword, password }),
  }),
  async logoutAll() {
    await request('/auth/logout-all', { method: 'POST', body: JSON.stringify({}) });
  },
  async logout() {
    await request('/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  },
  catalog: (params: { search: string; storeId?: number; limit: number; offset: number }, signal: AbortSignal) =>
    request<CatalogListing[]>(`/medicines${queryString({ view: 'catalog', ...params })}`, { signal }),
  /** Loads every catalog listing like the app does (pages of 50, offsets up to 1,000). Location never leaves the browser except as the distance query. */
  async catalogAll(position: { lat: number; lng: number } | null, signal: AbortSignal) {
    const all: CatalogListing[] = [];
    for (let offset = 0; offset <= 1000; offset += 50) {
      const page = await request<CatalogListing[]>(`/medicines${queryString({
        view: 'catalog', limit: 50, offset, latitude: position?.lat, longitude: position?.lng })}`, { signal, cache: 'no-store' });
      if (!Array.isArray(page)) throw new Error('Invalid medicine catalog response.');
      all.push(...page);
      if (page.length < 50) return all;
    }
    throw new Error('Too many medicine listings. Please narrow the search.');
  },
  medicineById: (id: number, signal?: AbortSignal) => request<{ description?: string | null }>(`/medicines/${id}`, { signal }),
  nearbyStores: (query: { latitude?: number; longitude?: number; radiusKm?: number; q?: string }, signal?: AbortSignal) =>
    request<NearbyResponse>(`/stores/nearby${queryString(query)}`, { signal }),
  storeRoute: (storeId: number, latitude: number, longitude: number, signal?: AbortSignal) =>
    request<DrivingRoute>(`/stores/${storeId}/route${queryString({ latitude, longitude })}`, { signal, cache: 'no-store' }),
  publicPharmacies: async (search: string, signal: AbortSignal) => search
    ? (await request<{ stores: PublicPharmacy[] }>(`/stores/nearby${queryString({ q: search, limit: 50 })}`, { signal })).stores
    : request<PublicPharmacy[]>('/stores', { signal }),
  publicInventory: (storeId: number, signal: AbortSignal, fresh = false) =>
    request<PublicPharmacyInventory>(`/stores/${storeId}/inventory?view=catalog`, { signal, cache: fresh ? 'no-store' : 'default' }),
  customerOrders: (accountId: string, signal: AbortSignal) => request<Order[]>('/orders', {
    signal, cache: 'no-store', headers: { 'X-NearPill-Account': accountId },
  }),
  reserveTestOrder: (accountId: string, items: CheckoutItem[], idempotencyKey: string, grouped: boolean, pickupDate?: string, pickupWindow?: string) =>
    request<{ id: number }>('/orders', { method: 'POST', headers: { 'X-NearPill-Account': accountId },
      body: JSON.stringify({ items, idempotencyKey, checkoutMode: grouped ? 'grouped' : undefined, pickupDate, pickupWindow }) }),
  reschedulePickup: (accountId: string, orderId: number, pickupDate: string, pickupWindow?: string) =>
    request<{ success: boolean }>(`/orders/${orderId}/pickup`, { method: 'PUT', headers: { 'X-NearPill-Account': accountId },
      body: JSON.stringify({ pickupDate, pickupWindow }) }),
  startTestPayment: (accountId: string, orderId: number, paymentPlan?: 'full' | 'deposit' | 'balance') => request<TestPayment>(`/orders/${orderId}/payments`, {
    method: 'POST', headers: { 'X-NearPill-Account': accountId }, body: JSON.stringify({ provider: 'xendit-test', idempotencyKey: `xendit-test:${orderId}`, paymentPlan }),
  }),
  testOrderPayment: (accountId: string, orderId: number, signal: AbortSignal) =>
    request<TestPayment>(`/orders/${orderId}/payment`, { signal, cache: 'no-store', headers: { 'X-NearPill-Account': accountId } }),
  refreshTestOrderPayment: (accountId: string, orderId: number) =>
    request<TestPayment>(`/orders/${orderId}/payment`, { method: 'POST', headers: { 'X-NearPill-Account': accountId } }),
  cancelReservation: (accountId: string, orderId: number) =>
    request(`/orders/${orderId}/cancel`, { method: 'PUT', headers: { 'X-NearPill-Account': accountId } }),
  prescriptionStatus: (accountId: string, drugstoreId: number, medicineId: number, signal?: AbortSignal) =>
    request<{ review: { id: number; status: string; rejectionReason?: string | null } | null }>(`/prescription-reviews${queryString({ drugstoreId, medicineId })}`, { signal, cache: 'no-store', headers: { 'X-NearPill-Account': accountId } }),
  submitPrescription: (accountId: string, drugstoreId: number, medicineId: number, mimeType: string, photo: string) =>
    request('/prescription-reviews', { method: 'POST', headers: { 'X-NearPill-Account': accountId }, body: JSON.stringify({ drugstoreId, medicineId, mimeType, photo }) }),
  partnerPrescriptionQueue: (accountId: string, drugstoreId: number, signal?: AbortSignal) =>
    request<{ id: number; productName: string; medicineId: number; version: string; expiresAt: string; customerId?: number; customerName?: string | null; submittedAt?: string }[]>(`/partner/prescription-reviews${queryString({ drugstoreId })}`, { signal, cache: 'no-store', headers: { 'X-NearPill-Account': accountId } }),
  partnerPrescriptionPhoto: (accountId: string, drugstoreId: number, id: number, version: string) =>
    request<{ mimeType: string; photo: string }>(`/partner/prescription-reviews/${id}/photo${queryString({ drugstoreId, version })}`, { cache: 'no-store', headers: { 'X-NearPill-Account': accountId } }),
  decidePrescription: (accountId: string, drugstoreId: number, id: number, version: string, decision: 'approved' | 'rejected', reason?: string) =>
    request(`/partner/prescription-reviews/${id}${queryString({ drugstoreId })}`, { method: 'PUT', headers: { 'X-NearPill-Account': accountId }, body: JSON.stringify(reason ? { decision, version, reason } : { decision, version }) }),
  metrics: () => request<Metrics>('/admin/metrics'),
  sendLoginEmail: (drugstoreId: number, userId: number) => request(`/admin/pharmacies/${drugstoreId}/memberships/${userId}/login-email`, { method: 'POST' }),
  createPartnerAccount: (drugstoreId: number, body: { email: string; password?: string }) => request<{ userId: number }>(`/admin/pharmacies/${drugstoreId}/partner-accounts`, { method: 'POST', body: JSON.stringify(body) }),
  pharmacies: () => request<Pharmacy[]>('/admin/pharmacies'),
  createPharmacy: (body: Record<string, unknown>) => request('/admin/pharmacies', { method: 'POST', body: JSON.stringify(body) }),
  goLiveChecklist: (id: number) => request<GoLiveChecklist>(`/admin/pharmacies/${id}/go-live`),
  setGoLive: (id: number, live: boolean) => request(`/admin/pharmacies/${id}/go-live`, { method: 'PUT', body: JSON.stringify({ live }) }),
  updatePharmacy: (id: number, body: Record<string, unknown>) => request(`/admin/pharmacies/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  adminOrders: () => request<Order[]>('/admin/orders'),
  setOrderStatus: (id: number, status: string) => request(`/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
  reconcilePayment: (id: number) => request(`/admin/payments/${id}/reconcile`, { method: 'POST' }),
  medicines: () => request<Medicine[]>('/admin/medicines'),
  createMedicine: (body: Record<string, unknown>) => request('/admin/medicines', { method: 'POST', body: JSON.stringify(body) }),
  updateMedicine: (id: number, body: Record<string, unknown>) => request(`/admin/medicines/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  addMedicineEvidence: (id: number, body: Record<string, unknown>) => request(`/admin/medicines/${id}/evidence`, { method: 'POST', body: JSON.stringify(body) }),
  setMedicinePublication: (id: number, status: string, reviewReference?: string) => request(`/admin/medicines/${id}/publication`, { method: 'PUT', body: JSON.stringify({ status, reviewReference }) }),
  updateInventoryPrice: (id: number, price: string, expectedSellingUnit?: string | null) => request(`/admin/inventory/${id}/price`, { method: 'PUT', body: JSON.stringify({ price, expectedSellingUnit }) }),
  subscriptions: () => request<Subscription[]>('/admin/subscriptions'),
  subscriptionPlans: () => request<SubscriptionPlan[]>('/subscription-plans'),
  createSubscription: (body: { drugstoreId: number; tier: string; startDate: string; planVersion: string }) => request('/admin/subscriptions', { method: 'POST', body: JSON.stringify({ ...body, status: 'active' }) }),
  adminSales: (startDate?: string, endDate?: string) => request<SalesRow[]>(`/admin/reports/sales${queryString({ startDate, endDate })}`),
  adminMedicineReport: () => request<MedicineReportRow[]>('/admin/reports/medicines'),
  adminDrugstoreReport: () => request<DrugstoreReportRow[]>('/admin/reports/drugstores'),
  pharmacyMemberships: (drugstoreId: number) => request<PharmacyMembership[]>(`/admin/pharmacies/${drugstoreId}/memberships`),
  saveMembership: (drugstoreId: number, body: { userId: number; membershipRole: string }) =>
    request(`/admin/pharmacies/${drugstoreId}/memberships`, { method: 'POST', body: JSON.stringify(body) }),
  deactivateMembership: (drugstoreId: number, userId: number) =>
    request(`/admin/pharmacies/${drugstoreId}/memberships/${userId}`, { method: 'DELETE' }),
  partnerDashboard: () => request<PartnerDashboard>('/partner/dashboard'),
  partnerSubscription: () => request<PartnerSubscription>('/partner/subscription'),
  partnerOrders: (accountId: string, drugstoreId?: number) => request<Order[]>(`/partner/orders${queryString({ drugstoreId })}`, {
    headers: { 'X-NearPill-Account': accountId }, cache: 'no-store',
  }),
  setPartnerPickupStatus: (accountId: string, id: number, drugstoreId: number, status: string, balancePayment?: { method: string; amountCentavos: number }) =>
    request(`/partner/orders/${id}/pickup`, { method: 'PUT', headers: { 'X-NearPill-Account': accountId }, body: JSON.stringify({ drugstoreId, status, balancePayment }) }),
  partnerInventory: (drugstoreId?: number) => request<InventoryItem[]>(`/partner/inventory${queryString({ drugstoreId })}`),
  updatePartnerInventory: (drugstoreId: number, item: { medicineId: number; stockOnHand: number; expectedStockOnHand: number; price: string; expectedPriceCentavos: number; saleProduct?: InventoryItem['saleProduct']; sellingUnit?: string; expectedSellingUnit?: string | null; packageSize?: string | null; expectedPackageSize?: string | null; expiryDate?: string | null; lowStockThreshold?: number | null }) => request('/inventory/update', {
    method: 'POST', body: JSON.stringify({ drugstoreId, ...item }),
  }),
  partnerIntakeProducts: (drugstoreId: number) => request<Medicine[]>(`/partner/inventory/catalog${queryString({ drugstoreId })}`),
  submitStock: (body: { drugstoreId: number; fileName?: string; csv?: string; row?: Record<string, string> }) =>
    request<{ id: number; status: string; rowCount: number; newMedicines: number }>('/partner/stock-submissions', { method: 'POST', body: JSON.stringify(body) }),
  partnerStockSubmissions: (drugstoreId: number) => request<{ pharmacyName: string | null; submissions: StockSubmission[] }>(`/partner/stock-submissions${queryString({ drugstoreId })}`),
  adminStockSubmissions: (status?: string) => request<StockSubmission[]>(`/admin/stock-submissions${queryString({ status })}`),
  partnerSales: (startDate?: string, endDate?: string) => request<SalesRow[]>(`/partner/reports/sales${queryString({ startDate, endDate })}`),
};
