export type PortalRole = 'admin' | 'partner' | 'customer';

export interface Membership {
  drugstoreId: number;
  drugstoreName?: string;
  membershipRole: 'owner' | 'manager' | 'staff' | string;
  isActive?: boolean;
}

export interface SessionUser {
  xenditTestCheckout?: boolean;
  xenditTestDeposit?: boolean;
  id: number | string;
  fullName?: string;
  name?: string;
  email: string;
  phone?: string | null;
  role: PortalRole | string;
  memberships?: Membership[];
  sessionExpiresInMs?: number;
}

export interface Metrics {
  totalGMV?: number;
  activePharmaciesCount?: number;
  totalOrdersCount?: number;
}

export interface StockRow {
  line: number; catalogId: number | null; medicineId?: number; name: string; genericName: string | null; form: string; category: string;
  sellingUnit: string; price: string; stock: number; match: 'existing' | 'new'; note?: string;
}

export interface StockSubmission {
  id: number; drugstoreId: number; drugstoreName: string; accountNo: number | null; source: 'csv' | 'single';
  status: 'pending' | 'approved' | 'rejected'; fileName: string | null; rowCount: number; reviewNote: string | null;
  createdAt: string; reviewedAt: string | null; rows?: StockRow[];
}

export interface GoLiveChecklist {
  drugstoreId: number;
  name: string;
  live: boolean;
  canGoLive: boolean;
  checks: { id: string; label: string; ok: boolean; hint: string }[];
}

export interface Pharmacy {
  id?: string | number;
  store_id?: number;
  name: string;
  slug?: string;
  address?: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  operatingHours?: string | null;
  status?: string;
  verificationStatus?: string;
  publicProfilePublishedAt?: string | null;
  licenseNumber?: string | null;
  evidenceReference?: string | null;
  verificationNotes?: string | null;
  reviewedBy?: number | null;
  reviewedAt?: string | null;
  totalOrders?: number;
  totalSales?: number;
  accountNo?: number | null;
  subscriptionTier?: string | null;
  partnershipStartedAt?: string | null;
  partnershipExpiresAt?: string | null;
}

export interface Medicine {
  id: number;
  brandName: string;
  genericName?: string;
  category?: string;
  dosageForm?: string;
  publicationStatus?: string;
  alreadyStocked?: boolean;
  approvedEvidenceCount?: number;
  linkedPharmacies?: { id: number; name: string; inventoryId: number; priceCentavos: string; stockOnHand?: number; sellableQuantity?: number; sellingUnit?: string | null; packageSize?: string | null }[];
  savedEvidence?: { id: number; name: string; status: string }[];
  description?: string | null;
  otcEligible?: boolean;
}

export interface CatalogListing {
  id: number | string;
  name: string;
  genericName: string | null;
  dosageForm: string | null;
  category: string | null;
  drugstoreId: number | string;
  drugstoreName: string;
  publicationStatus: string;
  canOrder: boolean;
  stockCount: number | string | null;
  priceCentavos: number | string | null;
  sellingUnit?: string | null;
  packageSize?: string | null;
  distanceKm?: number | string | null;
  distance?: string | null;
  activeIngredients?: string[];
  adultUseReviewed?: boolean;
  otcEligible?: boolean;
}

export interface PublicPharmacy {
  store_id: number;
  store_name: string;
  address: string;
  latitude: number | string | null;
  longitude: number | string | null;
  openNow: boolean | null;
  verified: boolean;
  operating_hours?: string | null;
  distanceKm?: number | string | null;
}

export interface PublicPharmacyInventory {
  store: PublicPharmacy;
  inventory: CatalogListing[];
}

export interface OrderItem {
  id?: number;
  name?: string;
  medicineName?: string;
  genericName?: string;
  quantity: number;
  sellingUnit?: string;
  priceCentavos?: number;
  drugstoreId?: number;
  drugstoreName?: string;
  prescriptionRequired?: boolean;
  category?: string;
  dosageForm?: string;
}

export type CheckoutItem = { id: number; drugstoreId: number; quantity: number; expectedUnitPriceCentavos: number; expectedSellingUnit?: string };

export interface Order {
  pickupBalanceCentavos?: number | null;
  pickupBalancePending?: boolean;
  pickupBalancePaidWithGCash?: boolean;
  id: number;
  paymentId?: number | null;
  paymentStatus?: string | null;
  paymentProvider?: string | null;
  reference?: string;
  customerName?: string;
  customerEmail?: string;
  storeName?: string;
  store_id?: number | null;
  drugstoreId?: number;
  items: OrderItem[];
  totalCentavos?: number;
  total?: number;
  status?: string;
  stage?: string;
  rejectionReason?: string | null;
  itemSummary?: string;
  placedOn?: string | null;
  createdAt?: string;
  pickupDate?: string | null;
  pickupWindow?: string | null;
  pickupRescheduled?: boolean;
}

export interface InventoryItem {
  orderingState?: 'pharmacy_review' | 'catalog_review' | 'pharmacy_confirmation' | 'out_of_stock' | 'unavailable' | 'orderable';
  inventoryId: number;
  drugstoreId: number;
  medicineId: number;
  drugstoreName?: string;
  medicineName: string;
  genericName?: string;
  category?: string;
  saleProduct?: [string, string | null, string, string] | null;
  priceCentavos: number;
  sellingUnit?: string | null;
  packageSize?: string | null;
  expiryDate?: string | null;
  lowStockThreshold?: number | null;
  stockOnHand: number;
  reservedQuantity: number;
  sellableQuantity: number;
  availability?: boolean | number;
  publicationStatus?: string;
}

export interface PartnerDashboard {
  drugstoreId: number;
  membershipRole: string;
  totalSales: number;
  totalOrders: number;
  completedOrders: number;
  pendingOrders: number;
  expiredOrders: number;
  cancelledOrders: number;
  branch?: { name: string; address: string; latitude: string | number; longitude: string | number; operatingHours: string | null; isPublic: boolean } | null;
}

export interface PartnerSubscription {
  drugstoreId: number;
  subscription: Subscription | null;
  entitlements: string[];
}

export interface SubscriptionPlan { tier: 'Basic' | 'Plus' | 'Pro'; summary: string; features: string[]; entitlements: string[]; partnershipMonths?: number }

export interface Subscription {
  id: number | string;
  drugstoreId: number | string;
  drugstoreName?: string;
  tier: string;
  status: string;
  planVersion: string;
  startDate: string;
  endDate: string | null;
}

export interface SalesRow {
  reportDate: string;
  orderCount: number;
  revenue: number;
}

export interface NearbyResponse {
  mode?: string;
  stores: PublicPharmacy[];
  center?: { latitude?: number | string; longitude?: number | string };
  radiusKm?: number | string;
  query?: string;
}

export interface DrivingRoute { distanceMeters: number; durationSeconds: number; coordinates: [number, number][] }

export interface MedicineReportRow { medicineId: number; brandName: string; genericName?: string | null; quantitySold: number; orderCount: number }
export interface DrugstoreReportRow { drugstoreId: number; drugstoreName: string; orderCount: number; revenue: number; cancelledCount: number; expiredCount: number }
export interface AuditLogRow { id: number; userId?: number | null; userName?: string | null; userEmail?: string | null; userRole?: string | null; action: string; description?: string | null; createdAt: string }
export interface AdminCustomer { id: number; name: string; email: string; createdAt: string | null }
export interface PharmacyMembership { userId: number; name: string; email: string; drugstoreId: number; membershipRole: 'owner' | 'manager' | 'staff'; isActive: boolean; createdAt?: string }
