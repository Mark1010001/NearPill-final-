import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useSession } from '../../auth/session';
import { useConfirm } from '../../components/ConfirmDialog';
import { DataTable, Status, displayDate } from '../../components/DataTable';
import { ErrorState, FormFeedback, LoadingState, currency } from '../../components/States';

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
  const [createdId, setCreatedId] = useState(0);
  const [justAdded, setJustAdded] = useState<{ drugstoreId: number; userId: number; email: string } | null>(null);
  const [accountEmail, setAccountEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
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
        const created = await api.createPharmacy({ name: form.name.trim(), address: form.address.trim(), latitude: Number(form.latitude), longitude: Number(form.longitude), status: 'active' }) as { id?: number; store_id?: number };
        id = Number(created.store_id ?? created.id);
        setCreatedId(id);
      }
      const account = await api.createPartnerAccount(id, { email: accountEmail.trim(), password: accountPassword });
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
      setForm({ name: '', address: '', latitude: '', longitude: '' }); setCreatedId(0); setAccountEmail(''); setAccountPassword('');
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
  const remove = useMutation({
    mutationFn: (id: number) => api.deactivateMembership(selected, id),
    onSuccess: async () => { setDone('Access removed.'); await refresh(); },
    onError: () => setDone(''),
  });
  async function deactivate(id: number, name: string) {
    const ok = await confirm({
      title: 'Remove pharmacy access?', confirmLabel: 'Remove access', danger: true,
      message: <>{name} will no longer be able to open this pharmacy’s orders or inventory. Their NearPill account stays. You can add them again later.</>,
    });
    if (ok) remove.mutate(id);
  }
  if (pharmacies.isLoading) return <LoadingState label="Loading pharmacies…" />;
  if (pharmacies.error) return <ErrorState error={pharmacies.error} retry={() => void pharmacies.refetch()} />;
  const stores = (pharmacies.data || []).filter((store) => store.status !== 'inactive');
  const rows = members.data || [];
  return <>
    <PageTitle title="Partner pharmacy accounts" subtitle="Each partner pharmacy's account number and when its partnership with NearPill expires. Choose who can work for each pharmacy below. Each person needs an existing pharmacy partner account." />
    <section className="card"><h2>Partnership expiry</h2>
      <p className="muted">Counted from the day the pharmacy joined NearPill: Basic 3 months, Plus 6 months, Pro 1 year.</p>
      <DataTable label="Partnership expiry" headers={['Account No.', 'Pharmacy', 'Plan', 'Partner since', 'Expires', 'Partnership']}
        sortKeys={stores.map((store) => [store.accountNo ?? 0, store.name, store.subscriptionTier ?? '', store.partnershipStartedAt ?? '', store.partnershipExpiresAt ?? '', partnershipState(store.partnershipExpiresAt).label])}
        rows={stores.map((store) => [String(store.store_id ?? store.id), store.accountNo ?? '—', store.name, store.subscriptionTier ?? 'No plan',
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
          <label>Email<input type="email" required autoComplete="off" maxLength={254} value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} /></label>
          <label>Password<input type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} /></label>
          <p className="muted">At least 10 characters with a letter and a number. The pharmacy signs in to the partner portal with this email and password, and can change the password there.</p>
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
            rows={rows.map((item) => [item.userId, <>{item.name}<small>Account ID {stores.find((store) => Number(store.store_id ?? store.id) === selected)?.accountNo ?? '—'}</small></>, item.email,
              roleLabels[item.membershipRole] ?? item.membershipRole, <Status value={item.isActive ? 'active' : 'inactive'} label={item.isActive ? 'Active' : 'Removed'} />,
              item.isActive ? <div className="stack-actions"><button type="button" className="secondary" disabled={mail.isPending} onClick={() => mail.mutate({ id: selected, userId: item.userId })}>Email login details</button><button type="button" className="secondary" disabled={remove.isPending} onClick={() => void deactivate(item.userId, item.name)}>Remove access</button></div> : '—'])}
            empty="No staff accounts for this pharmacy yet." />)}
        {remove.error && <FormFeedback error={remove.error} />}
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
        <p className="section-hint">Account No. {item.accountNo ?? '—'} · {item.source === 'csv' ? (item.fileName || 'CSV file') : 'Single medicine'} · {item.rowCount} {item.rowCount === 1 ? 'row' : 'rows'} · sent {showDateTime(item.createdAt)}</p>
      </div><Status value={item.status} /></div>
      <DataTable label={`Rows of submission ${item.id}`} headers={['Catalog ID', 'Medicine', 'Generic', 'Form', 'Category', 'Unit', 'Price', 'Stock', 'Result']} pageSize={10}
        rows={(item.rows ?? []).map((row) => [row.line, row.catalogId ?? 'New', row.name, row.genericName ?? '—', row.form, row.category, row.sellingUnit, currency.format(Number(row.price)), row.stock,
          row.match === 'existing' ? 'Updated catalog item' : (row.note ?? 'Added new medicine')])} />
    </section>)}</>;
}
