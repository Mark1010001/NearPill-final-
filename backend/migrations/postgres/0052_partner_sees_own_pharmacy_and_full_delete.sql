-- 1) Fix: a partner could not see their own pharmacy until it was published. The old rule compared the membership's own id
--    ("pm.drugstore_id = id") instead of the pharmacy's id, so every new, unpublished pharmacy showed "No active pharmacy membership".
DROP POLICY IF EXISTS drugstores_select ON drugstores;
CREATE POLICY drugstores_select ON drugstores FOR SELECT TO nearpill_app
USING (
  (is_active = 1 AND verification_status = 'verified' AND public_profile_published_at IS NOT NULL)
  OR nearpill.current_actor_role() IN ('admin','system')
  OR EXISTS (
    SELECT 1 FROM pharmacy_memberships pm
    WHERE pm.drugstore_id = drugstores.id
      AND pm.user_id = nearpill.current_actor_id()
      AND pm.is_active = 1
  )
);

-- 2) Deleting a pharmacy with no order history now removes the pharmacy and its partner login completely.
--    An administrator may delete partner logins only (never customers or admins).
GRANT DELETE ON users TO nearpill_app;
DROP POLICY IF EXISTS users_admin_delete_partner ON users;
CREATE POLICY users_admin_delete_partner ON users FOR DELETE TO nearpill_app
USING (nearpill.current_actor_role() = 'admin' AND role = 'partner');

-- 3) Remove the leftovers of earlier deletes: "Deleted pharmacy" rows with no orders, and their anonymised partner logins.
DELETE FROM drugstores d
WHERE d.name = 'Deleted pharmacy' AND d.is_active = 0
  AND NOT EXISTS (SELECT 1 FROM order_drugstores od WHERE od.drugstore_id = d.id);
DELETE FROM users u
WHERE u.role = 'partner' AND u.email LIKE 'deleted-partner-%@deleted.invalid'
  AND NOT EXISTS (SELECT 1 FROM pharmacy_memberships pm WHERE pm.user_id = u.id);
