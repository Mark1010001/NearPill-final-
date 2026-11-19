// Automatic deletion of old logs. Keeps the last `months` months, then removes
// audit, security and payment-event records. Orders are not deleted: customers
// keep their order history while the account exists.
export const LOG_RETENTION_MONTHS = 3;

export function retentionCutoff(now, months = LOG_RETENTION_MONTHS) {
  const date = new Date(now);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid date is required.');
  const cutoff = new Date(date.getTime());
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay));
  return cutoff;
}

export function createRetentionService({ repository, months = LOG_RETENTION_MONTHS, clock = () => new Date() }) {
  if (!repository || typeof repository.purgeBefore !== 'function') {
    throw new TypeError('A retention repository is required.');
  }
  return {
    async run() {
      const cutoff = retentionCutoff(clock(), months);
      const counts = await repository.purgeBefore(cutoff.toISOString());
      return { cutoff: cutoff.toISOString(), counts };
    },
  };
}
