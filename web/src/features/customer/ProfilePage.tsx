import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Order, SessionUser } from '../../api/types';
import { SkeletonCards, pesos } from '../../components/States';
import { policiesLabel, validatePhone } from './copy';
import { useToast } from './toast';
import { MaterialIcon } from './MaterialIcon';
import { useOrderUpdates } from './notifications';

const stageOf = (order: Order) => (order.stage ?? order.status ?? 'placed').toLowerCase();

/** Same labels and colours as the app's order chips. */
function statusChip(order: Order): { label: string; tone: 'ready' | 'done' | 'bad' | 'wait' } {
  switch (stageOf(order)) {
    case 'ready': case 'ready_for_pickup': return { label: 'Ready for pickup', tone: 'ready' };
    case 'completed': return { label: 'Completed', tone: 'done' };
    case 'cancelled': return { label: 'Cancelled', tone: 'bad' };
    case 'expired': return { label: 'Expired', tone: 'bad' };
    case 'preparing': case 'confirmed': return { label: 'Preparing', tone: 'wait' };
    default: return { label: 'Reserved', tone: 'wait' };
  }
}

export function ContactSheet({ phone, fullName, onClose, onSaved }: { phone: string; fullName?: string; onClose: () => void; onSaved: (v: { phone: string }) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [phoneValue, setPhone] = useState(phone);
  const [errors, setErrors] = useState<{ phone?: string }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function save() {
    if (saving) return;
    const next = { phone: validatePhone(phoneValue) ?? undefined };
    setErrors(next);
    if (next.phone) return;
    setSaving(true); setError(null);
    try {
      await api.updateProfile({ phone: phoneValue.trim() });
      onSaved({ phone: phoneValue.trim() });
    } catch {
      setSaving(false);
      setError('Could not save your contact details. Try again.');
    }
  }

  const shownName = (fullName ?? '').trim();
  return <dialog ref={dialog} className="sheet sheet-page" aria-labelledby="contact-title" onCancel={(event) => { if (saving) event.preventDefault(); else onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }} noValidate>
      <div className="sheet-bar">
        <button type="button" className="icon-button" aria-label="Back" disabled={saving} onClick={onClose}><MaterialIcon name="arrowBack" size={24} /></button>
        <h2 id="contact-title">Edit Account Details</h2>
      </div>
      {shownName && <div className="sheet-field">
        <span className="sheet-label"><span>Full Name</span></span>
        <div className="sheet-readonly" role="group" aria-label={`Full name, ${shownName}. Shown here for reference.`}>
          <MaterialIcon name="personOutline" size={22} /><span>{shownName}</span>
          <span className="sheet-check" aria-hidden="true"><MaterialIcon name="check" size={18} /></span>
        </div>
      </div>}
      <div className="sheet-field">
        <label htmlFor="contact-phone" className="sheet-label"><span>Phone Number</span></label>
        <span className="sheet-input"><MaterialIcon name="phoneOutlined" size={22} />
          <input id="contact-phone" aria-label="Phone Number" inputMode="tel" autoComplete="tel" value={phoneValue} readOnly={saving} placeholder="09171234567" maxLength={11}
            aria-invalid={!!errors.phone} aria-describedby={errors.phone ? 'contact-phone-error' : undefined}
            onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} /></span>
      </div>
      {errors.phone && <p className="form-error" id="contact-phone-error" role="alert">{errors.phone}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <button type="submit" className="primary sheet-save" disabled={saving} aria-live={saving ? 'polite' : undefined}>{saving ? 'Saving…' : 'Save Changes'}</button>
      <button type="button" className="sheet-cancel" disabled={saving} onClick={onClose}>Cancel</button>
    </form>
  </dialog>;
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  const empty = !value;
  const content = <>
    <span className="np-row-label">{label}</span>
    <span className={`np-row-value${empty ? ' np-row-empty' : ''}`}>{empty ? 'Not provided' : value}{onEdit && <MaterialIcon name="chevronRight" size={20} />}</span>
  </>;
  return onEdit ? <button type="button" className="np-row" onClick={onEdit}>{content}</button> : <div className="np-row">{content}</div>;
}

function OrderTile({ order }: { order: Order }) {
  const chip = statusChip(order);
  const count = order.items.length;
  const cancelled = chip.tone === 'bad';
  const details = [order.placedOn ?? '', count > 0 ? `${count} ${count === 1 ? 'item' : 'items'}` : ''].filter(Boolean).join(' • ');
  return <li className="np-order">
    <Link to="/app/orders?tab=orders" className="np-order-link">
      <span className="np-order-main"><strong>{order.storeName}</strong>{details && <span className="shop-muted">{details}</span>}</span>
      <span className="np-order-side">
        <strong className={`order-total${cancelled ? ' np-struck' : ''}`}>{typeof order.totalCentavos === 'number' ? pesos(order.totalCentavos) : '₱0.00'}</strong>
        <span className={`np-chip np-chip-${chip.tone}`}>{chip.label}</span>
      </span>
    </Link>
  </li>;
}

/** "View all": every order on the account, newest first. */
export function OrderHistoryPage({ user }: { user: SessionUser }) {
  const accountId = String(user.id);
  const orders = useQuery({ queryKey: ['customer-orders', accountId], queryFn: ({ signal }) => api.customerOrders(accountId, signal), retry: false, staleTime: 0, gcTime: 0 });
  const all = orders.data ?? [];
  return <div className="np-mint">
    <div className="screen-header"><h1>Order History</h1>
      <Link className="np-view-all" to="/app/profile">Back to profile</Link></div>
    <section className="card order-history">
      {all.length === 0 ? <div className="center-note">
        {orders.isPending ? <SkeletonCards label="Loading orders…" count={3} /> : <p role="status">{orders.isError ? 'Unable to load orders.' : 'No orders yet.'}</p>}
        {orders.isError && <button type="button" className="shop-text-link" onClick={() => { void orders.refetch(); }}>Try again</button>}
      </div> : <ul className="np-orders">{all.map((order) => <OrderTile key={order.id} order={order} />)}</ul>}
    </section>
  </div>;
}

/** The app's "My Profile" screen. */
export function ProfilePage({ user }: { user: SessionUser }) {
  const accountId = String(user.id);
  const queryClient = useQueryClient();
  const { unreadCount } = useOrderUpdates(accountId);
  const { show, toast } = useToast(3000);
  const [editing, setEditing] = useState(false);
  const profile = useQuery({ queryKey: ['customer-profile', accountId], queryFn: ({ signal }) => api.me(signal), retry: false, staleTime: 0 });
  const orders = useQuery({ queryKey: ['customer-orders', accountId], queryFn: ({ signal }) => api.customerOrders(accountId, signal), retry: false, staleTime: 0, gcTime: 0, enabled: profile.isSuccess });
  const me = profile.data;
  const name = me?.fullName ?? me?.name ?? user.fullName ?? user.name ?? '';
  const all = orders.data ?? [];
  const recent = all.slice(0, 3);

  return <div className="np-mint">
    <div className="screen-header"><h1>My Profile</h1>
      <div className="screen-actions">
        <Link className="icon-button" to="/app/notifications" title="Order updates"
          aria-label={unreadCount > 0 ? `Order updates, ${unreadCount} new` : 'Order updates'}><MaterialIcon name={unreadCount > 0 ? 'notificationsRounded' : 'notificationsOutlined'} size={22} /></Link>
        <Link className="icon-button" to="/app/assistant" aria-label="Ask NearPill" title="Ask NearPill"><MaterialIcon name="chatBubbleOutline" size={24} /></Link>
        <Link className="icon-button" to="/app/settings" aria-label="Settings" title="Settings">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
        </Link>
      </div></div>
    {profile.isPending ? <SkeletonCards label="Loading your account…" count={2} /> : <>
      {profile.isError && <div role="status"><p>Unable to load your account details.</p>
        <button type="button" className="shop-text-link" onClick={() => { void profile.refetch(); }}>Try again</button></div>}
      {me && <>
        <section className="card profile-head">
          <span className="avatar" aria-hidden="true">{name ? name[0].toUpperCase() : 'U'}</span>
          <div className="profile-head-text"><h2>{name}</h2><span className="shop-muted">{me.email}</span></div>
          <button type="button" className="icon-button" aria-label="Edit contact details" title="Edit contact details" onClick={() => setEditing(true)}><MaterialIcon name="editOutlined" size={24} /></button>
        </section>
        <section className="card identity-card" aria-labelledby="account-details-title">
          <h2 id="account-details-title" className="np-card-heading">Account details</h2>
          <Row label="Full Name" value={name} />
          <Row label="Phone Number" value={me.phone ?? ''} onEdit={() => setEditing(true)} />
        </section>
      </>}
      {me && <>
        <div className="screen-header"><h2>Order History</h2>
          {all.length > 0 && <Link className="np-view-all" to="/app/profile/orders">View all<MaterialIcon name="chevronRight" size={20} /></Link>}</div>
        <section className="card order-history">
          {recent.length === 0 ? <div className="center-note">
            {orders.isPending ? <SkeletonCards label="Loading orders…" count={3} /> : <p role="status">{orders.isError ? 'Unable to load orders.' : 'No recent orders.'}</p>}
            {orders.isError && <button type="button" className="shop-text-link" onClick={() => { void orders.refetch(); }}>Try again</button>}
          </div> : <ul className="np-orders">{recent.map((order) => <OrderTile key={order.id} order={order} />)}</ul>}
        </section>
      </>}
      <p><Link className="shop-text-link" to="/policies.html" reloadDocument>{policiesLabel}</Link></p>
    </>}
    {editing && me && <ContactSheet phone={me.phone ?? ''} fullName={name} onClose={() => setEditing(false)}
      onSaved={(saved) => {
        queryClient.setQueryData(['customer-profile', accountId], { ...me, ...saved });
        setEditing(false);
        show('Contact details saved.');
      }} />}
    {toast}
  </div>;
}
