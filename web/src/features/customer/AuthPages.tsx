import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { api } from '../../api/client';
import { useSession } from '../../auth/session';
import { authErrorMessage, emailErrorText, policiesLabel, validateEmailAddress, validateNewPassword } from './copy';

function Header({ title, subtitle }: { title: string; subtitle: ReactNode }) {
  return <header className="auth-header">
    <h1>{title}</h1>
    {subtitle ? <p>{subtitle}</p> : null}
  </header>;
}

function PasswordField({ label, value, onChange, autoComplete, error, disabled, onEnter }: {
  label: string; value: string; onChange: (value: string) => void; autoComplete: string; error?: string | null; disabled?: boolean; onEnter?: () => void;
}) {
  const [shown, setShown] = useState(false);
  return <div className="auth-field">
    <label>{label}
      <span className="auth-input-wrap">
        <input type={shown ? 'text' : 'password'} value={value} autoComplete={autoComplete} maxLength={128} readOnly={disabled}
          aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); } }} />
        <button type="button" className="auth-toggle" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? 'Hide password' : 'Show password'}</button>
      </span>
    </label>
    {error && <small className="auth-error" role="alert">{error}</small>}
  </div>;
}

export function passwordScore(password: string) {
  return [password.length >= 10, /\p{L}/u.test(password), /\p{N}/u.test(password), /[^\p{L}\p{N}]/u.test(password) || password.length >= 14].filter(Boolean).length;
}

function StrengthMeter({ password }: { password: string }) {
  const score = passwordScore(password);
  const meetsRules = password.length >= 10 && /\p{L}/u.test(password) && /\p{N}/u.test(password);
  const level = !meetsRules ? 'weak' : score < 4 ? 'okay' : 'strong';
  const label = level === 'weak' ? 'Weak' : level === 'okay' ? 'Okay' : 'Strong';
  const rules: [string, boolean][] = [['10+ characters', password.length >= 10], ['A letter', /\p{L}/u.test(password)], ['A number', /\p{N}/u.test(password)], ['Symbol or 14+ characters', /[^\p{L}\p{N}]/u.test(password) || password.length >= 14]];
  return <div className="auth-strength" data-level={password === '' ? 'none' : level}>
    <span className="auth-strength-label">{password === '' ? 'Use at least 10 characters' : label}</span>
    <div className="auth-meter" role="img" aria-label={`Password strength: ${password === '' ? 'not set' : label}`}>
      {[0, 1, 2, 3].map((i) => <span key={i} className={i < score ? 'on' : ''} />)}
    </div>
    <ul className="auth-rules">{rules.map(([text, ok]) => <li key={text} className={ok ? 'ok' : ''}><span aria-hidden="true">{ok ? '✓' : '○'}</span> {text}</li>)}</ul>
  </div>;
}

/** The app's login and three-step sign-up (email + password, name, email code) on one page. */
export function CustomerAuth({ disabled = false }: { disabled?: boolean }) {
  const { login } = useSession();
  const location = useLocation();
  const [isLogin, setIsLogin] = useState(true);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(typeof location.state?.notice === 'string' ? location.state.notice : null);
  const [testInbox, setTestInbox] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [company, setCompany] = useState('');
  const startedAt = useRef(Date.now());
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [resendLeft, setResendLeft] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = loading || disabled;

  useEffect(() => {
    if (resendLeft <= 0) return undefined;
    const timer = setTimeout(() => setResendLeft((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendLeft]);

  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [error]);

  const loginEmailError = touched.loginEmail ? validateEmailAddress(loginEmail) : null;
  const loginPasswordError = touched.loginPassword && loginPassword === '' ? 'Enter your password' : null;
  const emailError = touched.email ? validateEmailAddress(email) : null;
  const passwordError = touched.password ? validateNewPassword(password, email, name) : null;
  // Live check: shows as soon as something is typed in the repeat box.
  const password2Error = password2 !== '' && password2 !== password ? 'Passwords do not match'
    : touched.password2 && password2 === '' ? 'Repeat your password' : null;
  const trimmedName = name.trim();
  const termsError = touched.terms && !agreed ? 'Agree to the Terms and Conditions and Privacy Policy to continue.' : null;
  const nameError = touched.name ? (trimmedName === '' ? 'Enter your full name' : trimmedName.length > 100 ? 'Use at most 100 characters' : null) : null;

  async function submitLogin(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    setTouched((t) => ({ ...t, loginEmail: true, loginPassword: true }));
    if (validateEmailAddress(loginEmail) || loginPassword === '') return;
    setLoading(true); setError(null);
    try { await login(loginEmail.trim(), loginPassword, remember); }
    catch (err) { setError(authErrorMessage(err)); }
    finally { setLoading(false); }
  }

  async function requestCode(resend = false) {
    setLoading(true); setError(null); setStatus(null); setCode('');
    try {
      const delivery = await api.sendOtp(email.trim());
      setStep(2);
      setResendLeft(30);
      setTestInbox(delivery?.testInbox === true);
      const devCode = delivery?.devCode;
      if (typeof devCode === 'string' && devCode.length === 6) {
        setCode(devCode);
        setStatus(resend ? 'Local development: new code filled in automatically.' : 'Local development: verification code filled in automatically.');
      } else {
        setStatus(resend ? 'A new code has been sent.' : null);
        setTimeout(() => codeRef.current?.focus(), 0);
      }
    } catch (err) {
      const status = typeof err === 'object' && err !== null && 'status' in err ? Number((err as { status: unknown }).status) : NaN;
      if (status === 400) { setStep(0); setTouched((t) => ({ ...t, email: true })); setError(emailErrorText); }
      else setError(authErrorMessage(err, true));
    } finally { setLoading(false); }
  }

  async function continueSignup(event?: FormEvent) {
    event?.preventDefault();
    if (busy) return;
    if (step === 0) {
      setTouched((t) => ({ ...t, email: true, password: true, password2: true }));
      if (validateEmailAddress(email) || validateNewPassword(password, email, name)) return;
      if (password2 === '' || password2 !== password) return;
      setStep(1);
    } else if (step === 1) {
      setTouched((t) => ({ ...t, name: true, terms: true }));
      if (trimmedName === '' || trimmedName.length > 100 || !agreed) return;
      if (validateNewPassword(password, email, name)) { setStep(0); setTouched((t) => ({ ...t, password: true })); return; }
      await requestCode();
    }
  }

  async function verifyAndRegister(event?: FormEvent, typed?: string) {
    event?.preventDefault();
    if (busy) return;
    const entered = typed ?? code;
    if (!/^\d{6}$/.test(entered)) { setError('Enter the 6-digit verification code.'); return; }
    setLoading(true); setError(null); setStatus(null);
    try {
      await api.verifyOtp(email.trim(), entered);
    } catch (err) {
      setError(authErrorMessage(err, true));
      setCode('');
      setLoading(false);
      return;
    }
    try {
      await api.register({ fullName: trimmedName, email: email.trim(), password, acceptedTerms: true, company, formMs: Date.now() - startedAt.current });
      await login(email.trim(), password);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally { setLoading(false); }
  }

  async function pasteCode() {
    let text = '';
    try { text = (await navigator.clipboard.readText()).trim(); } catch { /* blocked */ }
    if (!/^\d{6}$/.test(text)) { setError('Copy a 6-digit code, then tap Paste code.'); return; }
    setCode(text); setError(null);
    void verifyAndRegister(undefined, text);
  }

  function switchMode() {
    setIsLogin(!isLogin); setStep(0); setPassword2(''); setError(null); setStatus(null); setTouched({});
    startedAt.current = Date.now();
  }

  const titles = [
    ['Create your account', ''],
    ['Tell us about you', 'A few details help us serve you better.'],
    [testInbox ? 'Enter test code' : 'Verify your email',
      testInbox ? `Development test: enter the code sent to the configured test inbox. This does not verify ${email}.` : `Enter the 6-digit code sent to ${email}.`],
  ] as const;

  return <div className="auth-page">
    <div className="auth-brand"><img src="/brand-mark.png" width="72" height="72" alt="NearPill" /></div>
    {error && <div className="auth-banner" role="alert" ref={errorRef}>{error}</div>}
    {status && <p className="auth-status" role="status">{status}</p>}
    {isLogin ? <form onSubmit={submitLogin} noValidate className="auth-form" aria-label="Log in">
      <h1 className="sr-only">Log in</h1>
      <div className="auth-field">
        <label>Email address
          <input type="email" value={loginEmail} autoComplete="email" maxLength={254} readOnly={busy} aria-invalid={loginEmailError ? true : undefined}
            onChange={(e) => setLoginEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, loginEmail: true }))} />
        </label>
        {loginEmailError && <small className="auth-error" role="alert">{loginEmailError}</small>}
      </div>
      <PasswordField label="Password" value={loginPassword} onChange={setLoginPassword} autoComplete="current-password" error={loginPasswordError} disabled={busy} />
      <div className="auth-right auth-remember-row">
        <label className="auth-check"><input type="checkbox" checked={remember} disabled={busy} onChange={(e) => setRemember(e.target.checked)} /><span>Remember me</span></label>
        <Link className="shop-text-link" to="/app/forgot-password" state={{ email: loginEmail.trim() }} aria-disabled={busy}>Forgot Password?</Link>
      </div>
      <button className="primary auth-primary" type="submit" disabled={busy}>{loading && <span className="auth-spinner" aria-hidden="true" />}{loading ? 'Please wait…' : 'Log In'}</button>
    </form> : <form onSubmit={step === 2 ? verifyAndRegister : continueSignup} noValidate className="auth-form" aria-label="Create account">
      <div className="auth-steps">
        <button type="button" className="shop-text-link" disabled={busy} onClick={() => { if (step === 0) { switchMode(); return; } setStep(step - 1); setError(null); setStatus(null); }}>Back</button>
        <span className="auth-step-count">Step {step + 1} of 3</span>
      </div>
      <div className="auth-progress" aria-hidden="true">{[0, 1, 2].map((i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
      <Header title={titles[step][0]} subtitle={titles[step][1]} />
      {step === 0 && <>
        <div className="auth-field">
          <label>Email address
            <input type="email" value={email} autoComplete="email" maxLength={254} aria-invalid={emailError ? true : undefined}
              onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched((t) => ({ ...t, email: true }))} />
          </label>
          {emailError && <small className="auth-error" role="alert">{emailError}</small>}
        </div>
        <PasswordField label="Create password" value={password} onChange={setPassword} autoComplete="new-password" error={passwordError} onEnter={() => void continueSignup()} />
        <StrengthMeter password={password} />
        <PasswordField label="Repeat password" value={password2} onChange={setPassword2} autoComplete="new-password" error={password2Error} onEnter={() => void continueSignup()} />
      </>}
      {step === 1 && <div className="auth-field">
        <label>Full name
          <input value={name} autoComplete="name" readOnly={busy} aria-invalid={nameError ? true : undefined} onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))} />
        </label>
        {nameError && <small className="auth-error" role="alert">{nameError}</small>}
      </div>}
      {step === 1 && <div className="auth-field auth-terms">
        <label className="auth-check"><input type="checkbox" checked={agreed} readOnly={busy} aria-invalid={termsError ? true : undefined}
          onChange={(e) => { setAgreed(e.target.checked); setTouched((t) => ({ ...t, terms: true })); }} />
          <span>I agree to the <a className="shop-text-link" href="/policies.html" target="_blank" rel="noopener noreferrer">Terms and Conditions and Privacy Policy</a></span></label>
        {termsError && <small className="auth-error" role="alert">{termsError}</small>}
      </div>}
      <div className="auth-hp" aria-hidden="true">
        <label>Company<input name="company_site" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} /></label>
      </div>
      {step === 2 && <>
        <div className="auth-field">
          <label>Verification code
            <span className="auth-otp">
              <span className="auth-otp-boxes" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} className={`auth-otp-box${error ? ' bad' : ''}${i === Math.min(code.length, 5) ? ' now' : ''}`}>{code[i] ?? ''}</span>)}</span>
              <input ref={codeRef} className="auth-otp-input" value={code} inputMode="numeric" autoComplete="one-time-code" maxLength={6} readOnly={busy}
                onChange={(e) => { const next = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(next); if (next.length === 6) void verifyAndRegister(undefined, next); }} />
            </span>
          </label>
        </div>
        <div className="auth-center">
          <button type="button" className="shop-text-link" disabled={busy} onClick={() => void pasteCode()}>Paste code</button>
          {resendLeft > 0
            ? <span className="auth-muted-count" role="status">Resend code in 0:{String(resendLeft).padStart(2, '0')}</span>
            : <button type="button" className="shop-text-link" disabled={busy} onClick={() => void requestCode(true)}>Resend Code</button>}
          <button type="button" className="shop-text-link" disabled={busy} onClick={() => { setStep(0); setCode(''); setError(null); setStatus(null); setResendLeft(0); }}>Use a different email</button>
        </div>
      </>}
      <button className="primary auth-primary" type="submit" disabled={busy}>
        {loading && <span className="auth-spinner" aria-hidden="true" />}{loading ? 'Please wait…' : step === 2 ? 'Verify & Create Account' : 'Continue'}
      </button>
    </form>}
    <p className="auth-switch">
      <span className="shop-muted">{isLogin ? 'New to NearPill?' : 'Already have an account?'}</span>{' '}
      <button type="button" className="shop-text-link" disabled={busy} onClick={switchMode}>{isLogin ? 'Create account' : 'Log in'}</button>
    </p>
    <p className="auth-center"><a className="shop-text-link" href="/policies.html">{policiesLabel}</a></p>
  </div>;
}

export function ForgotPasswordPage() {
  const location = useLocation();
  const [email, setEmail] = useState(typeof location.state?.email === 'string' ? location.state.email : '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const emailError = touched ? validateEmailAddress(email) : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setTouched(true);
    if (validateEmailAddress(email)) return;
    setLoading(true); setMessage(null);
    try {
      await api.forgotPassword(email.trim());
      setMessage('If this account can receive email, a reset link will be sent.');
    } catch (err) {
      setMessage(authErrorMessage(err));
    } finally { setLoading(false); }
  }

  return <section className="auth-page" aria-labelledby="reset-title">
    <form className="auth-form" onSubmit={submit} noValidate>
      <h1 id="reset-title">Reset password</h1>
      <p>Enter your account email to request a password-reset link.</p>
      <p className="muted">Your new password needs at least 10 characters with a letter and a number.</p>
      <div className="auth-field">
        <label>Email address
          <input type="email" value={email} autoComplete="email" maxLength={254} readOnly={loading} aria-invalid={emailError ? true : undefined}
            onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} />
        </label>
        {emailError && <small className="auth-error" role="alert">{emailError}</small>}
      </div>
      <button className="primary auth-primary" type="submit" disabled={loading}>{loading ? 'Requesting link…' : 'Send reset link'}</button>
      {message && <p role="status">{message}</p>}
      <p className="auth-center"><Link className="shop-text-link" to="/app/sign-in">Back to log in</Link></p>
    </form>
  </section>;
}
