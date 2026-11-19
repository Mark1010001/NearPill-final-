import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../../api/client';
import type { CheckoutItem, SessionUser } from '../../api/types';
import { EmptyState, ErrorState, FormFeedback, LoadingState, pesos } from '../../components/States';
import { useToast } from './toast';
import { ContactSheet } from './ProfilePage';
import { paymentNotice } from './copy';
import { type PreparedPhoto, preparePrescriptionPhoto } from './prescriptionPhoto';
import { type CartLine, type CheckoutAttempt, isSelected, cartCategory, cartTotal, listingIssue, listingKey, listingPath, nonnegativeInteger, positiveId,
  quantityLimit, reviewCart, saveCheckoutAttempt, storedCheckoutAttempt } from './cart';
import { anyTimeAvailable, chipLabel, dayAvailable, firstPickupDay, pickupDays, pickupText, shortDate, type PickupWindowId, pickupWindows, windowAvailable, windowForDay } from './pickup';
import { MaterialIcon } from './MaterialIcon';

function EmptyCart() {
  return <EmptyState>
    <strong>Your cart is empty</strong>
    <p>Browse products from local pharmacies to get started.</p>
    <Link className="shop-text-link" to="/app/search">Browse products</Link>
  </EmptyState>;
}

function PrescriptionUpload({ accountId, drugstoreId, medicineId, pharmacyName = 'the pharmacy' }: { accountId: string; drugstoreId: number; medicineId: number; pharmacyName?: string }) {
  const status = useQuery({ queryKey: ['prescription-review', accountId, drugstoreId, medicineId],
    queryFn: ({ signal }) => api.prescriptionStatus(accountId, drugstoreId, medicineId, signal), retry: false });
  const [prepared, setPrepared] = useState<PreparedPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pickError, setPickError] = useState<Error | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => { if (prepared) URL.revokeObjectURL(prepared.previewUrl); }, [prepared]);
  const upload = useMutation({ mutationFn: async (photo: PreparedPhoto) =>
    api.submitPrescription(accountId, drugstoreId, medicineId, photo.mimeType, photo.photo),
  onSuccess: () => setPrepared(null),
  onSettled: () => { void status.refetch(); feedbackRef.current?.focus(); }, gcTime: 0 });
  async function choose(file: File | undefined) {
    setPickError(null); setPrepared(null); upload.reset();
    if (!file) return;
    setPreparing(true);
    try { setPrepared(await preparePrescriptionPhoto(file)); }
    catch (error) { setPickError(error instanceof Error ? error : new Error('Could not use that photo.')); if (inputRef.current) inputRef.current.value = ''; }
    finally { setPreparing(false); }
  }
  if (status.error instanceof ApiError && status.error.status === 404) return null;
  if (status.isError) return <button type="button" className="secondary" onClick={() => void status.refetch()}>Retry prescription status</button>;
  if (status.isPending) return <small role="status">Checking prescription status…</small>;
  const review = status.data.review?.status;
  const state = review === 'pending' || review === 'approved' || review === 'rejected' ? review : 'none';
  const steps = <ol className="rx-steps" aria-label="Prescription progress">
    <li className={state === 'rejected' ? 'rx-step-bad' : state === 'none' ? 'rx-step-now' : 'rx-step-done'}><i aria-hidden="true">{state === 'pending' || state === 'approved' ? <MaterialIcon name="check" size={12} /> : state === 'rejected' ? '!' : '1'}</i>{state === 'rejected' ? 'Re-upload' : state === 'none' ? 'Upload' : 'Uploaded'}</li>
    <li className={state === 'approved' ? 'rx-step-done' : state === 'pending' ? 'rx-step-now' : ''}><i aria-hidden="true">{state === 'approved' ? <MaterialIcon name="check" size={12} /> : '2'}</i>{state === 'approved' ? 'Approved' : state === 'pending' ? 'Reviewing' : 'Review'}</li>
    <li className={state === 'approved' ? 'rx-step-now' : ''}><i aria-hidden="true">3</i>{state === 'approved' ? 'Ready to order' : 'Order'}</li>
  </ol>;
  const rxTitle = review === 'approved' ? `Approved by ${pharmacyName}`
    : review === 'pending' ? 'Waiting for the pharmacy to review your prescription.'
    : review === 'rejected' ? 'Pharmacy rejected your prescription'
    : review === 'expired' ? 'Your prescription review expired' : 'Prescription not yet uploaded';
  const reason = status.data.review?.rejectionReason;
  const rxDetail = review === 'approved' ? 'Prescription approved. You can place your order. Bring this prescription when you pick it up.'
    : review === 'pending' ? 'The pharmacist is verifying your prescription details.'
    : review === 'rejected' ? (reason ? null : 'Please upload another one.')
    : review === 'expired' ? 'Please upload your prescription again.'
    : `Upload your prescription so ${pharmacyName} can approve it before you place the order.`;
  const rxIcon = review === 'approved' ? 'checkCircle' : review === 'pending' ? 'hourglassTop' : review === 'rejected' ? 'cancel' : 'warningAmberRounded';
  const statusBox = <>
    {steps}
    <p className="rx-status" role="status"><MaterialIcon name={rxIcon} size={22} /><strong>{rxTitle}</strong></p>
    {review === 'rejected' && reason && <div className="rx-note"><span className="eyebrow">PHARMACIST NOTE</span><p>{reason}. Please upload another one.</p></div>}
    {rxDetail && <p className="rx-detail">{rxDetail}</p>}
  </>;
  if (review === 'pending' || review === 'approved') return <div className={`rx-block rx-${state}`}>
    {statusBox}
    {review === 'pending' && <button type="button" className="secondary" onClick={() => void status.refetch()}>Check review status</button>}
  </div>;
  const error = pickError ?? (upload.error instanceof ApiError && upload.error.status === 413
    ? new Error('The photo is still too large for the server. Choose a smaller photo.') : upload.error);
  return <form className={`mini-form rx-block rx-${state}`} onSubmit={(event) => {
    event.preventDefault();
    if (upload.isPending || preparing || !prepared) return;
    upload.mutate(prepared);
  }}>
    {statusBox}
    <p className="rx-help"><strong>Send your prescription</strong><br />Choose a clear photo of your prescription (JPG or PNG). Large photos are resized automatically. The selected pharmacy can view it for up to 24 hours and will approve or reject it. Bring this same prescription when you pick up your order.</p>
    <label>Prescription photo (JPG or PNG)
      <input ref={inputRef} type="file" name="photo" accept="image/jpeg,image/png" disabled={upload.isPending || preparing}
        onChange={(event) => void choose(event.currentTarget.files?.[0])} />
    </label>
    {preparing && <small role="status">Preparing photo…</small>}
    {prepared && <figure className="rx-preview">
      <img src={prepared.previewUrl} alt="Preview of the selected prescription photo" />
      <figcaption>{prepared.width}×{prepared.height} px, {(prepared.bytes / 1024).toFixed(0)} KB.{' '}
        <button type="button" className="shop-text-link" disabled={upload.isPending}
          onClick={() => { setPrepared(null); if (inputRef.current) inputRef.current.value = ''; }}>Remove</button></figcaption>
    </figure>}
    <button className={`primary${review === 'rejected' ? ' danger-fill' : ''}`} disabled={upload.isPending || preparing || !prepared}><MaterialIcon name="photoCameraOutlined" size={18} /> {upload.isPending ? 'Sending…' : review === 'rejected' ? 'Upload another prescription' : 'Upload prescription'}</button>
    <div ref={feedbackRef} tabIndex={-1}><FormFeedback error={error} /></div>
  </form>;
}

export function CartPage({ accountId, cart, changeQuantity, setSelected, setPharmacySelected, remove, testCheckout, continueGrouped, onGroupedReview }: {
  accountId: string;
  cart: CartLine[];
  testCheckout?: boolean;
  continueGrouped: boolean;
  onGroupedReview: () => void;
  changeQuantity: (key: string, delta: number) => void;
  setSelected: (key: string, value: boolean) => void;
  setPharmacySelected: (storeId: number | undefined, value: boolean) => void;
  remove: (key: string) => void;
}) {
  const picked = cart.filter(isSelected);
  const stores = [...new Set(cart.map((line) => positiveId(line.listing.drugstoreId)))];
  const mixed = new Set(picked.map((line) => positiveId(line.listing.drugstoreId))).size > 1;
  const groups = stores.map((id) => {
    const lines = cart.filter((line) => positiveId(line.listing.drugstoreId) === id);
    const chosen = lines.filter(isSelected);
    return { id, lines, name: lines[0].listing.drugstoreName, subtotal: cartTotal(chosen), allChosen: chosen.length === lines.length, picked: chosen.length };
  });
  const total = cartTotal(picked);
  const [groupSheet, setGroupSheet] = useState(false);
  const { show, toast } = useToast();
  const rxLines = cart.filter((line) => cartCategory(line.listing.category) === 'Prescription' && positiveId(line.listing.id) && positiveId(line.listing.drugstoreId));
  const rxStates = useQueries({ queries: rxLines.map((line) => ({
    queryKey: ['prescription-review', accountId, positiveId(line.listing.drugstoreId), positiveId(line.listing.id)],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.prescriptionStatus(accountId, positiveId(line.listing.drugstoreId)!, positiveId(line.listing.id)!, signal),
    retry: false,
  })) });
  const rxLabel = (() => {
    let label: string | null = null;
    rxStates.forEach((query, index) => {
      if (!isSelected(rxLines[index])) return;
      const state = query.data?.review?.status;
      if (state === 'approved') return;
      const next = query.isPending ? 'Checking prescription…' : state === 'pending' ? 'Waiting for pharmacy approval' : state === 'rejected' ? 'Fix prescription to continue' : 'Upload prescription to continue';
      if (label === null || next === 'Fix prescription to continue') label = next;
    });
    return label;
  })();
  return <>
    {toast}
    {cart.length > 0 && <p>Review pickup to check stock, prices, and GCash availability.</p>}
    {cart.length === 0 ? <EmptyCart /> : <div className="shop-columns">
      <section className="card shop-panel" aria-label="Cart items">
        {groups.map(({ id, name, lines, subtotal, allChosen }) => <section key={id ?? name} className="shop-cart-group">
        <div className="shop-group-header"><label className="shop-select"><input type="checkbox" checked={allChosen} aria-label={`Select all items from ${name}`}
          onChange={(event) => setPharmacySelected(id, event.target.checked)} /><h3>{name}</h3></label><span className="shop-muted">{subtotal === null ? 'Price unavailable' : `Selected subtotal ${pesos(subtotal)}`}</span></div>
        <ul className="shop-lines">
          {lines.map((line) => {
            const { listing, quantity } = line;
            const key = listingKey(listing);
            const price = nonnegativeInteger(listing.priceCentavos);
            const itemLabel = `${listing.name} at ${listing.drugstoreName}`;
            const issue = listingIssue(listing);
            const lineTotal = cartTotal([line]);
            const atMinimum = quantity <= 1;
            const atMaximum = quantity >= quantityLimit(listing);
            return <li className={`shop-cart-row${isSelected(line) ? '' : ' shop-cart-row-unselected'}`} key={key}>
              <div>
                <label className="shop-select shop-select-item"><input type="checkbox" checked={isSelected(line)} aria-label={`Select ${itemLabel} for checkout`}
                  onChange={(event) => setSelected(key, event.target.checked)} /><span>Select for checkout</span></label>
                <h4><Link to={listingPath(listing)}>{listing.name}</Link></h4>
                {cartCategory(listing.category) === 'Prescription' ? (() => {
                  const state = rxStates[rxLines.indexOf(line)]?.data?.review?.status;
                  return <span className={`rx-pill rx-pill-${state === 'approved' || state === 'pending' || state === 'rejected' ? state : 'none'}`}>
                    {state === 'approved' ? 'Prescription approved' : state === 'pending' ? 'Under pharmacist review' : state === 'rejected' ? 'Prescription rejected' : 'Prescription required'}</span>;
                })() : <p className="shop-muted">{cartCategory(listing.category)}</p>}
                {cartCategory(listing.category) === 'Prescription' && <p className="shop-muted">Prescription required. Upload it and wait for the pharmacy to approve it before you can place the order. Bring the same prescription when you pick up.</p>}
                <p><strong>{price === null ? 'Price unavailable' : `${pesos(price)}${listing.sellingUnit ? ` per ${listing.sellingUnit}` : ''}`}</strong></p>
                {issue && <span className="status status-pending">{issue}</span>}
                {cartCategory(listing.category) === 'Prescription' && id && positiveId(listing.id) &&
                  <PrescriptionUpload key={`${accountId}:${key}`} accountId={accountId} drugstoreId={id} medicineId={positiveId(listing.id)!} pharmacyName={name} />}
              </div>
              <dl className="shop-line-total">
                <dt>Item subtotal</dt><dd>{lineTotal === null ? 'Unavailable' : pesos(lineTotal)}</dd>
              </dl>
              <div className="shop-cart-controls">
                <div className="shop-stepper" role="group" aria-label={`Quantity for ${itemLabel}`}>
                  <button className="secondary" type="button" aria-label={`Decrease quantity of ${itemLabel}`}
                    aria-disabled={atMinimum} onClick={() => { if (!atMinimum) changeQuantity(key, -1); }}><MaterialIcon name="remove" size={24} /></button>
                  <output aria-label={`Current quantity of ${itemLabel}`}>{quantity}</output>
                  <button className="secondary" type="button" aria-label={`Increase quantity of ${itemLabel}`}
                    aria-disabled={atMaximum} aria-describedby={atMaximum && !issue ? `limit-${key}` : undefined}
                    onClick={() => { if (!atMaximum) changeQuantity(key, 1); }}><MaterialIcon name="add" size={24} /></button>
                </div>
                <button className="link-button" type="button" aria-label={`Remove ${listing.name} from cart`} onClick={() => remove(key)}>Remove</button>
              </div>
              <p className="shop-muted shop-stock-limit" role="status" id={`limit-${key}`}>{atMaximum && !issue ? 'Stock limit reached at the last check.' : ''}</p>
            </li>;
          })}
        </ul></section>)}
      </section>
      <section className="card shop-panel shop-summary" aria-label="Cart summary">
        {picked.length > 0 && (mixed || continueGrouped) && <>
          <button className="shop-text-link" type="button" aria-expanded={groupSheet}
            onClick={() => { if (!testCheckout) show('Grouped checkout is currently unavailable.'); else setGroupSheet((open) => !open); }}>Review pickups by pharmacy</button>
          {groupSheet && testCheckout && <div className="group-sheet" role="group" aria-label="Review pickups by pharmacy">
            <strong>Review and pay for each pharmacy separately</strong>
            <p className="shop-muted">Each pharmacy needs a subtotal of at least ₱100.</p>
            <ul className="shop-lines">{groups.filter((group) => group.picked > 0).map(({ id, name, subtotal }) => <li key={id ?? name}>
              {id ? <Link className="shop-text-link shop-action-link" onClick={onGroupedReview} to={`/app/checkout?pharmacy=${id}`}>
                <strong>{name}</strong><br /><span className="shop-muted">Estimated subtotal {subtotal === null ? 'Unavailable' : pesos(subtotal)}</span></Link>
                : <strong>{name}</strong>}
            </li>)}</ul>
          </div>}
        </>}
                {mixed && !continueGrouped && <p id="cart-block" role="status">Checkout supports one pharmacy at a time. Keep items from one pharmacy to continue.</p>}
        <div className="shop-card-meta"><span>{picked.length} of {cart.length} selected</span></div>
        <div className="shop-card-meta"><span>Estimated cart total</span><strong>{total === null ? 'Unavailable' : pesos(total)}</strong></div>
        {picked.length === 0 && <button className="primary" type="button" disabled>Select items to check out</button>}
        {picked.length > 0 && !mixed && !continueGrouped && rxLabel && <button className="primary" type="button" disabled>{rxLabel}</button>}
        {picked.length > 0 && !mixed && !continueGrouped && !rxLabel && <Link className="primary shop-button" to="/app/checkout">Review checkout</Link>}
        {picked.length > 0 && mixed && !continueGrouped && <button className="primary" type="button" aria-describedby="cart-block" disabled>Review checkout</button>}
      </section>
    </div>}
  </>;
}

export function CheckoutPage({ cart: allLines, user, onReserved }: { cart: CartLine[]; user: SessionUser; onReserved: (items: CheckoutItem[]) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingContact, setEditingContact] = useState(false);
  const [pickupDate, setPickupDate] = useState(() => pickupDays()[0]);
  const [pickupWindow, setPickupWindow] = useState<PickupWindowId | ''>('');
  const [params] = useSearchParams();
  const selected = user.xenditTestCheckout ? positiveId(params.get('pharmacy')) : undefined;
  const cart = selected ? allLines.filter((line) => positiveId(line.listing.drugstoreId) === selected) : allLines;
  const fallbackAttempt = useRef<CheckoutAttempt | null>(null);
  const submitting = useRef(false);
  const stores = new Set(cart.map((line) => positiveId(line.listing.drugstoreId)));
  const storeId = stores.size === 1 ? [...stores][0] : undefined;
  const accountId = String(user.id);
  const pendingAttempt = storeId ? storedCheckoutAttempt(accountId, storeId) ??
    (fallbackAttempt.current?.items[0].drugstoreId === storeId ? fallbackAttempt.current : undefined) : undefined;
  const inventory = useQuery({
    queryKey: ['customer-checkout-inventory', storeId],
    enabled: !!storeId,
    queryFn: ({ signal }) => api.publicInventory(storeId!, signal, true),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    retry: false,
  });
  // Prescription items can only be ordered after the pharmacy approved the customer's uploaded prescription.
  const prescriptionLines = storeId ? cart.filter((line) => cartCategory(line.listing.category) === 'Prescription' && positiveId(line.listing.id)) : [];
  const prescriptionReviews = useQueries({ queries: prescriptionLines.map((line) => ({
    queryKey: ['prescription-review', accountId, storeId, positiveId(line.listing.id)],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.prescriptionStatus(accountId, storeId!, positiveId(line.listing.id)!, signal),
    retry: false,
  })) });
  const prescriptionPending = prescriptionLines.length > 0 && prescriptionReviews.some((query) => query.data?.review?.status !== 'approved');
  const displayedReview = inventory.data ? reviewCart(cart, inventory.data) : null;
  const review = !inventory.isFetching && !inventory.isError ? displayedReview : null;
  const needsCartEdit = review?.some((line) => !!line.issue);
  const subtotal = review && !needsCartEdit ? cartTotal(review) : null;
  const belowGroupMinimum = selected !== undefined && subtotal !== null && subtotal < 10000;
  const store = inventory.data?.store;
  const operatingHours = store?.operating_hours;
  // Pickup today is not offered in the last hour before the pharmacy closes, and "any time" is not allowed for today.
  useEffect(() => {
    const day = dayAvailable(pickupDate, operatingHours) ? pickupDate : firstPickupDay(operatingHours);
    if (day !== pickupDate) setPickupDate(day);
    const window = windowForDay(day, pickupWindow, operatingHours);
    if (window !== pickupWindow) setPickupWindow(window);
  }, [operatingHours, pickupDate, pickupWindow]);
  const checkingStock = inventory.isFetching || inventory.isPending;
  function finishAttempt(attempt: CheckoutAttempt) {
    const pharmacyId = attempt.items[0].drugstoreId;
    if (storedCheckoutAttempt(accountId, pharmacyId)?.key === attempt.key) {
      saveCheckoutAttempt(accountId, pharmacyId, null);
      return true;
    }
    if (fallbackAttempt.current?.key !== attempt.key) return false;
    fallbackAttempt.current = null;
    return true;
  }
  const order = useMutation({
    mutationFn: (attempt: CheckoutAttempt) => api.reserveTestOrder(accountId, attempt.items, attempt.key, attempt.grouped, pickupDate, pickupWindow || undefined),
    onSuccess: (_, attempt) => {
      if (finishAttempt(attempt)) onReserved(attempt.items);
    },
    onError: (error, attempt) => {
      if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
        finishAttempt(attempt);
        void inventory.refetch({ cancelRefetch: false });
      }
    },
    onSettled: () => { submitting.current = false; },
  });
  function submit() {
    if (submitting.current || !storeId) return;
    let attempt = pendingAttempt;
    if (!attempt) {
      if (!review || subtotal === null || belowGroupMinimum) return;
      const items = review.map(({ listing, quantity }) => ({
        id: Number(listing.id), drugstoreId: Number(listing.drugstoreId), quantity,
        expectedUnitPriceCentavos: Number(listing.priceCentavos),
        expectedSellingUnit: listing.sellingUnit ?? undefined,
      }));
      attempt = { items, key: crypto.randomUUID(), grouped: selected !== undefined };
      if (!saveCheckoutAttempt(accountId, storeId, attempt)) fallbackAttempt.current = attempt;
    }
    submitting.current = true;
    order.mutate(attempt, { onSuccess: ({ id }) => { void navigate(`/app/orders?testOrder=${id}`, { replace: true, state: { reservedOrder: id } }); } });
  }

  return <>
    <div className="page-heading"><h1>Checkout</h1></div>
    {cart.length === 0 ? <p>Your cart is empty.</p> : <>
      {!storeId ? <EmptyState>
        <strong>Choose one pharmacy per checkout.</strong>
        <p>Return to the cart and keep items from one verified pharmacy.</p>
      </EmptyState> : <div className="shop-columns">
        <section className="card shop-panel" aria-labelledby="review-medicines">
          <h2 id="review-medicines" className="card-title">Review</h2>
          {checkingStock && <p role="status">Checking stock and prices…</p>}
          {inventory.isError && <ErrorState error={inventory.error} />}
          {(displayedReview ?? cart).length > 0 && <>
              <ul className="shop-lines">
                {(displayedReview ?? cart.map((line) => ({ ...line, issue: null }))).map(({ listing, quantity, issue }, index) => {
                  const previous = nonnegativeInteger(cart[index].listing.priceCentavos);
                  const price = nonnegativeInteger(listing.priceCentavos);
                  return <li key={listingKey(listing)}>
                    <div className="shop-card-meta"><h3>{listing.name} × {quantity}{listing.sellingUnit && ` (${listing.sellingUnit})`}</h3>
                      {price !== null && !issue && <strong>{pesos(price)} {listing.sellingUnit ? `per ${listing.sellingUnit}` : 'each'}</strong>}
                    </div>
                    {price !== null && !issue && <p className="shop-muted">{pesos(price * quantity)} subtotal{!review ? ' · estimate' : ''}</p>}
                    {issue ? <div><p className="form-error" role="status">{issue}</p>
                      <Link className="shop-text-link" to="/app/orders?tab=cart">Edit cart</Link></div> : price !== previous && <p className="notice">
                      {previous === null ? 'Current price confirmed.' : `Unit price updated from ${pesos(previous)}.`}
                    </p>}
                  </li>;
                })}
              </ul>
              {subtotal !== null && <p className="form-success" role="status">Stock and prices checked. Availability can change before an order is placed.</p>}
              {review && subtotal === null && !needsCartEdit && <p className="form-error" role="status">This total is too large. Reduce quantities in your cart.</p>}
            </>}
          <div className="shop-card-meta subtotal-row"><span>Total</span>
            <strong>{subtotal === null ? checkingStock ? 'Checking…' : 'Unavailable' : pesos(subtotal)}</strong></div>
          <Link className="shop-text-link link-divided" to="/app/orders?tab=cart"><MaterialIcon name="editOutlined" size={18} />Edit cart quantities</Link>
        </section>
        <section className="card shop-panel" aria-labelledby="pickup-details">
          <h2 id="pickup-details" className="card-title"><span className="card-icon" aria-hidden="true"><MaterialIcon name="localPharmacyOutlined" size={20} /></span>Pharmacy pickup</h2>
          <p>Pickup at {store?.store_name ?? cart[0].listing.drugstoreName}</p>
          {store?.address && <p className="shop-muted info-row"><MaterialIcon name="placeOutlined" size={18} />{store.address}</p>}
        </section>
        <section className="card shop-panel" aria-labelledby="pickup-date-title">
          <h2 id="pickup-date-title" className="card-title"><span className="card-icon" aria-hidden="true"><MaterialIcon name="eventOutlined" size={20} /></span>Pickup date & time</h2>
          <>
            <div className="chip-row pickup-days" role="group" aria-label="Pickup date">
              {pickupDays().map((day) => <button key={day} type="button" className={`chip${pickupDate === day ? ' chip-on' : ''}`}
                aria-pressed={pickupDate === day} aria-label={`${chipLabel(day)}, ${shortDate(day)}`} disabled={!dayAvailable(day, operatingHours)}
                onClick={() => { setPickupDate(day); setPickupWindow(windowForDay(day, pickupWindow, operatingHours)); }}>{chipLabel(day)}</button>)}
            </div>
            <div className="chip-row pickup-windows" role="group" aria-label="Pickup time">
              <button type="button" className={`chip${pickupWindow === '' ? ' chip-on' : ''}`} aria-pressed={pickupWindow === ''} disabled={!anyTimeAvailable(pickupDate, operatingHours)} onClick={() => setPickupWindow('')}>Any time</button>
              {pickupWindows.map((entry) => <button key={entry.id} type="button" className={`chip${pickupWindow === entry.id ? ' chip-on' : ''}`}
                aria-pressed={pickupWindow === entry.id} disabled={!windowAvailable(pickupDate, entry.id, Date.now(), operatingHours)}
                onClick={() => setPickupWindow(entry.id)}>{entry.label} {entry.hours}</button>)}
            </div>
            <hr className="pickup-rule" />
          </>
        </section>
        <section className="card shop-panel" aria-labelledby="pickup-contact">
          <h2 id="pickup-contact" className="card-title"><span className="card-icon" aria-hidden="true"><MaterialIcon name="personOutline" size={20} /></span>Pickup contact</h2>
          <p className="info-row info-strong"><MaterialIcon name="personOutline" size={18} />{user.fullName || user.name || user.email}</p>
          <p className="info-row"><MaterialIcon name="phoneOutlined" size={18} />{user.phone || 'No mobile number saved'}</p>
          <button type="button" className="shop-text-link" onClick={() => setEditingContact(true)}><MaterialIcon name="editOutlined" size={18} />Edit contact details</button>
          {editingContact && <ContactSheet phone={user.phone ?? ''} onClose={() => setEditingContact(false)}
            onSaved={(saved) => { queryClient.setQueryData(['session'], { ...user, ...saved }); setEditingContact(false); }} />}
        </section>
        <section className="card shop-panel shop-summary" aria-labelledby="payment-title">
          <h2 id="payment-title" className="card-title"><span className="card-icon" aria-hidden="true"><MaterialIcon name="accountBalanceWalletOutlined" size={20} /></span>Payment method</h2>
          <p className={`pay-option${user.xenditTestCheckout ? ' pay-option-on' : ''}`}><MaterialIcon name="accountBalanceWalletOutlined" size={20} /><strong>GCash</strong><MaterialIcon name={user.xenditTestCheckout ? 'radioButtonChecked' : 'radioButtonOff'} size={22} /></p>
          {!user.xenditTestCheckout && <p>{paymentNotice}</p>}
          <div className="shop-card-meta total-row"><span>{review ? 'Order total' : 'Estimated total'}</span>
            <strong>{subtotal === null ? 'Unavailable' : pesos(subtotal)}</strong></div>
          {!user.xenditTestCheckout && <p id="gcash-status">GCash unavailable</p>}
          {order.isError && <ErrorState error={order.error} />}
          {prescriptionPending && !pendingAttempt && <p className="form-error" role="status">
            A prescription item in your order needs an approved prescription. <Link to="/app/orders?tab=cart">Upload it in your cart</Link> and wait for the pharmacy to approve it. Bring the same prescription when you pick up.
          </p>}
          {belowGroupMinimum && <p className="form-error" role="status">This pharmacy’s subtotal is below ₱100. Add items or return to your cart.</p>}
          {pendingAttempt && !order.isPending && <p className="notice" role="status">
            Your previous reservation may already exist. Retry the same request or check <Link to="/app/orders?tab=orders">My Orders</Link>.
          </p>}
          <button className="primary" type="button" aria-describedby={user.xenditTestCheckout ? undefined : 'gcash-status'}
            disabled={!user.xenditTestCheckout || (!pendingAttempt && (subtotal === null || belowGroupMinimum || prescriptionPending)) || order.isPending}
            onClick={submit}>{order.isPending ? 'Please wait…' : pendingAttempt ? 'Retry order reservation' : user.xenditTestCheckout ? 'Place test order' : 'Place order'}</button>
        </section>
      </div>}
    </>}
  </>;
}

function trustedTestCheckoutUrl(value?: string) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password &&
        ['checkout-staging.xendit.co', 'dev.xen.to'].includes(url.hostname)) return url.href;
  } catch {}
}

function CancelDialog({ onKeep, onCancel }: { onKeep: () => void; onCancel: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="sheet" aria-labelledby="cancel-title" onCancel={onKeep}>
    <h2 id="cancel-title">Cancel this unpaid reservation?</h2>
    <div className="row">
      <button type="button" className="secondary" onClick={onKeep}>Keep reservation</button>
      <button type="button" className="primary" onClick={onCancel}>Cancel reservation</button>
    </div>
  </dialog>;
}

export function TestPayment({ id, accountId, status: orderStatus, depositEnabled, total, refreshOrders }: {
  id: number; accountId: string; status: string; depositEnabled?: boolean; total: number | null; refreshOrders: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [plan, setPlan] = useState<'deposit' | 'full'>('deposit');
  const payable = ['reserved', 'awaiting_payment'].includes(orderStatus);
  const ready = orderStatus === 'ready_for_pickup';
  const collected = orderStatus === 'completed';
  const payment = useQuery({
    queryKey: ['customer-orders', accountId, 'test-payment', id],
    queryFn: ({ signal }) => api.testOrderPayment(accountId, id, signal), retry: false, gcTime: 0,
    refetchOnWindowFocus: 'always',
    refetchInterval: ({ state }) => state.data?.payment?.paymentStatus === 'pending' ? 8000 : false,
  });
  const start = useMutation({ mutationFn: (plan?: 'full' | 'deposit' | 'balance') => api.startTestPayment(accountId, id, plan), onSuccess: async () => {
    await payment.refetch();
    refreshOrders();
  } });
  const refresh = useMutation({ mutationFn: () => api.refreshTestOrderPayment(accountId, id), onSuccess: async () => {
    await payment.refetch();
    refreshOrders();
  } });
  const cancel = useMutation({ mutationFn: () => api.cancelReservation(accountId, id), onSettled: refreshOrders });
  const status = payment.data?.payment?.paymentStatus;
  const refreshPayment = refresh.mutate;
  const refreshing = refresh.isPending || start.isPending;
  useEffect(() => {
    if (status !== 'pending') return;
    const run = () => { if (!document.hidden && !refreshing) refreshPayment(); };
    const timer = window.setInterval(run, 3000);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', run); document.removeEventListener('visibilitychange', run); };
  }, [status, refreshing, refreshPayment]);
  const paid = payment.data?.payment;
  const balance = paid?.paymentPlan === 'balance' && status !== 'confirmed' ? paid.amountCentavos ?? 0
    : total !== null && paid?.paymentPlan === 'deposit' && typeof paid.amountCentavos === 'number' ? Math.max(0, total - paid.amountCentavos) : 0;
  const busy = start.isPending || refresh.isPending || cancel.isPending;
  const canPayBalance = ready && depositEnabled && balance >= 100 && !payment.isError &&
    ((status === 'confirmed' && paid?.paymentPlan === 'deposit') || (status === 'pending' && paid?.paymentPlan === 'balance'));
  const receivedUrl = start.data?.payment?.checkoutUrl;
  const url = status === 'pending' ? trustedTestCheckoutUrl(receivedUrl) : undefined;
  const deposit = depositEnabled && total !== null && total > 10000 ? Math.max(10000, Math.ceil(total / 2)) : null;
  const canCancel = payable && !payment.isPending && !payment.isError && (!status || status === 'pending');
  const cancelButton = <button className="text-danger cancel-reservation" type="button" disabled={busy}
    onClick={() => setConfirmCancel(true)}>Cancel reservation</button>;
  const noticeText = status === 'confirmed' && paid?.paymentPlan === 'balance' ? 'Balance paid with GCash. ₱0.00 due.'
      : status === 'reconciliation_required' ? 'The test payment needs staff review.'
      : collected && balance > 0 && (status === 'confirmed' || status === 'failed') ? 'Remaining balance settled at pickup. ₱0.00 due.'
      : status === 'confirmed' ? balance > 0 ? `Deposit confirmed. Balance due: ${pesos(balance)}.` : null
      : status === 'failed' ? paid?.paymentPlan === 'balance' ? `The online balance checkout ended. Pay ${pesos(balance)} at pickup.` : 'The test checkout ended without payment.'
      : status === 'pending' ? 'Waiting for payment.'
      : null;
  return <div className="shop-actions shop-payment-actions">
    {noticeText && <p className="notice" role="status">{noticeText}</p>}
    {status === 'pending' && <p className="shop-muted">Come back here after paying.</p>}
    {ready && paid?.paymentPlan === 'deposit' && status === 'confirmed' && balance > 0 &&
      <p className="shop-muted">You can also pay at pickup.</p>}
    {payment.isError && <ErrorState error={payment.error} />}
    {start.isError && <ErrorState error={start.error} />}
    {refresh.isError && <ErrorState error={refresh.error} />}
    {cancel.isError && <ErrorState error={cancel.error} />}
    {status === 'pending' && receivedUrl && !url && <p className="form-error" role="alert">Could not open the test checkout.</p>}
    {canPayBalance && <div className="card shop-settle"><strong>Settle the remaining {pesos(balance)}?</strong>
      <p>Pay it now with GCash, or pay at the counter when you pick up.</p></div>}
    {canPayBalance && (url && start.data?.payment?.paymentPlan === 'balance'
      ? <a className="primary shop-button" href={url} target="_blank" rel="noreferrer">Open GCash balance checkout</a>
      : <button className="secondary" type="button" disabled={busy} onClick={() => start.mutate('balance')}>
        {status === 'pending' ? 'Resume GCash balance checkout' : `Pay ${pesos(balance)} with GCash`}</button>)}
    {payable && !payment.isError && !payment.isPending && (!status || status === 'pending') &&
      (url ? <a className="primary shop-button" href={url} target="_blank" rel="noreferrer">Open GCash test checkout</a>
        : !status && total !== null ? (() => {
          const pick = deposit !== null ? plan : 'full';
          const now = pick === 'deposit' && deposit !== null ? deposit : total;
          return <section className="shop-payment-card" aria-label="Choose how to pay">
            <h2>How would you like to pay?</h2>
            <div className="shop-payment-options">
              {deposit !== null && <div className={`shop-payment-option${pick === 'deposit' ? ' selected' : ''}`} onClick={() => setPlan('deposit')}>
                <div className="shop-payment-head">
                  <input type="radio" name="pay-plan" id="pay-plan-deposit" checked={pick === 'deposit'} onChange={() => setPlan('deposit')} />
                  <h3><label htmlFor="pay-plan-deposit">Pay a deposit</label></h3>
                </div>
                <dl className="shop-totals"><div><dt>Pay now</dt><dd>{pesos(deposit)}</dd></div><div><dt>Due at pickup</dt><dd>{pesos(total - deposit)}</dd></div></dl>
              </div>}
              <div className={`shop-payment-option${pick === 'full' ? ' selected' : ''}`} onClick={() => setPlan('full')}>
                <div className="shop-payment-head">
                  <input type="radio" name="pay-plan" id="pay-plan-full" checked={pick === 'full'} onChange={() => setPlan('full')} />
                  <h3><label htmlFor="pay-plan-full">Pay in full</label></h3>
                </div>
                <dl className="shop-totals"><div><dt>Pay now</dt><dd>{pesos(total)}</dd></div><div><dt>Due at pickup</dt><dd>{pesos(0)}</dd></div></dl>
              </div>
            </div>
            {depositEnabled && deposit === null && <p className="shop-muted">Orders of ₱100 or less are paid in full.</p>}
            <button className="primary" type="button" disabled={busy} onClick={() => start.mutate(pick === 'deposit' ? 'deposit' : undefined)}>
              {pick === 'deposit' ? `Pay ${pesos(now)} deposit with GCash` : depositEnabled ? `Pay ${pesos(total)} in full with GCash` : 'Open GCash test checkout'}
            </button>
            {canCancel && cancelButton}
          </section>;
        })() : <>
          <button className="primary" type="button" disabled={busy} onClick={() => start.mutate(paid?.paymentPlan)}>
            {start.isPending ? 'Please wait…' : status === 'pending' ? 'Continue with GCash'
              : depositEnabled && total !== null ? `Pay ${pesos(total)} in full with GCash` : 'Open GCash test checkout'}
          </button>
          {canCancel && cancelButton}
        </>)}
    {payable && !payment.isPending && !payment.isError && status === 'failed' && cancelButton}
    {confirmCancel && <CancelDialog onKeep={() => setConfirmCancel(false)} onCancel={() => { setConfirmCancel(false); cancel.mutate(); }} />}
  </div>;
}
