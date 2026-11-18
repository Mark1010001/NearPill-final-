import { isIP } from 'node:net';

export type RuntimeEnvironment = 'development' | 'test' | 'staging' | 'production';

export interface BackendEnvironment {
  nodeEnv: RuntimeEnvironment;
  routesApiKey: string;
  host: string;
  port: number;
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    ssl: boolean;
  };
  corsOrigins: readonly string[];
  trustedProxyIps: readonly string[];
  publicAppUrl: string;
  orderReservationTtlMinutes: number;
  payment: {
    policyMode: 'disabled' | 'full' | 'deposit_or_full';
    policyVersion: string;
    depositBasisPoints?: number;
    refundsEnabled: boolean;
    xenditTest?: { secretKey: string; webhookToken: string };
  };
  mail: {
    brevoApiKey?: string;
    from?: string;
  };
  assistant: {
    geminiApiKey?: string;
    model?: string;
  };
}

type RawEnvironment = Readonly<Record<string, string | undefined>>;

const runtimeEnvironments = new Set<RuntimeEnvironment>([
  'development',
  'test',
  'staging',
  'production',
]);

function parsePort(name: string, value: string | undefined, fallback: number): number {
  const candidate = value?.trim() || String(fallback);
  const parsed = Number(candidate);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }

  return parsed;
}


function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  const candidate = value?.trim() || String(fallback);
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseNodeEnv(value: string | undefined): RuntimeEnvironment {
  const candidate = (value?.trim() || 'development') as RuntimeEnvironment;

  if (!runtimeEnvironments.has(candidate)) {
    throw new Error('NODE_ENV must be development, test, staging, or production.');
  }

  return candidate;
}

function parseOrigins(
  value: string | undefined,
  nodeEnv: RuntimeEnvironment,
): readonly string[] {
  if ((nodeEnv === 'staging' || nodeEnv === 'production') && !value?.trim()) {
    throw new Error('CORS_ORIGINS must be explicitly configured in staging and production.');
  }

  const origins = (
    value || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost,http://127.0.0.1'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    throw new Error('CORS_ORIGINS must contain at least one explicit origin.');
  }

  for (const origin of origins) {
    if (origin === '*') {
      throw new Error('CORS_ORIGINS must not use a wildcard origin.');
    }

    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      // Do not echo potentially secret-bearing malformed URLs into logs.
      throw new Error('CORS_ORIGINS must contain valid HTTP(S) origins.');
    }
    // Browser Origin headers are scheme + host + optional port only. A path,
    // fragment, query or userinfo can never match that header, and silently
    // accepting them leads to misleading credentialed-CORS configuration.
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.origin !== origin ||
      parsed.username !== '' || parsed.password !== ''
    ) {
      throw new Error('CORS_ORIGINS must contain exact HTTP(S) origins without paths, queries or credentials.');
    }
    if ((nodeEnv === 'staging' || nodeEnv === 'production') && parsed.protocol !== 'https:') {
      throw new Error('CORS_ORIGINS must use HTTPS in staging and production.');
    }
  }

  return Object.freeze(origins);
}


function parseTrustedProxyIps(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === '') return Object.freeze([]);
  const ips = raw.split(',').map((value) => {
    const ip = value.trim();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
    return mapped && isIP(mapped) === 4 ? mapped : ip;
  });
  // Exact peers only: never authorize blanket private networks or wildcards.
  if (ips.length > 16 || ips.some((ip) => !isIP(ip) || ip === '0.0.0.0' || ip === '::')) {
    throw new Error('TRUSTED_PROXY_IPS must contain explicit, valid individual IP addresses.');
  }
  if (new Set(ips).size !== ips.length) {
    throw new Error('TRUSTED_PROXY_IPS must not contain duplicate peer addresses.');
  }
  return Object.freeze(ips);
}

function parseBoolean(name: string, value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

export function isNearPillStagingDatabase(host: string, user: string) {
  return host === 'db.afqqozfjpiodanpogvfb.supabase.co' ||
    (host.endsWith('.pooler.supabase.com') && user === 'nearpill_app.afqqozfjpiodanpogvfb');
}

function parsePaymentPolicy(raw: RawEnvironment, nodeEnv: RuntimeEnvironment) {
  const policyMode = (raw.PAYMENT_POLICY_MODE?.trim() || 'disabled') as 'disabled' | 'full' | 'deposit_or_full';
  if (!['disabled', 'full', 'deposit_or_full'].includes(policyMode)) {
    throw new Error('PAYMENT_POLICY_MODE must be disabled, full, or deposit_or_full.');
  }
  if ((nodeEnv === 'staging' || nodeEnv === 'production') && !raw.PAYMENT_POLICY_MODE?.trim()) {
    throw new Error('PAYMENT_POLICY_MODE must be explicitly configured in staging and production.');
  }
  const policyVersion = raw.PAYMENT_POLICY_VERSION?.trim() || 'unconfigured';
  if (policyMode !== 'disabled' && (nodeEnv === 'staging' || nodeEnv === 'production') && !raw.PAYMENT_POLICY_VERSION?.trim()) {
    throw new Error('PAYMENT_POLICY_VERSION must be explicitly configured when online payments are enabled.');
  }
  let depositBasisPoints: number | undefined;
  if (policyMode === 'deposit_or_full') {
    const parsed = Number(raw.PAYMENT_DEPOSIT_BASIS_POINTS);
    if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 10000) {
      throw new Error('PAYMENT_DEPOSIT_BASIS_POINTS must be an integer between 1 and 9999 when deposits are enabled.');
    }
    depositBasisPoints = parsed;
  }
  const refundsEnabled = parseBoolean('PAYMENT_REFUNDS_ENABLED', raw.PAYMENT_REFUNDS_ENABLED, false);
  const secretKey = optional(raw.XENDIT_TEST_SECRET_KEY);
  const webhookToken = optional(raw.XENDIT_TEST_WEBHOOK_TOKEN);
  if (secretKey || webhookToken) {
    if (nodeEnv === 'production' || !isNearPillStagingDatabase(raw.DB_HOST?.trim() ?? '', raw.DB_USER?.trim() ?? '')) {
      throw new Error('Xendit Test Mode requires the isolated NearPill staging database.');
    }
    if (!secretKey || !/^xnd_development_[A-Za-z0-9_-]+$/.test(secretKey) || !webhookToken) {
      throw new Error('Set both XENDIT_TEST_SECRET_KEY (development key) and XENDIT_TEST_WEBHOOK_TOKEN.');
    }
    if (policyMode === 'disabled' || refundsEnabled || (policyMode === 'deposit_or_full' && depositBasisPoints !== 5000)) {
      throw new Error('Xendit Test Mode requires full payments or a 50% deposit policy, with refunds disabled.');
    }
  }
  return Object.freeze({
    policyMode,
    policyVersion,
    ...(depositBasisPoints !== undefined ? { depositBasisPoints } : {}),
    refundsEnabled,
    ...(secretKey && webhookToken ? { xenditTest: Object.freeze({ secretKey, webhookToken }) } : {}),
  });
}

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseBackendEnvironment(raw: RawEnvironment): BackendEnvironment {
  const nodeEnv = parseNodeEnv(raw.NODE_ENV);
  const host = raw.HOST || '0.0.0.0';
  if (!isIP(host) && host !== 'localhost') throw new Error('HOST must be an IP address or localhost.');
  const port = parsePort('PORT', raw.PORT, 3001);
  const databasePort = parsePort('DB_PORT', raw.DB_PORT, 5432);
  const publicAppUrl = raw.PUBLIC_APP_URL?.trim() || `http://localhost:${port}`;
  if ((nodeEnv === 'staging' || nodeEnv === 'production') && !raw.ORDER_RESERVATION_TTL_MINUTES?.trim()) {
    throw new Error('ORDER_RESERVATION_TTL_MINUTES must be explicitly configured in staging and production.');
  }
  const orderReservationTtlMinutes = parsePositiveInteger('ORDER_RESERVATION_TTL_MINUTES', raw.ORDER_RESERVATION_TTL_MINUTES, 4320);
  const payment = parsePaymentPolicy(raw, nodeEnv);

  let parsedPublicUrl: URL;
  try {
    parsedPublicUrl = new URL(publicAppUrl);
  } catch {
    throw new Error('PUBLIC_APP_URL must be an absolute URL.');
  }

  if (parsedPublicUrl.protocol !== 'http:' && parsedPublicUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL must be an HTTP(S) origin.');
  }
  if (nodeEnv === 'production' && parsedPublicUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL must use HTTPS in production.');
  }
  if (nodeEnv === 'staging' && parsedPublicUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL must use HTTPS in staging.');
  }
  // Password-reset links are assembled from this origin; silently accepting a
  // URL with credentials/path/query/fragment can conceal a bad deployment
  // setting. Use a single canonical web origin, not an arbitrary URL.
  if (parsedPublicUrl.origin !== publicAppUrl || parsedPublicUrl.username || parsedPublicUrl.password) {
    throw new Error('PUBLIC_APP_URL must be an exact HTTP(S) origin without paths, queries, fragments or credentials.');
  }

  const brevoApiKey = optional(raw.BREVO_API_KEY);
  const mailFrom = optional(raw.MAIL_FROM);
  const databasePassword = raw.DB_PASSWORD ?? '';

  if ((nodeEnv === 'staging' || nodeEnv === 'production') && !databasePassword.trim()) {
    throw new Error('DB_PASSWORD must be configured in staging and production.');
  }

  if (nodeEnv === 'production' && Boolean(brevoApiKey) !== Boolean(mailFrom)) {
    throw new Error('BREVO_API_KEY and MAIL_FROM must be configured together in production.');
  }

  // The single Supabase PostgreSQL backend must fail closed rather than
  // silently connect in plaintext when a staging/production secret is absent.
  // Keep local/disposable PostgreSQL usable without TLS for characterization.
  const databaseSsl = parseBoolean('DB_SSL', raw.DB_SSL, false);
  if ((nodeEnv === 'staging' || nodeEnv === 'production') && !databaseSsl) {
    throw new Error('DB_SSL=true is required in staging and production.');
  }

  // A managed PostgreSQL provider is an explicit deployment decision. Never
  // silently substitute the local development host, role or database if a
  // staging/production connection setting is absent. This validates config,
  // NOT actual Supabase project ownership, role grants or live RLS behavior.
  if (nodeEnv === 'staging' || nodeEnv === 'production') {
    for (const setting of ['DB_HOST', 'DB_USER', 'DB_NAME'] as const) {
      if (!raw[setting]?.trim()) {
        throw new Error(`${setting} must be explicitly configured in staging and production.`);
      }
    }

    // A staging/production managed database connection must use an explicitly
    // selected provider hostname. Literal IPs and local hostnames can route the
    // Hono API to an unintended local/private PostgreSQL instance despite
    // DB_SSL=true; keep disposable loopback PostgreSQL for development/tests.
    // This is NOT a Supabase project-ownership or DNS-resolution check.
    const dbHost = raw.DB_HOST!.trim().toLowerCase().replace(/\.$/, '');
    const addressCandidate = dbHost.startsWith('[') && dbHost.endsWith(']')
      ? dbHost.slice(1, -1) : dbHost;
    // Numeric IPv4 aliases such as 127.1, 0177.0.0.1, 2130706433 and
    // 0x7f000001 are not detected by net.isIP(rawHost), but can resolve to
    // loopback. WHATWG URL parsing canonicalizes these forms without DNS I/O.
    // Require a canonical bare hostname; do not allow URL syntax in DB_HOST.
    let canonicalHostname: string;
    try {
      canonicalHostname = new URL(`http://${dbHost}`).hostname;
    } catch {
      throw new Error('DB_HOST must be a provider-supplied hostname (not a local host or IP literal) in staging and production.');
    }
    if (
      canonicalHostname !== dbHost ||
      isIP(addressCandidate) !== 0 ||
      dbHost === 'localhost' || dbHost.endsWith('.localhost') ||
      dbHost === 'localhost.localdomain' || dbHost === 'ip6-localhost'
    ) {
      throw new Error('DB_HOST must be a provider-supplied hostname (not a local host or IP literal) in staging and production.');
    }

    // Supabase port 6543 is the shared/dedicated transaction-pooler endpoint.
    // NearPill's persistent Hono/Drizzle adapter uses transaction-local RLS
    // context and has not passed transaction-pooler compatibility acceptance.
    // Direct and shared session-mode connections use port 5432 instead.
    // This does not establish real role permissions or provider ownership.
    if (databasePort === 6543) {
      // Reject the known Supabase transaction-pooling port even when an
      // operator supplies a custom DNS alias for a provider endpoint.
      throw new Error('DB_PORT=6543 selects Supabase transaction pooling; use direct or session-mode port 5432 for the backend.');
    }

    // This is the ordinary Hono/Drizzle runtime connection, never the schema
    // migrator or an RLS-bypassing provider/admin identity. Session-pooler
    // logins append .<project-ref> to the PostgreSQL role name.
    const runtimeRole = raw.DB_USER!.trim().toLowerCase().split('.')[0] || '';
    const forbiddenRuntimeRoles = new Set([
      'postgres', 'supabase_admin', 'service_role', 'nearpill_owner',
      'nearpill_migrator', 'anon', 'authenticated',
    ]);
    if (runtimeRole.startsWith('pg_') || forbiddenRuntimeRoles.has(runtimeRole)) {
      throw new Error('DB_USER must be a separate least-privilege application role in staging and production.');
    }
  }

  return Object.freeze({
    nodeEnv,
    routesApiKey: raw.GOOGLE_ROUTES_API_KEY?.trim() || '',
    host,
    port,
    database: Object.freeze({
      host: raw.DB_HOST?.trim() || '127.0.0.1',
      port: databasePort,
      user: raw.DB_USER?.trim() || 'nearpill_app',
      password: databasePassword,
      name: raw.DB_NAME?.trim() || 'nearpill',
      ssl: databaseSsl,
    }),
    corsOrigins: parseOrigins(raw.CORS_ORIGINS, nodeEnv),
    trustedProxyIps: parseTrustedProxyIps(raw.TRUSTED_PROXY_IPS),
    publicAppUrl,
    orderReservationTtlMinutes,
    payment,
    mail: Object.freeze({
      ...(brevoApiKey ? { brevoApiKey } : {}),
      ...(mailFrom ? { from: mailFrom } : {}),
    }),
    assistant: Object.freeze({
      ...(optional(raw.GEMINI_API_KEY) ? { geminiApiKey: optional(raw.GEMINI_API_KEY) } : {}),
      ...(optional(raw.GEMINI_MODEL) ? { model: optional(raw.GEMINI_MODEL) } : {}),
    }),
  });
}
