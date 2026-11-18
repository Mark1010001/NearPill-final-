// Server-owned subscription plans. The tier names, what each plan includes and the entitlement keys it grants are
// defined only here; the portals just display this list. Entitlement keys are what the API actually checks.
export const SALES_HISTORY_DAYS_WITHOUT_FULL_HISTORY = 90;

const BASIC_FEATURES = Object.freeze([
  'Receive customer orders and update pickup status',
  'Manage medicines, prices and stock',
  'Review prescription photos',
  'Expiry and low-stock tracking',
]);

export const subscriptionPlans = Object.freeze([
  Object.freeze({
    tier: 'Basic',
    partnershipMonths: 3,
    summary: 'Everything needed to take pickup orders.',
    features: BASIC_FEATURES,
    entitlements: Object.freeze([]),
  }),
  Object.freeze({
    tier: 'Plus',
    partnershipMonths: 6,
    summary: 'Basic, plus sales reporting.',
    features: Object.freeze(['Everything in Basic', `Sales report for the last ${SALES_HISTORY_DAYS_WITHOUT_FULL_HISTORY} days`]),
    entitlements: Object.freeze(['reports:view:premium']),
  }),
  Object.freeze({
    tier: 'Pro',
    partnershipMonths: 12,
    summary: 'Plus, with your complete sales history.',
    features: Object.freeze(['Everything in Plus', 'Full sales report history with no date limit']),
    entitlements: Object.freeze(['reports:view:premium', 'reports:history:full']),
  }),
]);

// How long a pharmacy stays our partner on each plan, counted from the day the pharmacy joined NearPill.
export const partnershipMonths = Object.freeze(Object.fromEntries(subscriptionPlans.map((plan) => [plan.tier, plan.partnershipMonths])));

/** Partnership expiry (YYYY-MM-DD, Philippine date) = join date + plan length. null when there is no plan or no join date. */
export function partnershipExpiry(joinedAt, tier) {
  const months = partnershipMonths[tier];
  const joined = joinedAt ? new Date(joinedAt) : null;
  if (!months || !joined || Number.isNaN(joined.getTime())) return null;
  const local = new Date(joined.getTime() + 8 * 3600 * 1000);
  const year = local.getUTCFullYear(); const month = local.getUTCMonth(); const day = local.getUTCDate();
  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const expiry = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)));
  return expiry.toISOString().slice(0, 10);
}

export const validTiers = Object.freeze(subscriptionPlans.map((plan) => plan.tier));
export const tierEntitlements = Object.freeze(Object.fromEntries(subscriptionPlans.map((plan) => [plan.tier, plan.entitlements])));
