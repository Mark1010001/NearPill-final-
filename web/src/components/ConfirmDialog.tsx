import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';

export type ConfirmOptions = {
  title: string;
  /** Say exactly what will happen. */
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
};

export type ReasonOptions = ConfirmOptions & { reasonLabel: string; minLength?: number; maxLength?: number };

type Pending = ReasonOptions & { reason: boolean; resolve: (value: boolean | string) => void };

/**
 * Accessible replacement for window.confirm. Uses the native <dialog> element, so
 * focus is trapped, Escape cancels, and the page behind is inert.
 *
 *   const [confirm, confirmDialog, askReason] = useConfirm();
 *   if (await confirm({ title, message, confirmLabel })) doIt();
 *   const reason = await askReason({ ..., reasonLabel: 'Why?' }); // string, or null when cancelled
 *   return <>…{confirmDialog}</>;
 */
export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);
  const confirm = useCallback((options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => setPending({ ...options, reasonLabel: '', reason: false, resolve: (value) => resolve(value === true) })), []);
  const askReason = useCallback((options: ReasonOptions) =>
    new Promise<string | null>((resolve) => setPending({ ...options, reason: true, resolve: (value) => resolve(typeof value === 'string' ? value : null) })), []);
  const dialog = pending
    ? <ConfirmDialog {...pending} onClose={(value) => { pending.resolve(value); setPending(null); }} />
    : null;
  return [confirm, dialog, askReason] as const;
}

function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Keep as is', danger, reason, reasonLabel, minLength = 3, maxLength = 200, onClose }:
  Pending & { onClose: (value: boolean | string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const [text, setText] = useState('');
  const valid = !reason || text.trim().length >= minLength;
  useEffect(() => {
    const element = ref.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  return <dialog ref={ref} className="confirm-dialog" aria-labelledby={titleId} aria-describedby={bodyId}
    onCancel={(event) => { event.preventDefault(); onClose(false); }}>
    <h2 id={titleId}>{title}</h2>
    <div id={bodyId} className="confirm-body">{message}</div>
    {reason && <label className="confirm-reason">{reasonLabel}
      <textarea required rows={3} minLength={minLength} maxLength={maxLength} value={text} autoFocus onChange={(event) => setText(event.target.value)} />
      <small>{text.trim().length}/{maxLength} · at least {minLength} characters</small>
    </label>}
    <div className="confirm-actions">
      <button type="button" className="secondary" autoFocus={!reason} onClick={() => onClose(false)}>{cancelLabel}</button>
      <button type="button" className={danger ? 'danger' : 'primary'} disabled={!valid} onClick={() => onClose(reason ? text.trim() : true)}>{confirmLabel}</button>
    </div>
  </dialog>;
}
