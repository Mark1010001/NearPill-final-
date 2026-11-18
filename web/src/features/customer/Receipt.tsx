import type { Order, SessionUser } from '../../api/types';
import { pesos } from '../../components/States';
import { pickupText } from './pickup';
import { downloadReceipt } from './receiptPdf';

/** A paid order the customer can show the pharmacy staff at pickup. Mirrors the Android app's receipt. */
const RECEIPT_STATUSES = ['confirmed', 'preparing', 'ready_for_pickup', 'completed'];
export const hasReceipt = (order: Order) => order.items.length > 0 && RECEIPT_STATUSES.includes((order.status ?? '').toLowerCase());

const money = (centavos?: number) => (Number.isFinite(centavos) ? pesos(centavos) : '₱0.00');

export function OrderReceipt({ order, user, balanceDue = 0, checkingPayment = false }: { order: Order; user: SessionUser; balanceDue?: number; checkingPayment?: boolean }) {
  const placed = order.placedOn || (order.createdAt ? new Date(order.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  return <section className="card receipt" aria-labelledby="receipt-title">
    <h2 id="receipt-title">Pickup receipt</h2>
    <p className="shop-muted">Show this to the pharmacy staff when you pick up your order.</p>
    <div className="receipt-claim"><span>PICKUP CLAIM CODE</span>
      <p className="receipt-reference" aria-label="Order reference">{order.reference}</p></div>
    {order.items.some((item) => item.prescriptionRequired) && <p className="receipt-rx" role="note">
      <strong>Physical prescription check required.</strong> Bring the prescription you uploaded when you claim your order.</p>}
    <dl className="receipt-facts">
      <div><dt>Pharmacy</dt><dd>{order.storeName}</dd></div>
      <div><dt>Customer</dt><dd>{user.fullName || user.name || user.email}</dd></div>
      {user.phone && <div><dt>Phone</dt><dd>{user.phone}</dd></div>}
      {placed && <div><dt>Ordered on</dt><dd>{placed}</dd></div>}
      <div><dt>Pickup date & time</dt><dd>{pickupText(order.pickupDate, order.pickupWindow) || 'No pickup date'}</dd></div>
      <div><dt>Payment</dt><dd>{checkingPayment ? 'Checking…' : balanceDue > 0 ? 'Deposit paid' : 'Paid in full'}</dd></div>
      {!checkingPayment && balanceDue > 0 && <div><dt>Paid online</dt><dd>{money(Math.max(0, (order.totalCentavos ?? 0) - balanceDue))}</dd></div>}
      {!checkingPayment && balanceDue > 0 && <div className="receipt-balance"><dt>Balance due at pickup</dt><dd>{money(balanceDue)}</dd></div>}
      {!checkingPayment && balanceDue <= 0 && <div><dt>Pay at pickup</dt><dd>{money(0)} (nothing to pay)</dd></div>}
    </dl>
    <span className="eyebrow receipt-eyebrow" aria-hidden="true">ITEM SUMMARY</span>
    <table className="receipt-items">
      <caption className="sr-only">Items on this order</caption>
      <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Amount</th></tr></thead>
      <tbody>{order.items.map((item, index) => <tr key={`${item.id ?? index}-${index}`}>
        <td>{item.name ?? 'Medicine'}{item.sellingUnit ? ` (${item.sellingUnit})` : ''}<small className="receipt-each">{money(item.priceCentavos)} each</small></td>
        <td>{item.quantity}</td>
        <td>{money((item.priceCentavos ?? 0) * (Number(item.quantity) || 0))}</td>
      </tr>)}</tbody>
      <tfoot><tr><th scope="row" colSpan={2}>Total</th><td>{money(order.totalCentavos)}</td></tr></tfoot>
    </table>
    <button type="button" className="secondary receipt-download" disabled={checkingPayment} onClick={() => downloadReceipt(order, user, balanceDue)}>Download receipt (PDF)</button>
  </section>;
}
