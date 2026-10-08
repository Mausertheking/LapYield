// Session storage in IndexedDB (on this phone only). Falls back to memory if unavailable.
const DB_NAME = 'ecoline';
const STORE = 'sessions';
let dbPromise = null;
const memory = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch (e) { resolve(null); }
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  if (!db) return fn(null);
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}
const req2p = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function saveSession(session) {
  return tx('readwrite', (store) => {
    if (!store) { memory.set(session.id, structuredClone(session)); return; }
    return req2p(store.put(session));
  });
}

export async function getSession(id) {
  return tx('readonly', (store) => (store ? req2p(store.get(id)) : memory.get(id)));
}

export async function deleteSession(id) {
  return tx('readwrite', (store) => (store ? req2p(store.delete(id)) : memory.delete(id)));
}

/** Lightweight list (no point arrays), newest first. */
export async function listSessions() {
  const all = await tx('readonly', (store) => (store ? req2p(store.getAll()) : [...memory.values()]));
  return (all || []).map(s => ({
    id: s.id, startedAt: s.startedAt, status: s.status, kart: s.kart,
    nPoints: s.points ? s.points.length : 0, summary: s.summary || null,
  })).sort((a, b) => b.startedAt - a.startedAt);
}
