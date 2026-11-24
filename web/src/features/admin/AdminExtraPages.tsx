import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useSession } from '../../auth/session';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, Status, displayDate } from '../../components/DataTable';
import { ErrorState, FormFeedback, LoadingState, currency } from '../../components/States';
import { hoursSummary, hoursToText, summaryText, weekDays } from './operatingHours';

const dateTime = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' });
function showDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date);
}

function PageTitle({ title, subtitle }: { title: string; subtitle: string }) { return <header className="page-heading"><h1>{title}</h1><p>{subtitle}</p></header>; }

const manilaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
/** Expiry label for a pharmacy's partnership: no plan, expired, expiring within 30 days, or active. */
function partnershipState(expires?: string | null): { value: string; label: string } {
  if (!expires) return { value: 'inactive', label: 'No plan' };
  const today = manilaToday();
  if (expires < today) return { value: 'inactive', label: 'Expired' };
  const soon = new Date(`${today}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 30);
  return expires <= soon.toISOString().slice(0, 10) ? { value: 'pending', label: 'Expires soon' } : { value: 'active', label: 'Active' };
}

const roleLabels = { owner: 'Owner', manager: 'Manager', staff: 'Staff' } as const;

export function StaffAccountsPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const [confirm, confirmDialog] = useConfirm();
  const [drugstoreId, setDrugstoreId] = useState('');
  const [form, setForm] = useState({ name: '', address: '', latitude: '', longitude: '' });
  const [hours, setHours] = useState({ open: '08:00', close: '20:00', days: [0, 1, 2, 3, 4, 5, 6] });
  const hoursInfo = hoursSummary(hours);
  const [createdId, setCreatedId] = useState(0);
  const [justAdded, setJustAdded] = useState<{ drugstoreId: number; userId: number; email: string } | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [done, setDone] = useState('');
  const pharmacies = useQuery({ queryKey: ['admin', 'pharmacies', user?.id], queryFn: api.pharmacies });
  const selected = Number(drugstoreId);
  const members = useQuery({
    queryKey: ['admin', 'memberships', user?.id, selected], queryFn: () => api.pharmacyMemberships(selected),
    enabled: Number.isInteger(selected) && selected > 0,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'memberships'] });
  // Adds the pharmacy and its login in one go. If the login step fails (for example the email is already used),
  // the pharmacy that was just created is kept and a retry only repeats the login step, so no duplicate pharmacy appears.
  const save = useMutation({
    mutationFn: async () => {
      let id = createdId;
      if (!id) {
        if (!hoursInfo) throw new Error('Set the opening and closing times (they must differ) and choose at least one day open.');
        // An email that already has any NearPill account is refused before anything is created.
        if (!(await api.checkPartnerEmail(accountEmail.trim())).available) throw new Error('An account with this email already exists. Use a different email. No pharmacy was added.');
        const created = await api.createPharmacy({ name: form.name.trim(), address: form.address.trim(), latitude: Number(form.latitude), longitude: Number(form.longitude), operatingHours: hoursToText(hours), status: 'active' }) as { id?: number; store_id?: number };
        id = Number(created.store_id ?? created.id);
        setCreatedId(id);
      }
      const account = await api.createPartnerAccount(id, { email: accountEmail.trim() });
      return { drugstoreId: id, userId: Number(account.userId) };
    },
    onSuccess: async ({ drugstoreId: id, userId }) => {
      const email = accountEmail.trim().toLowerCase();
      setJustAdded({ drugstoreId: id, userId, email });
      const name = form.name.trim();
      // The login email goes out straight away; if it cannot be sent the pharmacy is still added and the button below retries.
      const mailed = await api.sendLoginEmail(id, userId).then(() => true, () => false);
      setDone(mailed
        ? `${name} was added. A login email with a sign-in link and a link to choose a password was sent to ${email}.`
        : `${name} was added with a partner account for ${email}, but the login email could not be sent. Use "Email login details" to try again.`);
      setForm({ name: '', address: '', latitude: '', longitude: '' }); setCreatedId(0); setAccountEmail('');
      setDrugstoreId(String(id));
      await Promise.all([pharmacies.refetch(), refresh()]);
    },
    onError: () => setDone(''),
  });
  const mail = useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number }) => api.sendLoginEmail(id, userId),
    onSuccess: () => setDone('Login details emailed. The email has a sign-in link and a link to choose a password; it never contains a password.'),
    onError: () => setDone(''),
  });
  const [panelDone, setPanelDone] = useState('');
  const live = useQuery({ queryKey: ['admin', 'go-live', selected], queryFn: () => api.goLiveChecklist(selected), enabled: Number.isInteger(selected) && selected > 0, retry: false });
  // Remove access hides the pharmacy from the web app and the Android app (the partner can still sign in); Restore access shows it again.
  const visibility = useMutation({
    mutationFn: (liveNext: boolean) => api.setGoLive(selected, liveNext),
    onSuccess: (_data, liveNext) => {
      setPanelDone(liveNext ? 'Access restored. Customers can see this pharmacy again.' : 'Access removed. Customers no longer see this pharmacy in the web app or the Android app.');
      qc.setQueryData<{ live?: boolean }>(['admin', 'go-live', selected], (old) => (old ? { ...old, live: liveNext } : old));
      void live.refetch(); void pharmacies.refetch();
    },
    onError: () => setPanelDone(''),
  });
  const erase = useMutation({
    mutationFn: () => api.deletePharmacy(selected),
    onSuccess: async () => {
      setPanelDone('The pharmacy account was deleted.');
      setDrugstoreId('');
      await Promise.all([pharmacies.refetch(), refresh()]);
    },
    onError: () => setPanelDone(''),
  });
  const selectedName = () => (pharmacies.data || []).find((store) => Number(store.store_id ?? store.id) === selected)?.name ?? 'This pharmacy';
  async function removeAccess() {
    const ok = await confirm({
      title: 'Remove access to this pharmacy?', confirmLabel: 'Remove access', danger: true,
      message: <>Customers will no longer see {selectedName()} in the web app or the Android app. The partner can still sign in. You can restore access later.</>,
    });
    if (ok) { setPanelDone(''); visibility.mutate(false); }
  }
  async function deletePharmacy() {
    const ok = await confirm({
      title: 'Delete this pharmacy account?', confirmLabel: 'Delete', danger: true,
      message: <>{selectedName()} and its partner account will be deleted for good. The partner’s personal details are removed and their email can be used again. Orders and sales totals stay in the reports without personal details. This cannot be undone.</>,
    });
    if (ok) { setPanelDone(''); erase.mutate(); }
  }
  if (pharmacies.isLoading) return <LoadingState label="Loading pharmacies…" />;
  if (pharmacies.error) return <ErrorState error={pharmacies.error} retry={() => void pharmacies.refetch()} />;
  const stores = (pharmacies.data || []).filter((store) => store.status !== 'inactive');
  const rows = members.data || [];
  return <>
    <PageTitle title="Partner pharmacy accounts" subtitle="Each partner pharmacy's ID and when its partnership with NearPill expires. Choose who can work for each pharmacy below. Each person needs an existing pharmacy partner account." />
    <section className="card"><h2>Partnership expiry</h2>
      <p className="muted">Counted from the day the pharmacy joined NearPill: Basic 3 months, Plus 6 months, Pro 1 year.</p>
      <DataTable label="Partnership expiry" headers={['ID', 'Pharmacy', 'Plan', 'Partner since', 'Expires', 'Partnership']}
        sortKeys={stores.map((store) => [Number(store.store_id ?? store.id), store.name, store.subscriptionTier ?? '', store.partnershipStartedAt ?? '', store.partnershipExpiresAt ?? '', partnershipState(store.partnershipExpiresAt).label])}
        rows={stores.map((store) => [String(store.store_id ?? store.id), String(store.store_id ?? store.id), store.name, store.subscriptionTier ?? 'No plan',
          displayDate(store.partnershipStartedAt ?? null), displayDate(store.partnershipExpiresAt ?? null),
          <Status value={partnershipState(store.partnershipExpiresAt).value} label={partnershipState(store.partnershipExpiresAt).label} />])}
        empty="No partner pharmacies yet." />
    </section>
    <div className="two-col two-col-reverse">
      <aside><section className="card"><h2>Add partner pharmacy</h2>
        <form onSubmit={(event) => { event.preventDefault(); if (!save.isPending) { setDone(''); setJustAdded(null); save.mutate(); } }}>
          <label>Pharmacy name<input required maxLength={150} disabled={createdId > 0} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Address<input required maxLength={255} disabled={createdId > 0} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
          <label>Latitude<input required type="number" min={-90} max={90} step="any" disabled={createdId > 0} value={form.latitude} onChange={(event) => setForm({ ...form, latitude: event.target.value })} /></label>
          <label>Longitude<input required type="number" min={-180} max={180} step="any" disabled={createdId > 0} value={form.longitude} onChange={(event) => setForm({ ...form, longitude: event.target.value })} /></label>
          <fieldset className="hours-fieldset" disabled={createdId > 0}>
            <legend>Operating hours</legend>
            <label>Opens<input type="time" required value={hours.open} onChange={(event) => setHours({ ...hours, open: event.target.value })} /></label>
            <label>Closes<input type="time" required value={hours.close} onChange={(event) => setHours({ ...hours, close: event.target.value })} /></label>
            <div className="chip-row" role="group" aria-label="Days open">
              {weekDays.map((day, index) => <label key={day} className="checkbox-inline"><input type="checkbox" checked={hours.days.includes(index)}
                onChange={(event) => setHours({ ...hours, days: event.target.checked ? [...hours.days, index] : hours.days.filter((value) => value !== index) })} />{day}</label>)}
            </div>
            <p className="muted" role="status">{hoursInfo ? summaryText(hoursInfo) : 'Choose different opening and closing times and at least one day.'}</p>
          </fieldset>
          <label>Email<input type="email" required autoComplete="off" maxLength={254} value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} /></label>
          <p className="muted">You do not set a password. NearPill emails the pharmacy a sign-in link and a link to choose their own password.</p>
          <button disabled={save.isPending}>{save.isPending ? 'Adding…' : createdId > 0 ? 'Retry partner account' : 'Add pharmacy'}</button>
          <FormFeedback error={save.error} success={done} />
          {justAdded && <button type="button" className="secondary" disabled={mail.isPending} onClick={() => mail.mutate({ id: justAdded.drugstoreId, userId: justAdded.userId })}>{mail.isPending ? 'Sending…' : `Email login details again to ${justAdded.email}`}</button>}
          <FormFeedback error={mail.error} />
        </form></section></aside>
      <div><section className="card">
        <label>Pharmacy<select value={drugstoreId} onChange={(event) => { setDrugstoreId(event.target.value); setDone(''); }}>
          <option value="">Choose a pharmacy</option>
          {stores.map((store) => { const id = store.store_id ?? store.id; return <option key={String(id)} value={String(id)}>{store.name}</option>; })}
        </select></label>
        {selected > 0 && (members.isLoading ? <LoadingState label="Loading staff accounts…" />
          : members.error ? <ErrorState error={members.error} retry={() => void members.refetch()} />
          : <DataTable label="Staff accounts" headers={['Name', 'Email', 'Role', 'Access', 'Actions']}
            sortKeys={rows.map((item) => [item.name, item.email, item.membershipRole, item.isActive ? 'Active' : 'Removed', ''])}
            rows={rows.map((item) => [item.userId, <>{item.name}<small>Pharmacy ID {selected}</small></>, item.email,
              roleLabels[item.membershipRole] ?? item.membershipRole, <Status value={item.isActive ? 'active' : 'inactive'} label={item.isActive ? 'Active' : 'Removed'} />,
              item.isActive ? <div className="stack-actions"><button type="button" className="secondary" disabled={mail.isPending} onClick={() => mail.mutate({ id: selected, userId: item.userId })}>Email login details</button></div> : '—'])}
            empty="No staff accounts for this pharmacy yet." />)}
        {selected > 0 && <div className="mini-form" role="group" aria-label="Pharmacy visibility and deletion">
          <p><strong>{live.data ? (live.data.live ? 'Visible to customers' : 'Hidden from customers') : live.isError ? 'Visibility unavailable' : 'Checking visibility…'}</strong></p>
          <div className="stack-actions">
            {live.data?.live
              ? <button type="button" className="secondary" disabled={visibility.isPending} onClick={() => void removeAccess()}>Remove access</button>
              : <button type="button" className="secondary" disabled={visibility.isPending || !live.data} onClick={() => { setPanelDone(''); visibility.mutate(true); }}>Restore access</button>}
            <button type="button" className="danger" disabled={erase.isPending} onClick={() => void deletePharmacy()}>Delete pharmacy account</button>
          </div>
        </div>}
        <FormFeedback error={visibility.error || erase.error} success={panelDone} />
      </section></div>
    </div>
    {confirmDialog}
  </>;
}

export function AdminExtraReports() {
  const { user } = useSession();
  const medicines = useQuery({ queryKey: ['admin', 'medicine-report', user?.id], queryFn: api.adminMedicineReport });
  const pharmacies = useQuery({ queryKey: ['admin', 'pharmacy-report', user?.id], queryFn: api.adminDrugstoreReport });
  return <>
    <section className="card"><h2>Medicines sold</h2>
      {medicines.isLoading ? <LoadingState label="Loading medicine report…" />
        : medicines.error ? <ErrorState error={medicines.error} retry={() => void medicines.refetch()} />
        : <DataTable label="Medicines sold" columnMenu headers={['Medicine', 'Quantity sold', 'Orders']}
          sortKeys={(medicines.data || []).map((row) => [row.brandName, row.quantitySold, row.orderCount])}
          rows={(medicines.data || []).map((row) => [row.medicineId, <>{row.brandName}{row.genericName && <small>{row.genericName}</small>}</>, row.quantitySold, row.orderCount])}
          empty="No medicine sales to report." />}
    </section>
    <section className="card"><h2>Pharmacy performance</h2>
      {pharmacies.isLoading ? <LoadingState label="Loading pharmacy report…" />
        : pharmacies.error ? <ErrorState error={pharmacies.error} retry={() => void pharmacies.refetch()} />
        : <DataTable label="Pharmacy performance" columnMenu headers={['Pharmacy', 'Orders', 'Order value', 'Cancelled', 'Expired']}
          sortKeys={(pharmacies.data || []).map((row) => [row.drugstoreName, row.orderCount, row.revenue, row.cancelledCount, row.expiredCount])}
          rows={(pharmacies.data || []).map((row) => [row.drugstoreId, row.drugstoreName, row.orderCount, currency.format(row.revenue), row.cancelledCount, row.expiredCount])}
          empty="No pharmacy activity to report." />}
    </section>
  </>;
}

export function StockSubmissionsPage() {
  const { user } = useSession();
  const [filter, setFilter] = useState('');
  const query = useQuery({ queryKey: ['admin', 'stock-submissions', filter, user?.id], queryFn: () => api.adminStockSubmissions(filter || undefined) });
  const items = query.data ?? [];
  return <><PageTitle title="Stock submissions" subtitle="A record of the stock files pharmacies uploaded. A file that follows the template goes on sale at once, so there is nothing to approve." />
    <section className="card">
      <label>Show<select value={filter} onChange={(event) => setFilter(event.target.value)}>
        <option value="">All</option><option value="approved">Added</option>
      </select></label>
      {query.isLoading && <LoadingState label="Loading stock submissions…" />}
      {query.error && <ErrorState error={query.error} retry={() => void query.refetch()} />}
      {query.data && items.length === 0 && <p>No stock submissions here.</p>}
    </section>
    {items.map((item) => <section className="card" key={item.id} aria-label={`Submission ${item.id} from ${item.drugstoreName}`}>
      <div className="card-heading"><div>
        <h2>{item.drugstoreName}</h2>
        <p className="section-hint">Pharmacy ID {item.drugstoreId} · {item.source === 'csv' ? (item.fileName || 'CSV file') : 'Single medicine'} · {item.rowCount} {item.rowCount === 1 ? 'row' : 'rows'} · sent {showDateTime(item.createdAt)}</p>
      </div><Status value={item.status} /></div>
      <DataTable label={`Rows of submission ${item.id}`} headers={['Catalog ID', 'Medicine', 'Generic', 'Form', 'Category', 'Unit', 'Price', 'Stock', 'Result']} pageSize={10}
        rows={(item.rows ?? []).map((row) => [row.line, row.catalogId ?? 'New', row.name, row.genericName ?? '—', row.form, row.category, row.sellingUnit, currency.format(Number(row.price)), row.stock,
          row.match === 'existing' ? 'Updated catalog item' : (row.note ?? 'Added new medicine')])} />
    </section>)}</>;
}

export function CustomerAccountsPage() {
  const qc = useQueryClient();
  const { user } = useSession();
  const [confirm, confirmDialog] = useConfirm();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [done, setDone] = useState('');
  const customers = useQuery({ queryKey: ['admin', 'customers', user?.id, term], queryFn: () => api.adminCustomers(term) });
  const erase = useMutation({
    mutationFn: (id: number) => api.deleteCustomer(id),
    onSuccess: async () => { setDone('Customer account deleted.'); await qc.invalidateQueries({ queryKey: ['admin', 'customers'] }); },
    onError: () => setDone(''),
  });
  async function remove(id: number, name: string) {
    const ok = await confirm({
      title: 'Delete this customer account?', confirmLabel: 'Delete', danger: true,
      message: <>{name}’s personal details and prescription photos will be deleted and they will be signed out. Their orders stay in the reports without personal details. The email can be used again. This cannot be undone. Customers with active orders cannot be deleted.</>,
    });
    if (ok) { setDone(''); erase.mutate(id); }
  }
  return <>
    <PageTitle title="Customer accounts" subtitle="Find a customer and delete their account when they ask for it." />
    <section className="card">
      <form className="inline-form" onSubmit={(event) => { event.preventDefault(); setDone(''); setTerm(search.trim()); }}>
        <label>Search by name or email<input value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} /></label>
        <button type="submit">Search</button>
      </form>
      <FormFeedback error={erase.error} success={done} />
      {customers.isLoading ? <LoadingState label="Loading customers…" /> : customers.error ? <ErrorState error={customers.error} retry={() => void customers.refetch()} /> :
        <DataTable label="Customer accounts" headers={['Name', 'Email', 'Joined', 'Action']}
          rows={(customers.data || []).map((item) => [item.id, item.name, item.email, displayDate(item.createdAt), <button key={item.id} type="button" className="danger" disabled={erase.isPending} onClick={() => void remove(item.id, item.name)}>Delete account</button>])} />}
    </section>
    {confirmDialog}
  </>;
}
