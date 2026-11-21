const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'backend/public/reset-password.js'), 'utf8');

for (const ok of [true, false]) {
  test(`reset page ${ok ? 'submits a token once and clears credentials' : 'shows a generic retry message'}`, async () => {
    let submitHandler;
    let finish;
    const calls = [];
    const token = 'a'.repeat(64);
    const elements = {
      resetForm: { reportValidity: () => true, addEventListener(_, fn) { submitHandler = fn; } },
      status: {}, submit: { disabled: false },
      password: { value: 'New-password1' },
      confirmPassword: { value: 'New-password1', focus() { this.focused = true; } },
    };
    const history = [];
    const context = vm.createContext({
      URLSearchParams,
      location: { hash: `#token=${token}`, pathname: '/reset-password' },
      history: { replaceState(...args) { history.push(args); } },
      document: { getElementById: id => elements[id] },
      fetch: async (...args) => {
        calls.push(args);
        await new Promise(resolve => { finish = resolve; });
        return { ok };
      },
    });
    vm.runInContext(script, context);
    assert.equal(history[0][2], '/reset-password');
    elements.confirmPassword.value = 'Does-not-match';
    await submitHandler({ preventDefault() {} });
    assert.equal(elements.confirmPassword.focused, true);
    assert.equal(calls.length, 0);
    elements.confirmPassword.value = 'New-password1';
    const pending = submitHandler({ preventDefault() {} });
    await submitHandler({ preventDefault() {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/api/v1/auth/reset-password');
    assert.deepEqual(JSON.parse(calls[0][1].body), { token, password: 'New-password1' });
    finish();
    await pending;
    if (ok) {
      assert.equal(elements.resetForm.hidden, true);
      assert.equal(elements.password.value, '');
      assert.match(elements.status.textContent, /Password updated/);
    } else {
      assert.match(elements.status.textContent, /Unable to reset password/);
      assert.equal(elements.submit.disabled, false);
    }
  });
}

test('reset page hides the form when the link has no valid token', () => {
  const elements = new Map();
  const context = vm.createContext({
    URLSearchParams,
    location: { hash: '#token=invalid', pathname: '/reset-password' },
    history: { replaceState() {} },
    document: { getElementById(id) {
      if (!elements.has(id)) elements.set(id, { addEventListener() {} });
      return elements.get(id);
    } },
  });
  vm.runInContext(script, context);
  assert.equal(elements.get('resetForm').hidden, true);
  assert.match(elements.get('status').textContent, /reset link is invalid/);
});

for (const [label, password, status, expected] of [
  ['a password that is too weak', 'short1', 200, /at least 10 characters with a letter and a number/],
  ['an invalid or used link', 'Strong-pass1', 400, /invalid, already used or expired/],
]) {
  test(`reset page explains ${label}`, async () => {
    let submitHandler;
    const calls = [];
    const elements = {
      resetForm: { reportValidity: () => true, addEventListener(_, fn) { submitHandler = fn; } },
      status: {}, submit: { disabled: false },
      password: { value: password, focus() {} },
      confirmPassword: { value: password, focus() {} },
    };
    const context = vm.createContext({
      URLSearchParams,
      location: { hash: `#token=${'a'.repeat(64)}`, pathname: '/reset-password' },
      history: { replaceState() {} },
      document: { getElementById: id => elements[id] },
      fetch: async (...args) => { calls.push(args); return { ok: false, status }; },
    });
    vm.runInContext(script, context);
    await submitHandler({ preventDefault() {} });
    assert.match(elements.status.textContent, expected);
    assert.equal(calls.length, status === 400 ? 1 : 0);
    assert.equal(elements.submit.disabled, false);
  });
}
