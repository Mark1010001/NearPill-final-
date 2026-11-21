export const eligibleForStandardCheckout = `m.publication_status = 'published' AND m.otc_eligible
  AND lower(btrim(coalesce(m.category, ''))) NOT IN ('prescription (source list)', 'prescription', 'prescriptions', 'classification needs review')`;

export const pharmacyCanConfirmSale = `m.publication_status = 'draft' AND lower(btrim(m.category)) IN
  ('prescription (source list)', 'prescription', 'prescriptions',
   'non-prescription (source list)', 'non-prescription', 'non-prescriptions', 'non - prescriptions', 'otc', 'general otc',
   'medical supplies', 'non-medicine', 'non-medicines', 'non medicine', 'non medicines')`;
export const productIdentity = 'jsonb_build_array(m.brand_name, m.generic_name, m.dosage_form, m.category)';
// Like any pharmacy marketplace, a non-prescription or non-medicine item is orderable as soon as the pharmacy lists it
// with stock. Prescription items can be reserved too; the pharmacist verifies the prescription at pickup. Unclassified items stay blocked.
export const listingEligibleForCheckout = `(${eligibleForStandardCheckout} OR (${pharmacyCanConfirmSale}))`;

export const orderItemsEligibleForPickup = `SELECT COUNT(*) > 0 AND bool_and(
    (${listingEligibleForCheckout} AND ds.is_active = 1 AND ds.verification_status = 'verified'
      AND ds.public_profile_published_at IS NOT NULL AND i.id IS NOT NULL) IS TRUE) AS eligible
  FROM order_pharmacies od JOIN order_items oi ON oi.order_pharmacy_id = od.id
  LEFT JOIN medicines m ON m.id = oi.medicine_id
  LEFT JOIN stock i ON i.medicine_id = oi.medicine_id AND i.pharmacy_id = od.pharmacy_id
  LEFT JOIN pharmacies ds ON ds.id = od.pharmacy_id
  WHERE od.order_id = ?`;
