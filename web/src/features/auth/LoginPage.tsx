import { type FormEvent, useState } from 'react';
import { useSession } from '../../auth/session';

export function LoginPage() {
  return <main className="login-page">
    <section className="login-card" aria-labelledby="login-title">
      <div className="brand-mark" aria-hidden="true"><img src="/brand-mark.png" alt="" /></div>
      <h1 id="login-title">NearPill Operations Portal</h1>
      {new URLSearchParams(window.location.search).has('passwordChanged') && <p role="status">Password changed. Sign in with your new password.</p>}
      <p>Sign in with your administrator or partner pharmacy account.</p>
      <SignInForm />
      <a className="policy-link" href="/policies.html">Privacy and service information</a>
      <a className="policy-link" href="/site/">Visit the NearPill website</a>
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
