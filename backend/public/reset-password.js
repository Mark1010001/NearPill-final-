const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
history.replaceState(null, '', location.pathname);
const form = document.getElementById('resetForm');
const status = document.getElementById('status');
const submit = document.getElementById('submit');
const password = document.getElementById('password');
const confirmPassword = document.getElementById('confirmPassword');

if (token.length !== 64 || !/^[a-f0-9]{64}$/.test(token)) {
  form.hidden = true;
  status.textContent = 'This reset link is invalid. Request a new link from Forgot Password in the NearPill app.';
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (submit.disabled) return;
  if (password.value !== confirmPassword.value) {
    status.textContent = 'The passwords do not match.';
    confirmPassword.focus();
    return;
  }
  const value = password.value;
  if (value.length < 10 || !/\p{L}/u.test(value) || !/\p{N}/u.test(value)) {
    status.textContent = 'Use at least 10 characters with a letter and a number.';
    password.focus();
    return;
  }
  submit.disabled = true;
  try {
    const response = await fetch('/api/v1/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: password.value }),
    });
    if (response.status === 400) {
      status.textContent = 'This link is invalid, already used or expired, or the password is too common. Request a new link, or choose a less common password.';
      return;
    }
    if (!response.ok) throw new Error('Reset failed');
    password.value = '';
    confirmPassword.value = '';
    form.hidden = true;
    status.textContent = 'Password updated. Return to the NearPill app and sign in with your new password.';
  } catch (_) {
    status.textContent = 'Unable to reset password. Request a new link or try again later.';
  } finally {
    submit.disabled = false;
  }
});
