import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routeSource = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');
const serviceSource = await readFile(new URL('../src/application/payment-subscription-service.js', import.meta.url), 'utf8');
const repositorySource = await readFile(new URL('../src/infrastructure/postgres/payment-subscription-repository.js', import.meta.url), 'utf8');
const migrationSource = await readFile(new URL('../migrations/postgres/0007_payment_reconciliation.sql', import.meta.url), 'utf8');
const statusConstraintMigration = await readFile(new URL('../migrations/postgres/0020_payment_status_constraint.sql', import.meta.url), 'utf8');

test('the legacy payment status constraint is removed while the provider status constraint stays in force', () => {
  assert.match(migrationSource, /ADD CONSTRAINT payments_status_check CHECK \(payment_status IN \([\s\S]*?'confirmed'/);
  assert.match(statusConstraintMigration, /DROP CONSTRAINT IF EXISTS payments_payment_status_check;/);
  assert.doesNotMatch(statusConstraintMigration, /DROP CONSTRAINT IF EXISTS payments_status_check\b/);
});
const appSource = await readFile(new URL('../src/http/app.ts', import.meta.url), 'utf8');

const sqlShape = /\b(?:SELECT\s+[a-z0-9_*.,`]|INSERT\s+INTO\s+[a-z0-9_`]|UPDATE\s+(?:subscriptions|payments|payment_events|refunds)\s+SET|DELETE\s+FROM\s+[a-z0-9_`])/i;

test('payment HTTP transport is SQL-free and direct admin payment truth editing is removed', () => {
  assert.doesNotMatch(routeSource, sqlShape);
  assert.doesNotMatch(routeSource, /adminUpdateOrderPayment|PaymentUpdateSchema|\/admin\/orders\/:id\/payment/);
  assert.match(routeSource, /createPaymentIntent/);
  assert.match(routeSource, /paymentProviderWebhook/);
  assert.match(routeSource, /adminRequestRefund/);
  assert.match(routeSource, /adminReconcilePayment/);
});

test('webhook transport preserves raw request body for signature verification', () => {
  assert.match(appSource, /bodyLimit\(/);
  assert.match(appSource, /readWebhookBodyWithinLimit\(c\.req\.raw, maxSize\)/);
  assert.match(appSource, /c\.set\('rawWebhookBody', bounded\.rawBody\)/);
  assert.doesNotMatch(appSource, /raw\.clone\(\)\.text\(\)/);
  assert.match(routeSource, /rawWebhookBody/);
  assert.match(routeSource, /c\.req\.raw\.headers/);
});

test('payment application requires provider evidence and does not locally assert refunded', () => {
  assert.match(serviceSource, /provider\.verifyWebhook/);
  assert.match(serviceSource, /reconciliation_required/);
  assert.match(serviceSource, /refund_pending/);
  assert.doesNotMatch(serviceSource, /paymentStatus:\s*'refunded'/);
});

test('PostgreSQL payment adapter owns provider events, reconciliation, refund and entitlement persistence', () => {
  assert.match(repositorySource, /payment_events/);
  assert.match(repositorySource, /payment_issues/);
  assert.match(repositorySource, /INSERT INTO refunds/);
  assert.match(repositorySource, /plan_features/);
  assert.match(repositorySource, /ON CONFLICT \(provider, event_id\) DO NOTHING/);
  assert.match(repositorySource, /const pool = createPostgresCompatPool\(postgresPool\);/);
  assert.match(repositorySource, /const mutationPool = createPostgresCompatPool\(postgresPool, \{ capability: 'payment_mutation' \}\);/);
  assert.match(repositorySource, /const connection = await mutationPool\.getConnection\(\)/);
});

test('payment migration deduplicates provider events and quarantines legacy local paid/refunded claims', () => {
  assert.match(migrationSource, /UNIQUE\(provider, event_id\)/);
  assert.match(migrationSource, /payment_status = 'reconciliation_required'/);
  assert.match(migrationSource, /payment_status IN \('paid','refunded'\)/);
  assert.match(migrationSource, /refund_pending|CREATE TABLE IF NOT EXISTS refunds/);
  assert.match(migrationSource, /subscription_entitlements/); // migration 0007 predates the 0053 rename
  assert.match(migrationSource, /orders_payment_mutation_update/);
  assert.match(migrationSource, /reservations_payment_mutation_update/);
  assert.match(migrationSource, /stock_movements_payment_mutation_insert/);
  assert.match(migrationSource, /current_actor_id\(\) IS NULL/);
});
