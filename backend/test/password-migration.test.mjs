import assert from 'node:assert/strict';
import { createHash, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { passwordFormat, hashPassword, verifyPassword } from '../passwords.js';
import { auditPasswordStorage } from '../audit-passwords.js';
import { createLoginService } from '../src/application/login-service.js';

const password = ' Legacy-password<>! ';
const salt = Buffer.alloc(16, 7);
const key = await promisify(scrypt)(password, salt, 64, { N: 16384, r: 8, p: 5, maxmem: 64 * 1024 * 1024 });
const legacy = {
  plaintext: password,
  md5: `md5$${createHash('md5').update(password).digest('hex')}`,
  sha1: `sha1$${createHash('sha1').update(password).digest('hex')}`,
  scrypt: `scrypt$16384$8$5$${salt.toString('hex')}$${key.toString('hex')}`,
};

function loginFixture(user, { concurrentWrite = false } = {}) {
  let writes = 0;
  let issued = 0;
  const repository = {
    async findAuthUserByEmail(email) { return email === user.email ? { ...user } : null; },
    async replacePasswordIfCurrent({ newPasswordHash, currentPasswordHash }) {
      if (concurrentWrite || currentPasswordHash !== user.password) return 0;
      user.password = newPasswordHash;
      writes++;
      return 1;
    },
  };
  const security = {
    async begin(email) { return { email }; },
    async fail() { return { notifyLockout: false }; },
    async succeed() { return true; },
    async release() {},
  };
  const auth = {
    async issueCredentials() {
      issued++;
      return { accessToken: 'access', refreshToken: 'refresh', webSessionToken: 'web', csrfToken: 'csrf' };
    },
    webSessionCookieHeaders() { return ['session=web', 'csrf=csrf']; },
  };
  const login = createLoginService({ repository, auth, security, recovery: { async notify() {} } });
  return { login, get writes() { return writes; }, get issued() { return issued; } };
}

test('new password hashes use Argon2id with the required cost and distinct salts', async () => {
  const one = await hashPassword(password);
  const two = await hashPassword(password);
  assert.match(one, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(passwordFormat(one), 'argon2id');
  assert.notEqual(one, two);
  assert.ok(one.length <= 255);
  assert.equal(await verifyPassword(password, one), true);
  assert.equal(await verifyPassword(password.trim(), one), false);
  assert.equal(await verifyPassword(one, one), false);
});

for (const [format, stored] of Object.entries(legacy)) {
  test(`${format} credentials migrate only after a successful login, then remain unchanged`, async () => {
    const user = { id: 1, name: 'Test User', email: 'test@example.com', role: 'customer', password: stored };
    const fixture = loginFixture(user);
    const signIn = submitted => fixture.login.login({ email: user.email, password: submitted });

    assert.equal(passwordFormat(stored), format);
    assert.equal((await signIn('Incorrect-password')).result.status, 401);
    assert.equal(fixture.writes, 0);
    assert.equal(user.password, stored);

    assert.equal((await signIn(password)).result.status, 200);
    assert.equal(fixture.writes, 1);
    assert.equal(passwordFormat(user.password), 'argon2id');
    assert.equal(await verifyPassword(password, user.password), true);
    const upgraded = user.password;

    assert.equal((await signIn(password)).result.status, 200);
    assert.equal(fixture.writes, 1);
    assert.equal(user.password, upgraded);
    assert.equal(fixture.issued, 2);
  });
}

test('ambiguous bare digests and unsupported or corrupted hash formats require recovery', async () => {
  for (const stored of [
    createHash('md5').update(password).digest('hex'),
    createHash('sha1').update(password).digest('hex'),
    createHash('sha256').update(password).digest('hex'),
    'md5$not-a-digest', 'sha1$broken', 'scrypt$broken', '$argon2id$broken',
    '$argon2id$v=19$m=999999999,t=999999,p=9999$bad$bad',
  ]) {
    assert.ok(['ambiguous', 'unsupported'].includes(passwordFormat(stored)));
    assert.equal(await verifyPassword(password, stored), false);
    assert.equal(await verifyPassword(stored, stored), false);
  }
});

test('a concurrent password change prevents migration and session issuance', async () => {
  const user = { id: 1, name: 'Test User', email: 'test@example.com', role: 'customer', password };
  const fixture = loginFixture(user, { concurrentWrite: true });
  const response = await fixture.login.login({ email: user.email, password });
  assert.equal(response.result.status, 401);
  assert.equal(fixture.issued, 0);
});

test('audit script reads in batches and returns only format counts', async () => {
  const records = [...Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, password })),
    { id: 1001, password: await hashPassword(password) },
    { id: 1002, password: legacy.md5 },
    { id: 1003, password: 'a'.repeat(32) },
  ];
  const cursors = [];
  const pool = { async query(sql, [lastId]) {
    assert.equal(sql, 'SELECT id, password FROM users WHERE id > ? ORDER BY id LIMIT 1000');
    cursors.push(lastId);
    return [records.filter(row => row.id > lastId).slice(0, 1000)];
  } };
  const counts = await auditPasswordStorage(pool);
  assert.deepEqual(cursors, [0, 1000]);
  assert.deepEqual(counts, { argon2id: 1, scrypt: 0, md5: 1, sha1: 0, plaintext: 1000, ambiguous: 1, unsupported: 0, invalid: 0 });
  assert.doesNotMatch(JSON.stringify(counts), /Legacy-password|test@example/);
});
