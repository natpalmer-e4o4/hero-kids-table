// Tiny IndexedDB wrapper. The library (text + images) lives only in the GM's
// browser; nothing from the books is ever sent anywhere except the GM's own
// Owlbear storage when they choose to upload.

const DB_NAME = "hero-kids-table";
const STORES = ["files", "products", "kv"] as const;
type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      // some browsers never answer IndexedDB inside third-party iframes: fail fast
      const timer = setTimeout(() => reject(new Error("This browser is blocking storage for extensions (IndexedDB). Try Chrome or Firefox, or allow cross-site storage.")), 5000);
      let req: IDBOpenDBRequest;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        clearTimeout(timer);
        return reject(e);
      }
      req.onupgradeneeded = () => {
        for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
      };
      req.onsuccess = () => (clearTimeout(timer), resolve(req.result));
      req.onerror = () => (clearTimeout(timer), reject(req.error));
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

function tx<T>(store: Store, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const r = fn(t.objectStore(store));
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      }),
  );
}

export const db = {
  get: <T = unknown>(store: Store, key: string) => tx<T>(store, "readonly", (s) => s.get(key) as IDBRequest<T>),
  put: (store: Store, key: string, value: unknown) => tx(store, "readwrite", (s) => s.put(value, key)),
  del: (store: Store, key: string) => tx(store, "readwrite", (s) => s.delete(key)),
  keys: (store: Store) => tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()).then((k) => k.map(String)),
  clear: (store: Store) => tx(store, "readwrite", (s) => s.clear()),
  async putMany(store: Store, entries: [string, unknown][]) {
    const d = await open();
    await new Promise<void>((resolve, reject) => {
      const t = d.transaction(store, "readwrite");
      const s = t.objectStore(store);
      for (const [k, v] of entries) s.put(v, k);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
};
