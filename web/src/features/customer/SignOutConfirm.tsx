import { useEffect, useRef, useState } from 'react';

/** Sign out with a confirmation step, so a stray tap does not end the session. */
export function SignOutConfirm({ pending, onConfirm, outlined = false }: { pending: boolean; onConfirm: () => void; outlined?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  return <>
    <button type="button" className={`secondary np-signout-btn${outlined ? ' np-signout-outlined' : ''}`} disabled={pending} onClick={() => setOpen(true)}>
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
    {open && <dialog ref={dialog} className="confirm-dialog" aria-labelledby="signout-title" onCancel={() => setOpen(false)}>
      <h2 id="signout-title">Sign out?</h2>
      <p>You will need to log in again to use NearPill.</p>
      <div className="shop-actions">
        <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
        <button type="button" className="primary" onClick={() => { setOpen(false); onConfirm(); }}>Sign out</button>
      </div>
    </dialog>}
  </>;
}
