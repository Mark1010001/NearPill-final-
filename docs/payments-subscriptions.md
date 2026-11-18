# Payments, refunds, reconciliation, and subscriptions

NearPill does not treat a local database status as proof that money moved. The payment application owns provider intent creation, signed provider event processing, refund requests, reconciliation, and authoritative payment views. Concrete provider selection remains an operator decision, so the production composition currently registers no live payment provider and the default payment policy is `disabled`.

## Payment authority

The canonical flow is:

```text
client -> POST /api/v1/orders/:id/payments
       -> authoritative order amount in centavos
       -> configured PaymentProvider.createIntent()
       -> pending payment record
provider -> signed webhook with raw request body
         -> PaymentProvider.verifyWebhook()
         -> persisted provider event id
         -> amount/currency checks
         -> payment/order transition or reconciliation_required
```

Provider event IDs are unique per provider. Authenticated duplicates are accepted without replaying side effects. Wrong amount/currency, unmatched events, and ambiguous legacy payment claims enter reconciliation instead of becoming paid/refunded truth.

The generic provider port exposes intent creation, webhook verification, provider payment lookup, refund request, and refund lookup. A signed HMAC fixture provider exists under test support only and is not a production provider.

## Xendit GCash Test Mode

Use the isolated NearPill staging database. In the backend's ignored local `.env` or staging secret settings, set `PAYMENT_POLICY_MODE=full`, `PAYMENT_POLICY_VERSION=xendit-test-v1`, `PAYMENT_REFUNDS_ENABLED=false`, `XENDIT_TEST_SECRET_KEY` (a development Money In read/write key), and `XENDIT_TEST_WEBHOOK_TOKEN` (the dashboard's webhook verification token). Restart the API. Keep both credentials on the server.

In Xendit Test Mode, send **Payment Session – Completed** and **Payment Session – Expired** to `https://<staging-host>/api/v1/payments/webhooks/xendit-test`. Xendit requires a reachable HTTPS endpoint. For an HTTPS staging deployment, set `PUBLIC_APP_URL` to the customer web origin for checkout returns. Local checkout opens in a separate tab.

Use an approved staging listing with confirmed stock to reserve a pickup at `/app/checkout`. Open the GCash test checkout from the order and use **Check payment status** afterward. The server verifies the session and captured payment independently before confirming it. Test orders use the `NP-TEST-` reference prefix. Treat them as simulations throughout pharmacy operations.

## Refunds

A refund request changes a confirmed payment to `refund_pending` only after the configured provider accepts the request. It does not mark money as returned. `refunded` is reached only after signed provider confirmation or the reconciliation workflow observes provider-confirmed refund evidence. Full/partial refund policy remains an owner decision; the current implementation requests the full authoritative payment amount rather than inventing a partial-refund rule.

## Payment policy

`PAYMENT_POLICY_MODE` controls whether payment collection is available:

- `disabled` — default and truthful prelaunch behavior;
- `full` — only full authoritative order payment is allowed;
- `deposit_or_full` — requires an explicitly approved `PAYMENT_DEPOSIT_BASIS_POINTS` value.

Enabled staging/production modes require an explicit `PAYMENT_POLICY_VERSION`. Refund initiation is separately gated by `PAYMENT_REFUNDS_ENABLED`.

No 50% deposit percentage is hardcoded because the approved master plan lists the deposit/full policy as an owner decision.

## Subscription entitlements

Subscription tier display is not authorization. Active server-side entitlement rows authorize premium behavior. The currently preserved Premium behavior grants `reports:view:premium`; cancelling/expiring the subscription revokes that entitlement. Partner report routes re-check the entitlement per request.

## Database controls

PostgreSQL stores provider identifiers, payment events, refunds, reconciliation records, subscription entitlements, and billing events. RLS is forced on the new private tables. Signed webhooks run with a transaction-local `payment_mutation` capability scoped to the payment/order/reservation tables needed to apply verified provider evidence. Ordinary actor-scoped payment reads use the normal RLS context without that capability.

Legacy `paid`/`refunded` rows without provider evidence are migrated to `reconciliation_required`; synthetic provider-less pending rows are removed.

## Verification boundary

Source/unit contract tests cover forged signatures, event deduplication, wrong amounts, refund pending/confirmation, provider reconciliation, entitlement grants/revocation, raw webhook preservation, and removal of direct admin payment truth editing.

A selected provider's real sandbox webhook/reconciliation flow and real PostgreSQL execution remain release gates. They cannot be represented as passing until a provider is approved/configured and the supported runtime is available.
