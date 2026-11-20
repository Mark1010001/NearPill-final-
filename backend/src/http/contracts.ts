import { z } from '@hono/zod-openapi';
import { normalizeEmail, passwordMatchesIdentity, signupPasswordMessage, validEmail, validFullName, validSignupEmail, validSignupPassword, validLoginPassword } from '../domain/identity/input-policy.js';

export const ErrorSchema = z.object({ error: z.string() }).openapi('Error');
export const JsonObjectSchema = z.object({}).passthrough();
export const JsonArraySchema = z.array(JsonObjectSchema);
export const JsonResponseSchema = z.union([JsonObjectSchema, JsonArraySchema]);

export const EmptySchema = z.object({}).strict();
export const IdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
export const StoreIdParamsSchema = z.object({ id: z.coerce.number().int().positive() });
export const MembershipParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  userId: z.coerce.number().int().positive(),
});

const email = z.string().max(254)
  .refine(validEmail, { message: 'Invalid email address.' })
  .transform(normalizeEmail);
const signupEmail = z.string().max(254)
  .refine(validSignupEmail, { message: 'Enter a valid email address.' })
  .transform(normalizeEmail);
const signupPassword = z.string().refine(validSignupPassword, { message: signupPasswordMessage });
const loginPassword = z.string().refine(validLoginPassword, { message: 'Invalid password.' });

export const RegisterSchema = z.object({
  fullName: z.string().refine(validFullName, { message: 'Invalid full name.' }).transform((value) => value.trim()),
  email: signupEmail,
  password: signupPassword,
  acceptedTerms: z.literal(true),
  // Anti-bot fields: a hidden field people never fill in, and how long the form was open.
  company: z.string().max(200).optional(),
  formMs: z.number().int().min(0).max(86_400_000).optional(),
}).strict().superRefine((value, context) => {
  if (passwordMatchesIdentity(value.password, { email: value.email, name: value.fullName })) {
    context.addIssue({ code: 'custom', path: ['password'], message: 'Do not use your name or email as your password.' });
  }
});
export const LoginSchema = z.object({ email, password: loginPassword }).strict();
export const ChangePasswordSchema = z.object({ currentPassword: loginPassword, password: signupPassword }).strict();
export const DeleteAccountSchema = z.object({
  password: z.string().min(1).max(255),
}).strict();
export const AssistantChatSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(1000) }).strict()).min(1).max(12),
  cart: z.array(z.object({ name: z.string().max(80), quantity: z.number().int().min(1).max(999), pharmacy: z.string().max(80) }).strict()).max(20).optional(),
}).strict();
export const EmailSchema = z.object({ email }).strict();
export const SendOtpSchema = z.object({ email: signupEmail }).strict();
export const VerifyOtpSchema = z.object({ email, code: z.string().regex(/^\d{6}$/) }).strict();
export const ResetPasswordSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: signupPassword,
}).strict();
export const RefreshSchema = z.object({ refreshToken: z.string().min(1) }).strict();
export const LogoutSchema = z.object({ refreshToken: z.string().min(1).optional() }).strict();
export const ProfileUpdateSchema = z.object({
  phone: z.string().max(40).nullable().optional(),
  // Birthdate is no longer collected. Older app builds may still send it, so it is accepted and ignored.
  birthDate: z.string().max(40).nullable().optional(),
  birthdate: z.string().max(40).nullable().optional(),
}).strict();

export const StockSubmissionSchema = z.object({
  drugstoreId: z.coerce.number().int().positive(),
  fileName: z.string().max(200).optional(),
  csv: z.string().max(400_000).optional(),
  row: z.record(z.string(), z.union([z.string().max(300), z.number()])).optional(),
}).strict();
export const StockSubmissionQuerySchema = z.object({
  drugstoreId: z.coerce.number().int().positive().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
});
export const GoLiveSchema = z.object({ live: z.boolean() }).strict();
export const PartnerAccountSchema = z.object({ email, password: signupPassword }).strict();
export const MembershipUpsertSchema = z.object({
  userId: z.coerce.number().int().positive(),
  membershipRole: z.enum(['owner', 'manager', 'staff']),
}).strict();

export const MedicineQuerySchema = z.object({
  view: z.enum(['available', 'catalog']).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  search: z.string().max(160).optional(),
  q: z.string().max(160).optional(),
  category: z.string().max(120).optional(),
  storeId: z.coerce.number().int().positive().optional(),
  drugstoreId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).max(1000).optional(),
}).strict();

export const StoreInventoryQuerySchema = MedicineQuerySchema.pick({ view: true });
export const StoreRouteQuerySchema = z.object({ latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180) }).strict();

export const NearbyStoreQuerySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  radiusKm: z.coerce.number().positive().max(25).optional(),
  q: z.string().max(160).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
}).strict();

export const PharmacyBodySchema = z.object({
  name: z.string().max(200).optional(),
  address: z.string().max(500).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  operatingHours: z.union([z.string(), z.null()]).optional(),
  operating_hours: z.union([z.string(), z.null()]).optional(),
  status: z.string().max(40).optional(),
  isActive: z.boolean().optional(),
}).strict();

export const MedicineBodySchema = z.object({
  brandName: z.string().max(200).optional(),
  brand_name: z.string().max(200).optional(),
  genericName: z.string().max(200).nullable().optional(),
  generic_name: z.string().max(200).nullable().optional(),
  dosageForm: z.string().max(120).optional(),
  dosage_form: z.string().max(120).optional(),
  category: z.string().max(120).nullable().optional(),
  description: z.string().max(4000).nullable().optional(),
}).strict();


export const PharmacyVerificationSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected']),
  licenseNumber: z.string().max(160).nullable().optional(),
  evidenceReference: z.string().max(2000).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  publish: z.boolean().optional(),
}).strict();

export const MedicineEvidenceSchema = z.object({
  sourceName: z.string().min(1).max(200),
  sourceUrl: z.string().url().max(2000),
  sourceVersion: z.string().max(120).nullable().optional(),
  status: z.enum(['approved', 'rejected']).optional(),
}).strict();

export const MedicinePublicationSchema = z.object({
  status: z.enum(['draft', 'published', 'retired']),
  reviewReference: z.string().trim().min(1).max(500).optional(),
}).strict();

const sellingUnitSchema = z.string().trim().max(48).regex(/^[A-Za-z0-9][A-Za-z0-9 ().,\-]*$/);
const packageSizeSchema = z.string().trim().max(80).regex(/^[A-Za-z0-9][A-Za-z0-9 ().,\/\-]*$/);
export const InventoryPriceSchema = z.object({
  price: z.coerce.number().nonnegative(),
  expectedSellingUnit: sellingUnitSchema.nullable().optional(),
}).strict();

const InventoryIntakeRow = z.object({
  medicineId: z.number().int().positive(),
  stock: z.number().int().min(1).max(2147483647),
  price: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
  sellingUnit: sellingUnitSchema.optional(),
  packageSize: packageSizeSchema.optional(),
}).strict();

export const PartnerNewProductSchema = z.object({
  drugstoreId: z.number().int().positive(),
  brandName: z.string().trim().min(2).max(200),
  genericName: z.string().trim().max(200).nullable().optional(),
  dosageForm: z.string().trim().min(2).max(120),
  category: z.enum(['Non-prescription', 'Prescription', 'Non-medicine']),
  stock: z.number().int().min(1).max(2147483647),
  price: z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),
  sellingUnit: sellingUnitSchema,
  packageSize: packageSizeSchema.optional(),
}).strict();

export const PartnerInventoryIntakeSchema = z.union([
  InventoryIntakeRow.extend({ drugstoreId: z.number().int().positive() }),
  z.object({ drugstoreId: z.number().int().positive(), items: z.array(InventoryIntakeRow).min(1).max(100) }).strict(),
]);

const InventoryUpdateScope = z.object({
  pharmacyId: z.coerce.number().int().positive().optional(),
  drugstoreId: z.coerce.number().int().positive().optional(),
  medId: z.coerce.number().int().positive().optional(),
  medicineId: z.coerce.number().int().positive().optional(),
}).strict();
export const InventoryUpdateSchema = z.union([
  InventoryUpdateScope.extend({ countDelta: z.coerce.number().int() }).strict(),
  InventoryUpdateScope.extend({
    stockOnHand: z.number().int().min(0).max(2_147_483_647),
    expectedStockOnHand: z.number().int().min(0).max(2_147_483_647),
    price: z.string().regex(/^\d+(?:\.\d{1,2})?$/).max(17).optional(),
    expectedPriceCentavos: z.number().int().nonnegative().optional(),
    sellingUnit: sellingUnitSchema.optional(),
    expectedSellingUnit: sellingUnitSchema.nullable().optional(),
    packageSize: packageSizeSchema.nullable().optional(),
    expectedPackageSize: packageSizeSchema.nullable().optional(),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    lowStockThreshold: z.number().int().min(0).max(1_000_000).nullable().optional(),
    saleProduct: z.tuple([z.string().max(100), z.string().max(100).nullable(), z.string().max(50), z.string().max(100)]).optional(),
  }).strict(),
]);
export const InventoryQuerySchema = z.object({
  pharmacyId: z.coerce.number().int().positive().optional(),
  drugstoreId: z.coerce.number().int().positive().optional(),
}).passthrough();

export const PrescriptionTargetSchema = z.object({
  drugstoreId: z.coerce.number().int().positive().max(2147483647),
  medicineId: z.coerce.number().int().positive().max(2147483647),
}).strict();
export const PrescriptionSubmitSchema = PrescriptionTargetSchema.extend({
  mimeType: z.enum(['image/jpeg', 'image/png']),
  photo: z.string().min(1).max(1398104),
});
export const PrescriptionBranchSchema = PrescriptionTargetSchema.pick({ drugstoreId: true });
const PrescriptionVersionSchema = z.string().regex(/^\d{1,15}\.\d{6}$/);
export const PrescriptionPhotoQuerySchema = PrescriptionBranchSchema.extend({ version: PrescriptionVersionSchema });
export const PrescriptionDecisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  version: PrescriptionVersionSchema,
  reason: z.string().trim().min(3).max(200).optional(),
}).strict().refine((body) => body.decision === 'rejected' ? body.reason !== undefined : body.reason === undefined,
  { message: 'Give a reason when rejecting, and only then.', path: ['reason'] });

export const OrderCreateSchema = z.object({
  checkoutMode: z.literal('grouped').optional(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pickupWindow: z.enum(['morning', 'afternoon', 'evening']).optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/).optional(),
  items: z.array(z.object({
    id: z.coerce.number().int().positive(),
    drugstoreId: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive(),
    expectedUnitPriceCentavos: z.number().int().nonnegative().optional(),
    expectedSellingUnit: sellingUnitSchema.optional(),
  }).passthrough()).min(1),
}).passthrough();
export const OrderPickupSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupWindow: z.enum(['morning', 'afternoon', 'evening']).optional(),
}).strict();
export const OrderStatusSchema = z.object({
  status: z.string().min(1).max(80),
  rejectionReason: z.string().max(2000).nullable().optional(),
  reason: z.string().max(2000).nullable().optional(),
}).passthrough();

export const PartnerPickupStatusSchema = z.object({
  drugstoreId: z.number().int().positive(),
  status: z.enum(['preparing', 'ready_for_pickup', 'completed']),
  balancePayment: z.object({ method: z.enum(['cash', 'other']), amountCentavos: z.number().int().positive() }).strict().optional(),
}).strict();

export const SubscriptionBodySchema = z.object({
  drugstoreId: z.coerce.number().int().positive().optional(),
  tier: z.enum(['Basic', 'Plus', 'Pro']).optional(),
  status: z.enum(['active', 'expired', 'cancelled']).optional(),
  startDate: z.string().max(80).optional(),
  endDate: z.string().max(80).nullable().optional(),
  planVersion: z.string().min(1).max(100).optional(),
}).passthrough();
export const PaymentIntentCreateSchema = z.object({
  provider: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  paymentPlan: z.enum(['full', 'deposit', 'balance']).optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
}).strict();
export const RefundRequestSchema = z.object({ reason: z.string().min(1).max(1000) }).strict();
export const ProviderParamsSchema = z.object({ provider: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/) });
export const SalesQuerySchema = z.object({
  startDate: z.string().max(80).optional(),
  endDate: z.string().max(80).optional(),
}).passthrough();

export const LoginResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  csrfToken: z.string(),
  user: z.object({
    id: z.string(),
    fullName: z.string(),
    email: z.string(),
    role: z.string(),
  }),
  passwordNeedsUpdate: z.boolean().optional(),
}).openapi('LoginResponse');
export const RefreshResponseSchema = z.object({ accessToken: z.string(), refreshToken: z.string() })
  .openapi('RefreshResponse');
export const HealthSchema = z.object({ status: z.string(), database: z.string().optional() })
  .openapi('Health');
