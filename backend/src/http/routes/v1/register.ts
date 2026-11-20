import { createRoute } from '@hono/zod-openapi';
import { loginError } from '../../../application/durable-login-security.js';
import {
  AssistantChatSchema,
  DeleteAccountSchema,
  EmailSchema, SendOtpSchema,
  ErrorSchema,
  IdParamsSchema,
  InventoryPriceSchema,
  InventoryQuerySchema,
  InventoryUpdateSchema,
  StockSubmissionSchema,
  StockSubmissionQuerySchema,
  JsonResponseSchema,
  LoginResponseSchema,
  LoginSchema,
  LogoutSchema,
  MedicineBodySchema,
  MedicineEvidenceSchema,
  MedicinePublicationSchema,
  MedicineQuerySchema,
  MembershipParamsSchema,
  MembershipUpsertSchema,
  PartnerAccountSchema,
  GoLiveSchema,
  NearbyStoreQuerySchema,
  OrderCreateSchema,
  OrderPickupSchema,
  OrderStatusSchema,
  PartnerPickupStatusSchema,
  PaymentIntentCreateSchema,
  PrescriptionBranchSchema,
  PrescriptionDecisionSchema,
  PrescriptionPhotoQuerySchema,
  PrescriptionSubmitSchema,
  PrescriptionTargetSchema,
  ProviderParamsSchema,
  RefundRequestSchema,
  PharmacyBodySchema,
  ProfileUpdateSchema,
  RefreshResponseSchema,
  RefreshSchema,
  RegisterSchema,
  ResetPasswordSchema,
  ChangePasswordSchema,
  SalesQuerySchema,
  StoreIdParamsSchema,
  StoreInventoryQuerySchema,
  StoreRouteQuerySchema,
  SubscriptionBodySchema,
  VerifyOtpSchema,
} from '../../contracts.ts';
import {
  adminAccepted,
  authenticateContext,
  clientIp,
  parseBody,
  parseValue,
  requestEnvelope,
  sendOutcome,
} from '../../transport.ts';

const responseSet = {
  200: { content: { 'application/json': { schema: JsonResponseSchema } }, description: 'Successful response.' },
  201: { content: { 'application/json': { schema: JsonResponseSchema } }, description: 'Resource created.' },
  400: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Invalid request.' },
  401: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Authentication required or rejected.' },
  403: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Permission denied.' },
  404: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Resource not found.' },
  409: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Request conflicts with current state.' },
  413: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Request body too large.' },
  500: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Server error.' },
  503: { content: { 'application/json': { schema: ErrorSchema } }, description: 'Dependency unavailable.' },
};

type AuthMode = 'none' | 'user' | 'admin';
type RouteSpec = {
  id: string;
  method: 'get' | 'post' | 'put' | 'delete';
  path: string;
  tag: string;
  summary: string;
  auth?: AuthMode;
  accountRole?: 'customer' | 'partner';
  body?: any;
  query?: any;
  params?: any;
  bodyLimit?: number;
  bodyOptional?: boolean;
  rawBody?: boolean;
  rateLimit?: 'login' | 'recovery';
  invoke: (input: any) => Promise<any> | any;
  responseSchema?: any;
};

function openApiPath(prefix: string, path: string) {
  return `${prefix}${path}`.replace(/:([^/]+)/g, '{$1}');
}

function makeHandler(spec: RouteSpec, services: any, prevalidated = false) {
  return async (c: any) => {
    if (spec.path.startsWith('/auth/')) c.header('Cache-Control', 'no-store');
    if (spec.rateLimit) {
      const limiter = spec.rateLimit === 'login' ? services.loginSecurity : services.recoverySecurity;
      try {
        if (!(await limiter.allowIp(clientIp(c)))) return c.json({ error: loginError }, 401);
      } catch {
        return c.json({ error: loginError }, 503);
      }
    }

    if (spec.auth && spec.auth !== 'none') {
      const authResult = await authenticateContext(c, services.auth);
      if (!authResult.ok) return c.json(authResult.body, authResult.status);
      if (spec.auth === 'admin' && !adminAccepted(c)) {
        return c.json({ error: 'Administrator access required.' }, 403);
      }
    }
    if (spec.accountRole) {
      c.header('Cache-Control', 'private, no-store');
      const expectedAccount = c.req.header('X-NearPill-Account');
      if (expectedAccount !== undefined &&
          (expectedAccount !== String(c.get('authUserId')) || c.get('authUser')?.role !== spec.accountRole)) {
        return c.json({ error: 'Your signed-in account changed. Check your session and try again.' }, 409);
      }
    }

    const params = prevalidated && spec.params
      ? { ok: true, data: c.req.valid('param') }
      : parseValue(spec.params, c.req.param());
    if (!params.ok) return c.json(params.body, params.status);
    const query = prevalidated && spec.query
      ? { ok: true, data: c.req.valid('query') }
      : parseValue(spec.query, c.req.query());
    if (!query.ok) return c.json(query.body, query.status);

    let body: any = {};
    let rawBody = '';
    if (spec.rawBody) rawBody = c.get('rawWebhookBody') || '';
    if (spec.body) {
      if (prevalidated) {
        body = c.req.valid('json') ?? {};
      } else {
        const parsedBody = await parseBody(c, spec.body, spec.bodyLimit || 64 * 1024);
        if (!parsedBody.ok) return c.json(parsedBody.body, parsedBody.status);
        body = parsedBody.data;
      }
    }

    try {
      const outcome = await spec.invoke({
        c,
        body,
        params: params.data || {},
        query: query.data || {},
        userId: c.get('authUserId'),
        actor: c.get('authUser') ? { ...c.get('authUser'), memberships: c.get('authMemberships') || [] } : null,
        rawBody,
      });
      return sendOutcome(c, outcome);
    } catch (error: any) {
      console.error('api_operation_failed', { operationId: spec.id, code: error?.code });
      return c.json({ error: 'Internal server error.' }, 500);
    }
  };
}

function routeSpecs(services: any): RouteSpec[] {
  // The go-live checklist counts active partner logins on the server; the client never supplies this fact.
  const countPartnerAccounts = async (drugstoreId: number) => {
    const result = await services.memberships.list(drugstoreId);
    const members = result.status === 200 && Array.isArray(result.body) ? result.body : [];
    return members.filter((member: any) => member.isActive !== false).length;
  };
  const authBodyLimit = 4 * 1024;
  const prescriptionRoutes: RouteSpec[] = services.prescriptionReviewEnabled === true ? [
    { id: 'prescriptionReviewStatus', method: 'get', path: '/prescription-reviews', tag: 'Prescription review', summary: 'Get your staging prescription review status', auth: 'user', accountRole: 'customer', query: PrescriptionTargetSchema, invoke: ({ actor, userId, query }) => services.prescriptions.status(actor, userId, query) },
    { id: 'submitPrescriptionReview', method: 'post', path: '/prescription-reviews', tag: 'Prescription review', summary: 'Send a sample prescription photo to the selected pharmacy', auth: 'user', accountRole: 'customer', body: PrescriptionSubmitSchema, invoke: ({ actor, userId, body }) => services.prescriptions.submit(actor, userId, body) },
    { id: 'partnerPrescriptionQueue', method: 'get', path: '/partner/prescription-reviews', tag: 'Prescription review', summary: 'List staging prescription reviews for the pharmacy', auth: 'user', accountRole: 'partner', query: PrescriptionBranchSchema, invoke: ({ actor, query }) => services.prescriptions.queue(actor, query.drugstoreId) },
    { id: 'partnerPrescriptionPhoto', method: 'get', path: '/partner/prescription-reviews/:id/photo', tag: 'Prescription review', summary: 'Open a pending sample prescription photo', auth: 'user', accountRole: 'partner', params: IdParamsSchema, query: PrescriptionPhotoQuerySchema, invoke: ({ actor, query, params }) => services.prescriptions.photo(actor, query.drugstoreId, params.id, query.version) },
    { id: 'partnerPrescriptionDecision', method: 'put', path: '/partner/prescription-reviews/:id', tag: 'Prescription review', summary: 'Record a pharmacy decision and remove the sample photo', auth: 'user', accountRole: 'partner', params: IdParamsSchema, query: PrescriptionBranchSchema, body: PrescriptionDecisionSchema, invoke: ({ actor, userId, query, params, body }) => services.prescriptions.decide(actor, userId, query.drugstoreId, params.id, body.version, body.decision, body.reason) },
  ] : [];
  return [
    ...prescriptionRoutes,
    { id: 'authRegister', method: 'post', path: '/auth/register', tag: 'Auth', summary: 'Register a verified customer account', body: RegisterSchema, bodyLimit: authBodyLimit, invoke: ({ c, body }) => services.identity.register(body, { ip: clientIp(c) }) },
    { id: 'authSendOtp', method: 'post', path: '/auth/send-otp', tag: 'Auth', summary: 'Send an email verification code', body: SendOtpSchema, bodyLimit: authBodyLimit, invoke: ({ c, body }) => services.identity.sendOtp(body, { ip: clientIp(c) }) },
    { id: 'authVerifyOtp', method: 'post', path: '/auth/verify-otp', tag: 'Auth', summary: 'Verify an email code', body: VerifyOtpSchema, bodyLimit: authBodyLimit, invoke: ({ c, body }) => services.identity.verifyOtp(body, { ip: clientIp(c) }) },
    { id: 'authLogin', method: 'post', path: '/auth/login', tag: 'Auth', summary: 'Create access, refresh, and web session credentials', body: LoginSchema, bodyLimit: authBodyLimit, rateLimit: 'login', responseSchema: LoginResponseSchema, invoke: ({ body }) => services.login.login(body) },
    { id: 'authDeleteAccount', method: 'post', path: '/auth/delete-account', tag: 'Auth', summary: 'Delete the signed-in customer account after confirming their password', auth: 'user', accountRole: 'customer', body: DeleteAccountSchema, bodyLimit: authBodyLimit, rateLimit: 'login', invoke: async ({ userId, actor, body }) => {
      const result = await services.identity.deleteAccount(userId, actor, body);
      return { result, setCookies: result.status === 200 ? services.auth.clearWebSessionCookieHeaders() : [] };
    } },
    { id: 'authForgotPassword', method: 'post', path: '/auth/forgot-password', tag: 'Auth', summary: 'Request password recovery', body: EmailSchema, bodyLimit: authBodyLimit, rateLimit: 'recovery', invoke: ({ body }) => services.recovery.requestReset(body) },
    { id: 'authResetPassword', method: 'post', path: '/auth/reset-password', tag: 'Auth', summary: 'Reset password with a single-use token', body: ResetPasswordSchema, bodyLimit: authBodyLimit, rateLimit: 'recovery', invoke: ({ body }) => services.recovery.resetPassword(body) },
    { id: 'authRefresh', method: 'post', path: '/auth/refresh', tag: 'Auth', summary: 'Rotate a refresh credential', body: RefreshSchema, bodyLimit: authBodyLimit, responseSchema: RefreshResponseSchema, invoke: ({ body }) => services.identity.refresh(body) },
    { id: 'authLogout', method: 'post', path: '/auth/logout', tag: 'Auth', summary: 'Revoke supplied session credentials', body: LogoutSchema, bodyLimit: authBodyLimit, bodyOptional: true, invoke: async ({ c, body }) => {
      const request = requestEnvelope(c);
      const cookieToken = services.auth.webCookieToken(request);
      if (cookieToken) {
        // Check the cookie independently because logout can also carry a mobile token.
        const webSession = await services.auth.authenticate({ ...request, headers: { ...request.headers, authorization: '' } });
        if (webSession && !services.auth.csrfAccepted(request, webSession)) {
          return { status: 403, body: { error: 'Invalid CSRF token. Refresh the page and try again.' } };
        }
      }
      const result = await services.identity.logout({
        refreshToken: body.refreshToken, bearerToken: services.auth.bearerToken(request), cookieToken,
      });
      return { result, setCookies: services.auth.clearWebSessionCookieHeaders() };
    } },
    { id: 'authLogoutAll', method: 'post', path: '/auth/logout-all', tag: 'Auth', summary: 'Revoke all sessions for the authenticated account', auth: 'user', invoke: async ({ userId }) => ({ result: await services.identity.logoutAll(userId), setCookies: services.auth.clearWebSessionCookieHeaders() }) },
    { id: 'authMe', method: 'get', path: '/auth/me', tag: 'Auth', summary: 'Read authenticated profile and session lifetime', auth: 'user', invoke: async ({ userId, actor, c }) => {
      const profile = await services.identity.getProfile(userId);
      const expiresAt = new Date(c.get('authSession')?.expiresAt ?? NaN).getTime();
      if (profile.status !== 200) return profile;
      return { ...profile, body: {
        ...profile.body,
        ...(Number.isFinite(expiresAt) ? { sessionExpiresInMs: Math.max(0, expiresAt - Date.now()) } : {}),
        ...(services.xenditTestCheckout && actor?.role === 'customer' ? { xenditTestCheckout: true } : {}),
        ...(services.xenditTestDeposit && actor?.role === 'customer' ? { xenditTestDeposit: true } : {}),
      } };
    } },
    { id: 'authChangePassword', method: 'post', path: '/auth/change-password', tag: 'Auth', summary: 'Change a partner password using the current password', auth: 'user', body: ChangePasswordSchema, bodyLimit: authBodyLimit, rateLimit: 'login', invoke: async ({ userId, actor, body }) => {
      const result = await services.identity.changePartnerPassword(userId, actor, body);
      return { result, setCookies: result.status === 200 ? services.auth.clearWebSessionCookieHeaders() : [] };
    } },
    { id: 'authUpdateMe', method: 'put', path: '/auth/me', tag: 'Auth', summary: 'Update authenticated profile', auth: 'user', body: ProfileUpdateSchema, invoke: ({ userId, body }) => services.identity.updateProfile(userId, { phone: body.phone ?? null, birthDate: body.birthDate ?? body.birthdate ?? null }) },

    { id: 'listMemberships', method: 'get', path: '/admin/pharmacies/:id/memberships', tag: 'Memberships', summary: 'List pharmacy memberships', auth: 'admin', params: StoreIdParamsSchema, invoke: ({ params }) => services.memberships.list(params.id) },
    { id: 'upsertMembership', method: 'post', path: '/admin/pharmacies/:id/memberships', tag: 'Memberships', summary: 'Create or update a pharmacy membership', auth: 'admin', params: StoreIdParamsSchema, body: MembershipUpsertSchema, invoke: ({ userId, params, body }) => services.memberships.upsert(userId, params.id, body) },
    { id: 'createPartnerAccount', method: 'post', path: '/admin/pharmacies/:id/partner-accounts', tag: 'Memberships', summary: 'Create a partner pharmacy login', auth: 'admin', params: StoreIdParamsSchema, body: PartnerAccountSchema, bodyLimit: 4 * 1024, invoke: ({ userId, params, body }) => services.memberships.createPartnerAccount(userId, params.id, body) },
    { id: 'sendPartnerLoginEmail', method: 'post', path: '/admin/pharmacies/:id/memberships/:userId/login-email', tag: 'Memberships', summary: 'Email a partner their sign-in link and a link to choose a password', auth: 'admin', params: MembershipParamsSchema, bodyLimit: 1024, invoke: ({ userId, params }) => services.memberships.sendLoginEmail(userId, params.id, params.userId) },
    { id: 'deactivateMembership', method: 'delete', path: '/admin/pharmacies/:id/memberships/:userId', tag: 'Memberships', summary: 'Deactivate a pharmacy membership', auth: 'admin', params: MembershipParamsSchema, invoke: ({ userId, params }) => services.memberships.deactivate(userId, params.id, params.userId) },

    { id: 'getStoreRoute', method: 'get', path: '/stores/:id/route', tag: 'Catalog', summary: 'Preview a driving route to a public pharmacy', auth: 'user', params: StoreIdParamsSchema, query: StoreRouteQuerySchema, invoke: ({ userId, params, query }) => services.catalog.getStoreRoute(userId, params.id, query) },
    { id: 'listMedicines', method: 'get', path: '/medicines', tag: 'Catalog', summary: 'Browse pharmacy listings or available reviewed medicines, with optional location distance', query: MedicineQuerySchema, invoke: ({ query }) => services.catalog.listMedicines(query) },
    { id: 'getMedicine', method: 'get', path: '/medicines/:id', tag: 'Catalog', summary: 'Get a published OTC medicine', params: IdParamsSchema, invoke: ({ params }) => services.catalog.getMedicine(params.id) },
    { id: 'listStores', method: 'get', path: '/stores', tag: 'Catalog', summary: 'List verified public pharmacies', invoke: () => services.catalog.listStores() },
    { id: 'nearbyStores', method: 'get', path: '/stores/nearby', tag: 'Catalog', summary: 'Find verified pharmacies by coordinates or manual location search', query: NearbyStoreQuerySchema, invoke: ({ query }) => services.catalog.nearbyStores(query) },
    { id: 'getStore', method: 'get', path: '/stores/:id', tag: 'Catalog', summary: 'Get a verified public pharmacy', params: StoreIdParamsSchema, invoke: ({ params }) => services.catalog.getStore(params.id) },
    { id: 'getStoreInventory', method: 'get', path: '/stores/:id/inventory', tag: 'Catalog', summary: 'Browse a verified pharmacy catalogue or available reviewed inventory', params: StoreIdParamsSchema, query: StoreInventoryQuerySchema, invoke: ({ params, query }) => services.catalog.getStoreInventory(params.id, query) },
    { id: 'adminListPharmacies', method: 'get', path: '/admin/pharmacies', tag: 'Admin catalog', summary: 'List pharmacies for administration', auth: 'admin', invoke: () => services.catalog.listAdminPharmacies() },
    { id: 'adminCreatePharmacy', method: 'post', path: '/admin/pharmacies', tag: 'Admin catalog', summary: 'Create a pending-verification pharmacy', auth: 'admin', body: PharmacyBodySchema, invoke: ({ userId, body }) => services.catalog.createPharmacy(userId, body) },
    { id: 'adminUpdatePharmacy', method: 'put', path: '/admin/pharmacies/:id', tag: 'Admin catalog', summary: 'Update pharmacy profile fields', auth: 'admin', params: StoreIdParamsSchema, body: PharmacyBodySchema, invoke: ({ userId, params, body }) => services.catalog.updatePharmacy(userId, params.id, body) },
    { id: 'adminGoLiveChecklist', method: 'get', path: '/admin/pharmacies/:id/go-live', tag: 'Admin catalog', summary: 'Go-live checklist for a pharmacy', auth: 'admin', params: StoreIdParamsSchema, invoke: async ({ params }) => services.catalog.goLiveChecklist(params.id, { partnerAccounts: await countPartnerAccounts(params.id) }) },
    { id: 'adminSetGoLive', method: 'put', path: '/admin/pharmacies/:id/go-live', tag: 'Admin catalog', summary: 'Publish or take down a pharmacy once the checklist passes', auth: 'admin', params: StoreIdParamsSchema, body: GoLiveSchema, bodyLimit: 1024, invoke: async ({ userId, params, body }) => services.catalog.setGoLive(userId, params.id, body, { partnerAccounts: await countPartnerAccounts(params.id) }) },
    { id: 'adminListMedicines', method: 'get', path: '/admin/medicines', tag: 'Admin catalog', summary: 'List master OTC medicines', auth: 'admin', invoke: () => services.catalog.listMasterMedicines() },
    { id: 'adminCreateMedicine', method: 'post', path: '/admin/medicines', tag: 'Admin catalog', summary: 'Create a draft OTC medicine', auth: 'admin', body: MedicineBodySchema, invoke: ({ userId, body }) => services.catalog.createMedicine(userId, body) },
    { id: 'adminUpdateMedicine', method: 'put', path: '/admin/medicines/:id', tag: 'Admin catalog', summary: 'Update a master OTC medicine', auth: 'admin', params: IdParamsSchema, body: MedicineBodySchema, invoke: ({ userId, params, body }) => services.catalog.updateMedicine(userId, params.id, body) },
    { id: 'adminListMedicineEvidence', method: 'get', path: '/admin/medicines/:id/evidence', tag: 'Admin catalog', summary: 'List medicine publication evidence', auth: 'admin', params: IdParamsSchema, invoke: ({ params }) => services.catalog.listMedicineEvidence(params.id) },
    { id: 'adminAddMedicineEvidence', method: 'post', path: '/admin/medicines/:id/evidence', tag: 'Admin catalog', summary: 'Add reviewed medicine evidence', auth: 'admin', params: IdParamsSchema, body: MedicineEvidenceSchema, invoke: ({ userId, params, body }) => services.catalog.addMedicineEvidence(userId, params.id, body) },
    { id: 'adminSetMedicinePublication', method: 'put', path: '/admin/medicines/:id/publication', tag: 'Admin catalog', summary: 'Publish, draft, or retire a medicine', auth: 'admin', params: IdParamsSchema, body: MedicinePublicationSchema, invoke: ({ userId, params, body }) => services.catalog.setMedicinePublication(userId, params.id, body) },

    { id: 'updateInventory', method: 'post', path: '/inventory/update', tag: 'Inventory', summary: 'Update pharmacy stock and unit price', auth: 'user', body: InventoryUpdateSchema, invoke: ({ userId, actor, body }) => services.inventory.updateStock(userId, actor, body) },
    { id: 'adminUpdateInventoryPrice', method: 'put', path: '/admin/inventory/:id/price', tag: 'Inventory', summary: 'Set authoritative inventory price', auth: 'admin', params: IdParamsSchema, body: InventoryPriceSchema, invoke: ({ userId, params, body }) => services.inventory.updatePrice(userId, params.id, body) },
    { id: 'adminInventory', method: 'get', path: '/admin/inventory', tag: 'Inventory', summary: 'List admin inventory', auth: 'admin', query: InventoryQuerySchema, invoke: ({ query }) => services.inventory.listAdminInventory(query) },

    { id: 'createOrder', method: 'post', path: '/orders', tag: 'Orders', summary: 'Create a one-pharmacy idempotent order reservation', auth: 'user', accountRole: 'customer', body: OrderCreateSchema, invoke: ({ userId, actor, body, c }) => {
      if (services.xenditTestCheckout && actor?.role !== 'customer') {
        return { status: 403, body: { error: 'Customer access is required for test checkout.' } };
      }
      return services.orders.createOrder(userId, { ...body, idempotencyKey: body.idempotencyKey ?? c.req.header('idempotency-key'), requireIdempotency: c.req.path.startsWith('/api/v1/') });
    } },
    { id: 'assistantChat', method: 'post', path: '/assistant/chat', tag: 'Assistant', summary: 'Ask the NearPill-only assistant a question', auth: 'user', accountRole: 'customer', body: AssistantChatSchema, bodyLimit: 16 * 1024, invoke: ({ userId, body }) => services.assistant.chat(userId, body) },
    { id: 'listOrders', method: 'get', path: '/orders', tag: 'Orders', summary: 'List customer orders', auth: 'user', accountRole: 'customer', invoke: ({ userId }) => services.orders.listCustomerOrders(userId) },
    { id: 'getOrder', method: 'get', path: '/orders/:id', tag: 'Orders', summary: 'Get customer order', auth: 'user', accountRole: 'customer', params: IdParamsSchema, invoke: ({ userId, params }) => services.orders.getCustomerOrder(userId, params.id) },
    { id: 'adminListOrders', method: 'get', path: '/admin/orders', tag: 'Orders', summary: 'List admin orders', auth: 'admin', invoke: () => services.orders.listAdminOrders() },
    { id: 'adminGetOrder', method: 'get', path: '/admin/orders/:id', tag: 'Orders', summary: 'Get admin order', auth: 'admin', params: IdParamsSchema, invoke: ({ params }) => services.orders.getAdminOrder(params.id) },
    { id: 'adminUpdateOrderStatus', method: 'put', path: '/orders/:id/status', tag: 'Orders', summary: 'Update order status', auth: 'admin', params: IdParamsSchema, body: OrderStatusSchema, invoke: ({ userId, params, body }) => services.orders.updateStatus(userId, params.id, body) },
    { id: 'rescheduleOrderPickup', method: 'put', path: '/orders/:id/pickup', tag: 'Orders', summary: 'Change the pickup date of a customer order (once)', auth: 'user', accountRole: 'customer', params: IdParamsSchema, body: OrderPickupSchema, invoke: ({ userId, params, body }) => services.orders.reschedulePickup(userId, params.id, body) },
    { id: 'cancelOrder', method: 'put', path: '/orders/:id/cancel', tag: 'Orders', summary: 'Cancel customer order', auth: 'user', accountRole: 'customer', params: IdParamsSchema, invoke: ({ userId, params }) => services.orders.cancelOwnOrder(userId, params.id) },

    { id: 'partnerDashboard', method: 'get', path: '/partner/dashboard', tag: 'Partner', summary: 'Get partner dashboard', auth: 'user', invoke: ({ userId }) => services.payments.partnerDashboard(userId) },
    { id: 'partnerOrders', method: 'get', path: '/partner/orders', tag: 'Partner', summary: 'List orders for an authorized pharmacy membership', auth: 'user', accountRole: 'partner', query: InventoryQuerySchema, invoke: ({ actor, query }) => services.orders.listPartnerOrders(actor, query) },
    { id: 'partnerPickupStatus', method: 'put', path: '/partner/orders/:id/pickup', tag: 'Partner', summary: 'Advance a paid test pickup for the member pharmacy', auth: 'user', accountRole: 'partner', params: IdParamsSchema, body: PartnerPickupStatusSchema, invoke: ({ userId, actor, params, body }) => services.orders.updatePartnerPickup(userId, actor, params.id, body) },
    { id: 'partnerInventory', method: 'get', path: '/partner/inventory', tag: 'Partner', summary: 'List inventory for an authorized pharmacy membership', auth: 'user', query: InventoryQuerySchema, invoke: ({ actor, query }) => services.inventory.listPartnerInventory(actor, query) },
    { id: 'partnerIntakeProducts', method: 'get', path: '/partner/inventory/catalog', tag: 'Partner', summary: 'List eligible catalog products for pharmacy intake', auth: 'user', query: InventoryQuerySchema, invoke: ({ actor, query }) => services.inventory.listIntakeProducts(actor, query.drugstoreId) },
    { id: 'partnerSubmitStock', method: 'post', path: '/partner/stock-submissions', tag: 'Partner', summary: 'Send stock that follows the CSV template; it goes on sale at once when every row passes', auth: 'user', body: StockSubmissionSchema, bodyLimit: 512 * 1024, invoke: ({ userId, actor, body }) => services.stockSubmissions.submit(userId, actor, body) },
    { id: 'partnerStockSubmissions', method: 'get', path: '/partner/stock-submissions', tag: 'Partner', summary: 'List stock submissions of a pharmacy', auth: 'user', query: InventoryQuerySchema, invoke: ({ actor, query }) => services.stockSubmissions.listForPartner(actor, query) },
    { id: 'adminStockSubmissions', method: 'get', path: '/admin/stock-submissions', tag: 'Inventory', summary: 'List stock uploads (read only)', auth: 'admin', query: StockSubmissionQuerySchema, invoke: ({ query }) => services.stockSubmissions.listForAdmin(query) },
    { id: 'partnerSubscription', method: 'get', path: '/partner/subscription', tag: 'Partner', summary: 'Get partner subscription and active entitlements', auth: 'user', invoke: ({ userId }) => services.payments.partnerSubscription(userId) },
    { id: 'subscriptionPlans', method: 'get', path: '/subscription-plans', tag: 'Subscriptions', summary: 'List subscription plans and what each includes', auth: 'user', invoke: () => services.payments.subscriptionPlans() },
    { id: 'partnerEntitlements', method: 'get', path: '/partner/entitlements', tag: 'Subscriptions', summary: 'Get server-owned partner entitlements', auth: 'user', invoke: ({ userId }) => services.payments.partnerEntitlements(userId) },
    { id: 'partnerSalesReport', method: 'get', path: '/partner/reports/sales', tag: 'Reports', summary: 'Get premium pharmacy sales report', auth: 'user', query: SalesQuerySchema, invoke: async ({ userId, query }) => { const access = await services.payments.requirePartnerEntitlement(userId, 'reports:view:premium'); return access.ok ? services.reports.partnerSales(access.body.drugstoreId, query, { fullHistory: access.body.entitlements.includes('reports:history:full') }) : access; } },
    { id: 'adminListSubscriptions', method: 'get', path: '/admin/subscriptions', tag: 'Subscriptions', summary: 'List subscriptions', auth: 'admin', invoke: () => services.payments.listSubscriptions() },
    { id: 'adminCreateSubscription', method: 'post', path: '/admin/subscriptions', tag: 'Subscriptions', summary: 'Create a subscription and authoritative entitlements', auth: 'admin', body: SubscriptionBodySchema, invoke: ({ userId, body }) => services.payments.createSubscription(userId, body) },
    { id: 'adminUpdateSubscription', method: 'put', path: '/admin/subscriptions/:id', tag: 'Subscriptions', summary: 'Update a subscription and authoritative entitlements', auth: 'admin', params: IdParamsSchema, body: SubscriptionBodySchema, invoke: ({ userId, params, body }) => services.payments.updateSubscription(userId, params.id, body) },
    { id: 'createPaymentIntent', method: 'post', path: '/orders/:id/payments', tag: 'Payments', summary: 'Create a provider-backed payment intent', auth: 'user', accountRole: 'customer', params: IdParamsSchema, body: PaymentIntentCreateSchema, invoke: ({ userId, params, body, c }) => services.payments.createPaymentIntent(userId, params.id, { ...body, idempotencyKey: body.idempotencyKey ?? c.req.header('idempotency-key') }) },
    { id: 'paymentProviderWebhook', method: 'post', path: '/payments/webhooks/:provider', tag: 'Payments', summary: 'Receive a signed provider payment event', auth: 'none', params: ProviderParamsSchema, body: JsonResponseSchema, rawBody: true, bodyLimit: 64 * 1024, invoke: ({ params, rawBody, c }) => services.payments.processProviderWebhook(params.provider, { rawBody, headers: c.req.raw.headers }) },
    { id: 'getOrderPayment', method: 'get', path: '/orders/:id/payment', tag: 'Payments', summary: 'Get authoritative order payment state', auth: 'user', accountRole: 'customer', params: IdParamsSchema, invoke: ({ userId, params }) => services.payments.getOrderPayment(userId, params.id) },
    { id: 'refreshTestOrderPayment', method: 'post', path: '/orders/:id/payment', tag: 'Payments', summary: 'Verify the customer’s test payment with Xendit', auth: 'user', accountRole: 'customer', params: IdParamsSchema, invoke: ({ userId, actor, params }) => actor?.role === 'customer' ? services.payments.refreshTestOrderPayment(userId, params.id) : { status: 403, body: { error: 'Customer access is required.' } } },
    { id: 'getPayment', method: 'get', path: '/payments/:id', tag: 'Payments', summary: 'Get authoritative payment state', auth: 'user', params: IdParamsSchema, invoke: ({ userId, params }) => services.payments.getPayment(userId, params.id) },
    { id: 'adminRequestRefund', method: 'post', path: '/admin/payments/:id/refunds', tag: 'Payments', summary: 'Request a provider refund without asserting completion', auth: 'admin', params: IdParamsSchema, body: RefundRequestSchema, invoke: ({ userId, params, body }) => services.payments.requestRefund(userId, params.id, body) },
    { id: 'adminReconcilePayment', method: 'post', path: '/admin/payments/:id/reconcile', tag: 'Payments', summary: 'Reconcile payment/refund state against provider evidence', auth: 'admin', params: IdParamsSchema, invoke: ({ userId, params }) => services.payments.reconcilePayment(userId, params.id) },

    { id: 'adminMetrics', method: 'get', path: '/admin/metrics', tag: 'Reports', summary: 'Get admin metrics', auth: 'admin', invoke: () => services.reports.metrics() },
    { id: 'adminSalesReport', method: 'get', path: '/admin/reports/sales', tag: 'Reports', summary: 'Get sales report', auth: 'admin', query: SalesQuerySchema, invoke: ({ query }) => services.reports.sales(query) },
    { id: 'adminMedicineReport', method: 'get', path: '/admin/reports/medicines', tag: 'Reports', summary: 'Get medicine report', auth: 'admin', invoke: () => services.reports.medicines() },
    { id: 'adminDrugstoreReport', method: 'get', path: '/admin/reports/drugstores', tag: 'Reports', summary: 'Get pharmacy report', auth: 'admin', invoke: () => services.reports.drugstores() },
    { id: 'adminAuditLogs', method: 'get', path: '/admin/audit-logs', tag: 'Reports', summary: 'Get audit log', auth: 'admin', invoke: () => services.reports.auditLogs() },
  ];
}

export function registerApiRoutes(app: any, services: any) {
  const specs = routeSpecs(services);

  for (const spec of specs) {
    const v1Handler = makeHandler(spec, services, true);
    const request: Record<string, any> = {};
    if (spec.params) request.params = spec.params;
    if (spec.query) request.query = spec.query;
    if (spec.body) {
      request.body = {
        required: !spec.bodyOptional,
        content: { 'application/json': { schema: spec.body } },
      };
    }

    const responses = {
      ...responseSet,
      200: {
        content: { 'application/json': { schema: spec.responseSchema || JsonResponseSchema } },
        description: 'Successful response.',
      },
    };

    const route = createRoute({
      method: spec.method,
      path: openApiPath('/api/v1', spec.path),
      operationId: spec.id,
      tags: [spec.tag],
      summary: spec.summary,
      ...(Object.keys(request).length ? { request } : {}),
      ...(spec.auth && spec.auth !== 'none'
        ? { security: [{ bearerAuth: [] }, { cookieAuth: [] }] }
        : {}),
      responses,
    } as any);

    app.openapi(route, v1Handler as any);
  }

  return specs.map(({ id, method, path, auth = 'none' }) => ({ id, method, path, auth }));
}
