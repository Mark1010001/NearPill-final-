import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import type { StockSubmission } from '../../api/types';
import { DataTable, Status, displayDate } from '../../components/DataTable';
import { ErrorState, FormFeedback, LoadingState } from '../../components/States';

export const STOCK_HEADERS = ['pharmacy', 'catalog_id', 'brand', 'generic_name', 'strength', 'form', 'category', 'selling_unit', 'price', 'stock_quantity'] as const;
const MAX_FILE_BYTES = 300 * 1024;
const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

function downloadTemplate(pharmacyName: string) {
  const example = [pharmacyName, '', 'Biogesic 500 mg', 'Paracetamol', '', 'Tablet', 'Non-prescription', 'Tablet', '3.50', '120'];
  const text = `${STOCK_HEADERS.join(',')}\r\n${example.map(csvCell).join(',')}\r\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'nearpill-stock-template.csv'; link.click();
  URL.revokeObjectURL(url);
}

function RowErrors({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) return error instanceof Error ? <FormFeedback error={error} /> : null;
  const rows = Array.isArray(error.details) ? error.details as { line: number; message: string }[] : [];
  return <div role="alert" className="form-error"><p>{error.message}</p>
    {rows.length > 0 && <ul>{rows.map((row, index) => <li key={index}>{row.line > 0 ? `Line ${row.line}: ` : ''}{row.message}</li>)}</ul>}
  </div>;
}

const empty = { catalog_id: '', brand: '', generic_name: '', strength: '', form: '', category: '', selling_unit: '', price: '', stock_quantity: '' };

export function StockSubmitCard({ drugstoreId }: { drugstoreId: number }) {
  const qc = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useQuery({ queryKey: ['partner', 'stock-submissions', drugstoreId], queryFn: () => api.partnerStockSubmissions(drugstoreId) });
  const catalog = useQuery({ queryKey: ['partner', 'intake', drugstoreId], queryFn: () => api.partnerIntakeProducts(drugstoreId), retry: false });
  const [form, setForm] = useState(empty);
  const [fileError, setFileError] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['partner', 'stock-submissions', drugstoreId] });
  const send = useMutation({ mutationFn: api.submitStock, onSuccess: refresh });
  const pharmacyName = list.data?.pharmacyName ?? '';
  const set = (key: keyof typeof empty) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });

  async function upload(file: File | undefined) {
    setFileError(''); send.reset();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { setFileError('That file is too large. Upload at most 300 KB (about 500 rows).'); return; }
    send.mutate({ drugstoreId, fileName: file.name, csv: await file.text() });
    if (fileInput.current) fileInput.current.value = '';
  }

  const rows = list.data?.submissions ?? [];
  return <section className="card" aria-busy={send.isPending}>
    <h2>Add stock for admin review</h2>
    <p className="notice">New stock is not sold until an admin approves it. Upload a CSV that follows the template, or add one medicine below. Both use the same columns.</p>
    {list.isLoading && <LoadingState label="Loading…" />}
    {list.error && <ErrorState error={list.error} retry={() => void list.refetch()} />}
    {list.data && <>
      <div className="stack-actions">
        <button type="button" className="secondary" disabled={!pharmacyName} onClick={() => downloadTemplate(pharmacyName)}>Download CSV template</button>
        <label>Upload filled template (.csv)<input ref={fileInput} type="file" accept=".csv,text/csv" disabled={send.isPending} onChange={(event) => void upload(event.target.files?.[0])} /></label>
      </div>
      <p><small>Columns: {STOCK_HEADERS.join(', ')}. Leave catalog_id blank for a medicine that is not in the catalog yet.</small></p>
      {fileError && <p className="form-error" role="alert">{fileError}</p>}

      <form className="add-medicine" onSubmit={(event) => {
        event.preventDefault();
        if (send.isPending) return;
        send.mutate({ drugstoreId, row: { pharmacy: pharmacyName, ...form } }, { onSuccess: () => setForm(empty) });
      }}>
        <h3>Add one medicine</h3>
        <fieldset disabled={send.isPending} className="inline-form">
          <label>Fill from catalog (optional)
            <select value="" onChange={(event) => {
              const found = catalog.data?.find((item) => String(item.id) === event.target.value);
              if (found) setForm({ ...form, catalog_id: String(found.id), brand: found.brandName, generic_name: found.genericName ?? '', strength: '', form: found.dosageForm ?? '', category: found.category ?? '' });
            }}>
              <option value="">Choose a medicine</option>
              {(catalog.data ?? []).filter((item) => !item.alreadyStocked).map((item) => <option key={item.id} value={item.id}>{item.brandName} · Catalog #{item.id}</option>)}
            </select>
          </label>
          <label>Pharmacy<input readOnly value={pharmacyName} /></label>
          <label>Catalog ID (blank if new)<input inputMode="numeric" maxLength={9} value={form.catalog_id} onChange={set('catalog_id')} /></label>
          <label>Brand<input required maxLength={100} placeholder="Biogesic" value={form.brand} onChange={set('brand')} /></label>
          <label>Generic name<input maxLength={100} placeholder="Paracetamol" value={form.generic_name} onChange={set('generic_name')} /></label>
          <label>Strength<input maxLength={40} placeholder="500 mg" value={form.strength} onChange={set('strength')} /></label>
          <label>Form<input required maxLength={50} placeholder="Tablet" value={form.form} onChange={set('form')} /></label>
          <label>Category
            <select required value={form.category} onChange={set('category')}>
              <option value="">Choose a category</option>
              <option value="Non-prescription">Non-prescription</option>
              <option value="Prescription">Prescription</option>
              <option value="Non-medicine">Non-medicine</option>
            </select>
          </label>
          <label>Selling unit<input required maxLength={48} placeholder="Tablet or Box of 10" value={form.selling_unit} onChange={set('selling_unit')} /></label>
          <label>Price per unit (₱)<input required inputMode="decimal" maxLength={13} placeholder="3.50" value={form.price} onChange={set('price')} /></label>
          <label>Stock quantity<input required inputMode="numeric" maxLength={10} placeholder="120" value={form.stock_quantity} onChange={set('stock_quantity')} /></label>
          <button className="primary">{send.isPending ? 'Sending…' : 'Send for review'}</button>
        </fieldset>
      </form>
      <RowErrors error={send.error} />
      <FormFeedback success={send.isSuccess ? `Sent for admin review (${send.data.rowCount} ${send.data.rowCount === 1 ? 'row' : 'rows'}). It will not be sold until it is approved.` : undefined} />

      <h3>Your submissions</h3>
      <DataTable label="Stock submissions" headers={['Sent', 'Type', 'Rows', 'Status', 'Admin note']} empty="Nothing sent yet."
        rows={rows.map((item: StockSubmission) => [item.id, displayDate(item.createdAt), item.source === 'csv' ? (item.fileName || 'CSV file') : 'Single medicine', item.rowCount, <Status key={item.id} value={item.status} />, item.reviewNote ?? ''])} />
    </>}
  </section>;
}
