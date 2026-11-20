import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnershipLifecycleService, daysBetween, manilaDate, reminderEmail, reminderKey } from '../src/application/partnership-lifecycle-service.js';
import { partnershipExpiry } from '../src/domain/subscriptions/plans.js';

// A pharmacy that joined 2026-08-20 on Basic (3 months) expires on 2026-11-20.
const JOINED = '2026-08-20T02:00:00.000Z';
const at = (date) => Date.parse(`${date}T04:00:00.000Z`); // noon in Manila on that date

function fake({ stores, members = [{ userId: 1, email: 'Owner@Pharmacy.ph', isActive: true }], sentKeys = [], failMail = false } = {}) {
  const state = { sent: [], mails: [], hidden: [], keys: new Set(sentKeys) };
  const repository = {
    async listPartnerPharmacies() { return stores; },
    async reminderSent(key) { return state.keys.has(key); },
    async recordReminder(key) { state.keys.add(key); state.sent.push(key); },
    async hideExpired(id, expiry) { state.hidden.push([id, expiry]); return true; },
  };
  const sendEmail = async (to, subject, text) => { if (failMail) throw new Error('mail down'); state.mails.push({ to, subject, text }); };
  const make = (date) => createPartnershipLifecycleService({ repository, listMembers: async () => members, sendEmail, clock: () => at(date) });
  return { state, make };
}
const store = (extra = {}) => ({ id: 5, name: 'Alpha Pharmacy', createdAt: JOINED, tier: 'Basic', publishedAt: '2026-08-21T02:00:00.000Z', ...extra });

test('the expiry date is 3 months after joining on Basic', () => {
  assert.equal(partnershipExpiry(JOINED, 'Basic'), '2026-11-20');
  assert.equal(daysBetween('2026-11-13', '2026-11-20'), 7);
  assert.equal(manilaDate(Date.parse('2026-11-19T17:00:00Z')), '2026-11-20');
});

test('reminders go out 7, 3 and 1 day before the expiry date, once each, to every active login', async () => {
  for (const [date, days] of [['2026-11-13', 7], ['2026-11-17', 3], ['2026-11-19', 1]]) {
    const { state, make } = fake({ stores: [store()] });
    const result = await make(date).run();
    assert.equal(result.reminders, 1, date);
    assert.equal(state.mails.length, 1);
    assert.equal(state.mails[0].to, 'owner@pharmacy.ph');
    assert.match(state.mails[0].subject, days === 1 ? /expires tomorrow/ : new RegExp(`in ${days} days`));
    assert.match(state.mails[0].text, /2026-11-20/);
    assert.deepEqual(state.sent, [reminderKey(5, '2026-11-20', days)]);
    await make(date).run();
    assert.equal(state.mails.length, 1, 'a second run on the same day sends nothing more');
  }
});

test('no reminder on other days, and nothing is hidden before the expiry date has passed', async () => {
  for (const date of ['2026-11-12', '2026-11-14', '2026-11-16', '2026-11-18', '2026-11-20']) {
    const { state, make } = fake({ stores: [store()] });
    await make(date).run();
    assert.equal(state.mails.length, 0, date);
    assert.deepEqual(state.hidden, [], `${date} is still inside the partnership`);
  }
});

test('the day after the expiry date the pharmacy is hidden, once', async () => {
  const { state, make } = fake({ stores: [store()] });
  const result = await make('2026-11-21').run();
  assert.equal(result.hidden, 1);
  assert.deepEqual(state.hidden, [[5, '2026-11-20']]);
  const again = fake({ stores: [store({ publishedAt: null })] });
  assert.equal((await again.make('2026-11-21').run()).hidden, 0, 'already hidden: nothing to do');
});

test('a pharmacy an admin published again after its expiry date is not hidden again', async () => {
  const { state, make } = fake({ stores: [store({ publishedAt: '2026-11-21T01:00:00.000Z' })] });
  assert.equal((await make('2026-11-22').run()).hidden, 0);
  assert.deepEqual(state.hidden, []);
});

test('pharmacies without a plan, and logins that are removed, are left alone', async () => {
  const none = fake({ stores: [store({ tier: null })] });
  assert.equal((await none.make('2026-11-13').run()).checked, 0);
  const removed = fake({ stores: [store()], members: [{ userId: 1, email: 'a@b.ph', isActive: false }] });
  await removed.make('2026-11-13').run();
  assert.equal(removed.state.mails.length, 0);
  assert.equal(removed.state.sent.length, 0);
});

test('a failed email is not recorded as sent, so the next run tries again', async () => {
  const { state, make } = fake({ stores: [store()], failMail: true });
  const originalError = console.error; console.error = () => {};
  try { const result = await make('2026-11-13').run(); assert.equal(result.failed, 1); } finally { console.error = originalError; }
  assert.equal(state.sent.length, 0);
});

test('the reminder says what happens and how to renew', () => {
  const { subject, text } = reminderEmail({ name: 'Alpha Pharmacy', expiry: '2026-11-20', days: 7 });
  assert.match(subject, /in 7 days/);
  assert.match(text, /hidden from customers/);
  assert.match(text, /nearpillemail\.business@gmail\.com/);
});
