export const paymentPlans = Object.freeze(['full', 'deposit']);
export const minimumPharmacyCheckoutCentavos = 10000;

/** @param {{mode?: string, version?: string, depositBasisPoints?: number | null, minimumDepositCentavos?: number, refundsEnabled?: boolean}} [options] */
export function createPaymentPolicy({
  mode = 'disabled',
  version = 'unconfigured',
  depositBasisPoints = null,
  minimumDepositCentavos = 0,
  refundsEnabled = false,
} = {}) {
  const normalizedMode = String(mode || 'disabled');
  if (!['disabled', 'full', 'deposit_or_full'].includes(normalizedMode)) {
    throw new TypeError('Unsupported payment policy mode.');
  }
  if (!Number.isSafeInteger(minimumDepositCentavos) || minimumDepositCentavos < 0) throw new TypeError('Invalid minimum deposit.');
  if (normalizedMode === 'deposit_or_full') {
    if (!Number.isInteger(depositBasisPoints) || depositBasisPoints <= 0 || depositBasisPoints >= 10000) {
      throw new TypeError('depositBasisPoints must be an integer between 1 and 9999 for deposit_or_full mode.');
    }
  }

  function quote(totalCentavos, requestedPlan) {
    const total = Number(totalCentavos);
    if (!Number.isSafeInteger(total) || total < 0) return { ok: false, reason: 'Invalid authoritative order amount.' };
    if (normalizedMode === 'disabled') return { ok: false, unavailable: true, reason: 'Online payment collection is not configured.' };
    const plan = String(requestedPlan || 'full');
    if (!paymentPlans.includes(plan)) return { ok: false, reason: 'Invalid payment plan.' };
    if (plan === 'deposit' && normalizedMode !== 'deposit_or_full') return { ok: false, reason: 'Deposit payments are not enabled.' };
    const amountCentavos = plan === 'full'
      ? total
      : Math.max(minimumDepositCentavos, Number((BigInt(total) * BigInt(depositBasisPoints) + 9999n) / 10000n));
    if (plan === 'deposit' && amountCentavos >= total) return { ok: false, reason: 'This order total requires payment in full.' };
    return { ok: true, paymentPlan: plan, amountCentavos, currency: 'PHP', policyVersion: String(version || 'unconfigured') };
  }

  return Object.freeze({ mode: normalizedMode, version: String(version || 'unconfigured'), refundsEnabled: Boolean(refundsEnabled), quote });
}
