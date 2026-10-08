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

// Safari can't reliably keep Blobs in IndexedDB (WebKit bug 235687: blobs read
// back and saved again fail with "WebKitBlobResource error 1"), so files are
// stored as raw bytes and turned back into Blobs on the way out.
interface StoredBytes {
  __bytes: true;
  type: string;
  buf: ArrayBuffer;
}
const isBytes = (v: unknown): v is StoredBytes => !!v && typeof v === "object" && (v as StoredBytes).__bytes === true;

async function encode(v: unknown): Promise<unknown> {
  if (v instanceof Blob) return { __bytes: true, type: v.type, buf: await v.arrayBuffer() } satisfies StoredBytes;
  return v;
}
function decode<T>(v: unknown): T {
  return (isBytes(v) ? new Blob([v.buf], { type: v.type }) : v) as T;
}

export const db = {
  get: <T = unknown>(store: Store, key: string) => tx<unknown>(store, "readonly", (s) => s.get(key)).then((v) => decode<T>(v)),
  put: async (store: Store, key: string, value: unknown) => {
    const enc = await encode(value);
    return tx(store, "readwrite", (s) => s.put(enc, key));
  },
  del: (store: Store, key: string) => tx(store, "readwrite", (s) => s.delete(key)),
  keys: (store: Store) => tx<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys()).then((k) => k.map(String)),
  clear: (store: Store) => tx(store, "readwrite", (s) => s.clear()),
  async putMany(store: Store, entries: [string, unknown][]) {
    // encode first: awaiting inside a transaction would let it auto-commit
    const enc: [string, unknown][] = [];
    for (const [k, v] of entries) enc.push([k, await encode(v)]);
    const d = await open();
    await new Promise<void>((resolve, reject) => {
      const t = d.transaction(store, "readwrite");
      const s = t.objectStore(store);
      for (const [k, v] of enc) s.put(v, k);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  },
  /** True if a stored file can actually be read (old Blob entries may be broken in Safari). */
  async readable(store: Store, key: string): Promise<boolean> {
    try {
      const v = await tx<unknown>(store, "readonly", (s) => s.get(key));
      if (v === undefined) return false;
      if (isBytes(v)) return v.buf.byteLength > 0;
      if (v instanceof Blob) return (await v.slice(0, 16).arrayBuffer()).byteLength > 0;
      return true;
    } catch {
      return false;
    }
  },
};
