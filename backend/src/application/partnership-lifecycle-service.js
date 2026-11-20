import { partnershipExpiry } from '../domain/subscriptions/plans.js';

// Runs on a timer (see bootstrap/server.ts). For every partner pharmacy it
//  - emails the pharmacy's active logins 7, 3 and 1 day(s) before the partnership expires, once each;
//  - hides the pharmacy from customers once the expiry date has passed (the expiry date itself is the last full day).
//    A pharmacy an admin published again AFTER its expiry date is left visible: that publish is the admin's renewal decision.
// Dates are Philippine dates (UTC+8), the same as the admin screen. Nothing is deleted: a hidden pharmacy keeps its
// orders and records, and the admin can publish it again after the partnership is renewed.
export const REMINDER_DAYS = Object.freeze([7, 3, 1]);
const CONTACT = 'nearpillemail.business@gmail.com';

export function manilaDate(now) {
  return new Date(new Date(now).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

export function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

export function reminderKey(drugstoreId, expiry, days) {
  return `drugstore:${drugstoreId} expires:${expiry} days:${days}`;
}

export function reminderEmail({ name, expiry, days }) {
  const when = days === 1 ? 'tomorrow' : `in ${days} days`;
  return {
    subject: `Your NearPill partnership expires ${when}`,
    text: `${name}'s NearPill partnership expires ${when}, on ${expiry}.\n\nAfter that date the pharmacy is hidden from customers in the NearPill app until the partnership is renewed. Your orders and records are kept.\n\nTo renew, contact NearPill at ${CONTACT}.`,
  };
}

export function createPartnershipLifecycleService({ repository, listMembers, sendEmail, clock = () => Date.now() }) {
  for (const method of ['listPartnerPharmacies', 'reminderSent', 'recordReminder', 'hideExpired']) {
    if (typeof repository?.[method] !== 'function') throw new TypeError(`Partnership repository must implement ${method}().`);
  }
  if (typeof listMembers !== 'function' || typeof sendEmail !== 'function') throw new TypeError('Member lookup and email are required.');
  return Object.freeze({
    async run() {
      const today = manilaDate(clock());
      const result = { checked: 0, reminders: 0, hidden: 0, failed: 0 };
      for (const store of await repository.listPartnerPharmacies()) {
        const expiry = partnershipExpiry(store.createdAt, store.tier);
        if (!expiry) continue;
        result.checked += 1;
        try {
          if (expiry < today) {
            const publishedOn = store.publishedAt ? manilaDate(store.publishedAt) : null;
            if (publishedOn && publishedOn <= expiry && await repository.hideExpired(store.id, expiry)) result.hidden += 1;
            continue;
          }
          const days = daysBetween(today, expiry);
          if (!REMINDER_DAYS.includes(days)) continue;
          const key = reminderKey(store.id, expiry, days);
          if (await repository.reminderSent(key)) continue;
          const recipients = [...new Set((await listMembers(store.id)).filter((m) => m.isActive && m.email).map((m) => String(m.email).toLowerCase()))];
          if (recipients.length === 0) continue;
          const message = reminderEmail({ name: store.name, expiry, days });
          for (const to of recipients) await sendEmail(to, message.subject, message.text);
          await repository.recordReminder(key);
          result.reminders += 1;
        } catch (error) {
          result.failed += 1;
          console.error('partnership_lifecycle_failed', { drugstoreId: store.id, code: error?.code });
        }
      }
      return result;
    },
  });
}
