import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { SessionUser } from '../../api/types';
import { useSession } from '../../auth/session';
import { policiesLabel } from './copy';
import { MaterialIcon } from './MaterialIcon';

/** The app's Settings screen: the signed-in account, the policies and "Delete account". */
export function SettingsPage({ user, signOutButton }: { user: SessionUser; signOutButton: ReactNode }) {
  const navigate = useNavigate();
  const { clearSession } = useSession();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [shown, setShown] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOutEverywhere() {
    if (signingOut) return;
    setSigningOut(true); setSignOutError(null);
    try {
      await api.logoutAll();
      navigate('/app/sign-in', { replace: true, state: { notice: 'You have been signed out of all devices.' } });
      clearSession();
    } catch {
      setSignOutError('Could not sign you out of all devices. Check your connection and try again.');
    } finally { setSigningOut(false); }
  }

  function review(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password === '') { setError('Enter your password to delete your account.'); return; }
    setError(null);
    setTyped('');
    setConfirming(true);
  }

  async function deleteAccount() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api.deleteAccount(String(user.id), { password });
      navigate('/app/sign-in', { replace: true, state: { notice: 'Your account has been deleted.' } });
      clearSession();
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError && err.status !== 0 && err.status < 500
        ? err.message : 'Could not delete your account. Check your connection and try again.');
    } finally { setBusy(false); }
  }

  return <div className="np-mint">
    <div className="screen-header"><h1>Settings</h1></div>
    <section className="card np-list" aria-labelledby="settings-account">
      <h2 id="settings-account" className="np-section-label">Account &amp; security</h2>
      <div className="np-list-row">
        <span className="np-list-icon" aria-hidden="true"><MaterialIcon name="emailOutlined" size={22} /></span>
        <span className="np-list-text"><strong>Email</strong><span className="shop-muted">{user.email}</span></span>
        {/* Sign-up confirms the address with a code, so it is verified. */}
        <span className="np-chip np-chip-ready">Verified</span>
      </div>
      <Link className="np-list-row np-list-link" to="/app/forgot-password" state={{ email: user.email }}>
        <span className="np-list-icon" aria-hidden="true"><MaterialIcon name="lockOutline" size={22} /></span>
        <span className="np-list-text"><strong>Change password</strong><span className="shop-muted">We email you a link to set a new one.</span></span>
        <MaterialIcon name="chevronRight" size={22} />
      </Link>
      {signOutError && <p className="form-error" role="alert">{signOutError}</p>}
      <button type="button" className="np-list-row np-list-link" disabled={signingOut} onClick={() => void signOutEverywhere()}>
        <span className="np-list-icon" aria-hidden="true"><MaterialIcon name="logout" size={22} /></span>
        <span className="np-list-text"><strong>{signingOut ? 'Signing out…' : 'Sign out of all devices'}</strong><span className="shop-muted">Ends every session on every device.</span></span>
        <MaterialIcon name="chevronRight" size={22} />
      </button>
    </section>
    <section className="card np-list" aria-labelledby="settings-help">
      <h2 id="settings-help" className="np-section-label">Help &amp; legal</h2>
      <Link className="np-list-row np-list-link" to="/app/help">
        <span className="np-list-icon" aria-hidden="true"><MaterialIcon name="chatBubbleOutline" size={22} /></span>
        <span className="np-list-text"><strong>Help &amp; Support</strong><span className="shop-muted">Contact us about an order or your account.</span></span>
        <MaterialIcon name="chevronRight" size={22} />
      </Link>
      <Link className="np-list-row np-list-link" to="/policies.html" reloadDocument>
        <span className="np-list-icon" aria-hidden="true"><MaterialIcon name="infoOutline" size={22} /></span>
        <span className="np-list-text"><strong>{policiesLabel}</strong></span>
        <MaterialIcon name="chevronRight" size={22} />
      </Link>
    </section>
    <div className="np-signout">{signOutButton}</div>
    <h2 className="np-section-label settings-danger-label">Danger zone</h2>
    <section className="card settings-card settings-danger settings-danger-zone" aria-labelledby="settings-delete">
      <h2 id="settings-delete" className="card-title">Delete account</h2>
      <p>This removes your name, email and phone number, and signs you out everywhere. It cannot be undone.</p>
      <p className="shop-muted">Past orders stay on record for the pharmacies, without your name or contact details. You can’t delete your account while you have active orders.</p>
      {!open ? <button type="button" className="secondary text-danger-button" onClick={() => setOpen(true)}>Delete account</button>
        : confirming ? <div className="settings-confirm" role="group" aria-label="Confirm account deletion">
          <p><strong>Delete your account?</strong></p>
          <p>You will be signed out and your details removed. This cannot be undone.</p>
          <div className="auth-field">
            <label>Type DELETE to confirm
              <input value={typed} autoComplete="off" autoCapitalize="characters" spellCheck={false} onChange={(event) => setTyped(event.target.value)} />
            </label>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="shop-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => { setConfirming(false); setTyped(''); }}>Keep account</button>
            <button type="button" className="primary danger-fill" disabled={busy || typed.trim() !== 'DELETE'} onClick={() => void deleteAccount()}>{busy ? 'Deleting…' : 'Delete account'}</button>
          </div>
        </div>
          : <form className="settings-form" onSubmit={review} noValidate>
            <div className="auth-field">
              <label>Password
                <span className="auth-input-wrap">
                  <input type={shown ? 'text' : 'password'} value={password} autoComplete="current-password" maxLength={128}
                    onChange={(event) => setPassword(event.target.value)} />
                  <button type="button" className="auth-toggle" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'Hide password' : 'Show password'}</button>
                </span>
              </label>
            </div>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button type="submit" className="primary danger-fill">Delete my account</button>
            <button type="button" className="shop-text-link" onClick={() => { setOpen(false); setPassword(''); setError(null); }}>Cancel</button>
          </form>}
    </section>
  </div>;
}
