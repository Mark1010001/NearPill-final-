-- Lets a signed-in administrator create a partner pharmacy login. The backend still inserts only name, email,
-- password hash and role; the role must be 'partner' and the actor must be an administrator.
DROP POLICY IF EXISTS users_insert_partner_by_admin ON users;
CREATE POLICY users_insert_partner_by_admin ON users FOR INSERT TO nearpill_app WITH CHECK (
  nearpill.current_actor_role() = 'admin'
  AND nearpill.current_capability() = 'identity_security'
  AND role = 'partner'
);
