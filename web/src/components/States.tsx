import type { PropsWithChildren, ReactNode } from 'react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return <div className="state-card" role="status">{label}<div className="skeleton-lines" aria-hidden="true"><span /><span /><span /></div></div>;
}

/** Full-screen loading for the portals and the public site: just the NearPill logo (text stays for screen readers). */
export function BrandLoading({ label = 'Loading NearPill…' }: { label?: string }) {
  return <main className="brand-loading" role="status">
    <img className="brand-loading-mark" src="/brand-mark.png" alt="" aria-hidden="true" width="96" height="96" />
    <span className="visually-hidden">{label}</span>
  </main>;
}

/** Grey card-shaped loading placeholders for lists and detail pages (text stays for screen readers). */
export function SkeletonCards({ label, count = 3 }: { label: string; count?: number }) {
  return <div className="skeleton-cards" role="status" aria-busy="true">
    <span className="visually-hidden">{label}</span>
    {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton-card" aria-hidden="true">
      <span className="skeleton-block skeleton-thumb" /><div className="skeleton-card-lines"><span className="skeleton-block" /><span className="skeleton-block" /></div>
    </div>)}
  </div>;
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return <div className="state-card error"><div className="state-message" role="alert"><strong>Unable to load this view.</strong><span>{message}</span></div>{retry && <button type="button" className="secondary" onClick={retry}>Try again</button>}</div>;
}

export function EmptyState({ children }: PropsWithChildren) {
  return <div className="state-card" role="status">{children}</div>;
}

export function FormFeedback({ error, success }: { error?: Error | null; success?: string }) {
  if (error) return <p className="form-error" role="alert">{error.message}</p>;
  return success ? <p className="form-success" role="status">{success}</p> : null;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <article className="stat-card"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</article>;
}

export function pesos(centavos?: number) {
  return currency.format((centavos ?? 0) / 100);
}

export const currency = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
