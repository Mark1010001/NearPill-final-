> **Historical extraction note:** this document records the Packet 2 before-state and extraction sequence. The production transport has since moved to Hono `/api/v1`, and persistence has moved to PostgreSQL. See `docs/http-api.md` and `docs/postgres-migration.md` for the canonical runtime.

> **Current persistence note (2026-10-17):** the extracted application/repository boundaries are now composed with PostgreSQL adapters. MySQL references below describe the before-state/rollback evidence from the extraction work.

# Backend layer extraction status

The backend has been decomposed in place while the existing Express/MySQL runtime remains canonical. No second backend, database, auth, catalog, inventory, order, payment, subscription, reporting, or audit implementation was created.

## Canonical layering

The migrated backend surfaces now follow the same dependency direction:

```text
Express route adapter
  -> application use case/service
  -> domain policy where applicable
  -> repository port
  -> MySQL repository adapter
  -> existing MySQL pool
```

`backend/server.js` is now the composition/operational shell for the current runtime: middleware, MySQL pool creation, router composition, health/database verification, scheduled order-expiry invocation, global 404/error handling, and process startup/shutdown. Business SQL for the migrated slices is owned by the MySQL repository adapters rather than Express route handlers.

## Extracted slices

### Identity/profile

- `backend/src/http/routes/auth-routes.js`
- `backend/src/application/identity-service.js`
- `backend/src/domain/identity/otp.js`
- `backend/src/ports/identity-repository.js`
- `backend/src/infrastructure/mysql/identity-repository.js`
- `backend/login-handler.js` and `backend/password-recovery.js` reuse the same identity repository.

### Catalog/stores

- `backend/src/http/routes/catalog-routes.js`
- `backend/src/application/catalog-service.js`
- `backend/src/domain/catalog/open-now.js`
- `backend/src/ports/catalog-repository.js`
- `backend/src/infrastructure/mysql/catalog-repository.js`

Public medicine/store reads and current admin pharmacy/master-medicine management now use this single application/repository path. The existing in-memory pharmacy detail compatibility map remains injected into the service until the later persistence migration.

### Inventory

- `backend/src/http/routes/inventory-routes.js`
- `backend/src/application/inventory-service.js`
- `backend/src/ports/inventory-repository.js`
- `backend/src/infrastructure/mysql/inventory-repository.js`

The current stock row lock, nonnegative-stock validation, availability mutation, transaction boundary, and audit write are preserved behind the repository contract.

### Orders

- `backend/src/http/routes/order-routes.js`
- `backend/src/application/order-service.js`
- `backend/src/domain/orders/status.js`
- `backend/src/ports/order-repository.js`
- `backend/src/infrastructure/mysql/order-repository.js`

Customer/admin order reads, order creation, status transitions, customer cancellation, inventory reservation/restock, local payment creation/refund-state mutation, audit writes, and scheduled expiry now flow through the same order use cases/repository adapter.

### Payments/subscriptions

- `backend/src/http/routes/payment-subscription-routes.js`
- `backend/src/application/payment-subscription-service.js`
- `backend/src/ports/payment-subscription-repository.js`
- `backend/src/infrastructure/mysql/payment-subscription-repository.js`

Partner dashboard/subscription responses, admin subscription management, actor-scoped payment reads, and current admin payment editing behavior are preserved behind application/repository contracts.

### Reports/audit

- `backend/src/http/routes/report-routes.js`
- `backend/src/application/report-service.js`
- `backend/src/ports/report-repository.js`
- `backend/src/infrastructure/mysql/report-repository.js`

Admin metrics, sales/medicine/drugstore reports, and audit-log reads now use report application/repository boundaries.

## Shared application result contract

`backend/src/application/result.js` provides the transport-neutral success/failure result used by the extracted HTTP adapters. The route adapters parse transport input, call a use case, and present its result; they do not contain business SQL.

## Behavior intentionally preserved

This packet changes structure, not the later approved security/data policies. The following legacy semantics remain characterized intentionally for subsequent packets:

- process-local access/refresh sessions, OTP, and recovery challenge state;
- unresolved partner-to-drugstore membership mapping;
- public/admin catalog and pharmacy response contracts;
- current MySQL persistence and schema;
- current inventory stock/availability transaction semantics;
- multi-pharmacy order creation;
- JavaScript floating-point/order-total behavior where it already exists;
- immediate stock decrement/reservation behavior;
- current local `paid -> refunded` payment-status mutation without provider confirmation;
- direct admin payment amount/status/reference editing;
- Rx-related fields/metrics that still exist in the legacy launch surface;
- current HTTP paths/methods and Express runtime.

Those behaviors are not approved as target architecture merely because their parity is preserved here. Their owning later packets replace them deliberately with new acceptance/security tests.

## Characterization and extraction evidence

Targeted extraction tests live in:

- `backend/test/backend-layer-extraction.test.mjs`
- `backend/test/catalog-layer-extraction.test.mjs`
- `backend/test/inventory-layer-extraction.test.mjs`
- `backend/test/order-layer-extraction.test.mjs`
- `backend/test/payment-subscription-layer-extraction.test.mjs`
- `backend/test/report-layer-extraction.test.mjs`
- `backend/test/packet0-baseline-characterization.test.mjs`

The consolidated targeted run on 2026-10-17 passed 37/37 tests. It verifies thin route adapters, repository ownership of SQL, application/domain contracts for migrated behavior, and preservation of the 49 Express route registrations / 47 unique literal method-path contracts.

`backend/server.js` decreased from 6,612 lines in the original audited snapshot to 559 lines after the full extraction sequence. Remaining direct SQL in the server is limited to operational database verification/health checks, not migrated business routes.

## Packet completion boundary

The structural work required by the backend-extraction packet is complete for all six prescribed slices. The repository still inherits owner-bypassed environment gates from the earlier foundation work (supported Node 24 execution, root lock/tool install, Flutter SDK, and actual Compose startup), and this environment does not provide a real MySQL service for deployed integration verification. Those gaps remain explicit ledger evidence and are not recorded as passing.

The next architecture packet is PostgreSQL/Drizzle/RLS migration. It must reuse these application/repository boundaries rather than reimplement business logic in a parallel stack.
