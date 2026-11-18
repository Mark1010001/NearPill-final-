// Source-level characterization of the older 17 October real-world roadmap
// against the *current* canonical Hono/PostgreSQL codebase. These are not
// substitutes for live app-role RLS, FDA review, or provider integration tests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const get = (path) => readFile(new URL(path, import.meta.url), 'utf8');

const catalog = await get('../src/infrastructure/postgres/catalog-repository.js');
const orderRepository = await get('../src/infrastructure/postgres/order-repository.js');
const orderService = await get('../src/application/order-service.js');
const routes = await get('../src/http/routes/v1/register.ts');
const migration = await get('../migrations/postgres/0005_catalog_discovery.sql');
const webClient = await get('../../web/src/api/client.ts');

test('R04: current public catalog and checkout gate on published medicine status', async () => {
  assert.match(catalog, /listingEligibleForCheckout/);
  assert.match(orderRepository, /findInventoryForUpdate[\s\S]*?\$\{listingEligibleForCheckout\}/);
  const orderability = await get('../src/infrastructure/postgres/catalog-orderability.js');
  assert.match(orderability, /m\.publication_status = 'published' AND m\.otc_eligible/);
  assert.match(migration, /CASE WHEN rx_required = 1 THEN 'retired' ELSE 'draft' END/);
});

test('R04/R06: public pharmacies require verified published profiles', () => {
  assert.match(catalog, /ds\.verification_status\s*=\s*'verified'/);
  assert.match(catalog, /ds\.public_profile_published_at IS NOT NULL/);
  assert.match(orderRepository, /ds\.verification_status\s*=\s*'verified'/);
  assert.match(orderRepository, /ds\.public_profile_published_at IS NOT NULL/);
});

test('R09: one pharmacy per order is checked before starting transaction', () => {
  const onePharmacy = orderService.indexOf('if (drugstoreIds.length !== 1)');
  const transaction = orderService.indexOf('repository.withTransaction(');
  assert.ok(onePharmacy >= 0 && transaction > onePharmacy, 'reject mixed pharmacies before transaction');
  assert.match(orderService, /An order can contain medicines from only one pharmacy/);
  assert.match(orderRepository, /unit_price_centavos/);
});

test('R03/R12: privileged routes use server auth and partner access is actor scoped', () => {
  assert.match(routes, /id: 'adminSetGoLive'[^\n]*auth: 'admin'/);
  assert.match(routes, /id: 'adminGoLiveChecklist'[^\n]*auth: 'admin'/);
  assert.match(routes, /id: 'adminSetGoLive'[^\n]*invoke: async[^\n]*countPartnerAccounts/);
  assert.doesNotMatch(routes, /adminVerifyPharmacy/);
  assert.match(routes, /id: 'adminSetMedicinePublication'[^\n]*auth: 'admin'/);
  assert.match(routes, /id: 'partnerOrders'[^\n]*auth: 'user'[^\n]*services\.orders\.listPartnerOrders\(actor, query\)/);
  assert.match(webClient, /credentials:\s*'same-origin'/);
});


test('Packet 0 latest historical roadmap attribution cannot override the Supabase and OTC release gates', async () => {
  const reconciled = await get('../../docs/real-world-roadmap-reconciliation-2026-10-29.md');
  const master = await get('../../NearPill_Master_In_Place_Whole_Codebase_Refactor_Engineering_Plan_2026-10-17.md');
  const rows = reconciled.split('\n').filter((line) => /^\| R(?:0[1-9]|1[0-5]) \|/.test(line));
  assert.equal(rows.length, 15, 'retain the original R01-R15 requirement traceability');
  assert.match(reconciled, /2026-10-31 attached audit revalidation/);
  assert.match(reconciled, /Historical Express\/MySQL recommendation is not the current target/);
  assert.match(reconciled, /NP-031.*OPEN/);
  assert.match(reconciled, /R04.*OPEN P0/);
  assert.match(reconciled, /Real Supabase app-role RLS.*NOT RUN/);
  assert.match(reconciled, /Regulatory.*approval.*OPEN/);
  assert.match(master, /Supabase-hosted PostgreSQL is the selected database provider/);
});
