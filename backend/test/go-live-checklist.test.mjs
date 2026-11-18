import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGoLive } from '../src/domain/catalog/go-live.js';
import { createCatalogService } from '../src/application/catalog-service.js';

const ready = { name: 'ALV Pharmacy', address: '1 Main St', operatingHours: '8am-8pm', latitude: '14.6', longitude: '121.0', accountNo: 1,
  duplicateNames: 0, verificationStatus: 'verified', isActive: 1, partnerAccounts: 1, activePlans: 1, stockedItems: 3, pendingSubmissions: 0 };

test('a complete pharmacy can go live', () => {
  const result = evaluateGoLive(ready);
  assert.equal(result.canGoLive, true);
  assert.equal(result.checks.every((check) => check.ok), true);
});

test('each missing item blocks go-live', () => {
  for (const [override, id] of [
    [{ operatingHours: ' ' }, 'details'], [{ address: '' }, 'details'],
    [{ latitude: '121.0', longitude: '14.6' }, 'location'], [{ latitude: null }, 'location'],
    [{ duplicateNames: 1 }, 'account'], [{ accountNo: null }, 'account'],
    [{ verificationStatus: 'pending' }, 'verified'], [{ isActive: 0 }, 'verified'],
    [{ partnerAccounts: 0 }, 'login'], [{ activePlans: 0 }, 'plan'],
    [{ stockedItems: 0 }, 'stock'], [{ pendingSubmissions: 2 }, 'review'],
  ]) {
    const result = evaluateGoLive({ ...ready, ...override });
    assert.equal(result.canGoLive, false, id);
    assert.equal(result.checks.find((check) => check.id === id).ok, false, id);
  }
});

function service(facts, calls = []) {
  const repository = new Proxy({}, { get: (_, name) => {
    if (name === 'getGoLiveFacts') return async () => facts;
    if (name === 'setPublication') return async (id, live) => { calls.push(['publish', id, live]); return true; };
    if (name === 'appendAudit') return async (...args) => calls.push(['audit', ...args]);
    return async () => null;
  } });
  return createCatalogService({ repository });
}

test('going live is refused until the checklist passes, and take-down always works', async () => {
  const calls = [];
  const blocked = await service({ ...ready, stockedItems: 0 }, calls).setGoLive(1, 5, { live: true }, { partnerAccounts: 1 });
  assert.equal(blocked.status, 409);
  assert.equal(calls.length, 0);
  const ok = await service(ready, calls).setGoLive(1, 5, { live: true }, { partnerAccounts: 1 });
  assert.equal(ok.status, 200);
  assert.deepEqual(calls[0], ['publish', 5, true]);
  const down = await service({ ...ready, stockedItems: 0 }, calls).setGoLive(1, 5, { live: false }, { partnerAccounts: 0 });
  assert.equal(down.status, 200);
  assert.equal((await service(ready).setGoLive(1, 5, { live: 'yes' })).status, 400);
  assert.equal((await service(null).setGoLive(1, 5, { live: true })).status, 404);
});
