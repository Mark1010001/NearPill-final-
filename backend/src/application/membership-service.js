import { randomBytes } from 'node:crypto';
import { failure, success } from './result.js';
import { assertSecurityRepository } from '../ports/security-repository.js';
import { normalizeEmail, passwordMatchesIdentity, signupPasswordMessage, validEmail, validSignupPassword } from '../domain/identity/input-policy.js';

const roles = new Set(['owner', 'manager', 'staff']);

export function createMembershipService({ repository, hashPassword, sendSetupEmail, emailInUse }) {
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
    // An administrator creates the login a partner pharmacy uses on the partner portal. When no password is given (the
    // normal case) the server makes a random one nobody ever sees; the partner chooses their own through the emailed
    // set-password link. Any password is hashed here and is never returned, logged or written to the audit log.
    async createPartnerAccount(actorId, drugstoreIdValue, body = {}) {
      const drugstoreId = Number(drugstoreIdValue);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0) return failure(400, 'Invalid drugstore ID.');
      const rawEmail = String(body.email ?? '');
      const supplied = body.password !== undefined && body.password !== null && String(body.password) !== '';
      const password = supplied ? String(body.password) : randomBytes(24).toString('base64url');
      if (!validEmail(rawEmail)) return failure(400, 'Enter a valid email address.');
      const email = normalizeEmail(rawEmail);
      if (supplied && !validSignupPassword(password)) return failure(400, signupPasswordMessage);
      if (supplied && passwordMatchesIdentity(password, { email, name: '' })) return failure(400, 'Do not use the email address as the password.');
      const result = await repository.createPartnerAccount({ actorId, drugstoreId, email, passwordHash: await hashPassword(password) });
      if (result.status === 'store_missing') return failure(404, 'Drugstore not found.');
      if (result.status === 'email_taken') return failure(409, 'An account with this email already exists.');
      return success({ userId: result.userId, drugstoreId, email, membershipRole: 'owner', role: 'partner' }, 201);
    },
    // Lets the Add pharmacy form refuse an email that already has any NearPill account BEFORE a pharmacy is created, so a refused
    // email never leaves a pharmacy behind with nobody who can sign in to it.
    async partnerEmailAvailable(body = {}) {
      const rawEmail = String(body.email ?? '');
      if (!validEmail(rawEmail)) return failure(400, 'Enter a valid email address.');
      if (typeof emailInUse !== 'function') return failure(503, 'The email check is not available right now.');
      return success({ available: !(await emailInUse(normalizeEmail(rawEmail))) });
    },
    // Emails the partner a sign-in link and a single-use link to choose their own password. No password is ever emailed.
    async sendLoginEmail(actorId, drugstoreIdValue, userIdValue) {
      const drugstoreId = Number(drugstoreIdValue);
      const userId = Number(userIdValue);
      if (!Number.isInteger(drugstoreId) || drugstoreId <= 0 || !Number.isInteger(userId) || userId <= 0) {
        return failure(400, 'Invalid membership identifier.');
      }
      if (typeof sendSetupEmail !== 'function') return failure(503, 'Email is not available right now.');
      const members = await repository.listDrugstoreMemberships(drugstoreId);
      const member = members.find((item) => item.userId === userId && item.isActive);
      if (!member) return failure(404, 'Active partner account not found.');
      try {
        await sendSetupEmail({ id: member.userId, email: member.email });
      } catch {
        return failure(502, 'The email could not be sent. Try again in a moment.');
      }
      return success({ userId, drugstoreId, email: member.email, sent: true });
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
