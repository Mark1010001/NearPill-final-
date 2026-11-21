import { createHash } from 'node:crypto';
import { assertSecurityRepository } from '../../ports/security-repository.js';
import { applyDatabaseActor } from './context.js';

const minute = 60_000;
const lockDurationMs = 15 * minute;

function iso(value) {
  return new Date(value).toISOString();
}

function privacyHash(value) {
  return createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

export function createPostgresSecurityRepository(pool) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new TypeError('A PostgreSQL pool is required.');
  }

  async function transaction(work, actor = {}) {
    const client = await pool.connect();
    let began = false;
    let commitAttempted = false;
    let discard = false;
    try {
      await client.query('BEGIN');
      began = true;
      await applyDatabaseActor(client, { ...actor, capability: 'identity_security' });
      const value = await work(client);
      commitAttempted = true;
      await client.query('COMMIT');
      return value;
    } catch (error) {
      // An unsuccessful BEGIN or ambiguous COMMIT can leave the physical
      // connection in an unknown state even if best-effort rollback succeeds.
      discard = !began || commitAttempted;
      try { await client.query('ROLLBACK'); } catch { discard = true; }
      throw error;
    } finally {
      // A failed rollback may retain a previous session/actor transaction.
      // Never return that client for use by another authenticated request.
      client.release(discard);
    }
  }

  const repository = {
    privacyHash,

    async issueCredentialSet({
      userId,
      verifiedPasswordHash,
      familyId,
      accessHash,
      refreshHash,
      webHash,
      csrfHash,
      accessExpiresAt,
      refreshExpiresAt,
      webExpiresAt,
    }) {
      return transaction(async (client) => {
        if (verifiedPasswordHash !== undefined) {
          // Serialize issuance with password updates and their session revocations.
          const account = await client.query('SELECT id FROM users WHERE id = $1 AND password = $2 FOR SHARE', [userId, verifiedPasswordHash]);
          if (account.rowCount !== 1) return false;
        }
        await client.query(
          `INSERT INTO auth_session_families (id, user_id) VALUES ($1, $2)`,
          [familyId, userId],
        );
        await client.query(
          `INSERT INTO auth_sessions (user_id, family_id, token_hash, token_kind, expires_at)
           VALUES ($1, $2, $3, 'access', $4), ($1, $2, $5, 'refresh', $6)`,
          [userId, familyId, accessHash, iso(accessExpiresAt), refreshHash, iso(refreshExpiresAt)],
        );
        if (webHash) {
          await client.query(
            `INSERT INTO auth_sessions (user_id, token_hash, token_kind, csrf_hash, expires_at)
             VALUES ($1, $2, 'web', $3, $4)`,
            [userId, webHash, csrfHash, iso(webExpiresAt)],
          );
        }
        return true;
      }, { role: 'system' });
    },

    async findActiveSession(tokenHash, acceptedKinds = ['access', 'web']) {
      return transaction(async (client) => {
        const result = await client.query(
          `SELECT s.id, s.user_id, s.family_id, s.token_kind, s.csrf_hash, s.expires_at,
                  u.name, u.email, u.role
           FROM auth_sessions s
           INNER JOIN users u ON u.id = s.user_id
           LEFT JOIN auth_session_families f ON f.id = s.family_id
           WHERE s.token_hash = $1
             AND s.token_kind = ANY($2::varchar[])
             AND s.consumed_at IS NULL
             AND s.revoked_at IS NULL
             AND s.expires_at > CURRENT_TIMESTAMP
             AND (f.id IS NULL OR f.revoked_at IS NULL)
           LIMIT 1`,
          [tokenHash, acceptedKinds],
        );
        const session = result.rows[0];
        if (!session) return null;
        await applyDatabaseActor(client, {
          userId: Number(session.user_id),
          role: session.role,
          capability: 'identity_security',
        });
        const memberships = await client.query(
          `SELECT drugstore_id AS "drugstoreId", membership_role AS "membershipRole", is_active AS "isActive"
           FROM pharmacy_memberships
           WHERE user_id = $1 AND is_active = 1
           ORDER BY drugstore_id`,
          [session.user_id],
        );
        return {
          id: Number(session.id),
          userId: Number(session.user_id),
          familyId: session.family_id,
          tokenKind: session.token_kind,
          csrfHash: session.csrf_hash,
          expiresAt: session.expires_at,
          user: {
            id: Number(session.user_id),
            name: session.name,
            email: session.email,
            role: session.role,
          },
          memberships: memberships.rows.map((item) => ({
            drugstoreId: Number(item.drugstoreId),
            membershipRole: item.membershipRole,
            isActive: Number(item.isActive) === 1,
          })),
        };
      }, { role: 'system' });
    },

    async rotateRefreshToken({ tokenHash, newAccessHash, newRefreshHash, accessExpiresAt, refreshExpiresAt }) {
      return transaction(async (client) => {
        const result = await client.query(
          `SELECT s.id, s.user_id, s.family_id, s.expires_at, s.consumed_at, s.revoked_at,
                  f.revoked_at AS family_revoked_at, u.role
           FROM auth_sessions s
           INNER JOIN auth_session_families f ON f.id = s.family_id
           INNER JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = $1 AND s.token_kind = 'refresh'
           FOR UPDATE OF s, f`,
          [tokenHash],
        );
        const current = result.rows[0];
        if (!current) return { status: 'invalid' };
        const expired = new Date(current.expires_at).getTime() <= Date.now();
        if (current.consumed_at || current.revoked_at || current.family_revoked_at || expired) {
          await client.query(
            `UPDATE auth_session_families SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), revoke_reason = COALESCE(revoke_reason, 'refresh_replay') WHERE id = $1`,
            [current.family_id],
          );
          await client.query(
            `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE family_id = $1`,
            [current.family_id],
          );
          return { status: 'replay' };
        }
        await client.query(`UPDATE auth_sessions SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`, [current.id]);
        await client.query(
          `INSERT INTO auth_sessions (user_id, family_id, token_hash, token_kind, expires_at)
           VALUES ($1, $2, $3, 'access', $4), ($1, $2, $5, 'refresh', $6)`,
          [current.user_id, current.family_id, newAccessHash, iso(accessExpiresAt), newRefreshHash, iso(refreshExpiresAt)],
        );
        return {
          status: 'rotated',
          userId: Number(current.user_id),
          familyId: current.family_id,
          role: current.role,
        };
      }, { role: 'system' });
    },

    async revokeToken(tokenHash, reason = 'logout') {
      return transaction(async (client) => {
        const result = await client.query(
          `SELECT id, family_id, token_kind FROM auth_sessions WHERE token_hash = $1 FOR UPDATE`,
          [tokenHash],
        );
        const session = result.rows[0];
        if (!session) return false;
        if (session.token_kind === 'refresh' && session.family_id) {
          await client.query(
            `UPDATE auth_session_families SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), revoke_reason = COALESCE(revoke_reason, $2) WHERE id = $1`,
            [session.family_id, reason],
          );
          await client.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE family_id = $1`, [session.family_id]);
        } else {
          await client.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE id = $1`, [session.id]);
        }
        return true;
      }, { role: 'system' });
    },

    async revokeUserSessions(userId, reason = 'account_security_change') {
      return transaction(async (client) => {
        await client.query(
          `UPDATE auth_session_families SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), revoke_reason = COALESCE(revoke_reason, $2) WHERE user_id = $1`,
          [userId, reason],
        );
        const result = await client.query(
          `UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = $1 AND revoked_at IS NULL`,
          [userId],
        );
        return result.rowCount;
      }, { role: 'system' });
    },

    async upsertEmailVerification(email, codeHash, expiresAt) {
      return transaction(async (client) => {
        await client.query(
          `INSERT INTO email_verification_challenges (email, code_hash, expires_at, verified_at, attempt_count, updated_at)
           VALUES ($1, $2, $3, NULL, 0, CURRENT_TIMESTAMP)
           ON CONFLICT (email) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
             verified_at = NULL, attempt_count = 0, updated_at = CURRENT_TIMESTAMP`,
          [email, codeHash, iso(expiresAt)],
        );
      }, { role: 'system' });
    },

    /** Counts one event for scope+key inside a sliding window. Returns { allowed, retryAfterSeconds }. */
    async recordThrottle(scope, key, windowSeconds, max) {
      const keyHash = privacyHash(`${scope}:${key}`);
      try {
      return await transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`throttle:${scope}:${keyHash}`]);
        await client.query(
          `DELETE FROM auth_throttle_events WHERE scope = $1 AND key_hash = $2 AND occurred_at <= CURRENT_TIMESTAMP - make_interval(secs => $3)`,
          [scope, keyHash, windowSeconds],
        );
        const counted = await client.query(
          `SELECT COUNT(*)::int AS count, EXTRACT(EPOCH FROM (MIN(occurred_at) + make_interval(secs => $3) - CURRENT_TIMESTAMP))::int AS wait
           FROM auth_throttle_events WHERE scope = $1 AND key_hash = $2`,
          [scope, keyHash, windowSeconds],
        );
        if (Number(counted.rows[0]?.count) >= max) {
          return { allowed: false, retryAfterSeconds: Math.max(1, Number(counted.rows[0]?.wait) || windowSeconds) };
        }
        await client.query(`INSERT INTO auth_throttle_events (scope, key_hash) VALUES ($1, $2)`, [scope, keyHash]);
        return { allowed: true, retryAfterSeconds: 0 };
      }, { role: 'system' });
      } catch (error) {
        // Migration 0038 not applied yet: keep sign-up working (the code attempt
        // limits still apply) and say so loudly instead of failing every request.
        if (error?.code === '42P01' || error?.code === '42501') {
          console.error('auth_throttle_events is missing or not writable. Apply migration 0038_signup_hardening.sql.');
          return { allowed: true, retryAfterSeconds: 0 };
        }
        throw error;
      }
    },

    async verifyEmailCode(email, codeHash) {
      return transaction(async (client) => {
        const result = await client.query(
          `SELECT email, code_hash, expires_at, attempt_count FROM email_verification_challenges WHERE email = $1 FOR UPDATE`,
          [email],
        );
        const record = result.rows[0];
        if (!record) return { status: 'missing' };
        if (new Date(record.expires_at).getTime() <= Date.now()) {
          await client.query(`DELETE FROM email_verification_challenges WHERE email = $1`, [email]);
          return { status: 'expired' };
        }
        if (record.code_hash !== codeHash) {
          const attempts = Number(record.attempt_count) + 1;
          if (attempts >= 5) await client.query(`DELETE FROM email_verification_challenges WHERE email = $1`, [email]);
          else await client.query(`UPDATE email_verification_challenges SET attempt_count = $2, updated_at = CURRENT_TIMESTAMP WHERE email = $1`, [email, attempts]);
          return attempts >= 5 ? { status: 'locked' } : { status: 'invalid', attemptsLeft: 5 - attempts };
        }
        // A verified email may be used to create one account within 15 minutes.
        await client.query(
          `UPDATE email_verification_challenges SET verified_at = CURRENT_TIMESTAMP, expires_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes', updated_at = CURRENT_TIMESTAMP WHERE email = $1`,
          [email],
        );
        return { status: 'verified' };
      }, { role: 'system' });
    },

    async consumeVerifiedEmail(email) {
      return transaction(async (client) => {
        const result = await client.query(
          `DELETE FROM email_verification_challenges
           WHERE email = $1 AND verified_at IS NOT NULL AND expires_at > CURRENT_TIMESTAMP
           RETURNING email`,
          [email],
        );
        return result.rowCount === 1;
      }, { role: 'system' });
    },

    async createPasswordResetChallenge({ userId, email, tokenHash, expiresAt }) {
      return transaction(async (client) => {
        await client.query(`DELETE FROM password_reset_challenges WHERE user_id = $1 AND consumed_at IS NULL`, [userId]);
        await client.query(
          `INSERT INTO password_reset_challenges (user_id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
          [userId, email, tokenHash, iso(expiresAt)],
        );
      }, { role: 'system' });
    },

    async changePartnerPassword({ userId, currentPasswordHash, passwordHash }) {
      return transaction(async (client) => {
        const update = await client.query(
          "UPDATE users SET password = $3 WHERE id = $1 AND password = $2 AND role = 'partner'",
          [userId, currentPasswordHash, passwordHash],
        );
        if (update.rowCount !== 1) return false;
        await client.query(`UPDATE auth_session_families SET revoked_at = CURRENT_TIMESTAMP, revoke_reason = 'password_change' WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
        await client.query(`UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
        await client.query(`UPDATE password_reset_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE user_id = $1 AND consumed_at IS NULL`, [userId]);
        return true;
      }, { role: 'system' });
    },

    async resetPasswordWithChallenge({ tokenHash, passwordHash }) {
      return transaction(async (client) => {
        const result = await client.query(
          `SELECT id, user_id, email, expires_at, consumed_at
           FROM password_reset_challenges WHERE token_hash = $1 FOR UPDATE`,
          [tokenHash],
        );
        const record = result.rows[0];
        if (!record || record.consumed_at || new Date(record.expires_at).getTime() <= Date.now()) {
          return { status: 'invalid' };
        }
        const update = await client.query(`UPDATE users SET password = $2 WHERE id = $1`, [record.user_id, passwordHash]);
        if (update.rowCount !== 1) return { status: 'invalid' };
        await client.query(`UPDATE password_reset_challenges SET consumed_at = CURRENT_TIMESTAMP WHERE id = $1`, [record.id]);
        await client.query(
          `UPDATE auth_session_families SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP), revoke_reason = COALESCE(revoke_reason, 'password_reset') WHERE user_id = $1`,
          [record.user_id],
        );
        await client.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP) WHERE user_id = $1`, [record.user_id]);
        return { status: 'reset', userId: Number(record.user_id), email: record.email };
      }, { role: 'system' });
    },

    async recordIpLoginAttempt(ipHash) {
      return transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`ip:${ipHash}`]);
        await client.query(`DELETE FROM auth_rate_limit_events WHERE occurred_at <= CURRENT_TIMESTAMP - INTERVAL '1 minute'`);
        const count = await client.query(
          `SELECT COUNT(*)::int AS count FROM auth_rate_limit_events WHERE scope = 'ip' AND key_hash = $1 AND occurred_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'`,
          [ipHash],
        );
        if (Number(count.rows[0]?.count) >= 10) return false;
        await client.query(`INSERT INTO auth_rate_limit_events (scope, key_hash) VALUES ('ip', $1)`, [ipHash]);
        return true;
      }, { role: 'system' });
    },

    async beginAccountLoginAttempt(emailHash) {
      return transaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`account:${emailHash}`]);
        const current = await client.query(`SELECT * FROM auth_account_security WHERE email_hash = $1 FOR UPDATE`, [emailHash]);
        let row = current.rows[0];
        const now = Date.now();
        if (row && new Date(row.expires_at).getTime() <= now) {
          await client.query(`DELETE FROM auth_account_security WHERE email_hash = $1`, [emailHash]);
          row = null;
        }
        if (row && ((row.in_flight_until && new Date(row.in_flight_until).getTime() > now) || new Date(row.next_allowed_at).getTime() > now)) {
          return false;
        }
        await client.query(
          `INSERT INTO auth_account_security (email_hash, failures, next_allowed_at, expires_at, in_flight_until, updated_at)
           VALUES ($1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '15 minutes', CURRENT_TIMESTAMP + INTERVAL '30 seconds', CURRENT_TIMESTAMP)
           ON CONFLICT (email_hash) DO UPDATE SET in_flight_until = CURRENT_TIMESTAMP + INTERVAL '30 seconds', updated_at = CURRENT_TIMESTAMP`,
          [emailHash],
        );
        return true;
      }, { role: 'system' });
    },

    async failAccountLoginAttempt(emailHash) {
      return transaction(async (client) => {
        const result = await client.query(`SELECT failures FROM auth_account_security WHERE email_hash = $1 FOR UPDATE`, [emailHash]);
        const failures = Number(result.rows[0]?.failures ?? 0) + 1;
        const delayMs = failures >= 5 ? lockDurationMs : 1000 * (2 ** (failures - 1));
        await client.query(
          `INSERT INTO auth_account_security (email_hash, failures, next_allowed_at, expires_at, in_flight_until, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'), CURRENT_TIMESTAMP + INTERVAL '15 minutes', NULL, CURRENT_TIMESTAMP)
           ON CONFLICT (email_hash) DO UPDATE SET failures = $2,
             next_allowed_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'),
             expires_at = CURRENT_TIMESTAMP + INTERVAL '15 minutes', in_flight_until = NULL, updated_at = CURRENT_TIMESTAMP`,
          [emailHash, failures, delayMs],
        );
        return { failures, notifyLockout: failures === 5 };
      }, { role: 'system' });
    },

    async succeedAccountLoginAttempt(emailHash) {
      return transaction(async (client) => {
        await client.query(`DELETE FROM auth_account_security WHERE email_hash = $1`, [emailHash]);
      }, { role: 'system' });
    },

    async releaseAccountLoginAttempt(emailHash) {
      return transaction(async (client) => {
        await client.query(`UPDATE auth_account_security SET in_flight_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE email_hash = $1`, [emailHash]);
      }, { role: 'system' });
    },

    async resetAccountLoginSecurity(email) {
      const emailHash = privacyHash(email);
      return transaction(async (client) => {
        await client.query(`DELETE FROM auth_account_security WHERE email_hash = $1`, [emailHash]);
      }, { role: 'system' });
    },

    async listActiveMemberships(userId) {
      return transaction(async (client) => {
        await applyDatabaseActor(client, { userId, role: 'authenticated', capability: 'identity_security' });
        const result = await client.query(
          `SELECT pm.drugstore_id AS "drugstoreId", pm.membership_role AS "membershipRole", pm.is_active AS "isActive", d.name AS "drugstoreName"
           FROM pharmacy_memberships pm
           INNER JOIN drugstores d ON d.id = pm.drugstore_id
           WHERE pm.user_id = $1 AND pm.is_active = 1
           ORDER BY d.name, pm.drugstore_id`,
          [userId],
        );
        return result.rows.map((row) => ({ ...row, drugstoreId: Number(row.drugstoreId), isActive: Number(row.isActive) === 1 }));
      }, { userId, role: 'authenticated' });
    },

    async findActiveMembership(userId, drugstoreId) {
      const memberships = await this.listActiveMemberships(userId);
      return memberships.find((item) => Number(item.drugstoreId) === Number(drugstoreId)) ?? null;
    },

    async listDrugstoreMemberships(drugstoreId) {
      return transaction(async (client) => {
        const result = await client.query(
          `SELECT pm.user_id AS "userId", u.name, u.email, pm.drugstore_id AS "drugstoreId",
                  pm.membership_role AS "membershipRole", pm.is_active AS "isActive", pm.created_at AS "createdAt"
           FROM pharmacy_memberships pm
           INNER JOIN users u ON u.id = pm.user_id
           WHERE pm.drugstore_id = $1
           ORDER BY u.name, pm.user_id`,
          [drugstoreId],
        );
        return result.rows.map((row) => ({ ...row, userId: Number(row.userId), drugstoreId: Number(row.drugstoreId), isActive: Number(row.isActive) === 1 }));
      });
    },

    async upsertMembership({ actorId, userId, drugstoreId, membershipRole }) {
      return transaction(async (client) => {
        const user = await client.query(`SELECT id, role FROM users WHERE id = $1 LIMIT 1`, [userId]);
        if (!user.rows[0]) return { status: 'user_missing' };
        if (user.rows[0].role !== 'partner') return { status: 'role_invalid' };
        const store = await client.query(`SELECT id FROM drugstores WHERE id = $1 LIMIT 1`, [drugstoreId]);
        if (!store.rows[0]) return { status: 'store_missing' };
        await client.query(
          `INSERT INTO pharmacy_memberships (user_id, drugstore_id, membership_role, is_active)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (user_id, drugstore_id) DO UPDATE SET membership_role = EXCLUDED.membership_role, is_active = 1`,
          [userId, drugstoreId, membershipRole],
        );
        await client.query(
          `INSERT INTO audit_logs (user_id, action, description) VALUES ($1, 'UPSERT_PHARMACY_MEMBERSHIP', $2)`,
          [actorId, `Assigned user ${userId} to drugstore ${drugstoreId} as ${membershipRole}.`],
        );
        return { status: 'ok' };
      });
    },

    async createPartnerAccount({ actorId, drugstoreId, email, passwordHash }) {
      return transaction(async (client) => {
        const store = await client.query(`SELECT id, name FROM drugstores WHERE id = $1 LIMIT 1`, [drugstoreId]);
        if (!store.rows[0]) return { status: 'store_missing' };
        const existing = await client.query(`SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`, [email]);
        if (existing.rows[0]) return { status: 'email_taken' };
        let created;
        try {
          created = await client.query(
            `INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'partner') RETURNING id`,
            [String(store.rows[0].name).slice(0, 255), email, passwordHash],
          );
        } catch (error) {
          if (error?.code === '23505') return { status: 'email_taken' };
          throw error;
        }
        const userId = Number(created.rows[0].id);
        await client.query(
          `INSERT INTO pharmacy_memberships (user_id, drugstore_id, membership_role, is_active) VALUES ($1, $2, 'owner', 1)`,
          [userId, drugstoreId],
        );
        await client.query(
          `INSERT INTO audit_logs (user_id, action, description) VALUES ($1, 'CREATE_PARTNER_ACCOUNT', $2)`,
          [actorId, `Created partner account ${userId} for drugstore ${drugstoreId}.`],
        );
        return { status: 'ok', userId };
      });
    },

    async deletePharmacyAccount({ actorId, drugstoreId, anonymise }) {
      // Hashing is slow and async, so it is prepared before the transaction opens.
      const members = await this.listDrugstoreMemberships(drugstoreId);
      const partnerIds = [...new Set(members.map((member) => Number(member.userId)))];
      const prepared = new Map();
      for (const userId of partnerIds) prepared.set(userId, await anonymise(userId));
      return transaction(async (client) => {
        const store = await client.query(`SELECT id, name FROM drugstores WHERE id = $1 FOR UPDATE`, [drugstoreId]);
        if (!store.rows[0]) return { status: 'store_missing' };
        if (store.rows[0].name === 'Deleted pharmacy') return { status: 'already_deleted' };
        const open = await client.query(
          `SELECT 1 FROM order_drugstores WHERE drugstore_id = $1 AND status NOT IN ('cancelled','expired','completed','rejected') LIMIT 1`,
          [drugstoreId],
        );
        if (open.rows[0]) return { status: 'open_orders' };
        const anonymised = [];
        for (const userId of partnerIds) {
          const user = await client.query(`SELECT id, role FROM users WHERE id = $1 FOR UPDATE`, [userId]);
          if (!user.rows[0] || user.rows[0].role !== 'partner') continue;
          // A login that also works for another pharmacy keeps its account; only this pharmacy's link is removed.
          const others = await client.query(
            `SELECT 1 FROM pharmacy_memberships WHERE user_id = $1 AND drugstore_id <> $2 AND is_active = 1 LIMIT 1`,
            [userId, drugstoreId],
          );
          if (others.rows[0]) continue;
          const wipe = prepared.get(userId);
          await client.query(
            `UPDATE users SET name = $2, email = $3, phone = NULL, birthdate = NULL, password = $4 WHERE id = $1 AND role = 'partner'`,
            [userId, wipe.name, wipe.email, wipe.passwordHash],
          );
          anonymised.push(userId);
        }
        await client.query(`DELETE FROM pharmacy_memberships WHERE drugstore_id = $1`, [drugstoreId]);
        await client.query(
          `UPDATE drugstores SET name = 'Deleted pharmacy', address = 'Deleted', operating_hours = NULL,
                  latitude = 0, longitude = 0, is_active = 0, public_profile_published_at = NULL WHERE id = $1`,
          [drugstoreId],
        );
        await client.query(
          `INSERT INTO audit_logs (user_id, action, description) VALUES ($1, 'ADMIN_DELETE_PHARMACY', $2)`,
          [actorId, `Administrator deleted pharmacy ${drugstoreId} and ${anonymised.length} partner account(s).`],
        );
        return { status: 'ok', userIds: anonymised };
      });
    },

    async deactivateMembership({ actorId, userId, drugstoreId }) {
      return transaction(async (client) => {
        const result = await client.query(
          `UPDATE pharmacy_memberships SET is_active = 0 WHERE user_id = $1 AND drugstore_id = $2 AND is_active = 1`,
          [userId, drugstoreId],
        );
        if (result.rowCount === 0) return false;
        await client.query(
          `INSERT INTO audit_logs (user_id, action, description) VALUES ($1, 'DEACTIVATE_PHARMACY_MEMBERSHIP', $2)`,
          [actorId, `Deactivated user ${userId} membership for drugstore ${drugstoreId}.`],
        );
        return true;
      });
    },
  };

  return assertSecurityRepository(repository);
}
