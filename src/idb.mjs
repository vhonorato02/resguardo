/** Persistent offline-first storage; uses the original v1 DB to migrate user data in place. */
const DB = 'resguardo-db-v1';
let db;
export function openLocal() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of ['entries', 'files', 'audit', 'meta', 'queue'])
        if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => { db = request.result; db.onversionchange = () => db.close(); resolve(db); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Feche outras abas do aplicativo e atualize.'));
  });
}
export async function getAll(store) {
  await openLocal();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function get(store, key) {
  await openLocal();
  return new Promise((resolve, reject) => {
    const r = db.transaction(store, 'readonly').objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function put(store, value) {
  await openLocal();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).put(value);
    t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
export async function remove(store, key) {
  await openLocal();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    t.objectStore(store).delete(key);
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}
export async function saveSettings(settings) { return put('meta', { id: 'settings', value: settings }); }
export async function loadSettings(fallback) { return { ...fallback, ...(await get('meta', 'settings'))?.value }; }
export async function requestPersistence() {
  return navigator.storage?.persist ? navigator.storage.persist() : false;
}
