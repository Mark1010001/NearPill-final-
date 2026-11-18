/**
 * Packet 0 / core PostgreSQL reconciliation must not require a vector index
 * before NearPill's separately gated AI packet is enabled. Inspect the
 * extension without changing it; treat unknown catalog results as errors.
 * A missing extension is a DEFERRED AI prerequisite, never a security PASS.
 */
export function assertVectorExtensionReadiness(result, { aiEnabled = false, requireVector = false } = {}) {
  if (typeof aiEnabled !== 'boolean' || typeof requireVector !== 'boolean') {
    throw new TypeError('Vector readiness requires explicit boolean feature requirements.');
  }
  if (!result || !Array.isArray(result.rows) || result.rows.length > 1) {
    throw new Error('Vector extension readiness inconclusive: invalid PostgreSQL catalog result.');
  }
  const required = aiEnabled || requireVector;
  if (result.rows.length === 0) {
    if (required) throw new Error('pgvector is required for enabled AI but is not installed.');
    return Object.freeze({ installed: false, required, version: null });
  }
  const version = result.rows[0]?.extversion;
  if (typeof version !== 'string' || !/^\d+(?:\.\d+){1,3}$/.test(version)) {
    throw new Error('Vector extension readiness inconclusive: invalid extension version.');
  }
  return Object.freeze({ installed: true, required, version });
}

export function vectorRequirementFromEnvironment(env) {
  if (!env || typeof env !== 'object') {
    throw new TypeError('Vector readiness requires an explicit environment object.');
  }
  for (const name of ['NEARPILL_AI_ENABLED', 'NEARPILL_REQUIRE_PGVECTOR']) {
    if (env[name] !== undefined && env[name] !== 'true' && env[name] !== 'false') {
      throw new Error(`${name} must be exactly true or false when specified.`);
    }
  }
  return {
    aiEnabled: env.NEARPILL_AI_ENABLED === 'true',
    requireVector: env.NEARPILL_REQUIRE_PGVECTOR === 'true',
  };
}
