const adminPermissions = new Set([
  'admin:access',
  'pharmacy:manage',
  'inventory:adjust',
  'orders:read:pharmacy',
  'orders:update:pharmacy',
  'subscriptions:manage',
  'reports:view:premium',
]);

const membershipPermissions = Object.freeze({
  owner: new Set(['pharmacy:manage', 'inventory:adjust', 'orders:read:pharmacy', 'orders:update:pharmacy', 'reports:view:premium']),
  manager: new Set(['inventory:adjust', 'orders:read:pharmacy', 'orders:update:pharmacy', 'reports:view:premium']),
  staff: new Set(['inventory:adjust', 'orders:read:pharmacy', 'orders:update:pharmacy']),
});

export function actorHasPermission(actor, permission, drugstoreId = null) {
  if (!actor) return false;
  if (actor.role === 'admin' && adminPermissions.has(permission)) return true;
  if (permission === 'orders:create' || permission === 'orders:read:own') {
    return actor.role === 'customer' || actor.role === 'admin';
  }
  if (!drugstoreId) return false;
  const membership = (actor.memberships || []).find(
    (item) => Number(item.drugstoreId) === Number(drugstoreId) && item.isActive !== false,
  );
  if (!membership) return false;
  return membershipPermissions[membership.membershipRole]?.has(permission) === true;
}
