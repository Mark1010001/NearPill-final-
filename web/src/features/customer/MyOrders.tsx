import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Order, SessionUser } from '../../api/types';
import { SkeletonCards, pesos } from '../../components/States';
import { cancellationNotice } from './copy';
import { useCart } from './cartContext';
import { TestPayment } from './OrderPages';
import { nonnegativeInteger, positiveId } from './cart';
import { useToast } from './toast';
import { OrderReceipt, hasReceipt } from './Receipt';
import { chipLabel, pickupDays, pickupFlag, pickupText, pickupWindows, shortDate, windowAvailable, type PickupWindowId } from './pickup';
import { MaterialIcon } from './MaterialIcon';

type Stage = 'placed' | 'preparing' | 'ready' | 'completed' | 'cancelled';
// stageFromString in lib/models/order_model.dart
const stageOf = (order: Order): Stage => {
  switch ((order.stage ?? order.status ?? 'placed').toLowerCase()) {
    case 'preparing': return 'preparing';
    case 'ready': case 'ready_for_pickup': return 'ready';
    case 'completed': return 'completed';
    case 'cancelled': case 'expired': return 'cancelled';
    default: return 'placed';
  }
};
const isActive = (order: Order) => ['placed', 'preparing', 'ready'].includes(stageOf(order));
const itemSummary = (order: Order) => order.itemSummary
  ?? order.items.map((item) => `${item.name ?? 'Medicine'} x${item.quantity}${item.sellingUnit ? ` (${item.sellingUnit})` : ''}`).join(', ');
const itemCount = (order: Order) => order.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
const totalText = (order: Order) => { const c = nonnegativeInteger(order.totalCentavos); return c === null ? '₱0.00' : pesos(c); };

const statusOf = (order: Order) => (order.status ?? '').toLowerCase();
const toPay = (order: Order) => ['reserved', 'awaiting_payment', 'pending'].includes(statusOf(order));
const toPickUp = (order: Order) => ['confirmed', 'preparing'].includes(statusOf(order));
const filters = [
  { id: 'all', label: 'All', matches: () => true },
  { id: 'pay', label: 'To pay', matches: toPay },
  { id: 'ready', label: 'Ready', matches: (o: Order) => stageOf(o) === 'ready' },
  { id: 'pickup', label: 'To pick up', matches: toPickUp },
  { id: 'completed', label: 'Completed', matches: (o: Order) => stageOf(o) === 'completed' },
  { id: 'cancelled', label: 'Cancelled', matches: (o: Order) => stageOf(o) === 'cancelled' },
] as const;

/** Pickup line shown on order cards and details. */
function pickupSummary(order: Order) {
  const text = pickupText(order.pickupDate, order.pickupWindow);
  if (!text) return 'No pickup date';
  const flag = pickupFlag(order.pickupDate, isActive(order));
  return `Pick up ${text}${flag === 'today' ? ' · Today' : flag === 'missed' ? ' · Pickup date passed' : ''}`;
}

function PickupCard({ order, user, refresh, paid }: { order: Order; user: SessionUser; refresh: () => void; paid: boolean }) {
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(order.pickupDate ?? pickupDays()[0]);
  const [window, setWindow] = useState<PickupWindowId | ''>((order.pickupWindow as PickupWindowId | null) ?? '');
  const status = statusOf(order);
  const canChange = ['reserved', 'awaiting_payment'].includes(status) && !paid && !order.pickupRescheduled;
  const save = useMutation({
    mutationFn: () => api.reschedulePickup(String(user.id), order.id, date, window || undefined),
    onSuccess: () => { setEditing(false); refresh(); },
  });
  return <section className="card pickup-date-card" aria-label="Pickup date">
    <p className="card-title"><MaterialIcon name="eventOutlined" size={22} /><strong>{pickupText(order.pickupDate, order.pickupWindow) || 'No pickup date'}</strong></p>
    {order.pickupRescheduled && <p className="shop-muted">Pickup date changed once.</p>}
    {canChange && !editing && <button type="button" className="shop-text-link" onClick={() => setEditing(true)}>{order.pickupDate ? 'Change pickup date & time' : 'Choose pickup date & time'}</button>}
    {editing && <>
      <strong>Pick date & time</strong>
      <div className="chip-row pickup-days" role="group" aria-label="New pickup date">
        {pickupDays().map((day) => <button key={day} type="button" className={`chip${date === day ? ' chip-on' : ''}`} aria-pressed={date === day} aria-label={`${chipLabel(day)}, ${shortDate(day)}`}
          onClick={() => { setDate(day); if (window && !windowAvailable(day, window)) setWindow(''); }}>{chipLabel(day)}</button>)}
      </div>
      <div className="chip-row pickup-windows" role="group" aria-label="New pickup time">
        <button type="button" className={`chip${window === '' ? ' chip-on' : ''}`} aria-pressed={window === ''} onClick={() => setWindow('')}>Any time</button>
        {pickupWindows.map((entry) => <button key={entry.id} type="button" className={`chip${window === entry.id ? ' chip-on' : ''}`} aria-pressed={window === entry.id}
          disabled={!windowAvailable(date, entry.id)} onClick={() => setWindow(entry.id)}>{entry.label} {entry.hours}</button>)}
      </div>
      <p className="shop-muted">You can change this once.</p>
      {save.isError && <p className="form-error" role="alert">{save.error instanceof Error ? save.error.message : 'Could not change the pickup date.'}</p>}
      <div className="row">
        <button type="button" className="secondary" onClick={() => setEditing(false)}>Cancel</button>
        <button type="button" className="primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</button>
      </div>
    </>}
  </section>;
}

const statusChip: Record<Stage, [string, string]> = {
  placed: ['Reserved', 'st-reserved'], preparing: ['Preparing', 'st-preparing'], ready: ['Ready for Pickup', 'st-ready'],
  completed: ['Completed', 'st-completed'], cancelled: ['Cancelled', 'st-cancelled'],
};

function OrderDetail({ order, user, hasRemainingCart, justReserved, close, refresh }: {
  order: Order; user: SessionUser; hasRemainingCart: boolean; justReserved: boolean; close: () => void; refresh: () => void;
}) {
  const accountId = String(user.id);
  const { toast } = useToast(2000);
  const stage = stageOf(order);
  const status = (order.status ?? '').toLowerCase();
  const testOrder = !!user.xenditTestCheckout && !!order.reference?.startsWith('NP-TEST-');
  const payment = useQuery({
    queryKey: ['customer-orders', accountId, 'test-payment', order.id],
    queryFn: ({ signal }) => api.testOrderPayment(accountId, order.id, signal),
    enabled: testOrder, retry: false, gcTime: 0,
  });
  const paymentStatus = payment.data?.payment?.paymentStatus ?? null;
  const title = stage === 'cancelled' ? (status === 'expired' ? 'Reservation expired' : 'Order Cancelled')
    : stage === 'completed' ? 'Collected'
    : stage === 'preparing' ? 'Preparing for pickup'
    : stage === 'ready' ? 'Ready for pickup'
    : status === 'cancellation_pending' ? 'Cancellation requested'
    : paymentStatus === 'confirmed' ? 'Payment confirmed'
    : paymentStatus === 'pending' ? 'Waiting for payment confirmation' : 'Order reserved';
  const paidInfo = payment.data?.payment;
  const totalCentavos = nonnegativeInteger(order.totalCentavos);
  const balanceDue = stage === 'completed' ? 0
    : paidInfo?.paymentPlan === 'balance' && paymentStatus !== 'confirmed' ? paidInfo.amountCentavos ?? 0
    : totalCentavos !== null && paidInfo?.paymentPlan === 'deposit' && typeof paidInfo.amountCentavos === 'number' ? Math.max(0, totalCentavos - paidInfo.amountCentavos) : 0;
  const started = ['preparing', 'ready', 'completed'].includes(stage);
  const paidDone = paymentStatus === 'confirmed' || started;
  const steps = [
    { label: 'Placed', sub: '', done: true },
    ...(testOrder ? [{ label: 'Paid', sub: paidDone ? (balanceDue > 0 ? 'Deposit' : 'GCash') : 'Awaiting', done: paidDone }] : []),
    { label: 'Preparing', sub: 'In pharmacy', done: stage === 'ready' || stage === 'completed' },
    { label: 'Ready', sub: stage === 'completed' ? 'Picked up' : 'Pickup counter', done: stage === 'completed' },
  ];
  const current = Math.max(0, steps.findIndex((step) => !step.done) === -1 ? steps.length - 1 : steps.findIndex((step) => !step.done));
  return <section aria-label="Order" className="order-detail">
    <button type="button" className="shop-text-link shop-back-link" onClick={close}>Back to My Orders</button>
    <div className="screen-header"><h1>Order Details</h1></div>
    <div className="order-hero">
      <span className={`hero-icon${stage === 'cancelled' ? ' hero-bad' : ''}${stage === 'completed' ? ' hero-done' : ''}`} aria-hidden="true"><MaterialIcon name={stage === 'cancelled' ? 'cancelOutlined' : stage === 'preparing' ? 'timelapse' : 'checkCircle'} size={36} /></span>
      <h2>{title}</h2>
    </div>
    {stage !== 'cancelled' && <section className="card timeline" aria-label="Order progress">
      <ol className="steps">{steps.map((step, i) => <li key={step.label} aria-current={i === current && !step.done ? 'step' : undefined}
        className={step.done ? 'done' : i === current ? 'now' : ''}>
        <span className="step-dot" aria-hidden="true">{step.done ? <MaterialIcon name="check" size={18} /> : <MaterialIcon name="circle" size={10} />}</span>
        <strong>{step.label}</strong>
        {step.sub && <small>{step.sub}</small>}</li>)}</ol>
    </section>}
    {hasRemainingCart && justReserved && <>
      <p>Your other items are still in your cart.</p>
      <Link className="shop-text-link" to="/app/orders?tab=cart">Back to remaining cart items</Link>
    </>}
    {testOrder && <TestPayment id={order.id} accountId={accountId} status={status} depositEnabled={user.xenditTestDeposit}
      total={nonnegativeInteger(order.totalCentavos)} refreshOrders={refresh} />}
    {stage !== 'cancelled' && <PickupCard order={order} user={user} refresh={refresh} paid={paymentStatus === 'confirmed'} />}
    {stage === 'cancelled' && <p className="card cancelled-card" role="status"><MaterialIcon name="infoOutline" size={22} /> {cancellationNotice}</p>}
    {stage !== 'cancelled' && <>
      {hasReceipt(order) ? <OrderReceipt order={order} user={user} balanceDue={balanceDue} checkingPayment={testOrder && payment.isPending} /> : null}
    </>}
    {toast}
  </section>;
}

/** The app's "My Orders" tab: status tabs, order cards and order detail. */
export function OrdersPage({ user, retrySession, hasRemainingCart }: { user: SessionUser; retrySession: () => void; hasRemainingCart: boolean }) {
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const navigate = useNavigate();
  const cart = useCart();
  const { show, toast } = useToast(3000);
  const [filter, setFilter] = useState<(typeof filters)[number]['id']>('all');
  const accountId = String(user.id);
  const selectedId = positiveId(params.get('testOrder'));
  const orders = useQuery({
    queryKey: ['customer-orders', accountId],
    queryFn: ({ signal }) => api.customerOrders(accountId, signal),
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: ({ state }) => state.data?.some((order) =>
      order.id === selectedId && !['completed', 'cancelled', 'expired'].includes(order.status ?? order.stage ?? '')) ? 12000 : false,
  });
  const all = orders.data ?? [];
  const selected = all.find((order) => order.id === selectedId);

  function open(order: Order) {
    const next = new URLSearchParams(params);
    next.set('tab', 'orders'); next.set('testOrder', String(order.id));
    setParams(next);
  }
  function close() {
    const next = new URLSearchParams(params);
    next.delete('testOrder');
    void navigate({ search: next.toString() }, { replace: false });
  }
  function reorder(order: Order) {
    show(cart.addOrderItems(order) === null ? 'Order items added to cart.' : 'Could not add all order items. Check your cart.');
  }

  if (orders.isPending) return <SkeletonCards label="Loading orders" count={3} />;
  if (selected) return <>
    <OrderDetail order={selected} user={user} hasRemainingCart={hasRemainingCart} justReserved={state?.reservedOrder === selected.id}
      close={close} refresh={() => { void orders.refetch(); }} />{toast}</>;
  if (orders.isError && all.length === 0 || all.length === 0) return <div className="center-note">
    <strong>{orders.isError ? 'Unable to load orders' : 'No orders yet'}</strong>
    <p>{orders.isError ? 'Check your connection and try again.' : 'Your orders and pickup status will appear here.'}</p>
    {orders.isError && <button type="button" className="shop-text-link" onClick={() => { retrySession(); void orders.refetch(); }}>Try again</button>}
  </div>;

  const active = filters.find((entry) => entry.id === filter)!;
  const shown = all.filter((order) => active.matches(order));

  const card = (order: Order) => {
    const stage = stageOf(order);
    const [label, tone] = statusChip[stage];
    const canReorder = stage === 'completed' || stage === 'cancelled';
    const action = toPay(order) ? ['Pay now', () => open(order), true]
      : hasReceipt(order) && (stage === 'preparing' || statusOf(order) === 'confirmed') ? ['View receipt', () => open(order), true]
      : stage === 'placed' || stage === 'preparing' ? ['View status', () => open(order), true]
      : stage === 'ready' ? ['View pickup details', () => open(order), true]
      : stage === 'completed' ? ['Buy Again', () => reorder(order), true] : ['Reorder', () => reorder(order), false];
    const lines = order.items.slice(0, 2);
    const more = order.items.length - lines.length;
    const count = itemCount(order);
    return <li key={order.id} className="card order-card">
      <button type="button" className="order-card-main linklike" onClick={() => open(order)} aria-label={toPay(order) ? `${order.storeName}, ${label}` : `${order.storeName}, ${order.reference}, ${label}`}>
        <span className="order-card-head"><strong><MaterialIcon name="storefront" size={22} /> {order.storeName}</strong><span className={`order-status ${tone}`}>{label}</span></span>
        {lines.length > 0 ? <span className="order-lines">
          {lines.map((item, i) => <span key={i} className="order-line">
            <span className="thumb" aria-hidden="true"><MaterialIcon name="medication" size={22} /></span>
            <span className="order-line-text"><span className="order-summary">{item.name ?? 'Medicine'}</span>
              <span className="shop-muted">× {item.quantity}{item.sellingUnit ? ` (${item.sellingUnit})` : ''}</span></span>
            <span className="order-line-price">{pesos((nonnegativeInteger(item.priceCentavos) ?? 0) * (Number(item.quantity) || 0))}</span>
          </span>)}
          {more > 0 && <span className="shop-muted">+{more} more item{more === 1 ? '' : 's'}</span>}
        </span> : <span className="order-summary">{itemSummary(order)}</span>}
        <span className="shop-muted">{toPay(order) ? (order.placedOn ?? '') : `${order.reference} · ${order.placedOn ?? ''}`}</span>
        <span className="order-pickup">{pickupSummary(order)}</span>
      </button>
      <div className="order-card-foot">
        <span className="order-total"><span className="shop-muted">{count} item{count === 1 ? '' : 's'} · Order total</span> <strong>{totalText(order)}</strong></span>
        <button type="button" className={action[2] ? 'primary' : 'secondary'} onClick={action[1] as () => void}
          disabled={canReorder && order.items.length === 0}>{action[0] as string}</button></div>
    </li>;
  };

  return <>
    <div className="order-tabs" role="group" aria-label="Order filter">
      {filters.map((entry) => <button key={entry.id} type="button" className={`order-tab${filter === entry.id ? ' order-tab-on' : ''}`} aria-pressed={filter === entry.id}
        onClick={() => setFilter(entry.id)}>{entry.label} ({all.filter(entry.matches).length})</button>)}
    </div>
    {shown.length === 0 ? <div className="center-note"><strong>No orders here</strong><p>Orders with this status will appear here.</p></div>
      : <ul className="order-cards">{shown.map(card)}</ul>}
    {toast}
  </>;
}
