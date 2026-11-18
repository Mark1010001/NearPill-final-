import { assertCatalogRepository } from '../ports/catalog-repository.js';
import { calculateOpenNow, pharmacySlug } from '../domain/catalog/open-now.js';
import { evaluateGoLive } from '../domain/catalog/go-live.js';
import { partnershipExpiry } from '../domain/subscriptions/plans.js';
import { failure, success } from './result.js';

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function boundedInt(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function adminMedicineInput(body = {}, existing = null) {
  const brand = body.brandName !== undefined || body.brand_name !== undefined
    ? String(body.brandName ?? body.brand_name ?? '').trim()
    : existing?.brand_name;
  const generic = body.genericName !== undefined || body.generic_name !== undefined
    ? String(body.genericName ?? body.generic_name ?? '').trim() || null
    : existing?.generic_name ?? null;
  const form = body.dosageForm !== undefined || body.dosage_form !== undefined
    ? String(body.dosageForm ?? body.dosage_form ?? '').trim()
    : existing?.dosage_form ?? 'Tablet';
  const category = body.category !== undefined
    ? String(body.category || '').trim() || null
    : existing?.category ?? null;
  const description = body.description !== undefined
    ? String(body.description || '').trim() || null
    : existing?.description ?? null;

  return { brand, generic, form, category, description };
}

function publicStore(store, now) {
  return {
    store_id: Number(store.store_id ?? store.id),
    store_name: store.store_name ?? store.name,
    address: store.address,
    latitude: store.latitude,
    longitude: store.longitude,
    operating_hours: store.operating_hours,
    openNow: calculateOpenNow(store.operating_hours, 1, now),
    verified: true,
    verifiedAt: store.verifiedAt ?? store.verified_at ?? null,
    ...(store.distanceKm !== undefined ? { distanceKm: store.distanceKm === null ? null : Number(store.distanceKm) } : {}),
  };
}

/** @param {{ repository: any, now?: () => Date, routePlanner?: Function | null, stagingTestLabels?: boolean }} options */
export function createCatalogService({ repository, now = () => new Date(), routePlanner = null, stagingTestLabels = false }) {
  assertCatalogRepository(repository);

  return Object.freeze({
    async getStoreRoute(actorId, idValue, query = {}) {
      const storeId = validId(idValue);
      const latitude = Number(query.latitude), longitude = Number(query.longitude);
      if (!storeId || query.latitude == null || query.longitude == null || !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return failure(400, 'A valid pharmacy and current location are required.');
      const store = await repository.findPublicStoreById(storeId);
      if (!store) return failure(404, 'Pharmacy not found.');
      if (store.latitude == null || store.longitude == null || !Number.isFinite(Number(store.latitude)) || Math.abs(Number(store.latitude)) > 90 || !Number.isFinite(Number(store.longitude)) || Math.abs(Number(store.longitude)) > 180) return failure(409, 'Pharmacy coordinates are unavailable.');
      try {
        if (!routePlanner) throw new Error('Routing unavailable');
        return success(await routePlanner({ latitude, longitude }, { latitude: Number(store.latitude), longitude: Number(store.longitude) }, actorId));
      } catch {
        return failure(503, 'Road route unavailable. Try again shortly or open Google Maps.');
      }
    },
    async listMedicines(query = {}) {
      const search = String(query.search ?? query.q ?? '').trim();
      const category = String(query.category || '').trim();
      const rawStoreId = query.storeId ?? query.drugstoreId;
      const storeId = rawStoreId === undefined ? null : validId(rawStoreId);
      if (rawStoreId !== undefined && storeId === null) return failure(400, 'Invalid pharmacy ID.');
      const limit = boundedInt(query.limit, 30, 1, 50);
      const offset = boundedInt(query.offset, 0, 0, 1000);
      const hasLatitude = query.latitude !== undefined;
      const hasLongitude = query.longitude !== undefined;
      if (hasLatitude !== hasLongitude) return failure(400, 'Latitude and longitude must be provided together.');
      const latitude = hasLatitude ? Number(query.latitude) : null;
      const longitude = hasLongitude ? Number(query.longitude) : null;
      if (hasLatitude && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) return failure(400, 'Invalid latitude.');
      if (hasLongitude && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) return failure(400, 'Invalid longitude.');
      return success(await repository.searchAvailableMedicines({
        search, category, storeId, limit, offset,
        includeCatalog: query.view === 'catalog', latitude, longitude,
      }));
    },

    async getMedicine(idValue) {
      const medicineId = validId(idValue);
      if (!medicineId) return failure(400, 'Invalid medicine ID.');
      const medicine = await repository.findMedicineById(medicineId);
      if (!medicine) return failure(404, 'Medicine not found.');
      const [inventory, evidence] = await Promise.all([
        repository.findMedicineInventoryById(medicineId),
        repository.listMedicineEvidence(medicineId),
      ]);
      return success({ ...medicine, inventory, evidence });
    },

    async listStores() {
      const rows = await repository.listActiveStores();
      return success(rows.map((store) => publicStore(store, now())));
    },

    async nearbyStores(query = {}) {
      const manual = String(query.q || '').trim();
      const latitudeProvided = query.latitude !== undefined && query.latitude !== null && String(query.latitude) !== '';
      const longitudeProvided = query.longitude !== undefined && query.longitude !== null && String(query.longitude) !== '';
      const limit = boundedInt(query.limit, 20, 1, 50);

      if (latitudeProvided !== longitudeProvided) {
        return failure(400, 'Latitude and longitude must be provided together.');
      }

      if (!latitudeProvided && !longitudeProvided) {
        if (!manual) return failure(400, 'Location is unavailable. Use manual pharmacy or address search.');
        const rows = await repository.searchPublicStores({ query: manual, limit });
        return success({ mode: 'manual', query: manual, stores: rows.map((store) => publicStore(store, now())) });
      }

      const latitude = Number(query.latitude);
      const longitude = Number(query.longitude);
      const radiusKm = Number(query.radiusKm ?? 5);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return failure(400, 'Invalid latitude.');
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return failure(400, 'Invalid longitude.');
      if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 25) return failure(400, 'radiusKm must be between 0 and 25.');

      const rows = await repository.findNearbyStores({
        latitude,
        longitude,
        radiusMeters: Math.round(radiusKm * 1000),
        limit,
      });
      return success({
        mode: 'coordinates',
        center: { latitude, longitude },
        radiusKm,
        stores: rows.map((store) => publicStore(store, now())),
      });
    },

    async getStore(idValue) {
      const storeId = validId(idValue);
      if (!storeId) return failure(400, 'Invalid drugstore ID.');
      const store = await repository.findPublicStoreById(storeId);
      if (!store) return failure(404, 'Drugstore not found.');
      return success(publicStore({ ...store, store_id: store.id, store_name: store.name }, now()));
    },

    async getStoreInventory(idValue, query = {}) {
      const storeId = validId(idValue);
      if (!storeId) return failure(400, 'Invalid drugstore ID.');
      const store = await repository.findPublicStoreById(storeId);
      if (!store) return failure(404, 'Drugstore not found.');
      const inventory = await repository.listStoreInventory(storeId, { includeCatalog: query.view === 'catalog' });
      return success({
        store: publicStore({ ...store, store_id: store.id, store_name: store.name }, now()),
        inventory,
      });
    },

    async listAdminPharmacies() {
      const [rows, salesRows] = await Promise.all([
        repository.listAdminPharmacies(),
        repository.listDrugstoreSales(),
      ]);
      const salesMap = new Map(salesRows.map((row) => [
        Number(row.drugstoreId),
        { totalOrders: Number(row.totalOrders), totalSales: Number(row.totalSales) },
      ]));

      return success(rows.map((store) => {
        const id = Number(store.store_id);
        const sales = salesMap.get(id) || { totalOrders: 0, totalSales: 0 };
        return {
          id,
          store_id: id,
          slug: pharmacySlug(store.name),
          name: store.name,
          address: store.address,
          status: Number(store.is_active) === 1 ? 'active' : 'inactive',
          latitude: store.latitude,
          longitude: store.longitude,
          operatingHours: store.operating_hours,
          verificationStatus: store.verificationStatus,
          verifiedAt: store.verifiedAt,
          publicProfilePublishedAt: store.publicProfilePublishedAt,
          licenseNumber: store.licenseNumber,
          evidenceReference: store.evidenceReference,
          verificationNotes: store.verificationNotes,
          reviewedBy: store.reviewedBy,
          reviewedAt: store.reviewedAt,
          totalOrders: sales.totalOrders,
          totalSales: sales.totalSales,
          createdAt: store.created_at,
          accountNo: store.accountNo == null ? null : Number(store.accountNo),
          subscriptionTier: store.subscriptionTier ?? null,
          partnershipStartedAt: store.created_at,
          partnershipExpiresAt: partnershipExpiry(store.created_at, store.subscriptionTier),
        };
      }));
    },

    async createPharmacy(actorId, body = {}) {
      const name = String(body.name || '').trim();
      const address = String(body.address || '').trim();
      const latitude = Number(body.latitude);
      const longitude = Number(body.longitude);

      if (!name) return failure(400, 'Drugstore name is required.');
      if (!address) return failure(400, 'Drugstore address is required.');
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return failure(400, 'Invalid latitude.');
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return failure(400, 'Invalid longitude.');

      const isActive = body.status === 'inactive' || body.isActive === false ? 0 : 1;
      const operatingHours = body.operatingHours ?? body.operating_hours ?? null;
      const drugstoreId = await repository.createDrugstore({ name, address, latitude, longitude, operatingHours, isActive });
      await repository.appendAudit(actorId, 'CREATE_DRUGSTORE', `Created drugstore ${name} (verified, not live until the admin publishes it).`);

      return success({
        id: drugstoreId,
        store_id: drugstoreId,
        name,
        address,
        latitude,
        longitude,
        operatingHours,
        status: isActive === 1 ? 'active' : 'inactive',
        verificationStatus: 'verified',
        publicProfilePublishedAt: null,
      }, 201);
    },

    async updatePharmacy(actorId, idValue, body = {}) {
      const drugstoreId = validId(idValue);
      if (!drugstoreId) return failure(400, 'Invalid drugstore ID.');
      const existing = await repository.findStoreById(drugstoreId);
      if (!existing) return failure(404, 'Drugstore not found.');

      const name = body.name !== undefined ? String(body.name).trim() : existing.name;
      const address = body.address !== undefined ? String(body.address).trim() : existing.address;
      const latitude = body.latitude !== undefined ? Number(body.latitude) : Number(existing.latitude);
      const longitude = body.longitude !== undefined ? Number(body.longitude) : Number(existing.longitude);
      const operatingHours = body.operatingHours !== undefined
        ? body.operatingHours
        : body.operating_hours !== undefined ? body.operating_hours : existing.operating_hours;
      let isActive = Number(existing.is_active);
      if (body.isActive !== undefined) isActive = body.isActive ? 1 : 0;
      if (body.status !== undefined) isActive = body.status === 'inactive' ? 0 : 1;

      if (!name) return failure(400, 'Drugstore name cannot be empty.');
      if (!address) return failure(400, 'Drugstore address cannot be empty.');
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return failure(400, 'Invalid latitude.');
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return failure(400, 'Invalid longitude.');

      await repository.updateDrugstore(drugstoreId, { name, address, latitude, longitude, operatingHours, isActive });
      await repository.appendAudit(actorId, 'UPDATE_DRUGSTORE', `Updated drugstore ${drugstoreId}.`);

      return success({
        id: drugstoreId,
        store_id: drugstoreId,
        name,
        address,
        latitude,
        longitude,
        operatingHours,
        status: isActive === 1 ? 'active' : 'inactive',
        verificationStatus: existing.verification_status,
        verifiedAt: existing.verified_at,
        publicProfilePublishedAt: existing.public_profile_published_at,
      });
    },

    async verifyPharmacy(actorId, idValue, body = {}) {
      const drugstoreId = validId(idValue);
      if (!drugstoreId) return failure(400, 'Invalid drugstore ID.');
      const store = await repository.findStoreById(drugstoreId);
      if (!store) return failure(404, 'Drugstore not found.');

      const status = String(body.status || '').trim();
      const licenseNumber = String(body.licenseNumber || '').trim() || null;
      const evidenceReference = String(body.evidenceReference || '').trim() || null;
      const notes = String(body.notes || '').trim() || null;
      const publish = body.publish === true;

      if (!['pending', 'verified', 'rejected'].includes(status)) return failure(400, 'Invalid verification status.');
      if (status === 'verified' && (!licenseNumber || !evidenceReference)) {
        return failure(400, 'Verified pharmacies require a license number and evidence reference.');
      }
      if (publish && status !== 'verified') return failure(400, 'Only verified pharmacies can be published.');

      await repository.setPharmacyVerification({
        drugstoreId, status, licenseNumber, evidenceReference, notes, reviewedBy: actorId, publish,
      });
      await repository.appendAudit(actorId, 'VERIFY_DRUGSTORE', `Set drugstore ${drugstoreId} verification to ${status}; public=${publish}.`);
      return success({
        id: drugstoreId,
        verificationStatus: status,
        publicProfilePublished: status === 'verified' && publish,
      });
    },

    async goLiveChecklist(idValue, { partnerAccounts = 0 } = {}) {
      const drugstoreId = validId(idValue);
      if (!drugstoreId) return failure(400, 'Invalid drugstore ID.');
      const facts = await repository.getGoLiveFacts(drugstoreId);
      if (!facts) return failure(404, 'Drugstore not found.');
      const result = evaluateGoLive({ ...facts, partnerAccounts });
      return success({ drugstoreId, name: facts.name, live: Boolean(facts.publishedAt), ...result });
    },

    async setGoLive(actorId, idValue, body = {}, { partnerAccounts = 0 } = {}) {
      const drugstoreId = validId(idValue);
      if (!drugstoreId) return failure(400, 'Invalid drugstore ID.');
      if (typeof body.live !== 'boolean') return failure(400, 'Choose whether the pharmacy goes live or is taken down.');
      const facts = await repository.getGoLiveFacts(drugstoreId);
      if (!facts) return failure(404, 'Drugstore not found.');
      if (body.live) {
        const { canGoLive, checks } = evaluateGoLive({ ...facts, partnerAccounts });
        if (!canGoLive) return failure(409, `Not ready to go live: ${checks.filter((check) => !check.ok).map((check) => check.label).join('; ')}.`);
      }
      if (!(await repository.setPublication(drugstoreId, body.live))) return failure(409, 'Only active, verified pharmacies can be published.');
      await repository.appendAudit(actorId, body.live ? 'PHARMACY_GO_LIVE' : 'PHARMACY_TAKE_DOWN',
        `${body.live ? 'Published' : 'Took down'} pharmacy ${drugstoreId} (${facts.name}).`);
      return success({ drugstoreId, live: body.live });
    },

    async deactivatePharmacy(actorId, idValue) {
      const drugstoreId = validId(idValue);
      if (!drugstoreId) return failure(400, 'Invalid drugstore ID.');
      const affected = await repository.deactivateDrugstore(drugstoreId);
      if (affected === 0) return failure(404, 'Drugstore not found.');
      await repository.appendAudit(actorId, 'DEACTIVATE_DRUGSTORE', `Deactivated drugstore ${drugstoreId}.`);
      return success({ success: true, id: drugstoreId, status: 'inactive' });
    },

    async listMasterMedicines() {
      const rows = await repository.listMasterMedicines();
      return success(stagingTestLabels ? rows.map((row) => ({ ...row, testLabelsAllowed: true })) : rows);
    },

    async createMedicine(actorId, body = {}) {
      const input = adminMedicineInput(body);
      if (!input.brand) return failure(400, 'Brand name is required.');
      const medicineId = await repository.createMedicine({
        brandName: input.brand,
        genericName: input.generic,
        dosageForm: input.form,
        category: input.category,
        description: input.description,
      });
      await repository.appendAudit(actorId, 'CREATE_MEDICINE', `Created draft OTC medicine ${input.brand}.`);
      return success({
        id: medicineId,
        brandName: input.brand,
        genericName: input.generic,
        dosageForm: input.form,
        category: input.category,
        description: input.description,
        publicationStatus: 'draft',
      }, 201);
    },

    async updateMedicine(actorId, idValue, body = {}) {
      const medicineId = validId(idValue);
      if (!medicineId) return failure(400, 'Invalid medicine ID.');
      const existing = await repository.findMasterMedicineById(medicineId);
      if (!existing) return failure(404, 'Medicine not found.');
      const input = adminMedicineInput(body, existing);
      if (!input.brand) return failure(400, 'Brand name is required.');
      if (input.description?.includes('[NEARPILL_STAGING_TEST_APPROVAL:') &&
          (!stagingTestLabels || !['Prescription', 'Non-prescription', 'Non-medicine', 'Prescription (source list)', 'Non-Prescription (source list)', 'Medical Supplies', 'Classification Needs Review'].includes(existing.category) || existing.publication_status !== 'draft' || existing.otc_eligible !== false ||
           Object.keys(body).some((key) => key !== 'description') || !input.description.includes('[NEARPILL_STAGING_TEST_APPROVAL:afqqozfjpiodanpogvfb]'))) {
        return failure(403, 'Test labels are restricted to description-only updates on imported staging drafts.');
      }

      await repository.updateMedicine(medicineId, {
        brandName: input.brand,
        genericName: input.generic,
        dosageForm: input.form,
        category: input.category,
        description: input.description,
      });
      await repository.appendAudit(actorId, 'UPDATE_MEDICINE', `Updated master medicine ${medicineId}.`);
      return success({
        id: medicineId,
        brandName: input.brand,
        genericName: input.generic,
        dosageForm: input.form,
        category: input.category,
        description: input.description,
        publicationStatus: existing.publication_status,
      });
    },

    async listMedicineEvidence(idValue) {
      const medicineId = validId(idValue);
      if (!medicineId) return failure(400, 'Invalid medicine ID.');
      if (!(await repository.findMasterMedicineById(medicineId))) return failure(404, 'Medicine not found.');
      return success(await repository.listAdminMedicineEvidence(medicineId));
    },

    async addMedicineEvidence(actorId, idValue, body = {}) {
      const medicineId = validId(idValue);
      if (!medicineId) return failure(400, 'Invalid medicine ID.');
      if (!(await repository.findMasterMedicineById(medicineId))) return failure(404, 'Medicine not found.');
      const sourceName = String(body.sourceName || '').trim();
      const sourceUrl = String(body.sourceUrl || '').trim();
      const sourceVersion = String(body.sourceVersion || '').trim() || null;
      const status = String(body.status || 'approved');
      if (!sourceName || !sourceUrl) return failure(400, 'Evidence source name and URL are required.');
      if (!['approved', 'rejected'].includes(status)) return failure(400, 'Invalid evidence status.');
      const evidenceId = await repository.addMedicineEvidence({
        medicineId, sourceName, sourceUrl, sourceVersion, status, reviewedBy: actorId,
      });
      await repository.appendAudit(actorId, 'ADD_MEDICINE_EVIDENCE', `Added ${status} evidence ${evidenceId} for medicine ${medicineId}.`);
      return success({ id: evidenceId, medicineId, sourceName, sourceUrl, sourceVersion, status }, 201);
    },

    async setMedicinePublication(actorId, idValue, body = {}) {
      const medicineId = validId(idValue);
      if (!medicineId) return failure(400, 'Invalid medicine ID.');
      const medicine = await repository.findMasterMedicineById(medicineId);
      if (!medicine) return failure(404, 'Medicine not found.');
      const status = String(body.status || '').trim();
      if (!['draft', 'published', 'retired'].includes(status)) return failure(400, 'Invalid publication status.');
      const reviewReference = typeof body.reviewReference === 'string' ? body.reviewReference.trim() : '';
      if (body.reviewReference !== undefined && (status !== 'published' || !reviewReference || reviewReference.length > 500)) {
        return failure(400, 'Enter a review reference of up to 500 characters to publish.');
      }
      const category = String(medicine.category || '').trim().toLowerCase();
      if (status === 'published' && ['prescription', 'prescriptions', 'prescription (source list)', 'classification needs review'].includes(category)) {
        return failure(409, 'Resolve the product classification before publishing for standard checkout.');
      }
      if (status === 'published' && medicine.otc_eligible !== true && !reviewReference) {
        return failure(409, 'A reviewed OTC eligibility decision is required before publication.');
      }
      if (reviewReference && (medicine.publication_status !== 'draft' || medicine.otc_eligible === true || ![
        'non-prescription', 'non-prescriptions', 'non - prescriptions', 'non-prescription (source list)', 'general otc', 'otc',
        'medical supplies', 'non-medicine', 'non-medicines', 'non medicine', 'non medicines',
      ].includes(category))) return failure(409, 'Only an unapproved draft classified as non-prescription or non-medicine can be approved here.');
      if (status === 'published' && await repository.countApprovedMedicineEvidence(medicineId) < 1) {
        return failure(409, 'At least one approved evidence source is required before publication.');
      }
      const updated = reviewReference
        ? await repository.updateMedicinePublication(medicineId, status, reviewReference, medicine.category)
        : await repository.updateMedicinePublication(medicineId, status);
      if (updated === 0) return failure(409, 'The catalogue record changed. Refresh and review it again.');
      await repository.appendAudit(actorId, 'SET_MEDICINE_PUBLICATION', `Set medicine ${medicineId} publication to ${status}.`);
      return success({ id: medicineId, publicationStatus: status });
    },
  });
}
