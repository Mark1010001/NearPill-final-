import {
  bigint,
  boolean,
  bigserial,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 32 }),
  birthdate: varchar('birthdate', { length: 32 }),
  password: varchar('password', { length: 255 }).notNull(),
  role: varchar('role', { length: 32 }).notNull().default('customer'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex('users_email_unique').on(table.email)]);

export const pharmacies = pgTable('pharmacies', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 150 }).notNull(),
  address: varchar('address', { length: 255 }).notNull(),
  latitude: numeric('latitude', { precision: 10, scale: 8 }).notNull(),
  longitude: numeric('longitude', { precision: 11, scale: 8 }).notNull(),
  operatingHours: varchar('operating_hours', { length: 255 }),
  isActive: smallint('is_active').notNull().default(1),
  verificationStatus: varchar('verification_status', { length: 16 }).notNull().default('pending'),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  publicProfilePublishedAt: timestamp('public_profile_published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('drugstores_publication_idx').on(table.verificationStatus, table.publicProfilePublishedAt, table.isActive),
]);

export const pharmacyMemberships = pgTable('pharmacy_memberships', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  membershipRole: varchar('membership_role', { length: 32 }).notNull().default('staff'),
  isActive: smallint('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('pharmacy_memberships_user_store_unique').on(table.userId, table.pharmacyId),
  index('pharmacy_memberships_drugstore_idx').on(table.pharmacyId),
]);

export const medicines = pgTable('medicines', {
  id: serial('id').primaryKey(),
  brandName: varchar('brand_name', { length: 100 }).notNull(),
  genericName: varchar('generic_name', { length: 100 }),
  dosageForm: varchar('dosage_form', { length: 50 }).notNull().default('Tablet'),
  category: varchar('category', { length: 100 }),
  description: text('description'),
  publicationStatus: varchar('publication_status', { length: 16 }).notNull().default('draft'),
  otcEligible: boolean('otc_eligible').notNull().default(false),
  otcReviewReference: text('otc_review_reference'),
  otcReviewedAt: timestamp('otc_reviewed_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('medicines_publication_idx').on(table.publicationStatus, table.publishedAt)]);

export const pharmacyVerifications = pgTable('pharmacy_verifications', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull(),
  licenseNumber: varchar('license_number', { length: 160 }),
  evidenceReference: text('evidence_reference'),
  notes: text('notes'),
  reviewedBy: integer('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('pharmacy_verifications_store_reviewed_idx').on(table.pharmacyId, table.reviewedAt)]);

export const stock = pgTable('stock', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  medicineId: integer('medicine_id').notNull().references(() => medicines.id, { onDelete: 'cascade' }),
  priceCentavos: bigint('price_centavos', { mode: 'number' }).notNull(),
  sellingUnit: varchar('selling_unit', { length: 48 }),
  packageSize: varchar('package_size', { length: 80 }),
  stockOnHand: integer('stock_on_hand').notNull().default(0),
  reservedQuantity: integer('reserved_quantity').notNull().default(0),
  availability: smallint('availability').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('inventory_store_medicine_unique').on(table.pharmacyId, table.medicineId),
  index('inventory_medicine_idx').on(table.medicineId),
]);

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  reference: varchar('reference', { length: 64 }).notNull(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  totalCentavos: bigint('total_centavos', { mode: 'number' }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  idempotencyFingerprint: varchar('idempotency_fingerprint', { length: 64 }),
  status: varchar('status', { length: 50 }).notNull().default('reserved'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('orders_reference_unique').on(table.reference),
  uniqueIndex('orders_id_user_unique').on(table.id, table.userId),
  uniqueIndex('orders_user_idempotency_unique').on(table.userId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
  index('orders_user_status_created_idx').on(table.userId, table.status, table.createdAt),
]);

export const orderPharmacies = pgTable('order_pharmacies', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  orderId: integer('order_id').notNull(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('reserved'),
  rejectionReason: text('rejection_reason'),
}, (table) => [
  index('order_drugstores_order_idx').on(table.orderId),
  foreignKey({ columns: [table.orderId, table.userId], foreignColumns: [orders.id, orders.userId], name: 'order_drugstores_owner_fk' }).onDelete('cascade'),
  index('order_drugstores_drugstore_idx').on(table.pharmacyId),
]);

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderPharmacyId: integer('order_pharmacy_id').notNull().references(() => orderPharmacies.id, { onDelete: 'cascade' }),
  medicineId: integer('medicine_id').notNull().references(() => medicines.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  unitPriceCentavos: bigint('unit_price_centavos', { mode: 'number' }).notNull(),
  sellingUnit: varchar('selling_unit', { length: 48 }),
}, (table) => [index('order_items_order_drugstore_idx').on(table.orderPharmacyId)]);


export const reservations = pgTable('reservations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  stockId: integer('stock_id').notNull().references(() => stock.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').notNull(),
  status: varchar('status', { length: 16 }).notNull().default('active'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('reservations_order_inventory_unique').on(table.orderId, table.stockId),
  index('reservations_order_status_idx').on(table.orderId, table.status),
]);

export const stockMovements = pgTable('stock_movements', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  stockId: integer('stock_id').notNull().references(() => stock.id, { onDelete: 'cascade' }),
  orderId: integer('order_id').references(() => orders.id, { onDelete: 'set null' }),
  actorId: integer('actor_id').references(() => users.id, { onDelete: 'set null' }),
  movementType: varchar('movement_type', { length: 24 }).notNull(),
  stockChange: integer('stock_change').notNull().default(0),
  heldChange: integer('held_change').notNull().default(0),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('stock_movements_inventory_created_idx').on(table.stockId, table.createdAt)]);

export const auditLogs = pgTable('audit_logs', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: varchar('action', { length: 100 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('audit_logs_created_idx').on(table.createdAt)]);

export const payments = pgTable('payments', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('PHP'),
  provider: varchar('provider', { length: 64 }),
  providerPaymentId: varchar('provider_payment_id', { length: 200 }),
  paymentMethod: varchar('payment_method', { length: 50 }),
  paymentPlan: varchar('payment_plan', { length: 32 }),
  policyVersion: varchar('policy_version', { length: 100 }),
  paymentStatus: varchar('payment_status', { length: 32 }).notNull().default('pending'),
  paymentReference: varchar('payment_reference', { length: 100 }),
  idempotencyKey: varchar('idempotency_key', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('payments_order_created_idx').on(table.orderId, table.createdAt),
  uniqueIndex('payments_provider_external_unique').on(table.provider, table.providerPaymentId)
    .where(sql`${table.provider} IS NOT NULL AND ${table.providerPaymentId} IS NOT NULL`),
  uniqueIndex('payments_order_idempotency_unique').on(table.orderId, table.idempotencyKey)
    .where(sql`${table.idempotencyKey} IS NOT NULL`),
]);

export const paymentEvents = pgTable('payment_events', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  provider: varchar('provider', { length: 64 }).notNull(),
  eventId: varchar('event_id', { length: 200 }).notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  providerPaymentId: varchar('provider_payment_id', { length: 200 }),
  providerRefundId: varchar('provider_refund_id', { length: 200 }),
  amountCentavos: bigint('amount_centavos', { mode: 'number' }),
  currency: varchar('currency', { length: 3 }),
  rawBodyHash: varchar('raw_body_hash', { length: 64 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }),
  processingStatus: varchar('processing_status', { length: 32 }).notNull().default('received'),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('payment_events_provider_event_unique').on(table.provider, table.eventId),
  index('payment_events_payment_idx').on(table.provider, table.providerPaymentId, table.createdAt),
]);

export const refunds = pgTable('refunds', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  paymentId: integer('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  amountCentavos: bigint('amount_centavos', { mode: 'number' }).notNull(),
  provider: varchar('provider', { length: 64 }).notNull(),
  providerRefundId: varchar('provider_refund_id', { length: 200 }).notNull(),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  reason: text('reason').notNull(),
  requestedBy: integer('requested_by').references(() => users.id, { onDelete: 'set null' }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('refunds_provider_external_unique').on(table.provider, table.providerRefundId),
  uniqueIndex('refunds_provider_idempotency_unique').on(table.provider, table.idempotencyKey),
  index('refunds_payment_status_idx').on(table.paymentId, table.status, table.createdAt),
]);

export const paymentIssues = pgTable('payment_issues', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  paymentId: integer('payment_id').references(() => payments.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 64 }).notNull(),
  eventId: varchar('event_id', { length: 200 }),
  reason: varchar('reason', { length: 120 }).notNull(),
  details: text('details'),
  status: varchar('status', { length: 24 }).notNull().default('open'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('payment_reconciliation_open_idx').on(table.status, table.createdAt)]);

export const subscriptions = pgTable('subscriptions', {
  id: serial('id').primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  tier: varchar('tier', { length: 32 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  planVersion: varchar('plan_version', { length: 100 }).notNull().default('legacy-v1'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
}, (table) => [index('subscriptions_store_status_idx').on(table.pharmacyId, table.status)]);

export const planFeatures = pgTable('plan_features', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  pharmacyId: integer('pharmacy_id').notNull().references(() => pharmacies.id, { onDelete: 'cascade' }),
  subscriptionId: integer('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  entitlementKey: varchar('entitlement_key', { length: 100 }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('subscription_entitlements_store_idx').on(table.pharmacyId, table.revokedAt),
  uniqueIndex('subscription_entitlements_active_unique').on(table.pharmacyId, table.entitlementKey)
    .where(sql`${table.revokedAt} IS NULL`),
]);

export const authSessionFamilies = pgTable('auth_session_families', {
  id: varchar('id', { length: 64 }).primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  revokeReason: varchar('revoke_reason', { length: 100 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable('auth_sessions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  familyId: varchar('family_id', { length: 64 }).references(() => authSessionFamilies.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  tokenKind: varchar('token_kind', { length: 16 }).notNull(),
  csrfHash: varchar('csrf_hash', { length: 64 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('auth_sessions_token_hash_unique').on(table.tokenHash),
  index('auth_sessions_user_idx').on(table.userId, table.expiresAt),
  index('auth_sessions_family_idx').on(table.familyId),
]);

export const emailCodes = pgTable('email_codes', {
  email: varchar('email', { length: 254 }).primaryKey(),
  codeHash: varchar('code_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  attemptCount: integer('attempt_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const resetLinks = pgTable('reset_links', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 254 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('password_reset_challenges_token_unique').on(table.tokenHash),
  // Canonical 0004_identity_security.sql allows one unconsumed reset challenge
  // per account; consumed challenges remain available as audit history.
  uniqueIndex('password_reset_active_user_idx').on(table.userId)
    .where(sql`${table.consumedAt} IS NULL`),
]);

export const authRateLimitEvents = pgTable('auth_rate_limit_events', {
  id: serial('id').primaryKey(),
  scope: varchar('scope', { length: 16 }).notNull(),
  keyHash: varchar('key_hash', { length: 64 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index('auth_rate_limit_events_lookup_idx').on(table.scope, table.keyHash, table.occurredAt)]);

export const authAccountSecurity = pgTable('auth_account_security', {
  emailHash: varchar('email_hash', { length: 64 }).primaryKey(),
  failures: integer('failures').notNull().default(0),
  nextAllowedAt: timestamp('next_allowed_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  inFlightUntil: timestamp('in_flight_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
