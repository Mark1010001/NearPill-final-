// Go-live checklist for a partner pharmacy. Every check is computed from stored facts, so the admin cannot
// publish a pharmacy that is missing something customers need.
const present = (value) => String(value ?? '').trim().length > 0;
const coordinate = (value, min, max) => {
  if (value === null || value === undefined || String(value).trim() === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
};

export function evaluateGoLive(facts) {
  const checks = [
    {
      id: 'details', label: 'Pharmacy details are complete',
      ok: present(facts.name) && present(facts.address) && present(facts.operatingHours),
      hint: 'Add the name, address and operating hours (Partner pharmacies, Edit storefront).',
    },
    {
      id: 'location', label: 'Map location is inside the Philippines',
      ok: coordinate(facts.latitude, 4, 22) && coordinate(facts.longitude, 116, 128),
      hint: 'Check the latitude and longitude. They may be blank or swapped.',
    },
    {
      id: 'account', label: 'Account No. is assigned and the name is not used by another pharmacy',
      ok: Number(facts.accountNo) > 0 && Number(facts.duplicateNames) === 0,
      hint: 'Rename the pharmacy if another active pharmacy has the same name.',
    },
    {
      id: 'verified', label: 'Pharmacy is verified and active',
      ok: facts.verificationStatus === 'verified' && Number(facts.isActive) === 1,
      hint: 'Verify the pharmacy first, or restore it if it was removed.',
    },
    {
      id: 'login', label: 'Partner login exists',
      ok: Number(facts.partnerAccounts) > 0,
      hint: 'Create the partner account (Partner pharmacy accounts, Add partner pharmacy).',
    },
    {
      id: 'plan', label: 'A subscription plan is active',
      ok: Number(facts.activePlans) > 0,
      hint: 'Assign a plan (Subscriptions).',
    },
    {
      id: 'stock', label: 'At least one approved item has stock, a price and a selling unit',
      ok: Number(facts.stockedItems) > 0,
      hint: 'Ask the pharmacy to upload its stock file in the partner portal.',
    },
  ];
  return { checks, canGoLive: checks.every((check) => check.ok) };
}
