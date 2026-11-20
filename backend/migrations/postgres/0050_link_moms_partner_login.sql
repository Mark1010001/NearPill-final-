-- Gives "Mom's Best Value Pharmacy" back the partner login that was created for it. That login signs in but finds
-- "No active pharmacy membership" because it was never linked to this pharmacy. Only a partner account that has no active
-- pharmacy at all and carries the pharmacy's own name is linked (partner accounts are named after their pharmacy when the
-- admin creates them), so no other account is touched. If no such account or pharmacy exists, nothing changes.
INSERT INTO pharmacy_memberships (user_id, drugstore_id, membership_role, is_active)
SELECT u.id, d.id, 'owner', 1
FROM drugstores d
JOIN users u ON u.role = 'partner' AND replace(u.name, '''', '') = replace(d.name, '''', '')
WHERE replace(d.name, '''', '') = 'Moms Best Value Pharmacy'
  AND NOT EXISTS (SELECT 1 FROM pharmacy_memberships pm WHERE pm.user_id = u.id AND pm.is_active = 1)
ON CONFLICT (user_id, drugstore_id) DO UPDATE SET membership_role = 'owner', is_active = 1;
