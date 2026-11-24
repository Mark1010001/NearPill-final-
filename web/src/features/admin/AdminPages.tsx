import { useState } from 'react';
import { pickupText } from '../customer/pickup';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Pharmacy, SubscriptionPlan } from '../../api/types';
import { useSession } from '../../auth/session';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, SalesDateFilter, SalesTable, Status, displayDate } from '../../components/DataTable';
import { AdminExtraReports } from './AdminExtraPages';
import { hoursSummary, hoursToText, parseHours, summaryText, weekDays } from './operatingHours';
import { PlanCards } from '../../components/PlanCards';
import { ErrorState, FormFeedback, LoadingState, Stat, currency, pesos } from '../../components/States';

const PLAN_MONTHS: Record<string, number> = { Basic: 3, Plus: 6, Pro: 12 };
/** Start date plus the plan length; a shorter month clamps to its last day (31 Aug + 6 months = 28 Feb). Mirrors the server rule. */
function planEndDate(startDate: string, tier: string) {
  const [y, m, d] = startDate.split('-').map(Number);
  if (!y || !m || !d) return '';
  const total = (m - 1) + (PLAN_MONTHS[tier] || 0);
  const year = y + Math.floor(total / 12), month = total % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

const PENDING_PICKUP = ['confirmed', 'preparing', 'ready_for_pickup'];
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const STATUS_COLORS: Record<string, string> = {
  completed: '#2E7D32', ready_for_pickup: '#66BB6A', preparing: '#F9A825', confirmed: '#1E88E5',
  awaiting_payment: '#90A4AE', reserved: '#B0BEC5', cancelled: '#E53935', rejected: '#8E24AA', expired: '#6D4C41',
};
function StatusMix({ counts, loading, failed }: { counts: Map<string, number>; loading: boolean; failed: boolean }) {
  if (loading) return <LoadingState label="Loading orders…" />;
  if (failed) return <p className="muted">Orders could not be loaded.</p>;
  const entries = [...counts].sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (!total) return <p className="muted">No orders yet.</p>;
  return <div className="kpi-mix">
    <div className="kpi-mix-bar" role="img" aria-label={`Orders by status: ${entries.map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ')}.`}>
      {entries.map(([k, n]) => <span key={k} style={{ width: `${(n / total) * 100}%`, background: STATUS_COLORS[k] || '#78909C' }} />)}
    </div>
    <ul className="kpi-legend">
      {entries.map(([k, n]) => <li key={k}><i style={{ background: STATUS_COLORS[k] || '#78909C' }} />{k.replace(/_/g, ' ')} <strong>{n}</strong> <small>{Math.round((n / total) * 100)}%</small></li>)}
    </ul>
  </div>;
}
function ValueBars({ rows }: { rows: { name: string; value: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="muted">No pharmacy activity yet.</p>;
  return <ul className="kpi-bars">
    {rows.map((r) => <li key={r.name}><span className="kpi-bar-name">{r.name}</span>
      <span className="kpi-bar-track" aria-hidden="true"><span style={{ width: `${(r.value / max) * 100}%` }} /></span>
      <strong>{currency.format(r.value)}</strong></li>)}
  </ul>;
}

function OrdersTrend({ rows }: { rows: { day: string; label: string; count: number }[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const PLOT = 160;
  return <div className="trend" role="img" aria-label={`Orders per day, ${rows[0]?.label} to ${rows[rows.length - 1]?.label}: ${total} in total.`}>
    <div className="trend-plot" style={{ height: PLOT }}>
      <span className="trend-max" aria-hidden="true">{max}</span>
      <div className="trend-bars">{rows.map((row) => <div key={row.day} className="trend-col" title={`${row.label}: ${row.count} ${row.count === 1 ? 'order' : 'orders'}`}>
        <span className="trend-value">{row.count || ''}</span>
        <span className="trend-bar" style={{ height: row.count ? Math.max(6, Math.round((row.count / max) * (PLOT - 22))) : 2 }} />
      </div>)}</div>
    </div>
    <div className="trend-axis" aria-hidden="true">{rows.map((row) => { const [mon, day] = row.label.split(' '); return <span key={row.day}><small>{mon}</small>{day}</span>; })}</div>
    <p className="section-hint trend-total">{total} {total === 1 ? 'order' : 'orders'} in the last 14 days</p>
  </div>;
}

export function AdminDashboard() {
  const { user } = useSession();
  const query = useQuery({ queryKey: ['admin', 'metrics', user?.id], queryFn: api.metrics });
  const pharmacyList = useQuery({ queryKey: ['admin', 'pharmacies', user?.id], queryFn: api.pharmacies, retry: false });
  const orderList = useQuery({ queryKey: ['admin', 'orders', user?.id], queryFn: api.adminOrders, retry: false });
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 13);
  const sales = useQuery({ queryKey: ['admin', 'sales', user?.id, isoDay(start), isoDay(end)], queryFn: () => api.adminSales(isoDay(start), isoDay(end)), retry: false });
  const performance = useQuery({ queryKey: ['admin', 'pharmacy-report', user?.id], queryFn: api.adminDrugstoreReport, retry: false });
  if (query.isLoading) return <LoadingState label="Loading platform metrics…" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const data = query.data || {};
  const pending = pharmacyList.data?.filter((p) => p.status !== 'inactive' && !(p.verificationStatus === 'verified' && p.publicProfilePublishedAt)).length;
  const reconcile = orderList.data?.filter((o) => o.paymentStatus === 'reconciliation_required').length;
  const statusOf = (o: { status?: string; stage?: string }) => o.status || o.stage || 'unknown';
  const allOrders = orderList.data;
  const pendingPickups = allOrders?.filter((o) => PENDING_PICKUP.includes(statusOf(o))).length;
  const cancelled = allOrders?.filter((o) => statusOf(o) === 'cancelled').length;
  const statusCounts = new Map<string, number>();
  (allOrders || []).forEach((o) => statusCounts.set(statusOf(o), (statusCounts.get(statusOf(o)) || 0) + 1));
  const byDay = new Map((sales.data || []).map((row) => [String(row.reportDate).slice(0, 10), Number(row.orderCount) || 0]));
  const days = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return { day: isoDay(day), label: day.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }), count: byDay.get(isoDay(day)) || 0 };
  });
  const top = [...(performance.data || [])].sort((a, b) => b.revenue - a.revenue || b.orderCount - a.orderCount).slice(0, 5);
  return <><PageTitle title="Platform dashboard" subtitle="Review order activity and active pharmacies." />
    <div className="stats-grid stats-grid-5">
      <Stat label="Order value" value={currency.format(data.totalGMV || 0)} hint="Paid orders: confirmed to completed" />
      <Stat label="Active pharmacies" value={data.activePharmaciesCount || 0} />
      <Stat label="Orders" value={data.totalOrdersCount || 0} />
      <Stat label="Pending pickups" value={pendingPickups ?? '—'} hint="Confirmed, preparing or ready" />
      <Stat label="Cancelled orders" value={cancelled ?? '—'} hint="All time" />
    </div>
    <div className="two-col dashboard-grid kpi-visuals">
      <section className="card" aria-labelledby="mix-title"><h2 id="mix-title">Orders by status</h2>
        <p className="section-hint">Share of all orders in each status.</p>
        <StatusMix counts={statusCounts} loading={orderList.isLoading} failed={Boolean(orderList.error)} />
      </section>
      <section className="card" aria-labelledby="value-title"><h2 id="value-title">Order value by pharmacy</h2>
        <p className="section-hint">Paid orders, top five pharmacies.</p>
        {performance.isLoading ? <LoadingState label="Loading pharmacy report…" /> : <ValueBars rows={top.map((row) => ({ name: row.drugstoreName, value: Number(row.revenue) || 0 }))} />}
      </section>
    </div>
    <div className="two-col dashboard-grid">
      <section className="card" aria-labelledby="trend-title"><h2 id="trend-title">Orders, last 14 days</h2>
        <p className="section-hint">{days[0].label} – {days[13].label}</p>
        {sales.isLoading ? <LoadingState label="Loading daily orders…" />
          : sales.error ? <ErrorState error={sales.error} retry={() => void sales.refetch()} />
          : <OrdersTrend rows={days} />}
      </section>
      <aside aria-labelledby="attention-title"><section className="card"><h2 id="attention-title">Needs attention</h2>
        <ul className="attention-list">
          {pending != null && <li><Link to="/pharmacies"><strong>{pending}</strong> {pending === 1 ? 'pharmacy' : 'pharmacies'} not live yet</Link></li>}
          {reconcile != null && <li><Link to="/orders"><strong>{reconcile}</strong> {reconcile === 1 ? 'payment needs' : 'payments need'} reconciliation</Link></li>}
          {pending == null && reconcile == null && <li>Nothing to show right now.</li>}
        </ul></section></aside>
    </div>
    <section className="card" aria-labelledby="top-title"><div className="card-heading"><div><h2 id="top-title">Top pharmacies</h2><p className="section-hint">By order value, from the pharmacy report.</p></div><Link className="text-link" to="/pharmacies">View all pharmacies →</Link></div>
      {performance.isLoading ? <LoadingState label="Loading pharmacy report…" />
        : performance.error ? <ErrorState error={performance.error} retry={() => void performance.refetch()} />
        : <DataTable label="Top pharmacies" headers={['Pharmacy', 'Orders', 'Order value']} empty="No pharmacy activity to report."
          rows={top.map((row) => [row.drugstoreId, row.drugstoreName, row.orderCount, currency.format(row.revenue)])} />}
    </section></>;
}

/** Same fields as Add pharmacy (name, address, coordinates, opening times and days open); the login email belongs to the account and is not shown here. */
function EditPharmacyForm({ pharmacy: p, pending, onSave }: { pharmacy: Pharmacy; pending: boolean; onSave: (body: Record<string, unknown>) => void }) {
  const parsed = parseHours(p.operatingHours);
  const [hours, setHours] = useState(parsed ?? { open: '08:00', close: '20:00', days: [0, 1, 2, 3, 4, 5, 6] });
  const [hoursTouched, setHoursTouched] = useState(false);
  const hasText = Boolean(p.operatingHours?.trim());
  const info = hoursSummary(hours);
  const change = (next: typeof hours) => { setHours(next); setHoursTouched(true); };
  return <form className="mini-form" onSubmit={(event) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const body: Record<string, unknown> = {
      name: String(fields.get('name')).trim(), address: String(fields.get('address')),
      latitude: Number(fields.get('latitude')), longitude: Number(fields.get('longitude')),
    };
    // Hours written in another format are left alone unless the admin changes them here. Blank hours are filled from the times shown.
    if (hoursTouched || parsed || !hasText) body.operatingHours = hoursToText(hours);
    onSave(body);
  }}>
    <label>Pharmacy name<input name="name" required maxLength={200} defaultValue={p.name} /></label>
    <label>Address<input name="address" required maxLength={255} defaultValue={p.address} /></label>
    <label>Latitude<input name="latitude" type="number" required min="-90" max="90" step="any" defaultValue={p.latitude ?? ''} /></label>
    <label>Longitude<input name="longitude" type="number" required min="-180" max="180" step="any" defaultValue={p.longitude ?? ''} /></label>
    <fieldset className="hours-fieldset">
      <legend>Operating hours</legend>
      {!hasText && <p className="muted">Hours are not set yet. The times below are saved when you press Save pharmacy.</p>}
      {!parsed && hasText && !hoursTouched && <p className="muted">Current: {p.operatingHours}</p>}
      <label>Opens<input type="time" required value={hours.open} onChange={(event) => change({ ...hours, open: event.target.value })} /></label>
      <label>Closes<input type="time" required value={hours.close} onChange={(event) => change({ ...hours, close: event.target.value })} /></label>
      <div className="chip-row" role="group" aria-label="Days open">
        {weekDays.map((day, index) => <label key={day} className="checkbox-inline"><input type="checkbox" checked={hours.days.includes(index)}
          onChange={(event) => change({ ...hours, days: event.target.checked ? [...hours.days, index] : hours.days.filter((value) => value !== index) })} />{day}</label>)}
      </div>
      <p className="muted" role="status">{info ? summaryText(info) : 'Choose different opening and closing times and at least one day.'}</p>
    </fieldset>
    <button className="secondary" disabled={pending || (hoursTouched && !info)}>Save pharmacy</button>
  </form>;
}

export function PharmaciesPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const query = useQuery({ queryKey: ['admin', 'pharmacies', user?.id], queryFn: api.pharmacies });
  const profile = useMutation({ mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api.updatePharmacy(id, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'pharmacies'] }) });
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  if (query.isLoading) return <LoadingState label="Loading partner pharmacies…" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const pharmacies = (query.data || []).filter((pharmacy) =>
    (showInactive || pharmacy.status !== 'inactive') &&
    `${pharmacy.name} ${pharmacy.address || ''}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <><PageTitle title="Partner pharmacies" subtitle="Check pharmacies against the go-live checklist and decide which appear in the app. New pharmacies are added from Add partner pharmacy." />
    <div>
    <div><section className="card">
      <label>Find pharmacy<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show inactive pharmacies</label>
      <DataTable label="Partner pharmacies" headers={['Pharmacy', 'Verification', 'Public state', 'Actions']} empty="No matching pharmacy profiles." columnMenu
        exportCsv={{ filename: 'pharmacies.csv', rows: pharmacies.map((p) => [p.name, p.verificationStatus || 'pending', p.verificationStatus === 'verified' && p.status === 'active' && p.publicProfilePublishedAt ? 'Public' : 'Not public', '']) }}
        sortKeys={pharmacies.map((p) => [p.name, p.verificationStatus || 'pending', p.verificationStatus === 'verified' && p.status === 'active' && p.publicProfilePublishedAt ? 'Public' : 'Not public', undefined])} rows={pharmacies.map((p) => [
        Number(p.store_id || p.id),
        <div><strong>{p.name}</strong><small>{p.address || 'No address'}</small></div>,
        <Status value={p.verificationStatus || 'pending'} />,
        p.verificationStatus === 'verified' && p.status === 'active' && p.publicProfilePublishedAt ? 'Public' : 'Not public',
        <div className="stack-actions" key={String(p.store_id || p.id)}>
          {p.status === 'inactive' ? <Status value="Inactive" /> : <>
          {p.verificationStatus === 'verified' && <GoLivePanel pharmacy={p} />}
          <details><summary>Edit pharmacy</summary>
            <EditPharmacyForm key={JSON.stringify([p.name, p.address, p.latitude, p.longitude, p.operatingHours])} pharmacy={p} pending={profile.isPending}
              onSave={(body) => { if (!profile.isPending) profile.mutate({ id: Number(p.store_id || p.id), body }); }} />
            {profile.variables?.id === Number(p.store_id || p.id) && <FormFeedback error={profile.error} success={profile.isSuccess ? 'Pharmacy saved.' : undefined} />}
          </details>
          </>}
        </div>,
      ])} />
    </section></div></div>
    {confirmDialog}
  </>;
}

function GoLivePanel({ pharmacy }: { pharmacy: Pharmacy }) {
  const qc = useQueryClient();
  const id = Number(pharmacy.store_id || pharmacy.id);
  const [open, setOpen] = useState(false);
  const checklist = useQuery({ queryKey: ['admin', 'go-live', id], queryFn: () => api.goLiveChecklist(id), enabled: open });
  const publish = useMutation({
    mutationFn: (live: boolean) => api.setGoLive(id, live),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['admin', 'go-live', id] }), qc.invalidateQueries({ queryKey: ['admin', 'pharmacies'] })]),
  });
  const data = checklist.data;
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}><summary>Go-live checklist</summary>
    {checklist.isLoading && <LoadingState label="Checking the pharmacy…" />}
    {checklist.error && <ErrorState error={checklist.error} retry={() => void checklist.refetch()} />}
    {data && <div className="mini-form">
      <ul className="attention-list" aria-label={`Go-live checks for ${pharmacy.name}`}>
        {data.checks.map((check) => <li key={check.id}><span aria-hidden="true">{check.ok ? '✓' : '✗'}</span> <strong>{check.label}</strong>
          <span className="sr-only">{check.ok ? ' — done' : ' — not done'}</span>{!check.ok && <small>{check.hint}</small>}</li>)}
      </ul>
      <p className="muted">After going live, open the Android or web app and confirm the pharmacy shows up near you, its medicines are listed and an order request can be sent. Prescription items need the customer to upload a prescription for the pharmacy to approve.</p>
      {data.live
        ? <button className="danger" disabled={publish.isPending} onClick={() => publish.mutate(false)}>Take down</button>
        : <button className="primary" disabled={publish.isPending || !data.canGoLive} onClick={() => publish.mutate(true)}>{publish.isPending ? 'Publishing…' : 'Go live'}</button>}
      <FormFeedback error={publish.error} success={publish.isSuccess ? (publish.variables ? 'Pharmacy is live in the app.' : 'Pharmacy taken down from the app.') : undefined} />
    </div>}
  </details>;
}

export function AdminOrdersPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const query = useQuery({ queryKey: ['admin', 'orders', user?.id], queryFn: api.adminOrders });
  const transition = useMutation({ mutationFn: ({ id, status }: { id: number; status: string }) => api.setOrderStatus(id, status), onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orders'] }) });
  const reconcile = useMutation({ mutationFn: api.reconcilePayment, onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'orders'] }) });
  const [pharmacy, setPharmacy] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirm, confirmDialog] = useConfirm();
  if (query.isLoading) return <LoadingState label="Loading orders…" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const orders = query.data || [];
  const pharmacies = [...new Set(orders.map((order) => order.storeName).filter(Boolean))].sort();
  const statuses = [...new Set(orders.map((order) => order.status || order.stage || 'unknown'))].sort();
  const shown = orders.filter((o) => (!pharmacy || o.storeName === pharmacy) && (!statusFilter || (o.status || o.stage || 'unknown') === statusFilter));
  const chipStatuses: [string, string][] = [['confirmed', 'Confirmed'], ['preparing', 'Preparing'], ['ready_for_pickup', 'Ready for pickup'], ['completed', 'Completed'], ['cancelled', 'Cancelled']];
  const countOf = (name: string) => orders.filter((o) => (o.status || o.stage || 'unknown') === name).length;
  return <>
    <PageTitle title="Global orders" subtitle="Review payment and pickup status for each pharmacy." />
    <div className="chip-row" role="group" aria-label="Orders by pickup status">
      {chipStatuses.map(([name, label]) => <button key={name} type="button" className={`chip chip-${name.replace(/_/g, '-')}`} aria-pressed={statusFilter === name}
        onClick={() => setStatusFilter(statusFilter === name ? '' : name)}>{label}<b>{countOf(name)}</b></button>)}
    </div>
    <section className="card">
      <label>Pharmacy<select value={pharmacy} onChange={(event) => setPharmacy(event.target.value)}>
        <option value="">All pharmacies</option>
        {pharmacies.map((name) => <option key={name} value={name}>{name}</option>)}
      </select></label>
      <label>Pickup status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
        <option value="">All statuses</option>
        {statuses.map((name) => <option key={name} value={name}>{name.replace(/_/g, ' ')}</option>)}
      </select></label>
      <DataTable label="Global orders" columnMenu
        exportCsv={{ filename: 'orders.csv', rows: shown.map((o) => [o.reference || `Order #${o.id}`, o.storeName || '', o.customerName || '', o.items?.map((i) => `${i.name || i.medicineName || 'Medicine'} x${i.quantity}`).join('; ') || '', pesos(o.totalCentavos), o.status || o.stage || 'unknown', o.paymentStatus || '', '']) }}
        sortKeys={shown.map((o) => [o.reference || o.id, o.storeName, o.customerName, undefined, Number(o.totalCentavos) || 0, o.status || o.stage, o.paymentStatus, undefined])} headers={['Order', 'Pharmacy', 'Customer', 'Items', 'Amount', 'Pickup status', 'Payment status', 'Action']} empty="No matching orders."
        rows={shown.map((o) => {
          const status = o.status || o.stage || 'unknown';
          const next = status === 'confirmed' ? ['preparing', 'Start preparing']
            : status === 'preparing' ? ['ready_for_pickup', 'Mark ready']
            : status === 'ready_for_pickup' ? ['completed', 'Complete pickup'] : null;
          const testOrder = o.paymentProvider === 'xendit-test' || o.reference?.startsWith('NP-TEST-');
          const canReconcile = testOrder && o.paymentId != null && ['pending', 'reconciliation_required'].includes(o.paymentStatus || '');
          const canCancel = ['reserved', 'awaiting_payment', 'cancellation_pending'].includes(status) &&
            !['confirmed', 'refund_pending', 'refunded', 'reconciliation_required'].includes(o.paymentStatus || '') &&
            !(testOrder && o.paymentStatus === 'pending');
          return [o.id, <>{o.reference || `Order #${o.id}`}{testOrder && <small>Test order</small>}<small>{o.pickupDate ? `Pickup ${pickupText(o.pickupDate, o.pickupWindow)}` : 'No pickup date'}</small></>,
          o.storeName || '—',
          <span>{o.customerName || 'Customer'}<small>{o.customerEmail}</small></span>,
          o.items?.map((i) => `${i.name || i.medicineName || 'Medicine'} ×${i.quantity}${i.sellingUnit ? ` (${i.sellingUnit})` : ''}`).join(', ') || '—',
          pesos(o.totalCentavos), <><Status value={status} />{o.rejectionReason && <small>{o.rejectionReason}</small>}</>,
          <Status value={o.paymentStatus || 'No payment recorded'} />,
          <div className="stack-actions">
            {next
              ? <button className="secondary" disabled={transition.isPending}
                onClick={() => transition.mutate({ id: o.id, status: next[0] })}>
                {transition.isPending && transition.variables?.id === o.id ? 'Saving…' : next[1]}
              </button>
              : null}
            {canCancel && <button className="secondary" disabled={transition.isPending} onClick={async () => {
              if (await confirm({ title: `Cancel ${o.reference || `order #${o.id}`}?`, danger: true, confirmLabel: 'Cancel order', cancelLabel: 'Keep order',
                message: <>The order for <strong>{o.customerName || 'the customer'}</strong> at <strong>{o.storeName || 'the pharmacy'}</strong> will be cancelled and its reserved stock released back to the pharmacy. This cannot be undone.</> })) transition.mutate({ id: o.id, status: 'cancelled' });
            }}>Cancel order</button>}
            {canReconcile && <button className="secondary" disabled={reconcile.isPending}
              onClick={() => reconcile.mutate(o.paymentId!)}>Check with Xendit</button>}
            {reconcile.variables != null && reconcile.variables === o.paymentId && <FormFeedback error={reconcile.error}
              success={reconcile.isSuccess ? 'Payment status refreshed from Xendit.' : undefined} />}
            {transition.variables?.id === o.id && <FormFeedback error={transition.error}
              success={transition.isSuccess ? 'Pickup status updated.' : undefined} />}
          </div>];
        })} />
    </section>
    {confirmDialog}
  </>;
}

const STOCK_CATEGORIES = ['Prescription', 'Non-prescription', 'Non-medicine'] as const;
/** The only three categories the platform uses. Anything else (older import labels) is shown as "Category missing". */
export function stockCategory(raw?: string | null): (typeof STOCK_CATEGORIES)[number] | 'Category missing' {
  const label = (raw ?? '').trim().toLowerCase().replace(/ \(source list\)$/, '').replace(/\s*-\s*/g, '-');
  if (['prescription', 'prescriptions'].includes(label)) return 'Prescription';
  if (['non-prescription', 'non-prescriptions', 'general otc', 'otc'].includes(label)) return 'Non-prescription';
  if (['non-medicine', 'non-medicines', 'non medicine', 'non medicines', 'medical supplies'].includes(label)) return 'Non-medicine';
  return 'Category missing';
}

export function CatalogPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['admin', 'medicines', user?.id], queryFn: api.medicines });
  const [categoryFilter, setCategoryFilter] = useState('');
  const [stockSearch, setStockSearch] = useState('');
  const [stockPharmacy, setStockPharmacy] = useState('');
  if (query.isLoading) return <LoadingState label="Loading stocks…" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  // "Stocks" lists what the active partner pharmacies actually have in their inventory.
  const allStocked = (query.data || []).filter((m) => m.publicationStatus !== 'retired' && (m.linkedPharmacies?.length ?? 0) > 0);
  const pharmacyOptions = [...new Map(allStocked.flatMap((m) => m.linkedPharmacies ?? []).map((pharmacy) => [pharmacy.id, pharmacy.name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const pharmacyId = Number(stockPharmacy) || 0;
  const stocked = pharmacyId ? allStocked.filter((m) => m.linkedPharmacies?.some((pharmacy) => pharmacy.id === pharmacyId)) : allStocked;
  const atPharmacy = (m: (typeof allStocked)[number]) => m.linkedPharmacies?.find((pharmacy) => pharmacy.id === pharmacyId);
  const needle = stockSearch.trim().toLowerCase();
  const searched = needle ? stocked.filter((m) => [m.brandName, m.genericName, m.dosageForm, `catalog #${m.id}`, stockCategory(m.category), ...(m.linkedPharmacies?.map((pharmacy) => pharmacy.name) ?? [])]
    .some((field) => (field ?? '').toLowerCase().includes(needle))) : stocked;
  const countOf = (label: string) => searched.filter((m) => stockCategory(m.category) === label).length;
  const visible = searched.filter((m) => !categoryFilter || stockCategory(m.category) === categoryFilter);
  const chipLabels = [...STOCK_CATEGORIES, ...(countOf('Category missing') > 0 ? ['Category missing' as const] : [])];
  return <><PageTitle title="Stocks" subtitle="Everything the partner pharmacies currently stock. Pharmacies manage their own listings, prices, categories, and stock in their inventory portal." />
    <label>Pharmacy<select value={stockPharmacy} onChange={(event) => setStockPharmacy(event.target.value)}>
      <option value="">All pharmacies</option>
      {pharmacyOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <label>Search stocks<input type="search" value={stockSearch} placeholder="Medicine, generic name, category or pharmacy" maxLength={80}
      onChange={(event) => setStockSearch(event.target.value)} /></label>
    <div className="chip-row" role="group" aria-label="Stocks by category">
      {chipLabels.map((label) => <button key={label} type="button" className="chip" aria-pressed={categoryFilter === label}
        onClick={() => setCategoryFilter(categoryFilter === label ? '' : label)}>{label}<b>{countOf(label)}</b></button>)}
    </div>
    <section className="card">
      <DataTable label="Stocks" headers={pharmacyId ? ['Product', 'Category', 'At this pharmacy'] : ['Product', 'Category']} empty={needle ? 'No stocked items match your search.' : 'No stocked items yet.'} columnMenu
        sortKeys={visible.map((m) => pharmacyId ? [m.brandName, stockCategory(m.category), atPharmacy(m)?.stockOnHand ?? 0] : [m.brandName, stockCategory(m.category)])}
        rows={visible.map((m) => [m.id, <>{m.brandName}<small>{m.genericName}</small>
          <small>Catalog #{m.id}{m.dosageForm ? ` · ${m.dosageForm}` : ''}</small>
          <small>{m.linkedPharmacies?.map((pharmacy) => pharmacy.name).join(', ') || 'No linked pharmacy inventory'}</small></>,
          stockCategory(m.category),
          ...(pharmacyId ? [<>{atPharmacy(m)?.stockOnHand ?? 0} on hand<small>{atPharmacy(m)?.sellableQuantity ?? 0} sellable · {currency.format(Number(atPharmacy(m)?.priceCentavos ?? 0) / 100)}{atPharmacy(m)?.sellingUnit ? ` per ${atPharmacy(m)?.sellingUnit}` : ''}</small></>] : [])])} />
    </section>
  </>;
}

export function SubscriptionsPage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const [pharmacy, setPharmacy] = useState('');
  const [form, setForm] = useState({ drugstoreId: '', tier: 'Plus', startDate: new Date().toISOString().slice(0, 10) });
  const query = useQuery({ queryKey: ['admin', 'subscriptions', user?.id], queryFn: api.subscriptions });
  const plans = useQuery({ queryKey: ['subscription-plans', user?.id], queryFn: api.subscriptionPlans, retry: false });
  const pharmacyList = useQuery({ queryKey: ['admin', 'pharmacies', user?.id], queryFn: api.pharmacies, retry: false });
  const save = useMutation({
    mutationFn: () => api.createSubscription({ drugstoreId: Number(form.drugstoreId), tier: form.tier, startDate: form.startDate, planVersion: `${form.tier.toLowerCase()}-v1` }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'subscriptions'] }),
  });
  if (query.isLoading) return <LoadingState label="Loading subscriptions…" />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const rows = query.data || [];
  const pharmacyNames = new Map(rows.map((row) => [String(row.drugstoreId), row.drugstoreName || `Pharmacy #${row.drugstoreId}`]));
  const assignable = (pharmacyList.data || []).filter((p) => p.status !== 'inactive' && (p.verificationStatus || 'pending') === 'verified');
  return <>
    <PageTitle title="Subscriptions" subtitle="Review each pharmacy’s plan and subscription dates." />
    <section className="card" aria-labelledby="plans-title"><h2 id="plans-title">Plans</h2>
      <p className="section-hint">What each plan includes. Changing a pharmacy’s plan takes effect immediately.</p>
      {plans.isLoading ? <LoadingState label="Loading plans…" /> : plans.error ? <ErrorState error={plans.error} retry={() => void plans.refetch()} />
        : <PlanCards plans={plans.data || []} />}
    </section>
    {assignable.length > 0 && <section className="card"><h2>Change a pharmacy’s plan</h2>
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); if (!save.isPending) save.mutate(); }}>
        <fieldset className="inline-form" disabled={save.isPending} aria-label="Plan change">
          <label>Pharmacy<select required value={form.drugstoreId} onChange={(event) => setForm({ ...form, drugstoreId: event.target.value })}>
            <option value="">Choose a pharmacy</option>
            {assignable.map((p) => <option key={String(p.store_id || p.id)} value={String(p.store_id || p.id)}>{p.name}</option>)}
          </select></label>
          <label>Plan<select value={form.tier} onChange={(event) => setForm({ ...form, tier: event.target.value })}>
            {(plans.data || [{ tier: 'Basic' }, { tier: 'Plus' }, { tier: 'Pro' }]).map((plan) => <option key={plan.tier} value={plan.tier}>{plan.tier}</option>)}
          </select></label>
          <label>Start date<input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
          <label>End date (automatic)<input type="date" readOnly value={planEndDate(form.startDate, form.tier)} aria-describedby="end-date-note" /></label>
          <button className="primary">{save.isPending ? 'Saving…' : 'Save plan'}</button>
        </fieldset>
      </form>
      <p id="end-date-note" className="section-hint">The end date is set from the start date: Basic 3 months, Plus 6 months, Pro 1 year.</p>
      <FormFeedback error={save.error} success={save.isSuccess ? 'Plan saved. The pharmacy’s previous plan was ended.' : undefined} />
    </section>}
    <section className="card">
      <label>Pharmacy<select value={pharmacy} onChange={(event) => setPharmacy(event.target.value)}>
        <option value="">All pharmacies</option>
        {[...pharmacyNames].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <DataTable label="Pharmacy subscriptions" columnMenu
        exportCsv={{ filename: 'subscriptions.csv', rows: rows.filter((plan) => !pharmacy || String(plan.drugstoreId) === pharmacy).map((plan) => [plan.drugstoreName || 'Pharmacy', plan.tier, plan.status, String(plan.planVersion), plan.startDate, plan.endDate ?? '']) }}
        sortKeys={rows.filter((plan) => !pharmacy || String(plan.drugstoreId) === pharmacy).map((plan) => [plan.drugstoreName || '', plan.tier, plan.status, plan.planVersion, plan.startDate, plan.endDate ?? '9999'])}
        headers={['Pharmacy', 'Plan', 'Status', 'Version', 'Starts', 'Ends']}
        rows={rows.filter((plan) => !pharmacy || String(plan.drugstoreId) === pharmacy).map((plan) => [plan.id, <>{plan.drugstoreName || 'Pharmacy'}<small>Pharmacy #{plan.drugstoreId} · Subscription #{plan.id}</small></>,
          plan.tier, <Status value={plan.status} />, plan.planVersion, displayDate(plan.startDate),
          plan.endDate ? displayDate(plan.endDate) : 'No end date'])} empty="No subscriptions found." />
    </section>
  </>;
}

export function AdminReportsPage() {
  const { user } = useSession();
  const [[start, end], setDates] = useState(['', '']);
  const query = useQuery({ queryKey: ['admin', 'sales-report', user?.id, start, end], queryFn: () => api.adminSales(start, end) });
  return <>
    <PageTitle title="Reports" subtitle="Review daily order counts and order value. Order value counts paid orders only." />
    <section className="card"><h2>Sales report</h2>
      <SalesDateFilter onApply={(from, through) => setDates([from, through])} />
      {query.isLoading ? <LoadingState label="Loading sales report…" />
        : query.error ? <ErrorState error={query.error} retry={() => void query.refetch()} />
        : <><div className="stats-grid"><Stat label="Orders" value={(query.data || []).reduce((n, r) => n + (Number(r.orderCount) || 0), 0)} hint={start || end ? 'In the selected dates' : 'All time'} />
            <Stat label="Order value" value={currency.format((query.data || []).reduce((n, r) => n + (Number(r.revenue) || 0), 0))} hint="Paid orders" /></div>
          <SalesTable rows={query.data || []} amountLabel="Order value" /></>}
    </section>
    <AdminExtraReports />
  </>;
}

function PageTitle({ title, subtitle }: { title: string; subtitle: string }) { return <header className="page-heading"><h1>{title}</h1><p>{subtitle}</p></header>; }
