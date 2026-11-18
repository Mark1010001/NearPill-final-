import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

function normalizeActor(actor = {}) {
  const userId = Number(actor.userId);
  return {
    userId: Number.isInteger(userId) && userId > 0 ? userId : null,
    role: String(actor.role || 'anonymous'),
    capability: actor.capability ? String(actor.capability) : null,
  };
}


export function currentDatabaseActor() {
  return normalizeActor(storage.getStore());
}

export function setCurrentDatabaseActor(actor = {}) {
  const current = storage.getStore();
  if (!current) return;
  Object.assign(current, normalizeActor({ ...current, ...actor }));
}

export function runWithDatabaseActor(actor, work) {
  return storage.run(normalizeActor(actor), work);
}

export async function applyDatabaseActor(client, overrides = {}) {
  const actor = normalizeActor({ ...currentDatabaseActor(), ...overrides });
  await client.query(
    `SELECT
       set_config('app.user_id', $1, true),
       set_config('app.role', $2, true),
       set_config('app.capability', $3, true)`,
    [actor.userId ? String(actor.userId) : '', actor.role, actor.capability || ''],
  );
  return actor;
}
