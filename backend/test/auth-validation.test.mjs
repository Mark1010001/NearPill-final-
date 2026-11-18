import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  normalizeEmail,
  validEmail,
  validFullName,
  validLoginPassword,
  validSignupPassword,
} from '../src/domain/identity/input-policy.js';

const contracts = await readFile(new URL('../src/http/contracts.ts', import.meta.url), 'utf8');
const transport = await readFile(new URL('../src/http/transport.ts', import.meta.url), 'utf8');
const app = await readFile(new URL('../src/http/app.ts', import.meta.url), 'utf8');
const routes = await readFile(new URL('../src/http/routes/v1/register.ts', import.meta.url), 'utf8');

test('auth input policy preserves the pre-Hono email, name, and password contract', () => {
  assert.equal(normalizeEmail('  USER@example.COM '), 'user@example.com');
  for (const value of ['user@example.com', "o'hara@example.co.uk", 'a+b@example.ph']) {
    assert.equal(validEmail(value), true, value);
  }
  for (const value of ['.user@example.com', 'user..x@example.com', 'user@localhost', 'user@-example.com', 'ユーザー@example.com']) {
    assert.equal(validEmail(value), false, value);
  }
  assert.equal(validFullName('María Dela Cruz'), true);
  assert.equal(validFullName("O’Connor Jr."), true);
  assert.equal(validFullName('<script>alert(1)</script>'), false);
  assert.equal(validFullName('12345'), false);
  // Sign-up passwords: 10-128 characters with a letter and a number, and not a common password.
  assert.equal(validSignupPassword('Strong1!pass'), true);
  assert.equal(validSignupPassword('123456'), false);
  assert.equal(validSignupPassword('longpasswordonly'), false);
  assert.equal(validSignupPassword('Password123'), false);
  assert.equal(validLoginPassword('x'), true);
  assert.equal(validLoginPassword(''), false);
});

test('auth request validation is owned by strict Zod schemas at the Hono boundary', () => {
  assert.match(contracts, /RegisterSchema/);
  assert.match(contracts, /LoginSchema/);
  assert.match(contracts, /validEmail/);
  assert.match(contracts, /validFullName/);
  assert.match(contracts, /validSignupPassword/);
  assert.ok(contracts.includes("code: z.string().regex(/^\\d{6}$/)"));
  assert.ok(contracts.includes("token: z.string().regex(/^[a-f0-9]{64}$/)"));
  assert.match(contracts, /\.strict\(\)/);
  assert.match(app, /defaultHook/);
  assert.match(app, /invalidInputMessage/);
});

test('compatibility transport rejects malformed or oversized JSON before invoking use cases', () => {
  assert.match(transport, /Buffer\.byteLength\(text, 'utf8'\) > byteLimit/);
  assert.match(transport, /JSON\.parse\(text\)/);
  assert.match(transport, /Invalid JSON request body/);
  assert.match(transport, /schema\.safeParse\(value\)/);
  assert.match(routes, /const authBodyLimit = 4 \* 1024/);
});

test('OpenAPI request schemas reuse the same Zod objects as runtime validation', () => {
  assert.match(routes, /request\.body =/);
  assert.match(routes, /schema: spec\.body/);
  assert.match(routes, /c\.req\.valid\('json'\)/);
  assert.match(routes, /parseBody\(c, spec\.body/);
  assert.match(routes, /request\.params = spec\.params/);
  assert.match(routes, /request\.query = spec\.query/);
});
