import { failure, success } from './result.js';
import { assertSecurityRepository } from '../ports/security-repository.js';
import { normalizeEmail, passwordMatchesIdentity, signupPasswordMessage, validEmail, validSignupPassword } from '../domain/identity/input-policy.js';

const roles = new Set(['owner', 'manager', 'staff']);

export function createMembershipService({ repository, hashPassword }) {
  assertSecurityRepository(repository);
  if (typeof hashPassword !== 'function') throw new TypeError('A password hasher is required.');
  return Object.freeze({
    async list(drugstoreIdValue) {
      const drugstoreId = Number(drugstoreIdValue);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Invalid drugstore ID.');
      return success(await repository.listDrugstoreMemberships(drugstoreId));
    },
    async upsert(actorId, drugstoreIdValue, body = {}) {
      const drugstoreId = Number(drugstoreIdValue);
      const userId = Number(body.userId);
      const membershipRole = String(body.membershipRole || '').trim().toLowerCase();
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Invalid drugstore ID.');
      if (!Number.isInteger(userId) || userId <= 0) return failure(400, 'Valid userId is required.');
      if (!roles.has(membershipRole)) return failure(400, 'membershipRole must be owner, manager, or staff.');
      const result = await repository.upsertMembership({ actorId, userId, drugstoreId, membershipRole });
      if (result.status === 'user_missing') return failure(404, 'User not found.');
      if (result.status === 'store_missing') return failure(404, 'Drugstore not found.');
      if (result.status === 'role_invalid') return failure(409, 'Only partner accounts can receive pharmacy memberships.');
      return success({ userId, drugstoreId, membershipRole, isActive: true }, 201);
    },
    // An administrator creates the login a partner pharmacy uses on the partner portal. The password is hashed here and
    // is never returned, logged or written to the audit log.
    async createPartnerAccount(actorId, drugstoreIdValue, body = {}) {
      const drugstoreId = Number(drugstoreIdValue);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Invalid drugstore ID.');
      const rawEmail = String(body.email ?? '');
      const password = String(body.password ?? '');
      if (!validEmail(rawEmail)) return failure(400, 'Enter a valid email address.');
      const email = normalizeEmail(rawEmail);
      if (!validSignupPassword(password)) return failure(400, signupPasswordMessage);
      if (passwordMatchesIdentity(password, { email, name: '' })) return failure(400, 'Do not use the email address as the password.');
      const result = await repository.createPartnerAccount({ actorId, drugstoreId, email, passwordHash: await hashPassword(password) });
      if (result.status === 'store_missing') return failure(404, 'Drugstore not found.');
      if (result.status === 'email_taken') return failure(409, 'An account with this email already exists.');
      return success({ userId: result.userId, drugstoreId, email, membershipRole: 'owner', role: 'partner' }, 201);
    },
    async deactivate(actorId, drugstoreIdValue, userIdValue) {
      const drugstoreId = Number(drugstoreIdValue);
      const userId = Number(userIdValue);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0 || !Number.isInteger(userId) || userId <= 0) {
        return failure(400, 'Invalid membership identifier.');
      }
      if (!(await repository.deactivateMembership({ actorId, userId, drugstoreId }))) {
        return failure(404, 'Active membership not found.');
      }
      return success({ userId, drugstoreId, isActive: false });
    },
  });
}
