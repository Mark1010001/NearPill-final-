# Order and inventory integrity

NearPill checkout uses one canonical order/inventory implementation. The Hono transport delegates to the existing order application service, which coordinates PostgreSQL repository transactions; clients never calculate authoritative price, stock, reservation, or order-state truth.

## Checkout contract

Canonical `/api/v1/orders` creation requires an `Idempotency-Key` header or the equivalent validated request field. The key is scoped to the authenticated customer. A SHA-256 fingerprint of the canonical `(pharmacy, medicine, quantity)` request is stored with the order: replaying the same key and same request returns the original order, while reusing the key for a different request returns conflict.

Checkout accepts medicines from exactly one pharmacy. The service reloads published catalog inventory and price while holding PostgreSQL row locks, ignores client price fields, and computes every authoritative amount in integer Philippine centavos. Compatibility response fields expressed as pesos are display projections only.

## Inventory invariant

The database enforces:

```text
stock_on_hand >= 0
reserved_quantity >= 0
reserved_quantity <= stock_on_hand
sellable = stock_on_hand - reserved_quantity
```

Creating an order increases `reserved_quantity`; it does not decrement `stock_on_hand`. `reservations` records the order-to-inventory hold and `stock_movements` records adjustment, reserve, release, and fulfillment changes.

Cancellation and expiry release an active reservation exactly once. Completion fulfills it exactly once by decrementing both `stock_on_hand` and `reserved_quantity`. The reservation row status prevents a second release/fulfillment from being silently applied.

## Order lifecycle

The application service owns the transition policy:

```text
reserved -> awaiting_payment | confirmed | cancelled | expired
awaiting_payment -> confirmed | cancelled | expired
confirmed -> preparing | cancellation_pending
preparing -> ready_for_pickup | cancellation_pending
ready_for_pickup -> completed
cancellation_pending -> cancelled
cancelled | expired | completed -> terminal
```

A paid order cannot be locally asserted as cancelled/refunded by this packet. It enters or remains on the reconciliation path owned by the payment/refund implementation.

## Reservation expiry policy

`ORDER_RESERVATION_TTL_MINUTES` controls reservation expiry. Development/test default to the preserved legacy value of 4320 minutes. Staging and production must configure the value explicitly; this intentionally prevents an unapproved pickup/reservation TTL from becoming a production default.

## Mobile cart boundary

The existing Flutter cart is keyed by authenticated user, deletes the superseded global `nearpill_cart` storage key, rejects unauthenticated cart authority, and refuses items from a second pharmacy. Its local total is presentation-only; the server recomputes price in centavos at checkout.

## Live database verification

With PostgreSQL migrations applied and both app/migrator credentials configured, run:

```bash
npm --prefix backend run db:verify-order-inventory
```

The verifier sends 100 concurrent checkout attempts through the real order service/PostgreSQL repository against stock of 3 and requires exactly 3 successful reservations. It then verifies idempotent replay, rejects key reuse with a different payload, verifies cancellation and expiry release exactly once, fulfills the final reservation, and reconciles final stock/reservation state.

This live check is required before production acceptance; static/contract tests are not a substitute for executing the contention test against PostgreSQL.
