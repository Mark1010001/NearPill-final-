import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { createPrescriptionReviews, prescriptionPhoto } from '../src/infrastructure/postgres/prescription-reviews.js';

const sample = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aA7sAAAAASUVORK5CYII=';

test('prescription photos are decoded, bounded, and stripped of metadata', async () => {
  const image = sharp({ create: { width: 2, height: 3, channels: 3, background: 'white' } });
  const png = await image.clone().png().toBuffer();
  assert.ok(await prescriptionPhoto(png.toString('base64'), 'image/png'));
  const jpeg = await image.jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const clean = await prescriptionPhoto(jpeg.toString('base64'), 'image/jpeg');
  const metadata = await sharp(clean).metadata();
  assert.deepEqual([metadata.width, metadata.height, metadata.exif], [3, 2, undefined]);
  assert.equal(await prescriptionPhoto(png.subarray(0, 33).toString('base64'), 'image/png'), null);
  assert.equal(await prescriptionPhoto(jpeg.subarray(0, -10).toString('base64'), 'image/jpeg'), null);
  assert.equal(await prescriptionPhoto(sample, 'image/jpeg'), null);
  assert.equal(await prescriptionPhoto(sample, 'image/svg+xml'), null);
  assert.equal(await prescriptionPhoto('A'.repeat(1398105), 'image/png'), null);
  const oversized = Buffer.from(sample, 'base64');
  oversized.writeUInt32BE(5000, 16);
  assert.equal(await prescriptionPhoto(oversized.toString('base64'), 'image/png'), null);
});

test('admins, customers and unrelated branches cannot open or decide pharmacy reviews', async () => {
  const database = { async query() { assert.fail('Unauthorized query'); }, async connect() { assert.fail('Unauthorized connection'); } };
  const reviews = createPrescriptionReviews(database);
  for (const actor of [{ role: 'customer' }, { role: 'admin' }, { role: 'partner', memberships: [{ drugstoreId: 12, membershipRole: 'staff' }] }]) {
    assert.equal((await reviews.queue(actor, 27)).status, 403);
    assert.equal((await reviews.photo(actor, 27, 4, '1794480000.000000')).status, 403);
    assert.equal((await reviews.decide(actor, 7, 27, 4, '1794480000.000000', 'approved')).status, 403);
  }
  assert.equal((await reviews.submit({ role: 'partner' }, 7, { drugstoreId: 27, medicineId: 4, photo: sample, mimeType: 'image/png' })).status, 403);
  assert.equal((await reviews.submit({ role: 'customer' }, 7, { drugstoreId: 27, medicineId: 4, photo: sample, mimeType: 'image/svg+xml' })).status, 400);
});

test('a rejection stores the reason, an approval stores none, and a resubmission clears it', async () => {
  const calls = [];
  const database = { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: 4, status: params?.[0] }], rowCount: 1 }; },
    async connect() { return { async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: 4, status: params?.[0] }], rowCount: 1 }; }, release() {} }; } };
  const reviews = createPrescriptionReviews(database);
  const partner = { role: 'partner', memberships: [{ drugstoreId: 27, membershipRole: 'staff', isActive: true }] };
  await reviews.decide(partner, 7, 27, 4, '1794480000.000000', 'rejected', 'Photo is blurry');
  const decide = calls.find((call) => /rejection_reason = /.test(call.sql) && call.params?.includes('Photo is blurry'));
  assert.ok(decide, 'decide writes rejection_reason');
  const submit = await import('node:fs').then((fs) => fs.readFileSync(new URL('../src/infrastructure/postgres/prescription-reviews.js', import.meta.url), 'utf8'));
  assert.match(submit, /rejection_reason = NULL/);
  calls.length = 0;
  await reviews.decide(partner, 7, 27, 4, '1794480000.000000', 'approved', 'ignored');
  assert.equal(calls.some((call) => call.params?.includes('ignored')), false, 'approval never stores a reason');
});
