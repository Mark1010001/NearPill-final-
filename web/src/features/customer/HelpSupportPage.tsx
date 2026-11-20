import { useToast } from './toast';

export const supportEmail = 'nearpillemail.business@gmail.com';

/** Help & Support: the support email, with a one-tap copy. Same words as the Android screen. */
export function HelpSupportPage() {
  const { show, toast } = useToast(3000);
  async function copy() {
    try { await navigator.clipboard.writeText(supportEmail); show('Email address copied.'); }
    catch { show('Could not copy. Select the address and copy it.'); }
  }
  return <div className="np-mint">
    <div className="screen-header"><h1>Help &amp; Support</h1></div>
    <section className="card help-card" aria-labelledby="help-title">
      <h2 id="help-title" className="np-card-heading">Contact support</h2>
      <p className="shop-muted">Email us about an order, your account or anything in the app. Include your claim code if your question is about an order.</p>
      <p><a className="shop-text-link" href={`mailto:${supportEmail}`}><strong>{supportEmail}</strong></a></p>
      <button type="button" className="secondary" onClick={() => void copy()}>Copy email address</button>
    </section>
    {toast}
  </div>;
}
