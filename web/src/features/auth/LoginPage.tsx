import { type FormEvent, useState } from 'react';
import { api } from '../../api/client';
import { useSession } from '../../auth/session';

export function LoginPage() {
  const [forgot, setForgot] = useState(false);
  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="brand-mark" aria-hidden="true"><img src="/brand-mark.png" alt="" /></div>
      <h1 id="login-title">NearPill Operations Portal</h1>
      {new URLSearchParams(window.location.search).has('passwordChanged') && <p role="status">Password changed. Sign in with your new password.</p>}
      {forgot ? <ForgotPasswordForm onBack={() => setForgot(false)} /> : <>
        <p>Sign in with your administrator or partner pharmacy account.</p>
        <SignInForm />
        <button type="button" className="policy-link" onClick={() => setForgot(true)}>Forgot password?</button>
      </>}
      <a className="policy-link" href="/policies.html">Privacy and service information</a>
      <a className="policy-link" href="/">Visit the NearPill website</a>
    </section>
  </main>;
}

export function SignInForm({ disabled = false }: { disabled?: boolean }) {
  const { login } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit}>
    <label>Email<input type="email" autoComplete="username" maxLength={254} required readOnly={busy} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    <label>Password<input type="password" autoComplete="current-password" maxLength={255} required readOnly={busy} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    <button className="primary" type="submit" disabled={busy || disabled}>{busy ? 'Signing in…' : 'Sign in'}</button>
  </form>;
}

/** Emails a single-use reset link. The answer is the same whether or not the address has an account, so it cannot be used to find accounts. */
function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      await api.forgotPassword(email.trim());
      setMessage('If this account can receive email, a reset link will be sent. The link works once and expires in 15 minutes.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request a reset link.');
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit}>
    <p>Enter your account email and we will send a link to choose a new password. It needs at least 10 characters with a letter and a number.</p>
    <label>Email<input type="email" autoComplete="username" maxLength={254} required readOnly={busy} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <p role="status">{message}</p>}
    <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
    <button type="button" className="policy-link" onClick={onBack}>Back to sign in</button>
  </form>;
}
