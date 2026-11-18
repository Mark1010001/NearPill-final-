import { type Key, type PropsWithChildren, type ReactNode, useMemo, useState } from 'react';
import type { SalesRow } from '../api/types';
import { currency, EmptyState } from './States';

export function TableRegion({ label, children }: PropsWithChildren<{ label: string }>) {
  return <>
    <p className="table-hint notice">Scroll sideways if some columns are out of view.</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>{children}</div>
  </>;
}

type SortKey = string | number | null | undefined;

const csvCell = (value: string) => `"${value.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;

/**
 * Table with optional client-side sorting, pagination, column visibility and row selection.
 * - `sortKeys[row][column]`: value to sort by; a column whose key is undefined in the first row is not sortable.
 * - `exportCsv`: enables row checkboxes plus "Download CSV" for the selected rows. `rows[row]` holds
 *   plain-text values for every header (the Actions column is left out of the file).
 * - `columnMenu`: lets people hide columns (the first and any "Action(s)" column always stay).
 */
export function DataTable({ label, headers, rows, empty = 'No records found.', sortKeys, pageSize = 25, exportCsv, columnMenu }: {
  label: string;
  headers: string[];
  rows: [Key, ...ReactNode[]][];
  empty?: string;
  sortKeys?: SortKey[][];
  pageSize?: number;
  exportCsv?: { filename: string; rows: string[][] };
  columnMenu?: boolean;
}) {
  const [sort, setSort] = useState<{ column: number; direction: 'ascending' | 'descending' } | null>(null);
  const [page, setPage] = useState(0);
  const [hiddenColumns, setHiddenColumns] = useState<number[]>([]);
  const [selected, setSelected] = useState<Key[]>([]);
  const order = useMemo(() => {
    const indexes = rows.map((_, index) => index);
    if (!sort || !sortKeys) return indexes;
    const factor = sort.direction === 'ascending' ? 1 : -1;
    return indexes.sort((a, b) => {
      const left = sortKeys[a]?.[sort.column]; const right = sortKeys[b]?.[sort.column];
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor;
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: 'base' }) * factor;
    });
  }, [rows, sort, sortKeys]);
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = order.slice(current * pageSize, (current + 1) * pageSize);
  const sortable = (column: number) => sortKeys?.[0]?.[column] !== undefined;
  const isActions = (column: number) => /^actions?$/i.test(headers[column]);
  const shown = headers.map((_, column) => column).filter((column) => !hiddenColumns.includes(column));
  const liveSelected = selected.filter((id) => rows.some(([key]) => key === id));
  const allVisibleSelected = visible.length > 0 && visible.every((index) => liveSelected.includes(rows[index][0]));
  function download() {
    if (!exportCsv) return;
    const columns = headers.map((_, column) => column).filter((column) => !isActions(column));
    const lines = [columns.map((column) => csvCell(headers[column])).join(',')];
    rows.forEach(([key], index) => { if (liveSelected.includes(key)) lines.push(columns.map((column) => csvCell(exportCsv.rows[index]?.[column] ?? '')).join(',')); });
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = exportCsv.filename; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    {(columnMenu || exportCsv) && <div className="table-tools">
      {columnMenu && <details className="column-menu"><summary>Columns</summary>
        <fieldset><legend className="sr-only">Visible columns</legend>
          {headers.map((heading, column) => column === 0 || isActions(column) ? null : <label key={heading}>
            <input type="checkbox" checked={!hiddenColumns.includes(column)}
              onChange={(event) => setHiddenColumns(event.target.checked ? hiddenColumns.filter((value) => value !== column) : [...hiddenColumns, column])} />{heading}
          </label>)}
        </fieldset></details>}
      {exportCsv && <div className="bulk-bar" role="group" aria-label="Selected rows">
        <span role="status">{liveSelected.length} selected</span>
        <button type="button" className="secondary" disabled={!liveSelected.length} onClick={download}>Download CSV</button>
        <button type="button" className="link-button" disabled={!liveSelected.length} onClick={() => setSelected([])}>Clear selection</button>
      </div>}
    </div>}
    <TableRegion label={label}>
      <table>
        <thead><tr>
          {exportCsv && <th scope="col" className="select-cell"><input type="checkbox" aria-label={`Select all rows on this page of ${label}`} checked={allVisibleSelected}
            onChange={(event) => {
              const ids = visible.map((index) => rows[index][0]);
              setSelected(event.target.checked ? [...new Set([...liveSelected, ...ids])] : liveSelected.filter((id) => !ids.includes(id)));
            }} /></th>}
          {shown.map((column) => <th scope="col" key={headers[column]}
          aria-sort={sort?.column === column ? sort.direction : undefined}>
          {sortable(column)
            ? <button type="button" className="sort-button" onClick={() => {
              setPage(0);
              setSort(sort?.column === column && sort.direction === 'ascending' ? { column, direction: 'descending' } : { column, direction: 'ascending' });
            }}>{headers[column]}<span aria-hidden="true" className="sort-arrow">{sort?.column === column ? (sort.direction === 'ascending' ? '▲' : '▼') : '↕'}</span></button>
            : headers[column]}
        </th>)}</tr></thead>
        <tbody>{visible.map((index) => { const [id, ...cells] = rows[index]; return <tr key={id} data-selected={liveSelected.includes(id)}>
          {exportCsv && <td className="select-cell"><input type="checkbox" aria-label={`Select ${exportCsv.rows[index]?.[0] || `row ${index + 1}`}`} checked={liveSelected.includes(id)}
            onChange={(event) => setSelected(event.target.checked ? [...liveSelected, id] : liveSelected.filter((value) => value !== id))} /></td>}
          {shown.map((column) => column === 0
            ? <th scope="row" className="record-title" key={headers[0]}>{cells[0]}</th>
            : <td key={headers[column]}>{cells[column]}</td>)}
        </tr>; })}</tbody>
      </table>
    </TableRegion>
    {pages > 1 && <nav className="pager" aria-label={`${label} pages`}>
      <span role="status">Showing {current * pageSize + 1}–{Math.min(rows.length, (current + 1) * pageSize)} of {rows.length}</span>
      <button type="button" className="secondary" disabled={current === 0} onClick={() => setPage(current - 1)}>Previous</button>
      <button type="button" className="secondary" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next</button>
    </nav>}
  </>;
}

export function Status({ value, label }: { value: string; label?: string }) {
  return <span className={`status status-${value.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`}>{label ?? value.replace(/_/g, ' ')}</span>;
}

export function SalesTable({ rows, amountLabel }: { rows: SalesRow[]; amountLabel: string }) {
  return <DataTable label="Sales report" headers={['Date', 'Orders', amountLabel]}
    rows={rows.map((row) => [row.reportDate, displayDate(row.reportDate), row.orderCount, currency.format(row.revenue)])}
    empty="No orders to report." />;
}

export function SalesDateFilter({ onApply }: { onApply: (start: string, end: string) => void }) {
  return <form className="inline-form" onSubmit={(event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onApply(String(form.get('start') || ''), String(form.get('end') || ''));
  }}>
    <label>From<input name="start" type="date" /></label>
    <label>Through<input name="end" type="date" /></label>
    <button className="secondary">Apply dates</button>
  </form>;
}

const dates = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' });

export function displayDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dates.format(date);
}
