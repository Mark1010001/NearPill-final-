import { useEffect, useState } from 'react';
import { manilaToday, pickupDays, pickupText } from '../customer/pickup';
import { Link } from 'react-router';
import { useConfirm } from '../../components/ConfirmDialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { InventoryItem, PartnerSubscription, SubscriptionPlan } from '../../api/types';
import { useSession } from '../../auth/session';
import { DataTable, SalesDateFilter, SalesTable, Status, TableRegion, displayDate } from '../../components/DataTable';
import { PlanCards } from '../../components/PlanCards';
import { StockSubmitCard } from './StockSubmit';
import { EmptyState, ErrorState, FormFeedback, LoadingState, Stat, currency, pesos } from '../../components/States';

function scope(user: ReturnType<typeof useSession>['user']) {
  return user?.memberships?.find((item) => item.isActive !== false)?.drugstoreId;
}

export function PartnerDashboardPage() {
  const { user } = useSession();
  const dashboard = useQuery({ queryKey: ['partner', 'dashboard', user?.id], queryFn: api.partnerDashboard });
  const subscription = useQuery({ queryKey: ['partner', 'subscription', user?.id], queryFn: api.partnerSubscription });
  const plans = useQuery({ queryKey: ['subscription-plans', user?.id], queryFn: api.subscriptionPlans, retry: false });
  const drugstoreId = scope(user);
  const accountId = String(user?.id);
  const orders = useQuery({ queryKey: ['partner', 'orders', drugstoreId, accountId], queryFn: () => api.partnerOrders(accountId, drugstoreId), enabled: Boolean(drugstoreId), refetchInterval: 15000, retry: false });
  const inventory = useQuery({ queryKey: ['partner', 'inventory', drugstoreId, user?.id], queryFn: () => api.partnerInventory(drugstoreId), enabled: Boolean(drugstoreId), retry: false });
  const reviews = useQuery({ queryKey: ['partner-prescriptions', accountId, drugstoreId], queryFn: ({ signal }) => api.partnerPrescriptionQueue(accountId, drugstoreId!, signal), enabled: Boolean(drugstoreId), retry: false });
  if (dashboard.isLoading) return <LoadingState label="Loading pharmacy overview…" />;
  if (dashboard.error) return <ErrorState error={dashboard.error} retry={() => void dashboard.refetch()} />;
  const d = dashboard.data!;
  return <>
    <Heading title="Pharmacy overview" subtitle="Review your pharmacy’s sales, orders and plan." />
    <NeedsAction orders={orders.data} inventory={inventory.data} reviews={reviews.data} />
    <div className="stats-grid">
      <Stat label="Completed order value" value={currency.format(d.totalSales || 0)} hint="Completed orders" />
      <Stat label="Orders" value={d.totalOrders || 0} />
      <Stat label="Completed" value={d.completedOrders || 0} />
      <Stat label="Pending" value={d.pendingOrders || 0} />
    </div>
    {d.branch && <section className="card"><h2>Storefront</h2>
      <dl className="facts">
        <div><dt>Branch</dt><dd>{d.branch.name}</dd></div>
        <div><dt>Address</dt><dd>{d.branch.address}</dd></div>
        <div><dt>Map coordinates</dt><dd>{d.branch.latitude}, {d.branch.longitude}</dd></div>
        <div><dt>Operating hours</dt><dd>{d.branch.operatingHours || 'Hours not provided'}</dd></div>
        <div><dt>Visibility</dt><dd>{d.branch.isPublic ? 'Public' : 'Not public'}</dd></div>
      </dl><p className="notice">Contact a platform admin to edit your storefront.</p>
    </section>}
    <section className="card"><h2>Plan & permissions</h2>
      {subscription.isLoading ? <LoadingState label="Loading plan…" /> : subscription.error
        ? <ErrorState error={subscription.error} retry={() => void subscription.refetch()} />
        : <PlanDetails data={subscription.data!} plans={plans.data || []} compact />}
    </section>
  </>;
}

function NeedsAction({ orders, inventory, reviews }: { orders?: { status?: string; stage?: string }[]; inventory?: InventoryItem[]; reviews?: unknown[] }) {
  const state = (order: { status?: string; stage?: string }) => order.status || order.stage;
  const items = [
    reviews && { key: 'rx', count: reviews.length, label: 'Prescriptions to review', to: '/partner/orders', go: 'Review now' },
    orders && { key: 'prepare', count: orders.filter((o) => state(o) === 'confirmed').length, label: 'Paid and ready to prepare', to: '/partner/orders', go: 'Start preparing' },
    orders && { key: 'ready', count: orders.filter((o) => state(o) === 'ready_for_pickup').length, label: 'Waiting for customer pickup', to: '/partner/orders', go: 'See queue' },
    inventory && inventory.some((i) => expiryState(i.expiryDate)) ? { key: 'expiry', count: inventory.filter((i) => expiryState(i.expiryDate)).length, label: 'Expired or expiring within 30 days', to: '/partner/inventory', go: 'Check expiry dates' } : undefined,
    inventory && { key: 'stock', count: inventory.filter((i) => i.stockOnHand <= lowStockLevel(i)).length, label: 'Low or out of stock', to: '/partner/inventory', go: 'Update stock' },
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!items.length) return null;
  return <section aria-labelledby="needs-action-title"><h2 id="needs-action-title">Needs action</h2>
    <div className="needs-action">{items.map((item) => <Link key={item.key} className="action-card" to={item.to} data-urgent={item.count > 0 && item.key !== 'ready'}>
      <strong>{item.count}</strong><span>{item.label}</span><span className="action-go">{item.count > 0 ? `${item.go} →` : 'All clear'}</span>
    </Link>)}</div>
  </section>;
}

const LOW_STOCK = 5;
const SOON_DAYS = 30;
/** Each pharmacy can set its own low-stock level; 5 is used until they do. */
export function lowStockLevel(item: Pick<InventoryItem, 'lowStockThreshold'>) { return item.lowStockThreshold ?? LOW_STOCK; }
/** Expiry dates are plain calendar dates (YYYY-MM-DD) compared in Manila time. */
export function expiryState(date?: string | null, now = new Date()): 'expired' | 'soon' | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  if (date < today) return 'expired';
  const limit = new Date(`${today}T00:00:00Z`); limit.setUTCDate(limit.getUTCDate() + SOON_DAYS);
  return date <= limit.toISOString().slice(0, 10) ? 'soon' : null;
}

function PrescriptionQueue({ accountId, drugstoreId }: { accountId: string; drugstoreId: number }) {
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [turn, setTurn] = useState(0);
  const [confirm, confirmDialog, askReason] = useConfirm();
  const photo = useMutation({ mutationFn: ({ id, version }: { id: number; version: string }) =>
    api.partnerPrescriptionPhoto(accountId, drugstoreId, id, version), gcTime: 0 });
  const resetPhoto = photo.reset;
  const queue = useQuery({ queryKey: ['partner-prescriptions', accountId, drugstoreId], retry: false,
    refetchInterval: photo.variables ? 10_000 : false,
    queryFn: ({ signal }) => api.partnerPrescriptionQueue(accountId, drugstoreId, signal) });
  const selected = queue.data?.find(({ id, version }) => id === photo.variables?.id && version === photo.variables.version);
  const expiresAt = selected && Date.parse(selected.expiresAt);
  useEffect(() => {
    function closeWhenHidden() {
      if (document.hidden) resetPhoto();
    }
    document.addEventListener('visibilitychange', closeWhenHidden);
    window.addEventListener('pagehide', resetPhoto);
    window.addEventListener('offline', resetPhoto);
    return () => {
      document.removeEventListener('visibilitychange', closeWhenHidden);
      window.removeEventListener('pagehide', resetPhoto);
      window.removeEventListener('offline', resetPhoto);
    };
  }, [resetPhoto]);
  useEffect(() => {
    if (!photo.variables) return;
    if (queue.isError || !expiresAt || expiresAt <= Date.now()) {
      resetPhoto();
      return;
    }
    const timeout = window.setTimeout(resetPhoto, expiresAt - Date.now());
    return () => window.clearTimeout(timeout);
  }, [photo.variables, queue.isError, expiresAt, resetPhoto]);
  const decision = useMutation({ mutationFn: ({ id, version, value, reason }: { id: number; version: string; value: 'approved' | 'rejected'; reason?: string }) =>
    api.decidePrescription(accountId, drugstoreId, id, version, value, reason),
    onSuccess: () => { resetPhoto(); return queue.refetch(); },
    onError: (error) => {
      if (error instanceof ApiError && [401, 403, 404, 409].includes(error.status)) {
        resetPhoto();
        void queue.refetch();
      }
    } });
  if (queue.error instanceof ApiError && queue.error.status === 404) return null;
  async function approve() {
    if (!selected) return;
    const facts = <>Approve the prescription for <strong>{selected.productName}</strong> (catalog #{selected.medicineId}){selected.customerId != null && <> from customer #{selected.customerId}</>} at pharmacy #{drugstoreId}. The photo is deleted once you decide.</>;
    if (await confirm({ title: 'Approve this prescription?', confirmLabel: 'Approve', cancelLabel: 'Keep reviewing', message: facts }))
      decision.mutate({ id: selected.id, version: selected.version, value: 'approved' });
  }
  async function reject() {
    if (!selected) return;
    const reason = await askReason({ title: 'Reject this prescription?', danger: true, confirmLabel: 'Reject and request replacement', cancelLabel: 'Keep reviewing',
      reasonLabel: 'Reason shown to the customer',
      message: <>The customer will be asked to submit a replacement photo for <strong>{selected.productName}</strong> (catalog #{selected.medicineId}). Their order will not proceed until a new prescription is approved.</> });
    if (reason) decision.mutate({ id: selected.id, version: selected.version, value: 'rejected', reason });
  }
  return <section className="card">
    <h2>Prescription reviews</h2>
    <p>Staging sample photos only. Check that the prescription matches the listed medicine before approving.</p>
    <button type="button" className="secondary" disabled={queue.isFetching || decision.isPending || photo.isPending} onClick={() => {
      photo.reset(); setLoaded(false); void queue.refetch();
    }}>Refresh prescription queue</button>
    {queue.isPending && <p role="status">Loading prescription reviews…</p>}
    {queue.isSuccess && !queue.data.length && <p>No pending prescription reviews for this pharmacy.</p>}
    {queue.data?.map((row) => <p key={row.id}>{row.productName} · Catalog #{row.medicineId}{' '}
      <button type="button" className="secondary" disabled={photo.isPending || decision.isPending} onClick={() => {
        setLoaded(false); setZoom(1); setTurn(0); decision.reset(); photo.mutate({ id: row.id, version: row.version });
      }}>Open photo</button></p>)}
    {photo.isPending && <p role="status">Opening prescription photo…</p>}
    {photo.data && !queue.isError && selected && expiresAt && expiresAt > Date.now() && ['image/jpeg', 'image/png'].includes(photo.data.mimeType) && <div className="rx-viewer">
      <dl className="rx-facts" aria-label="What you are approving">
        {selected.customerId != null && <div><dt>Customer</dt><dd>{selected.customerName ? `${selected.customerName} (#${selected.customerId})` : `#${selected.customerId}`}</dd></div>}
        <div><dt>Medicine</dt><dd>{selected.productName}</dd></div>
        <div><dt>Catalog ID</dt><dd>#{selected.medicineId}</dd></div>
        <div><dt>Pharmacy</dt><dd>#{drugstoreId}</dd></div>
        <div><dt>Photo available until</dt><dd>{new Date(expiresAt).toLocaleTimeString()}</dd></div>
      </dl>
      <div className="rx-toolbar" role="group" aria-label="Image controls">
        <button type="button" className="secondary" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Zoom out">−</button>
        <button type="button" className="secondary" onClick={() => setZoom(1)} aria-label="Reset zoom">{Math.round(zoom * 100)}%</button>
        <button type="button" className="secondary" onClick={() => setZoom((value) => Math.min(3, value + 0.25))} aria-label="Zoom in">+</button>
        <button type="button" className="secondary" onClick={() => setTurn((value) => (value + 90) % 360)} aria-label="Rotate 90 degrees">Rotate</button>
      </div>
      <div className="rx-stage" tabIndex={0} aria-keyshortcuts="+ - R A X" aria-label="Prescription image. Plus and minus zoom, R rotates, A approves and X rejects, each after you confirm."
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const key = event.key.toLowerCase();
          if (key === '+' || key === '=') setZoom((value) => Math.min(3, value + 0.25));
          else if (key === '-') setZoom((value) => Math.max(0.5, value - 0.25));
          else if (key === 'r') setTurn((value) => (value + 90) % 360);
          else if (key === '0') setZoom(1);
          else if (key === 'a' && loaded && !decision.isPending && !event.repeat) void approve();
          else if (key === 'x' && !decision.isPending && !event.repeat) void reject();
        }}>
        <img alt={`Sample prescription for ${selected.productName}`} className="prescription-photo"
          style={{ transform: `scale(${zoom}) rotate(${turn}deg)` }}
          onLoad={() => setLoaded(true)} onError={() => setLoaded(false)} src={`data:${photo.data.mimeType};base64,${photo.data.photo}`} />
      </div>
      {!loaded && <small>If the image is unreadable, close it or ask the customer to submit a replacement.</small>}
      <button type="button" className="secondary" disabled={decision.isPending || !loaded}
        onClick={() => decision.mutate({ id: selected.id, version: selected.version, value: 'approved' })}>Approve sample prescription</button>
      <button type="button" className="secondary" disabled={decision.isPending}
        onClick={() => void reject()}>Reject and request replacement</button>
      <button type="button" className="secondary" disabled={decision.isPending} onClick={() => { photo.reset(); setLoaded(false); }}>Close photo</button>
    </div>}
    {confirmDialog}
    <FormFeedback error={queue.error ?? photo.error ?? decision.error} success={decision.isSuccess ? 'Review saved. The sample photo was removed.' : undefined} />
  </section>;
}

function matchesPickupFilter(date: string | null | undefined, filter: 'all' | 'today' | 'tomorrow' | 'week') {
  if (filter === 'all') return true;
  if (!date) return false;
  const days = pickupDays();
  return filter === 'today' ? date === days[0] : filter === 'tomorrow' ? date === days[1] : date >= days[0] && date <= days[6];
}

export function PartnerOrdersPage() {
  const { user } = useSession(); const drugstoreId = scope(user);
  const accountId = String(user?.id);
  const queueKey = `${user?.id}:${drugstoreId}`;
  const [hidden, setHidden] = useState<Record<string, number[]>>({});
  const [pickupFilter, setPickupFilter] = useState<'all' | 'today' | 'tomorrow' | 'week'>('all');
  const hiddenOrders = hidden[queueKey] ?? [];
  const query = useQuery({ queryKey: ['partner', 'orders', drugstoreId, accountId], queryFn: () => api.partnerOrders(accountId, drugstoreId), enabled: Boolean(drugstoreId), refetchInterval: 15000 });
  const pickup = useMutation({ mutationFn: ({ id, status, balancePayment }: { id: number; status: string; balancePayment?: { method: string; amountCentavos: number } }) => api.setPartnerPickupStatus(accountId, id, drugstoreId!, status, balancePayment), onSettled: () => query.refetch() });
  if (!drugstoreId) return <EmptyState>No active pharmacy membership.</EmptyState>;
  if (query.isLoading) return <LoadingState label="Loading pharmacy orders…" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  return <>
    <Heading title="Pharmacy orders" subtitle="Start preparing after payment is confirmed. Mark the order ready when it’s packed." />
    <PrescriptionQueue key={queueKey} accountId={accountId} drugstoreId={drugstoreId} />
    <section className="card">
      <OrderStepper counts={(query.data || []).reduce<Record<string, number>>((acc, o) => { const k = o.status || o.stage || 'unknown'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})} />
      {hiddenOrders.length > 0 && <button className="secondary" type="button" onClick={() => setHidden((current) => ({ ...current, [queueKey]: [] }))}>Restore hidden orders</button>}
      <div className="chip-row" role="group" aria-label="Pickup date filter">
        {([['all', 'All dates'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week']] as const).map(([id, label]) =>
          <button key={id} type="button" className={`chip${pickupFilter === id ? ' chip-on' : ''}`} aria-pressed={pickupFilter === id} onClick={() => setPickupFilter(id)}>{label}</button>)}
      </div>
      <DataTable label="Pharmacy orders" headers={['Order', 'Items', 'Order total', 'Pickup status', 'Next step']} empty={hiddenOrders.length ? 'No visible orders.' : 'No orders for this pharmacy yet.'}
        rows={(query.data || []).filter((o) => !hiddenOrders.includes(o.id) && matchesPickupFilter(o.pickupDate, pickupFilter)).map((o) => {
          const status = o.status || o.stage || 'unknown';
          const next = status === 'confirmed' ? 'preparing' : status === 'preparing' ? 'ready_for_pickup' : status === 'ready_for_pickup' ? 'completed' : null;
          const reference = o.reference || `Order #${o.id}`;
          const balance = o.pickupBalanceCentavos;
          const saving = pickup.isPending && pickup.variables?.id === o.id;
          const overdue = ['confirmed', 'preparing', 'ready_for_pickup'].includes(status) && !!o.pickupDate && o.pickupDate < manilaToday();
          return [o.id, <>{reference}{o.reference?.startsWith('NP-TEST-') && <small>Test order</small>}
            <small className={overdue ? 'pickup-overdue' : undefined}>{o.pickupDate ? `Pickup ${pickupText(o.pickupDate, o.pickupWindow)}${o.pickupDate === manilaToday() ? ' · Today' : ''}${overdue ? ' · Overdue' : ''}` : 'No pickup date'}</small>
            {o.pickupBalancePaidWithGCash ? <><small role="status">Balance paid with GCash · Verified by Xendit</small><small>₱0.00 due</small></>
              : balance != null && balance >= 0 && !o.pickupBalancePending && <small>{pesos(balance)} due at pickup</small>}</>,
          o.items?.map((item) => `${item.name || item.medicineName || 'Medicine'} ×${item.quantity}${item.sellingUnit ? ` (${item.sellingUnit})` : ''}`).join(', ') || '—',
          pesos(o.totalCentavos), <Status value={status} label={status === 'completed' ? 'Collected' : undefined} />,
          next === 'completed' && o.pickupBalancePending ? <div role="status">Waiting for Xendit to verify the GCash balance payment. Collection is paused.</div>
          : next === 'completed' && o.reference?.startsWith('NP-TEST-') && (balance == null || balance < 0) ? 'Payment status is unavailable. Wait for confirmation before handing over this order.'
          : next && o.reference?.startsWith('NP-TEST-') ? <form className="mini-form" onSubmit={(event) => {
            event.preventDefault();
            if (pickup.isPending || query.isFetching) return;
            const balancePayment = next === 'completed' && balance != null && balance > 0 ? { method: String(new FormData(event.currentTarget).get('method')), amountCentavos: balance } : undefined;
            if (next === 'completed' && !window.confirm(balancePayment ? `Confirm you received ${pesos(balancePayment.amountCentavos)} and handed over ${reference}.` : `Confirm the customer has collected ${reference}.`)) return;
            pickup.mutate({ id: o.id, status: next, balancePayment });
          }}>
            {next === 'completed' && balance != null && balance > 0 && <label>Balance received ({pesos(balance)})
              <select name="method" required defaultValue="" disabled={pickup.isPending}>
                <option value="" disabled>Select payment method</option><option value="cash">Cash</option><option value="other">Other in-person payment</option>
              </select>
            </label>}
            <button className="secondary" aria-disabled={pickup.isPending || query.isFetching}>
              {next === 'preparing' ? 'Start preparing' : next === 'ready_for_pickup' ? 'Mark ready for pickup' : 'Complete pickup'}
            </button>
            {saving && <small role="status">Saving pickup status…</small>}
            {pickup.variables?.id === o.id && <FormFeedback error={pickup.error} />}
          </form> : status === 'ready_for_pickup' ? 'Waiting for customer pickup.'
            : ['reserved', 'awaiting_payment'].includes(status) ? 'Wait for payment confirmation.'
            : ['completed', 'cancelled', 'expired'].includes(status) ? <button type="button" className="secondary"
              title="Hide finished order from this view" aria-label={`Hide finished order ${o.reference || o.id}`}
              onClick={() => setHidden((current) => ({ ...current, [queueKey]: [...(current[queueKey] ?? []), o.id] }))}>
              <span aria-hidden="true">×</span>
            </button> : '—'];
        })} />
    </section>
  </>;
}

const STEPS: [string, string][] = [['confirmed', 'Paid, to prepare'], ['preparing', 'Being packed'], ['ready_for_pickup', 'Ready to collect'], ['completed', 'Handed over']];
function OrderStepper({ counts }: { counts: Record<string, number> }) {
  return <ol className="stepper" aria-label="Orders by pickup step">
    {STEPS.map(([key, label]) => <li key={key} data-active={(counts[key] ?? 0) > 0}><span className="step-count">{counts[key] ?? 0}</span><span className="step-label">{label}</span></li>)}
  </ol>;
}

const pesoText = (centavos: number) => `${Math.floor(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;

type InventoryChange = { inventoryId: number; medicineId: number; name: string; from: InventoryItem; to: { stockOnHand: number }; at: Date };

function QuickStock({ item, busy, onSave }: { item: InventoryItem; busy: boolean; onSave: (stock: number) => void }) {
  const [draft, setDraft] = useState(String(item.stockOnHand));
  useEffect(() => setDraft(String(item.stockOnHand)), [item.stockOnHand]);
  const valid = /^\d{1,10}$/.test(draft) && Number(draft) <= 2147483647;
  const dirty = draft !== String(item.stockOnHand);
  const belowReserved = valid && Number(draft) < item.reservedQuantity;
  return <form className="quick-stock" onSubmit={(event) => { event.preventDefault(); if (valid && dirty && !busy) onSave(Number(draft)); }}>
    <label>Quick stock
      <input type="text" inputMode="numeric" value={draft} aria-label={`Quick stock count for ${item.medicineName}`} aria-invalid={!valid}
        disabled={busy} onChange={(event) => setDraft(event.target.value.trim())} />
    </label>
    {dirty && <button className="primary" disabled={!valid || busy}>Save</button>}
    {dirty && <button type="button" className="link-button" onClick={() => setDraft(String(item.stockOnHand))}>Reset</button>}
    {!valid && <small className="form-error" role="alert">Enter a whole number from 0.</small>}
    {belowReserved && <small>{item.reservedQuantity} are reserved for open orders. The server will reject anything it cannot cover.</small>}
  </form>;
}

export function PartnerInventoryPage() {
  const { user } = useSession(); const qc = useQueryClient(); const drugstoreId = scope(user);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const query = useQuery({ queryKey: ['partner', 'inventory', drugstoreId, user?.id], queryFn: () => api.partnerInventory(drugstoreId), enabled: Boolean(drugstoreId) });
  const [lastChange, setLastChange] = useState<InventoryChange | null>(null);
  const adjust = useMutation({
    mutationFn: (item: Parameters<typeof api.updatePartnerInventory>[1]) => api.updatePartnerInventory(drugstoreId!, item),
    onSettled: (_data, error) => {
      if (!error || (error instanceof ApiError && error.status === 409)) return query.refetch();
    },
  });
  function saveStock(item: InventoryItem, stock: number, undo = false) {
    adjust.reset();
    adjust.mutate({ medicineId: item.medicineId, stockOnHand: stock, expectedStockOnHand: item.stockOnHand,
      price: pesoText(item.priceCentavos), expectedPriceCentavos: item.priceCentavos,
      sellingUnit: item.sellingUnit || undefined, expectedSellingUnit: item.sellingUnit,
      packageSize: item.packageSize || undefined, expectedPackageSize: item.packageSize },
    { onSuccess: () => setLastChange(undo ? null : { inventoryId: item.inventoryId, medicineId: item.medicineId, name: item.medicineName, from: item, to: { stockOnHand: stock }, at: new Date() }) });
  }
  if (!drugstoreId) return <EmptyState>No active pharmacy membership.</EmptyState>;
  if (query.isLoading) return <LoadingState label="Loading pharmacy inventory…" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const orderingLabels = {
    orderable: 'Orderable',
    pharmacy_review: 'Not visible to customers yet. The admin will publish the pharmacy when it is ready.',
    catalog_review: 'Check the product category before offering it online.',
    pharmacy_confirmation: 'Confirm this product and its category before it can be offered online.',
    out_of_stock: 'Out of stock. Add units when stock is available.',
    unavailable: 'Listing unavailable. Ask an admin to check its availability.',
  };
  return <><Heading title="Pharmacy inventory" subtitle="Add new stock with a CSV or one medicine at a time, or edit stock and price of your items below." />
    <StockSubmitCard drugstoreId={drugstoreId} />
    <section className="card">
      {lastChange && <p className="notice" role="status">
        Stock for <strong>{lastChange.name}</strong> changed from {lastChange.from.stockOnHand} to {lastChange.to.stockOnHand} at {lastChange.at.toLocaleTimeString()}.{' '}
        <button type="button" className="link-button" disabled={adjust.isPending} onClick={() => {
          const current = query.data?.find((entry) => entry.inventoryId === lastChange.inventoryId);
          if (current) saveStock(current, lastChange.from.stockOnHand, true);
        }}>Undo</button>
      </p>}
      {query.data?.length === 0 ? <EmptyState>No inventory records for this pharmacy.</EmptyState> :
        <TableRegion label="Pharmacy inventory table">
          <table><thead><tr>{['Medicine', 'Stock on hand', 'Unit price', 'Actions'].map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
            <tbody>{(query.data || []).map((item) => <tr key={item.inventoryId}>
              <th scope="row" className="record-title">{item.medicineName}{item.genericName && <small>{item.genericName}</small>}
                <small>Catalog #{item.medicineId}</small>
                {item.orderingState ? <small>{orderingLabels[item.orderingState]}</small>
                  : item.publicationStatus === 'draft' && <small>{orderingLabels.catalog_review}</small>}
              </th>
              <td>{item.stockOnHand}{item.sellingUnit && ` (${item.sellingUnit})`}
                {item.stockOnHand <= 0 ? <> <Status value="Out of stock" /></> : item.stockOnHand <= lowStockLevel(item) ? <> <Status value="Low stock" /></> : null}
                {item.expiryDate && <small>Expires {displayDate(item.expiryDate)}{expiryState(item.expiryDate) === 'expired' ? <> <Status value="Expired" /></> : expiryState(item.expiryDate) === 'soon' ? <> <Status value="Expires soon" /></> : null}</small>}</td><td>{pesos(item.priceCentavos)}{item.sellingUnit ? ` per ${item.sellingUnit}` : <small> · Selling unit unconfirmed</small>}
                {item.packageSize && <small> · Supplier package {item.packageSize}</small>}</td>
              <td>{editing?.inventoryId === item.inventoryId ? <form className="mini-form" onSubmit={(event) => {
                event.preventDefault();
                if (adjust.isPending) return;
                const data = new FormData(event.currentTarget);
                const sellingUnit = String(data.get('sellingUnit') ?? '').trim();
                const packageSize = String(data.get('packageSize') ?? '').trim();
                const expiryDate = String(data.get('expiryDate') ?? '') || null;
                const lowStockText = String(data.get('lowStockThreshold') ?? '').trim();
                const lowStockThreshold = lowStockText === '' ? null : Number(lowStockText);
                adjust.mutate({ medicineId: item.medicineId, stockOnHand: Number(data.get('stockOnHand')), expectedStockOnHand: editing.stockOnHand,
                  sellingUnit: sellingUnit || undefined, expectedSellingUnit: editing.sellingUnit,
                  packageSize: packageSize || (editing.packageSize ? null : undefined), expectedPackageSize: editing.packageSize,
                  price: String(data.get('price')), expectedPriceCentavos: editing.priceCentavos,
                  // Expiry date and low-stock level are only sent when they were changed.
                  ...(expiryDate !== (editing.expiryDate ?? null) ? { expiryDate } : {}),
                  ...(lowStockThreshold !== (editing.lowStockThreshold ?? null) ? { lowStockThreshold } : {}) }, { onSuccess: () => { setLastChange(null); setEditing(null); } });
              }}>
                <label>Stock on hand
                  <input name="stockOnHand" type="number" step={1} min={0} max={2147483647} required
                    disabled={adjust.isPending} defaultValue={editing.stockOnHand} aria-label={`Stock on hand for ${item.medicineName}`} />
                </label>
                <label>Selling unit<input name="sellingUnit" maxLength={48} placeholder="Capsule or Box of 10" defaultValue={editing.sellingUnit ?? ''}
                  disabled={adjust.isPending} required={Boolean(editing.sellingUnit)} /></label>
                <label>Supplier package size (optional)<input name="packageSize" maxLength={80} placeholder="Box of 10 capsules" defaultValue={editing.packageSize ?? ''}
                  disabled={adjust.isPending} /></label>
                <small>Use the selling unit above for both stock and price. Wait until reserved stock is cleared before changing the unit or package size.</small>
                <label>Unit price (₱)
                  <input name="price" type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" maxLength={17} required
                    disabled={adjust.isPending} defaultValue={`${Math.floor(editing.priceCentavos / 100)}.${String(editing.priceCentavos % 100).padStart(2, '0')}`}
                    aria-label={`Unit price for ${item.medicineName}`} />
                </label>
                <label>Expiry date (optional)<input name="expiryDate" type="date" defaultValue={editing.expiryDate ?? ''} disabled={adjust.isPending} /></label>
                <label>Low-stock warning at (optional)<input name="lowStockThreshold" type="number" step={1} min={0} max={1000000} placeholder={String(LOW_STOCK)}
                  defaultValue={editing.lowStockThreshold ?? ''} disabled={adjust.isPending} /></label>
                <small>The warning shows when stock is at or below this number. Expiry dates only remind you; they do not stop orders.</small>
                <button className="primary" disabled={adjust.isPending}>{adjust.isPending ? 'Saving…' : 'Save changes'}</button>
                <button type="button" className="secondary" disabled={adjust.isPending} onClick={() => { setEditing(null); adjust.reset(); }}>Cancel</button>
                <FormFeedback error={adjust.error} />
              </form> : <>
                <button type="button" className="secondary" disabled={editing !== null || adjust.isPending}
                  onClick={() => { adjust.reset(); setEditing(item); }} aria-label={`Edit stock and price for ${item.medicineName}`}>Edit stock and price</button>
                {item.orderingState === 'pharmacy_confirmation' && item.saleProduct && <button type="button" className="primary" disabled={adjust.isPending}
                  aria-label={`Confirm product and category for ${item.medicineName}`}
                  onClick={() => adjust.mutate({ medicineId: item.medicineId, stockOnHand: item.stockOnHand, expectedStockOnHand: item.stockOnHand,
                    price: pesoText(item.priceCentavos), expectedPriceCentavos: item.priceCentavos,
                    sellingUnit: item.sellingUnit || undefined, expectedSellingUnit: item.sellingUnit,
                    packageSize: item.packageSize || undefined, expectedPackageSize: item.packageSize, saleProduct: item.saleProduct })}>Confirm product and category</button>}
                <QuickStock item={item} busy={adjust.isPending || editing !== null} onSave={(stock) => saveStock(item, stock)} />
                {adjust.variables?.medicineId === item.medicineId && adjust.isSuccess && <FormFeedback success="Inventory saved." />}
                {adjust.variables?.medicineId === item.medicineId && adjust.isError && <FormFeedback error={adjust.error} />}
              </>}</td>
            </tr>)}</tbody>
          </table>
        </TableRegion>}
    </section>
  </>;
}

export function PartnerReportsPage() {
  const { user } = useSession();
  const [[start, end], setDates] = useState(['', '']);
  const report = useQuery({ queryKey: ['partner', 'sales-report', user?.id, start, end], queryFn: () => api.partnerSales(start, end), retry: false });
  const subscription = useQuery({ queryKey: ['partner', 'subscription', user?.id], queryFn: api.partnerSubscription });
  const plans = useQuery({ queryKey: ['subscription-plans', user?.id], queryFn: api.subscriptionPlans, retry: false });
  return <>
    <Heading title="Reports & subscription" subtitle="Check your plan and sales from completed orders." />
    <section className="card"><h2>Subscription</h2>
      {subscription.isLoading ? <LoadingState label="Loading plan…" /> : subscription.error
        ? <ErrorState error={subscription.error} retry={() => void subscription.refetch()} />
        : <PlanDetails data={subscription.data!} plans={plans.data || []} />}
    </section>
    <section className="card"><h2>Sales report</h2>
      <p className="notice">Completed orders only.{subscription.data?.subscription?.tier === 'Plus' ? ' Your Plus plan shows the last 90 days; Pro shows your full history.' : ''}</p>
      <SalesDateFilter onApply={(from, through) => setDates([from, through])} />
      {report.isLoading ? <LoadingState label="Loading sales report…" />
        : report.error instanceof ApiError && report.error.status === 403 ? <EmptyState>{report.error.message}</EmptyState>
        : report.error ? <ErrorState error={report.error} retry={() => void report.refetch()} />
        : <SalesTable rows={report.data || []} amountLabel="Sales" />}
    </section>
  </>;
}

function PlanDetails({ data, plans, compact = false }: { data: PartnerSubscription; plans: SubscriptionPlan[]; compact?: boolean }) {
  const plan = data.subscription;
  return <>
    {plan ? <dl className="facts">
      <div><dt>Plan</dt><dd>{plan.tier}</dd></div>
      <div><dt>Status</dt><dd><Status value={plan.status} /></dd></div>
      <div><dt>Version</dt><dd>{plan.planVersion}</dd></div>
      <div><dt>Start date</dt><dd>{displayDate(plan.startDate)}</dd></div>
      <div><dt>End date</dt><dd>{plan.endDate ? displayDate(plan.endDate) : 'No end date'}</dd></div>
    </dl> : <p>No active subscription.</p>}
    {compact
      ? <><p><strong>Included features</strong></p><ul>{(plans.find((entry) => entry.tier === plan?.tier)?.features ?? ['Receive customer orders and update pickup status']).map((feature) => <li key={feature}>{feature}</li>)}</ul></>
      : <><h3>Plans</h3><PlanCards plans={plans} current={plan?.tier} /></>}
  </>;
}

function Heading({ title, subtitle }: { title: string; subtitle: string }) { return <header className="page-heading"><h1>{title}</h1><p>{subtitle}</p></header>; }
