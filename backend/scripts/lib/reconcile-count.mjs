/**
 * Read-only reconciliation must not turn a failed/partial query shape into
 * an apparent zero-invalid-rows result. PostgreSQL COUNT(*) returns a
 * decimal string by default in node-postgres unless it was cast to integer.
 */
export function assertZeroInvalidRows(label, result) {
  const rows = result?.rows;
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
      !Object.hasOwn(rows[0], 'count')) {
    throw new Error(`Reconciliation inconclusive (${label}): missing count result.`);
  }
  const raw = rows[0].count;
  if (!((typeof raw === 'number' && Number.isSafeInteger(raw)) ||
        (typeof raw === 'string' && /^\d+$/.test(raw)))) {
    throw new Error(`Reconciliation inconclusive (${label}): invalid count result.`);
  }
  const count = Number(raw);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Reconciliation inconclusive (${label}): count out of safe range.`);
  }
  if (count !== 0) throw new Error(`${label}: ${count} invalid row(s)`);
}
