import pg from 'pg';
import { assertApprovedFixtureTarget } from './lib/verify-fixture-target.mjs';
import { assertSafeLiveFixtureConnections, reviewedRlsPolicyInventory, POLICY_INVENTORY_PROBE_SQL, assertActualRlsPolicyInventory } from './lib/verify-live-fixture-connection.mjs';
import { assertZeroInvalidRows } from './lib/reconcile-count.mjs';
import { withReadOnlyReconciliationSnapshot, closeReconciliationPools, assertReconciliationPrincipal, assertForcedReconciliationRls } from './lib/read-only-reconciliation-snapshot.mjs';
import { assertVectorExtensionReadiness, vectorRequirementFromEnvironment } from './lib/reconciliation-extension-readiness.mjs';

const { Pool } = pg;
// Reconciliation reads protected tenant data. Using the ordinary app role
// without trusted actor context may yield zero rows under RLS, producing a
// false integrity PASS. Validate the target BEFORE connecting, then require
// the separate reviewed migrator role and its live privilege/migration probe.
// This operation is read-only, but intentionally reuses the more restrictive
// fixture-verification operator approval boundary (including confirmation).
assertApprovedFixtureTarget(process.env);

const connection = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  // SET LOCAL statement/lock/idle timeouts apply only after connection and
  // BEGIN. Bound network connection establishment and queued pool acquisition
  // separately, for BOTH the application preflight and direct migrator pool.
  connectionTimeoutMillis: 10_000,
};
const appPool = new Pool({
  ...connection,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
const migratorPool = new Pool({
  ...connection,
  host: process.env.MIGRATOR_DB_HOST || process.env.DB_HOST,
  port: Number(process.env.MIGRATOR_DB_PORT || process.env.DB_PORT),
  user: process.env.MIGRATOR_DB_USER,
  password: process.env.MIGRATOR_DB_PASSWORD,
});

const checks = [
  ['invalid inventory invariant', `SELECT COUNT(*)::int AS count FROM stock WHERE stock_on_hand < 0 OR reserved_quantity < 0 OR reserved_quantity > stock_on_hand`],
  ['invalid availability', `SELECT COUNT(*)::int AS count FROM stock WHERE availability NOT IN (0,1)`],
  // Both columns are individually valid foreign keys, but the reviewed
  // schema does not enforce that a bearer session's user is the user owning
  // its refresh family. The canonical issue/rotation path writes matching
  // IDs. Detect active mismatches (and missing families) before claiming a
  // secure staging snapshot; do not revoke/change credentials in an audit.
  ['active bearer sessions without an owned refresh family', `SELECT COUNT(*)::int AS count
    FROM auth_sessions s
    LEFT JOIN auth_session_families f ON f.id = s.family_id
    WHERE s.token_kind IN ('access','refresh')
      AND s.revoked_at IS NULL
      AND s.consumed_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP
      AND (s.family_id IS NULL OR s.user_id IS DISTINCT FROM f.user_id)`],
  // Refresh rotation locks the family and consumes the previous credential
  // before inserting its successor. Independent token-hash uniqueness cannot
  // prevent two distinct unconsumed refresh credentials in one family after
  // an unreviewed writer or interrupted migration. Detect forks in the
  // active/redeemable state only; expired, consumed and revoked tokens are
  // historical and independent web sessions do not belong to a token family.
  ['refresh-token families with multiple redeemable refresh sessions', `SELECT COUNT(*)::int AS count
    FROM (
      SELECT s.family_id
      FROM auth_sessions s
      JOIN auth_session_families f ON f.id = s.family_id
      WHERE s.token_kind = 'refresh'
        AND s.family_id IS NOT NULL
        AND s.consumed_at IS NULL
        AND s.revoked_at IS NULL
        AND s.expires_at > CURRENT_TIMESTAMP
        AND f.revoked_at IS NULL
      GROUP BY s.family_id
      HAVING COUNT(*) > 1
    ) duplicate_families`],
  // Canonical session revocation marks both the family and its member
  // credentials revoked. Independent columns cannot enforce this invariant.
  // Detect a live bearer credential stranded under an already revoked family;
  // do not mutate tokens or reinterpret standalone web sessions in an audit.
  ['revoked token families retain active bearer sessions', `SELECT COUNT(*)::int AS count
    FROM auth_sessions s
    JOIN auth_session_families f ON f.id = s.family_id
    WHERE f.revoked_at IS NOT NULL
      AND s.token_kind IN ('access','refresh')
      AND s.revoked_at IS NULL
      AND s.consumed_at IS NULL
      AND s.expires_at > CURRENT_TIMESTAMP`],
  // The reset table links to a user by ID but stores its own email text.
  // Its consuming use case updates users.password by user_id. A mismatched
  // live challenge must fail verification rather than silently trusting that
  // independently persisted email as the account identity. Compare canonical
  // case-insensitive, trimmed addresses; consumed/expired challenges are
  // historical and cannot be redeemed. Never mutate tokens during an audit.
  ['active password reset challenges with mismatched account email', `SELECT COUNT(*)::int AS count
    FROM reset_links c
    JOIN users u ON u.id = c.user_id
    WHERE c.consumed_at IS NULL
      AND c.expires_at > CURRENT_TIMESTAMP
      AND lower(btrim(c.email)) IS DISTINCT FROM lower(btrim(u.email))`],
  // Verification challenges are deleted after the fifth invalid attempt.
  // The schema only enforces nonnegative attempts, so a still-unverified,
  // unexpired challenge at or above the limit indicates inconsistent or
  // unreviewed security state. Do not mutate the challenge during an audit.
  ['active unverified email challenges beyond attempt limit', `SELECT COUNT(*)::int AS count
    FROM email_codes
    WHERE verified_at IS NULL
      AND expires_at > CURRENT_TIMESTAMP
      AND attempt_count >= 5`],
  ['orphan order drugstores', `SELECT COUNT(*)::int AS count FROM order_pharmacies od LEFT JOIN orders o ON o.id=od.order_id WHERE o.id IS NULL`],
  ['orphan order items', `SELECT COUNT(*)::int AS count FROM order_items oi LEFT JOIN order_pharmacies od ON od.id=oi.order_pharmacy_id WHERE od.id IS NULL`],
  ['orphan payments', `SELECT COUNT(*)::int AS count FROM payments p LEFT JOIN orders o ON o.id=p.order_id WHERE o.id IS NULL`],
  ['duplicate inventory', `SELECT COUNT(*)::int AS count FROM (SELECT pharmacy_id, medicine_id FROM stock GROUP BY 1,2 HAVING COUNT(*) > 1) d`],
  ['negative centavos', `SELECT COUNT(*)::int AS count FROM (SELECT price_centavos AS amount FROM stock UNION ALL SELECT total_centavos FROM orders UNION ALL SELECT unit_price_centavos FROM order_items UNION ALL SELECT amount_centavos FROM payments) m WHERE amount < 0`],
  // Reconcile the payment ledger as well as order prices: the reviewed SQL
  // constrains refunds to positive amounts, while payment-event amounts are
  // optional but never negative. These SELECT-only checks detect invalid
  // existing data (for example after an unauthorized constraint change), not
  // merely catalog presence. Confirmed refunds must have the timestamp set
  // by the canonical provider-event handling path.
  // Order totals are immutable centavo snapshots assembled from the submitted
  // quantity and the verified catalog price at checkout. Constraints on
  // individual nonnegative prices cannot detect an altered persisted total,
  // dropped line, or duplicate pharmacy association. Use exact numeric math
  // rather than JavaScript floating-point or current mutable catalog prices.
  ['orders with inconsistent immutable line totals', `SELECT COUNT(*)::int AS count
    FROM orders o
    LEFT JOIN (
      SELECT od.order_id,
             SUM(oi.quantity::numeric * oi.unit_price_centavos::numeric) AS lines_centavos
      FROM order_pharmacies od
      JOIN order_items oi ON oi.order_pharmacy_id = od.id
      GROUP BY od.order_id
    ) items ON items.order_id = o.id
    WHERE o.total_centavos::numeric <> COALESCE(items.lines_centavos, 0)`],
  ['orders without exactly one pharmacy and at least one item', `SELECT COUNT(*)::int AS count
    FROM orders o
    LEFT JOIN (
      SELECT od.order_id, COUNT(DISTINCT od.id) AS pharmacy_rows, COUNT(oi.id) AS item_rows
      FROM order_pharmacies od
      LEFT JOIN order_items oi ON oi.order_pharmacy_id = od.id
      GROUP BY od.order_id
    ) contents ON contents.order_id = o.id
    WHERE COALESCE(contents.pharmacy_rows, 0) <> 1
       OR COALESCE(contents.item_rows, 0) = 0`],
  // The server-owned payment policy quotes full payments from the frozen
  // order total; if a deposit plan was approved its amount may be smaller,
  // but never larger than that total. Check the persisted plan separately:
  // do not silently impose an unapproved 50% policy or mistake legacy rows
  // with no payment_plan for a reviewed provider-backed quote. Exact numeric
  // arithmetic avoids floating-point comparison in centavos.
  ['full payment amounts differ from authoritative order totals', `SELECT COUNT(*)::int AS count
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.payment_plan = 'full'
      AND p.amount_centavos::numeric <> o.total_centavos::numeric`],
  ['deposit payments exceed authoritative order totals', `SELECT COUNT(*)::int AS count
    FROM payments p JOIN orders o ON o.id = p.order_id
    WHERE p.payment_plan = 'deposit'
      AND p.amount_centavos::numeric > o.total_centavos::numeric`],
  ['invalid refund amounts', `SELECT COUNT(*)::int AS count FROM refunds WHERE amount_centavos IS NULL OR amount_centavos <= 0`],
  ['negative provider event amounts', `SELECT COUNT(*)::int AS count FROM payment_events WHERE amount_centavos < 0`],
  ['confirmed refunds without evidence timestamp', `SELECT COUNT(*)::int AS count FROM refunds WHERE status = 'confirmed' AND confirmed_at IS NULL`],
  // Refund provider identity must match the provider that created the
  // originating payment. The existing refund use case uses locked.provider;
  // independent foreign keys and per-row CHECKs do not enforce this linkage.
  ['refund provider differs from payment provider', `SELECT COUNT(*)::int AS count
    FROM refunds r
    JOIN payments p ON p.id = r.payment_id
    WHERE r.provider IS DISTINCT FROM p.provider`],
  // Successful partial refunds can be valid pending owner/provider review,
  // but the cumulative CONFIRMED money returned must never exceed the
  // originating payment. Aggregate with exact PostgreSQL numeric arithmetic;
  // ignore pending/failed requests, which do not represent returned money.
  ['confirmed refunds exceed the originating payment amount', `SELECT COUNT(*)::int AS count
    FROM (
      SELECT r.payment_id, SUM(r.amount_centavos::numeric) AS confirmed_centavos
      FROM refunds r
      WHERE r.status = 'confirmed'
      GROUP BY r.payment_id
    ) confirmed
    JOIN payments p ON p.id = confirmed.payment_id
    WHERE confirmed.confirmed_centavos > p.amount_centavos::numeric`],
  // The signed provider webhook adapter resolves the originating payment
  // and the provider refund identifier independently. Those identifiers must
  // describe the SAME persisted payment. Otherwise a processed refund event
  // could attest a refund belonging to a different payment. Failed and
  // confirmed events are both included; merely received/quarantined events
  // are not claimed as successfully processed and remain separate gates.
  // An optional refund event amount (when provided) attests the refund, not
  // the original payment; its optional currency must match that payment.
  // Missing metadata is not fabricated, but a contradictory provided value
  // prevents a read-only audit PASS. This does not repair the runtime handler.
  // A processed payment webhook is evidence only when its external payment ID
  // resolves to the same provider payment and (when supplied) exact amount and
  // currency. The reviewed event schema deliberately permits omitted values,
  // but their absence cannot excuse a missing/mismatched payment identity.
  // This read-only snapshot check detects historical inconsistencies; the
  // signed-webhook handler remains the preventive authorization boundary.
  ['processed payment events without matching provider payment amount or currency', `SELECT COUNT(*)::int AS count
    FROM payment_events e
    WHERE e.processing_status = 'processed'
      AND e.event_type IN ('payment.confirmed','payment.failed')
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        WHERE p.provider = e.provider
          AND p.provider_payment_id = e.provider_payment_id
          AND (e.amount_centavos IS NULL OR e.amount_centavos::numeric = p.amount_centavos::numeric)
          AND (e.currency IS NULL OR e.currency = p.currency)
      )`],
  ['processed refund events without matching payment refund ownership', `SELECT COUNT(*)::int AS count
    FROM payment_events e
    WHERE e.processing_status = 'processed'
      AND e.event_type IN ('refund.confirmed','refund.failed')
      AND NOT EXISTS (
        SELECT 1 FROM payments p
        JOIN refunds r ON r.payment_id = p.id
        WHERE p.provider = e.provider
          AND p.provider_payment_id = e.provider_payment_id
          AND r.provider = e.provider
          AND r.provider_refund_id = e.provider_refund_id
          AND (e.amount_centavos IS NULL OR e.amount_centavos::numeric = r.amount_centavos::numeric)
          AND (e.currency IS NULL OR e.currency = p.currency)
      )`],
  ['invalid reservations', `SELECT COUNT(*)::int AS count FROM reservations WHERE quantity <= 0 OR status NOT IN ('active','released','fulfilled')`],
  // A valid per-row stock CHECK does not prove that held stock equals the
  // committed reservation ledger. These whole-table, snapshot-consistent
  // counts catch missed releases, double reservation writes and terminal
  // orders retaining stock holds; they never repair data automatically.
  ['reserved stock does not match active reservation ledger', `SELECT COUNT(*)::int AS count
    FROM stock i
    LEFT JOIN (SELECT stock_id, SUM(quantity) AS held_quantity
               FROM reservations WHERE status = 'active' GROUP BY stock_id) active
      ON active.stock_id = i.id
    WHERE i.reserved_quantity <> COALESCE(active.held_quantity, 0)`],
  ['terminal orders with active reservations', `SELECT COUNT(*)::int AS count
    FROM reservations r JOIN orders o ON o.id = r.order_id
    WHERE r.status = 'active' AND o.status IN ('cancelled','expired','completed')`],
  ['reservation lifecycle missing timestamps', `SELECT COUNT(*)::int AS count
    FROM reservations
    WHERE (status = 'released' AND released_at IS NULL)
       OR (status = 'fulfilled' AND fulfilled_at IS NULL)`],
  // The reservation row, stock hold and journal are three independent
  // records of one transactional transition. Check the journal's per-event
  // counts AND signed deltas: aggregate stock correctness alone can conceal
  // missing, duplicated, or inverted reserve/release/fulfillment movements.
  // The canonical order/payment repositories write exactly one 'reserve' and
  // at most one matching 'release' OR 'fulfill' per reservation.
  ['reservation stock movements differ from lifecycle ledger', `SELECT COUNT(*)::int AS count
    FROM reservations r
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE movement_type = 'reserve') AS reserve_events,
        COUNT(*) FILTER (WHERE movement_type = 'release') AS release_events,
        COUNT(*) FILTER (WHERE movement_type = 'fulfill') AS fulfill_events,
        COALESCE(SUM(held_change) FILTER (WHERE movement_type = 'reserve'), 0) AS reserve_delta,
        COALESCE(SUM(stock_change) FILTER (WHERE movement_type = 'reserve'), 0) AS reserve_stock_delta,
        COALESCE(SUM(held_change) FILTER (WHERE movement_type = 'release'), 0) AS release_delta,
        COALESCE(SUM(stock_change) FILTER (WHERE movement_type = 'release'), 0) AS release_stock_delta,
        COALESCE(SUM(held_change) FILTER (WHERE movement_type = 'fulfill'), 0) AS fulfill_delta,
        COALESCE(SUM(stock_change) FILTER (WHERE movement_type = 'fulfill'), 0) AS fulfill_stock_delta
      FROM stock_movements sm
      WHERE sm.order_id = r.order_id
        AND sm.stock_id = r.stock_id
        AND sm.movement_type IN ('reserve','release','fulfill')
    ) movements ON TRUE
    WHERE movements.reserve_events <> 1
       OR movements.reserve_delta <> r.quantity
       OR movements.reserve_stock_delta <> 0
       OR movements.release_events <> CASE WHEN r.status = 'released' THEN 1 ELSE 0 END
       OR movements.release_delta <> CASE WHEN r.status = 'released' THEN -r.quantity ELSE 0 END
       OR movements.release_stock_delta <> 0
       OR movements.fulfill_events <> CASE WHEN r.status = 'fulfilled' THEN 1 ELSE 0 END
       OR movements.fulfill_delta <> CASE WHEN r.status = 'fulfilled' THEN -r.quantity ELSE 0 END
       OR movements.fulfill_stock_delta <> CASE WHEN r.status = 'fulfilled' THEN -r.quantity ELSE 0 END`],
  // The reservation-rooted journal check above cannot see EXTRA movement
  // records lacking any reservation. For still-referenced orders, each
  // reserve/release/fulfill movement must belong to an existing reservation
  // for the same order and inventory. The reviewed schema intentionally uses
  // ON DELETE SET NULL for movement.order_id: retain historical movements
  // after an order is deleted without interpreting those rows as corruption.
  ['reservation movements without a matching live order reservation', `SELECT COUNT(*)::int AS count
    FROM stock_movements sm
    WHERE sm.movement_type IN ('reserve','release','fulfill')
      AND sm.order_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM reservations r
        WHERE r.order_id = sm.order_id
          AND r.stock_id = sm.stock_id
      )`],
  // A reservation's independent order_id and inventory_id foreign keys do
  // not prove it came from the ordered pharmacy and medicine. Reconcile each
  // historical/current reservation with EXACTLY ONE immutable order line from
  // the same pharmacy, medicine and quantity. This is a read-only detection
  // gate, not a retroactive change to business behavior or migration history.
  ['reservations without exactly one matching pharmacy medicine order line', `SELECT COUNT(*)::int AS count
    FROM reservations r
    JOIN stock i ON i.id = r.stock_id
    WHERE (
      SELECT COUNT(*)
      FROM order_pharmacies od
      JOIN order_items oi ON oi.order_pharmacy_id = od.id
      WHERE od.order_id = r.order_id
        AND od.pharmacy_id = i.pharmacy_id
        AND oi.medicine_id = i.medicine_id
        AND oi.quantity = r.quantity
    ) <> 1`],
  ['provider-confirmed payments without evidence', `SELECT COUNT(*)::int AS count FROM payments WHERE payment_status IN ('confirmed','refund_pending','refunded') AND (provider IS NULL OR provider_payment_id IS NULL OR provider = 'legacy-local')`],
  ['duplicate provider events', `SELECT COUNT(*)::int AS count FROM (SELECT provider, event_id FROM payment_events GROUP BY 1,2 HAVING COUNT(*) > 1) d`],
  ['unresolved payment reconciliation', `SELECT COUNT(*)::int AS count FROM payments WHERE payment_status = 'reconciliation_required'`],
  // A payment can leave its primary row in a non-reconciliation status while
  // the provider event or separate operator reconciliation case remains open.
  // Treat all three ledgers as independent integrity gates. 'received' events
  // are intentionally not counted because processing may still be in flight.
  ['unresolved payment reconciliation cases', `SELECT COUNT(*)::int AS count FROM payment_issues WHERE status = 'open'`],
  // Reconciliation incidents can exist before a provider payment is resolved,
  // so payment_id is intentionally nullable. Once linked, however, the case
  // must identify the same payment provider as the referenced payment; the
  // independent FK alone does not establish this cross-record ownership.
  // Include both open and resolved cases so historical misattribution cannot
  // be hidden by closing an incident. Read-only detection, not webhook repair.
  ['payment reconciliation incidents linked to a different provider', `SELECT COUNT(*)::int AS count
    FROM payment_issues pr
    JOIN payments p ON p.id = pr.payment_id
    WHERE pr.provider IS DISTINCT FROM p.provider`],
  // A reconciliation case may be created without an event (for a manual
  // provider snapshot), but when event_id is recorded, the canonical signed
  // webhook path has already inserted that provider event in the same DB
  // transaction. event_id alone is not globally unique: require BOTH the
  // incident provider and the event ID to resolve to the persisted event.
  // Open and resolved cases are both audited. This is read-only detection,
  // never an authorization or webhook-ownership repair.
  ['reconciliation incidents with unknown or cross-provider event IDs', `SELECT COUNT(*)::int AS count
    FROM payment_issues pr
    WHERE pr.event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM payment_events e
        WHERE e.provider = pr.provider
          AND e.event_id = pr.event_id
      )`],
  // Incident->event provenance alone does not establish payment ownership:
  // two valid payment IDs under the same provider can be mismatched even if
  // (provider, event_id) exists and incident.provider matches payment.provider.
  // For incidents explicitly linked to BOTH records, the event must identify
  // the same external payment as the linked payment row. Keep manual incidents
  // with nullable payment_id or event_id valid, as the reviewed schema permits.
  // This detects persisted misattribution; it does not fix the webhook handler.
  ['reconciliation incident events attributed to another payment', `SELECT COUNT(*)::int AS count
    FROM payment_issues pr
    JOIN payments p ON p.id = pr.payment_id
    WHERE pr.event_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM payment_events e
        WHERE e.provider = pr.provider
          AND e.event_id = pr.event_id
          AND e.provider_payment_id IS NOT NULL
          AND e.provider_payment_id = p.provider_payment_id
      )`],
  ['provider events requiring reconciliation', `SELECT COUNT(*)::int AS count FROM payment_events WHERE processing_status = 'reconciliation_required'`],
  ['processed provider events without evidence timestamp', `SELECT COUNT(*)::int AS count FROM payment_events WHERE processing_status = 'processed' AND processed_at IS NULL`],
  // Each entitlement or billing event carries its own pharmacy ID as well
  // as a subscription FK. Independent FKs do not enforce SAME-pharmacy
  // ownership: a cross-pharmacy pair can otherwise grant premium reporting
  // to the wrong pharmacy or misattribute a billing audit event. Query both
  // sides in the same read-only snapshot; leave nullable historic billing
  // subscription references (ON DELETE SET NULL) out of this join.
  ['entitlements linked to another pharmacy subscription', `SELECT COUNT(*)::int AS count
    FROM plan_features e
    JOIN subscriptions s ON s.id = e.subscription_id
    WHERE e.pharmacy_id IS DISTINCT FROM s.pharmacy_id`],
  // An unrevoked entitlement is directly consumed by premium authorization.
  // The reviewed backfill grants it only for active Plus or Pro subscriptions
  // whose end date has not passed, but the grant can become stale if a
  // subscription changes or expires without its entitlement being revoked.
  // Detect this in the same read-only snapshot; do not silently revoke data.
  ['unrevoked premium entitlements from ineligible subscriptions', `SELECT COUNT(*)::int AS count
    FROM plan_features e
    JOIN subscriptions s ON s.id = e.subscription_id
    WHERE e.revoked_at IS NULL
      AND e.entitlement_key = 'reports:view:premium'
      AND (
        s.tier NOT IN ('Plus', 'Pro')
        OR s.status IS DISTINCT FROM 'active'
        OR (s.end_date IS NOT NULL AND s.end_date < CURRENT_DATE)
      )`],
  // The active-grant uniqueness index is per pharmacy/entitlement, but that
  // does NOT mean a grant from another subscription satisfies this particular
  // eligible subscription. Check the exact subscription_id, or a pharmacy
  // with two eligible subscriptions can appear fully covered by one grant.
  ['active premium subscriptions without entitlement', `SELECT COUNT(*)::int AS count
    FROM subscriptions s
    WHERE s.tier IN ('Plus', 'Pro')
      AND s.status = 'active'
      AND (s.end_date IS NULL OR s.end_date >= CURRENT_DATE)
      AND NOT EXISTS (
        SELECT 1 FROM plan_features e
        WHERE e.pharmacy_id = s.pharmacy_id
          AND e.subscription_id = s.id
          AND e.entitlement_key = 'reports:view:premium'
          AND e.revoked_at IS NULL
      )`],
];

let summary;
let verificationError;
try {
  // Both live roles, effective grants, migration hashes and staging TLS must
  // be verified before a single integrity result may be reported. The
  // migrator_all policies in reviewed migrations permit full tenant reads
  // while neither role is a superuser or BYPASSRLS authority.
  await assertSafeLiveFixtureConnections({ appPool, migratorPool, env: process.env });
  // Parse the reviewed policies before opening a long-lived database snapshot.
  // The preflight has checked one pool connection; the snapshot must attest
  // the actual policy catalog again on its own connection before private reads.
  const reviewedPolicies = await reviewedRlsPolicyInventory();
  // All observations must describe one committed view of the database.
  // Do not report individual PASS lines until the read-only transaction has
  // committed successfully; a partial run is never an accepted reconciliation.
  summary = await withReadOnlyReconciliationSnapshot(migratorPool, async (client) => {
    // The pool-level role preflight runs on its own checked-out connection.
    // Attest THIS transaction client before inspecting private tenant data:
    // a pooler, role switch, or disabled row_security must never yield PASS.
    const principal = await client.query(`
      SELECT current_user AS role_name,
             session_user AS session_role_name,
             current_setting('row_security') AS row_security,
             r.rolsuper AS is_superuser,
             r.rolbypassrls AS bypass_rls,
             (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls_active
      FROM pg_roles r WHERE r.rolname = current_user
    `);
    assertReconciliationPrincipal(principal, process.env.MIGRATOR_DB_USER,
      { requireTls: process.env.NEARPILL_VERIFICATION_TARGET === 'staging' });
    // An RLS policy change can widen access even when FORCE RLS flags and role
    // metadata are unchanged. Compare against the SAME source-backed inventory
    // used by the application-role preflight, on THIS reconciliation snapshot.
    // Include users (NP-031) and migrator-only journal: unexpected policies on
    // either exceptional table must not go unnoticed.
    const policyTables = [...new Set([
      ...reviewedPolicies.map((policy) => policy.tablename),
      'users', 'nearpill_schema_migrations',
    ])];
    const currentPolicies = await client.query(POLICY_INVENTORY_PROBE_SQL, [policyTables]);
    assertActualRlsPolicyInventory(currentPolicies?.rows, reviewedPolicies);
    const rls = await client.query(`
      SELECT c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = ANY($1::text[])
      ORDER BY c.relname
    `, [[
      'users','pharmacies','pharmacy_memberships','medicines','stock','orders',
      'order_pharmacies','order_items','payments','subscriptions','audit_logs',
      'auth_session_families','auth_sessions','email_codes',
      'reset_links','auth_rate_limit_events','auth_account_security','pharmacy_verifications','reservations','stock_movements',
      'payment_events','refunds','payment_issues','plan_features',
      'stock_submissions','auth_throttle_events',
    ]]);
    // Revalidate the exact protected set on THIS reconciliation connection,
    // including users (NP-031). The earlier application-pool preflight also
    // requires users RLS, but cannot attest another connection's snapshot.
    // The existing reviewed migrations still leave users RLS incomplete:
    // that is a BLOCKER, never a reason to omit the table or bypass the gate.
    assertForcedReconciliationRls(rls, [
      'users','pharmacies','pharmacy_memberships','medicines','stock','orders',
      'order_pharmacies','order_items','payments','subscriptions','audit_logs',
      'auth_session_families','auth_sessions','email_codes',
      'reset_links','auth_rate_limit_events','auth_account_security',
      'pharmacy_verifications','reservations','stock_movements',
      'payment_events','refunds','payment_issues','plan_features',
      'stock_submissions','auth_throttle_events',
    ]);

    const appRole = await client.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`, [process.env.DB_USER.split('.')[0]]);
    if (!appRole.rows[0] || appRole.rows[0].rolsuper || appRole.rows[0].rolbypassrls) {
      throw new Error('Configured application role must exist without superuser/BYPASSRLS privileges.');
    }

    const passed = [];
    // Run every read-only check so one finding does not hide the others, then fail closed if any check found rows.
    const failed = [];
    for (const [name, sql] of checks) {
      const result = await client.query(sql);
      try {
        assertZeroInvalidRows(name, result);
        passed.push(name);
      } catch (error) {
        failed.push(error.message);
      }
    }
    if (failed.length) throw new Error(`Reconciliation found ${failed.length} failing check(s): ${failed.join('; ')}`);

    // Inspect (but never install) the optional pgvector extension. It becomes
    // mandatory only if the AI capability is enabled or explicitly gated.
    // This is independent of the mandatory migration/RLS/integrity checks.
    const vector = await client.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    const vectorReadiness = assertVectorExtensionReadiness(
      vector, vectorRequirementFromEnvironment(process.env),
    );
    return { passed, vectorReadiness };
  });

} catch (error) {
  verificationError = error;
  throw error;
} finally {
  // Pool shutdown is part of successful completion, not best effort. Do not
  // print any PASS results until both pools are closed and cleanup has been
  // assessed. Preserve the original verification failure if cleanup fails.
  await closeReconciliationPools([appPool, migratorPool], { originalError: verificationError });
}

for (const name of summary.passed) console.log(`PASS ${name}`);
console.log('PASS RLS enabled/forced');
console.log('PASS application role privilege boundary');
if (summary.vectorReadiness.installed) {
  console.log(`PASS pgvector ${summary.vectorReadiness.version} installed`);
} else {
  console.log('DEFERRED pgvector: optional until the separately approved AI packet is enabled');
}
