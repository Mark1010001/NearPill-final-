import dotenv from 'dotenv';
import { serve } from '@hono/node-server';
import { isNearPillStagingDatabase, parseBackendEnvironment } from '../config/env.ts';
import { createPostgresDatabase } from '../infrastructure/postgres/client.js';
import { createPostgresIdentityRepository } from '../infrastructure/postgres/identity-repository.js';
import { createPostgresSecurityRepository } from '../infrastructure/postgres/security-repository.js';
import { createPostgresCatalogRepository } from '../infrastructure/postgres/catalog-repository.js';
import { createPostgresInventoryRepository } from '../infrastructure/postgres/inventory-repository.js';
import { createPostgresOrderRepository } from '../infrastructure/postgres/order-repository.js';
import { createPrescriptionReviews } from '../infrastructure/postgres/prescription-reviews.js';
import { createPostgresPaymentSubscriptionRepository } from '../infrastructure/postgres/payment-subscription-repository.js';
import { createPostgresReportRepository } from '../infrastructure/postgres/report-repository.js';
import { createAuthService, useSecureCookies } from '../application/auth-service.js';
import { createDurableLoginSecurity } from '../application/durable-login-security.js';
import { createIdentityService } from '../application/identity-service.js';
import { createLoginService } from '../application/login-service.js';
import { createPasswordRecoveryService } from '../application/password-recovery-service.js';
import { createMembershipService } from '../application/membership-service.js';
import { createAssistantService } from '../application/assistant-service.js';
import { createCatalogService } from '../application/catalog-service.js';
import { createGoogleRoutePlanner } from '../infrastructure/google-route.js';
import { createXenditTestProvider } from '../infrastructure/xendit-test.js';
import { createInventoryService } from '../application/inventory-service.js';
import { createStockSubmissionService } from '../application/stock-submission-service.js';
import { createOrderService } from '../application/order-service.js';
import { createPaymentSubscriptionService } from '../application/payment-subscription-service.js';
import { createReportService } from '../application/report-service.js';
import { createRetentionService } from '../application/retention-service.js';
import { createPostgresRetentionRepository } from '../infrastructure/postgres/retention-repository.js';
import { createPartnershipLifecycleService } from '../application/partnership-lifecycle-service.js';
import { createPostgresPartnershipRepository } from '../infrastructure/postgres/partnership-repository.js';
import { createPaymentProviderRegistry } from '../ports/payment-provider.js';
import { createPaymentPolicy, minimumPharmacyCheckoutCentavos } from '../domain/payments/policy.js';
import { createHttpApp } from '../http/app.ts';
import { runWithDatabaseActor } from '../infrastructure/postgres/context.js';
import { hashPassword } from '../../passwords.js';
import { sendEmail, verificationRecipient, verificationDeliveryUnavailable } from '../../email.js';

dotenv.config();
const env = parseBackendEnvironment(process.env);
const { pool } = createPostgresDatabase({ ...env.database, database: env.database.name });

function mailConfigured() {
  return Boolean(env.mail.brevoApiKey?.trim() && env.mail.from);
}

async function sendVerificationEmail(email: string, code: string) {
  const recipient = verificationRecipient(email, { NODE_ENV: env.nodeEnv, DEV_OTP_INBOX: process.env.DEV_OTP_INBOX });
  if (!mailConfigured()) {
    return verificationDeliveryUnavailable(env.nodeEnv, code, process.env.DEV_ECHO_OTP === 'true');
  }
  const sent = await sendEmail(
    recipient,
    'Your NearPill verification code',
    `Your NearPill verification code is ${code}. It expires in 10 minutes.`,
  );
  return { devMode: false, sent, testInbox: recipient !== email };
}

async function sendExistingAccountNotice(email: string) {
  const recipient = verificationRecipient(email, { NODE_ENV: env.nodeEnv, DEV_OTP_INBOX: process.env.DEV_OTP_INBOX });
  if (!mailConfigured()) return;
  await sendEmail(
    recipient,
    'Someone tried to sign up with your NearPill email',
    'Someone tried to create a NearPill account with this email address, but an account already exists. If this was you, log in or use "Forgot password" instead. If it was not you, you can ignore this message.',
  );
}

async function verifyDatabase() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    const result = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`,
      ['public'],
    );
    const tableNames = result.rows.map((row: any) => row.table_name);
    const requiredTables = [
      'users', 'drugstores', 'pharmacy_memberships', 'auth_session_families', 'auth_sessions',
      'email_verification_challenges', 'password_reset_challenges', 'auth_rate_limit_events',
      'auth_account_security', 'medicines', 'inventory', 'orders', 'order_drugstores', 'order_items',
      'payments', 'payment_events', 'refunds', 'payment_reconciliation', 'subscriptions',
      'subscription_entitlements', 'billing_events', 'reservations', 'stock_movements', 'audit_logs',
    ];
    const missing = requiredTables.filter((table) => !tableNames.includes(table));
    if (missing.length) throw new Error(`Missing required database tables: ${missing.join(', ')}`);
    const vector = await client.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    if (!vector.rows[0]) throw new Error('Required pgvector extension is not installed.');
  } finally {
    client.release();
  }
}

const identityRepository = createPostgresIdentityRepository(pool);
const securityRepository = createPostgresSecurityRepository(pool);
const auth = createAuthService({ repository: securityRepository, production: useSecureCookies(env.nodeEnv, process.env.PUBLIC_APP_URL) });
const loginSecurity = createDurableLoginSecurity({ repository: securityRepository, namespace: 'login' });
const recoverySecurity = createDurableLoginSecurity({ repository: securityRepository, namespace: 'recovery' });
const recovery = createPasswordRecoveryService({
  repository: identityRepository,
  securityRepository,
  security: loginSecurity,
  sendEmail,
  publicUrl: env.publicAppUrl,
});
const identity = createIdentityService({ repository: identityRepository, securityRepository, auth, hashPassword, sendVerificationEmail, sendExistingAccountNotice, signupLimits: securityRepository });
const login = createLoginService({ repository: identityRepository, auth, security: loginSecurity, recovery });
const memberships = createMembershipService({ repository: securityRepository, hashPassword, sendSetupEmail: (user: { id: number; email: string }) => recovery.invite(user) });
const catalog = createCatalogService({
  repository: createPostgresCatalogRepository(pool), routePlanner: createGoogleRoutePlanner(env.routesApiKey),
  stagingTestLabels: env.nodeEnv !== 'production' && isNearPillStagingDatabase(env.database.host, env.database.user),
});
const inventoryRepository = createPostgresInventoryRepository(pool);
const inventory = createInventoryService({ repository: inventoryRepository });
const stockSubmissions = createStockSubmissionService({ repository: inventoryRepository });
const prescriptions = env.nodeEnv !== 'production' && isNearPillStagingDatabase(env.database.host, env.database.user)
  ? createPrescriptionReviews(pool) : undefined;
const xenditTestCheckout = Boolean(env.payment.xenditTest);
const orders = createOrderService({
  repository: createPostgresOrderRepository(pool),
  reservationTtlMs: (xenditTestCheckout ? Math.min(30, env.orderReservationTtlMinutes) : env.orderReservationTtlMinutes) * 60 * 1000,
  checkoutAvailable: xenditTestCheckout,
  testCheckout: xenditTestCheckout,
});
const paymentProviderRegistry = createPaymentProviderRegistry(env.payment.xenditTest
  ? [createXenditTestProvider({ ...env.payment.xenditTest, publicAppUrl: env.publicAppUrl })]
  : []);
const paymentPolicy = createPaymentPolicy({
  mode: env.payment.policyMode,
  version: env.payment.policyVersion,
  depositBasisPoints: env.payment.depositBasisPoints ?? null,
  minimumDepositCentavos: xenditTestCheckout ? minimumPharmacyCheckoutCentavos : 0,
  refundsEnabled: env.payment.refundsEnabled,
});
const payments = createPaymentSubscriptionService({
  repository: createPostgresPaymentSubscriptionRepository(pool),
  identityRepository,
  securityRepository,
  providerRegistry: paymentProviderRegistry,
  paymentPolicy,
});
const assistant = createAssistantService({
  apiKey: env.assistant.geminiApiKey, model: env.assistant.model, orders, catalog,
});
const reports = createReportService({ repository: createPostgresReportRepository(pool) });
const retention = createRetentionService({ repository: createPostgresRetentionRepository(pool) });
const partnerships = createPartnershipLifecycleService({
  repository: createPostgresPartnershipRepository(pool),
  listMembers: (drugstoreId: number) => securityRepository.listDrugstoreMemberships(drugstoreId),
  // sendEmail answers false when Brevo refuses; throwing keeps that reminder unrecorded so the next run retries it.
  sendEmail: async (to: string, subject: string, text: string) => {
    if (!(await sendEmail(to, subject, text))) throw new Error('Reminder email could not be sent.');
  },
});

const services = Object.freeze({
  auth, loginSecurity, recoverySecurity, recovery, identity, login, memberships,
  catalog, inventory, stockSubmissions, orders, payments, reports, assistant, prescriptions, xenditTestCheckout,
  prescriptionReviewEnabled: Boolean(prescriptions),
  xenditTestDeposit: xenditTestCheckout && env.payment.policyMode === 'deposit_or_full',
});
const { app } = createHttpApp({ services, pool, databaseName: env.database.name, corsOrigins: env.corsOrigins, trustedProxyIps: env.trustedProxyIps });

await verifyDatabase();
await runWithDatabaseActor({ role: 'system' }, () => orders.expireOldOrders());
async function expirePrescriptionPhotos() {
  try {
    await runWithDatabaseActor({ role: 'system' }, () => prescriptions?.expire());
  } catch (error: any) {
    console.error('prescription_expiry_failed', { code: error?.code });
  }
}
if (prescriptions) await expirePrescriptionPhotos();
const prescriptionTimer = prescriptions ? setInterval(() => {
  void expirePrescriptionPhotos();
}, 60_000) : undefined;
prescriptionTimer?.unref();
async function purgeOldLogs() {
  try {
    const result = await runWithDatabaseActor({ role: 'system' }, () => retention.run());
    console.log('log_retention_done', { cutoff: result.cutoff, ...result.counts });
  } catch (error: any) {
    console.error('log_retention_failed', { code: error?.code });
  }
}
await purgeOldLogs();
const retentionTimer = setInterval(() => { void purgeOldLogs(); }, 24 * 60 * 60 * 1000);
retentionTimer.unref();
// Partnership reminders (7, 3 and 1 day before expiry) and hiding expired pharmacies. Safe to repeat: each reminder is sent once.
async function runPartnershipLifecycle() {
  try {
    const result = await runWithDatabaseActor({ role: 'system' }, () => partnerships.run());
    console.log('partnership_lifecycle_done', result);
  } catch (error: any) {
    console.error('partnership_lifecycle_failed', { code: error?.code });
  }
}
void runPartnershipLifecycle();
const partnershipTimer = setInterval(() => { void runPartnershipLifecycle(); }, 6 * 60 * 60 * 1000);
partnershipTimer.unref();
let paymentCursor = 0;
let expiryRunning = false;
const expirationTimer = setInterval(
  () => {
    if (expiryRunning) return;
    expiryRunning = true;
    void runWithDatabaseActor({ role: 'system' }, async () => {
      await orders.expireOldOrders();
      if (xenditTestCheckout) paymentCursor = await payments.refreshDueTestPayments(paymentCursor);
    }).catch((error: any) => console.error('scheduled_order_expiration_failed', { code: error?.code }))
      .finally(() => { expiryRunning = false; });
  },
  xenditTestCheckout ? 60_000 : 60 * 60 * 1000,
);
expirationTimer.unref();

const server = serve({ fetch: app.fetch, port: env.port, hostname: env.host }, (info) => {
  console.log(`NearPill Hono API listening on http://localhost:${info.port}`);
  console.log(`OpenAPI contract: http://localhost:${info.port}/api/v1/openapi.json`);
});

async function shutdown(signal: string) {
  console.log(`${signal} received. Shutting down server...`);
  clearInterval(expirationTimer);
  clearInterval(retentionTimer);
  clearInterval(partnershipTimer);
  clearInterval(prescriptionTimer);
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  recovery.close();
  await pool.end();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    shutdown(signal).then(() => process.exit(0)).catch((error: any) => {
      console.error('shutdown_error', { code: error?.code });
      process.exit(1);
    });
  });
}
