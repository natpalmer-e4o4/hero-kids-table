// Loading the extracted library folder into this browser's IndexedDB.
import { db } from "./db";
import type { LibraryIndexEntry, Product } from "./types";

export async function loadFolder(files: FileList, onProgress: (done: number, total: number, label: string) => void) {
  const list = Array.from(files);
  const libFile = list.find((f) => f.webkitRelativePath.endsWith("library.json") || f.name === "library.json");
  if (!libFile) throw new Error("That folder has no library.json — pick the “_Owlbear Library” folder.");
  const root = libFile.webkitRelativePath.slice(0, -"library.json".length);
  const index = JSON.parse(await libFile.text()) as { products: LibraryIndexEntry[] };
  const wanted = list.filter((f) => {
    const rel = f.webkitRelativePath.slice(root.length);
    return /^[^/]+\/(product\.json|maps\/|cards\/|tokens\/)/.test(rel);
  });
  let done = 0;
  const batch: [string, unknown][] = [];
  const flush = async () => {
    if (batch.length) await db.putMany("files", batch.splice(0));
  };
  for (const f of wanted) {
    const rel = f.webkitRelativePath.slice(root.length);
    if (rel.endsWith("product.json")) {
      const p = JSON.parse(await f.text()) as Product;
      await db.put("products", p.id, p);
    } else {
      const type = rel.endsWith(".webp") ? "image/webp" : rel.endsWith(".png") ? "image/png" : "image/jpeg";
      batch.push([rel, new Blob([await f.arrayBuffer()], { type })]);
      if (batch.length >= 40) await flush();
    }
    done++;
    if (done % 10 === 0 || done === wanted.length) onProgress(done, wanted.length, rel.split("/")[0]);
  }
  await flush();
  await db.put("kv", "library", { products: index.products, loadedAt: new Date().toISOString() });
  return index.products;
}

export async function loadedIndex(): Promise<LibraryIndexEntry[]> {
  const v = await db.get<{ products: LibraryIndexEntry[] }>("kv", "library");
  return v?.products ?? [];
}

const cache = new Map<string, Product>();
export async function product(id: string): Promise<Product | undefined> {
  if (!cache.has(id)) {
    const p = await db.get<Product>("products", id);
    if (p) cache.set(id, p);
  }
  return cache.get(id);
}

export async function allProducts(): Promise<Product[]> {
  const idx = await loadedIndex();
  const out: Product[] = [];
  for (const e of idx) {
    const p = await product(e.id);
    if (p) out.push(p);
  }
  return out;
}
