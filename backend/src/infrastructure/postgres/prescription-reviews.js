import sharp from 'sharp';
import { actorHasPermission } from '../../domain/identity/permissions.js';
import { failure, success } from '../../application/result.js';
import { productIdentity } from './catalog-orderability.js';
import { createPostgresCompatPool } from './compat-pool.js';

const publicPrescription = `m.publication_status IN ('draft','published')
  AND lower(btrim(m.category)) IN ('prescription','prescriptions','prescription (source list)')
  AND ds.is_active = 1 AND ds.verification_status = 'verified' AND ds.public_profile_published_at IS NOT NULL`;
const statusColumn = `CASE WHEN status = 'pending' AND expires_at <= now() THEN 'expired' ELSE status END AS status`;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const photoVersion = 'extract(epoch from submitted_at)::text';

export async function prescriptionPhoto(photo, mimeType) {
  if (typeof photo !== 'string' || photo.length > 1398104 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo)) return null;
  const bytes = Buffer.from(photo, 'base64');
  if (bytes.length > 1048576 || bytes.toString('base64') !== photo) return null;
  const format = mimeType === 'image/png' && bytes.subarray(0, 8).equals(pngSignature) ? 'png'
    : mimeType === 'image/jpeg' && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])) ? 'jpeg' : null;
  if (!format) return null;
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 4096 * 4096 });
    const { width, height } = await image.metadata();
    if (!width || !height || width > 4096 || height > 4096) return null;
    // Decode the image and retain its orientation while stripping embedded metadata.
    const clean = await image.autoOrient().toFormat(format).toBuffer();
    return clean.length <= 1048576 ? clean : null;
  } catch {
    return null;
  }
}

export function createPrescriptionReviews(postgresPool) {
  const pool = createPostgresCompatPool(postgresPool, { capability: 'catalog_browse' });
  const customer = (actor) => actor?.role === 'customer';
  const partner = (actor, branch) => actor?.role === 'partner' && actorHasPermission(actor, 'orders:update:pharmacy', branch);
  return {
    async status(actor, customerId, { drugstoreId, medicineId }) {
      if (!customer(actor)) return failure(403, 'Customer access required.');
      const [rows] = await pool.query(`SELECT id, ${statusColumn}, rejection_reason AS "rejectionReason" FROM nearpill.prescription_reviews
        WHERE customer_id = ? AND pharmacy_id = ? AND medicine_id = ?`, [customerId, drugstoreId, medicineId]);
      return success({ review: rows[0] ?? null });
    },
    async submit(actor, customerId, { drugstoreId, medicineId, photo, mimeType }) {
      if (!customer(actor)) return failure(403, 'Customer access required.');
      const bytes = await prescriptionPhoto(photo, mimeType);
      if (!bytes) return failure(400, 'Choose a readable JPG or PNG up to 1 MB and 4096 pixels per side.');
      const [rows] = await pool.query(`WITH submitted AS (INSERT INTO nearpill.prescription_reviews AS r
          (customer_id, pharmacy_id, medicine_id, product, photo, mime_type, customer_name)
        SELECT ?, ds.id, m.id, ${productIdentity}, ?, ?, (SELECT split_part(btrim(u.name), ' ', 1) FROM public.users u WHERE u.id = ?) FROM public.stock i
        JOIN public.medicines m ON m.id = i.medicine_id JOIN public.pharmacies ds ON ds.id = i.pharmacy_id
        WHERE ds.id = ? AND m.id = ? AND ${publicPrescription}
        ON CONFLICT (customer_id, pharmacy_id, medicine_id) DO UPDATE SET
          customer_name = excluded.customer_name, product = excluded.product, photo = excluded.photo, mime_type = excluded.mime_type,
          status = 'pending', rejection_reason = NULL, submitted_at = greatest(clock_timestamp(), r.submitted_at + interval '1 microsecond'),
          expires_at = now() + interval '24 hours', reviewed_by = NULL, reviewed_at = NULL
        WHERE r.status IN ('rejected','expired') OR (r.status = 'pending' AND r.expires_at <= now())
        RETURNING id, status) SELECT id, status FROM submitted`, [customerId, bytes, mimeType, customerId, drugstoreId, medicineId]);
      return rows[0] ? success({ review: rows[0] }, 201)
        : failure(409, 'This prescription item is unavailable or already has an active review. Refresh to check its status.');
    },
    async queue(actor, drugstoreId) {
      if (!partner(actor, drugstoreId)) return failure(403, 'Pharmacy access denied.');
      const [rows] = await pool.query(`SELECT id, product ->> 0 AS productName, medicine_id AS medicineId,
          ${photoVersion} AS version, expires_at AS expiresAt, customer_id AS customerId, customer_name AS customerName, submitted_at AS submittedAt
        FROM nearpill.prescription_reviews WHERE pharmacy_id = ? AND status = 'pending' AND expires_at > now()
        ORDER BY submitted_at, id LIMIT 50`, [drugstoreId]);
      return success(rows);
    },
    async photo(actor, drugstoreId, id, version) {
      if (!partner(actor, drugstoreId)) return failure(403, 'Pharmacy access denied.');
      const [rows] = await pool.query(`SELECT photo, mime_type AS mimeType FROM nearpill.prescription_reviews
        WHERE id = ? AND pharmacy_id = ? AND ${photoVersion} = ? AND status = 'pending' AND expires_at > now()`, [id, drugstoreId, version]);
      return rows[0] ? success({ mimeType: rows[0].mimeType, photo: rows[0].photo.toString('base64') })
        : failure(404, 'This prescription photo is no longer available.');
    },
    async decide(actor, reviewerId, drugstoreId, id, version, decision, reason = null) {
      if (!partner(actor, drugstoreId)) return failure(403, 'Pharmacy access denied.');
      const [rows] = await pool.query(`WITH decided AS (UPDATE nearpill.prescription_reviews r SET status = ?, reviewed_by = ?,
          reviewed_at = now(), rejection_reason = ?, photo = NULL, mime_type = NULL
        WHERE r.id = ? AND r.pharmacy_id = ? AND ${photoVersion} = ? AND r.status = 'pending' AND r.expires_at > now()
          AND (? = 'rejected' OR EXISTS (SELECT 1 FROM public.stock i
            JOIN public.medicines m ON m.id = i.medicine_id JOIN public.pharmacies ds ON ds.id = i.pharmacy_id
            WHERE ds.id = r.pharmacy_id AND m.id = r.medicine_id AND ${publicPrescription} AND r.product = ${productIdentity}))
        RETURNING r.id, r.status) SELECT id, status FROM decided`, [decision, reviewerId, decision === 'rejected' ? reason : null, id, drugstoreId, version, decision]);
      return rows[0] ? success({ review: rows[0] }) : failure(409, 'The request expired, was reviewed, or the listing changed.');
    },
    async expire() {
      await pool.query(`UPDATE nearpill.prescription_reviews SET status = 'expired', photo = NULL, mime_type = NULL
        WHERE status = 'pending' AND expires_at <= now()`);
    },
  };
}
