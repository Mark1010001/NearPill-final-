import { type FormEvent, useState } from 'react';
import { api } from '../../api/client';
import { useSession } from '../../auth/session';

export function ChangePasswordPage() {
  const { clearSession } = useSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const password = String(fields.get('password'));
    if (password !== fields.get('confirmation')) {
      setError('The new passwords do not match.');
      event.currentTarget.querySelector<HTMLInputElement>('[name="confirmation"]')?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.changePassword(String(fields.get('currentPassword')), password);
      clearSession();
      window.location.assign('/portal?passwordChanged=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to change password.');
      setBusy(false);
    }
  }

  return <section className="card">
    <h1>Change password</h1>
    <p>Enter your current password and choose a new one. You’ll sign in again afterward.</p>
    <form className="password-form" onSubmit={submit}>
      <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" maxLength={255} required readOnly={busy} /></label>
      <label>New password<input name="password" type="password" autoComplete="new-password" minLength={6} maxLength={128} required readOnly={busy} aria-describedby="password-length" /></label>
      <small id="password-length">Use 6 to 128 characters.</small>
      <label>Confirm new password<input name="confirmation" type="password" autoComplete="new-password" minLength={6} maxLength={128} required readOnly={busy} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  </section>;
}
