import type { Order, SessionUser } from '../../api/types';
import { pickupText } from './pickup';

/**
 * Builds the downloadable receipt as a small text PDF in the browser (no library, nothing stored on the server).
 * The Android app builds the same receipt (lib/features/orders/receipt_pdf.dart). The standard PDF fonts cannot
 * draw the peso sign, so amounts read "PHP 130.00" in the PDF.
 */
type Line = { text: string; size?: number; bold?: boolean; x?: number; gap?: number };

const php = (centavos?: number) => `PHP ${((Number.isFinite(centavos) ? Number(centavos) : 0) / 100).toFixed(2)}`;
const latin1 = (text: string) => text.replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const escapePdf = (text: string) => latin1(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

function wrap(text: string, max: number) {
  const words = latin1(text).split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > max) { if (current) lines.push(current); current = word; } else current = (current + ' ' + word).trim();
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

export type ReceiptFacts = { order: Order; customer: string; phone?: string; balanceDue: number };

export function receiptLines({ order, customer, phone, balanceDue }: ReceiptFacts): Line[] {
  const placed = order.placedOn || (order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const pickup = pickupText(order.pickupDate, order.pickupWindow);
  const total = Number(order.totalCentavos) || 0;
  const out: Line[] = [
    { text: 'NearPill', size: 22, bold: true, gap: 8 },
    { text: 'Pickup receipt', size: 14, gap: 14 },
    { text: 'PICKUP CLAIM CODE', size: 9, gap: 2 },
    { text: order.reference ?? `Order #${order.id}`, size: 18, bold: true, gap: 12 },
  ];
  const fact = (label: string, value: string) => {
    if (!value) return;
    wrap(value, 62).forEach((part, i) => out.push({ text: i === 0 ? label : '', x: 50, size: 10, bold: true }, { text: part, x: 190, size: 10, gap: 4 }));
  };
  fact('Pharmacy', order.storeName ?? '');
  fact('Customer', customer);
  fact('Phone', phone ?? '');
  fact('Ordered on', placed);
  fact('Pickup date & time', pickup || 'No pickup date');
  fact('Payment', balanceDue > 0 ? 'Deposit paid' : 'Paid in full');
  if (balanceDue > 0) { fact('Paid online', php(Math.max(0, total - balanceDue))); fact('Balance due at pickup', php(balanceDue)); }
  else fact('Pay at pickup', `${php(0)} (nothing to pay)`);
  out.push({ text: '', gap: 8 });
  out.push({ text: 'Item', size: 10, bold: true, x: 50 }, { text: 'Price', size: 10, bold: true, x: 330 }, { text: 'Qty', size: 10, bold: true, x: 410 }, { text: 'Amount', size: 10, bold: true, x: 465, gap: 4 });
  for (const item of order.items) {
    const qty = Number(item.quantity) || 0;
    const name = `${item.name ?? 'Medicine'}${item.sellingUnit ? ` (${item.sellingUnit})` : ''}`;
    const parts = wrap(name, 44);
    parts.forEach((part, i) => {
      if (i === 0) out.push({ text: part, size: 10, x: 50 }, { text: php(item.priceCentavos), size: 10, x: 330 }, { text: String(qty), size: 10, x: 410 },
        { text: php((item.priceCentavos ?? 0) * qty), size: 10, x: 465, gap: 2 });
      else out.push({ text: part, size: 10, x: 50, gap: 2 });
    });
  }
  out.push({ text: '', gap: 4 }, { text: 'Total', size: 12, bold: true, x: 50 }, { text: php(total), size: 12, bold: true, x: 465, gap: 12 });
  if (order.items.some((item) => item.prescriptionRequired)) {
    out.push({ text: 'Physical prescription check required. Bring the prescription you uploaded.', size: 10, bold: true, gap: 12 });
  }
  out.push({ text: 'Show this receipt and a valid ID to the pharmacy staff when you pick up your order.', size: 9, gap: 4 },
    { text: 'Capstone test payment, no real money was charged.', size: 9 });
  return out;
}

/** Lines share a row until one with a `gap` ends it. */
export function buildReceiptPdf(facts: ReceiptFacts): Uint8Array {
  const lines = receiptLines(facts);
  const ops: string[] = [];
  let rowY = 790;
  for (const line of lines) {
    const size = line.size ?? 10;
    if (line.text) ops.push(`BT /${line.bold ? 'F2' : 'F1'} ${size} Tf ${line.x ?? 50} ${rowY} Td (${escapePdf(line.text)}) Tj ET`);
    if (line.gap !== undefined) { rowY -= size + 4 + line.gap; }
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i += 1) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

export function receiptFileName(order: Order) {
  return `NearPill-receipt-${(order.reference ?? String(order.id)).replace(/[^A-Za-z0-9._-]/g, '')}.pdf`;
}

export function downloadReceipt(order: Order, user: SessionUser, balanceDue: number) {
  const bytes = buildReceiptPdf({ order, customer: user.fullName || user.name || user.email || '', phone: user.phone ?? '', balanceDue });
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url; link.download = receiptFileName(order);
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
