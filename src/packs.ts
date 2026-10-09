// Sound packs the GM owns, mapped onto the soundboard's buttons (src/packs/*.json,
// built by tools/build_pack_*.py). Only the mapping ships with the extension; the
// GM picks their own pack folder once and the mapped files are kept in this browser.
import { db } from "./db";
import leohpaz from "./packs/leohpaz.json";
import { Sound, setPack } from "./sfx";

interface PackFile { p: string; g: number }
interface PackManifest {
  id: string;
  title: string;
  folder: string;
  slots: Record<string, PackFile[]>;
  extras: { id: string; name: string; cat: string; loop: boolean; tags: string[]; files: PackFile[]; staple?: boolean }[];
}
export const PACKS = [leohpaz as PackManifest];
export interface PackState { id: string; title: string; imported: number; missing: string[]; at: string }

const key = (pack: PackManifest, path: string) => `${pack.id}/${path}`;
const neededFiles = (pack: PackManifest) =>
  [...new Set([...Object.values(pack.slots).flat(), ...pack.extras.flatMap((x) => x.files)].map((f) => f.p))];

function activate(pack: PackManifest, have: Set<string>) {
  const ok = (f: PackFile) => have.has(f.p);
  const slots: Record<string, { files: string[]; gains: number[] }> = {};
  for (const [id, files] of Object.entries(pack.slots)) {
    const f = files.filter(ok);
    if (f.length) slots[id] = { files: f.map((x) => `pack:${key(pack, x.p)}`), gains: f.map((x) => x.g) };
  }
  const extras: Sound[] = pack.extras
    .map((x) => ({ x, f: x.files.filter(ok) }))
    .filter(({ f }) => f.length)
    .map(({ x, f }) => ({
      id: x.id, name: x.name, cat: x.cat, tags: x.tags, loop: x.loop, credit: [], packed: true, staple: x.staple,
      files: f.map((y) => `pack:${key(pack, y.p)}`), gains: f.map((y) => y.g),
    }));
  setPack({ slots, extras });
}

export const packState = () => db.get<PackState>("kv", "soundpack").catch(() => undefined);

/** Load the imported pack (if any) into the soundboard. Call once at start-up. */
export async function initPack() {
  const st = await packState();
  const pack = PACKS.find((p) => p.id === st?.id);
  if (!st || !pack) return;
  const missing = new Set(st.missing);
  activate(pack, new Set(neededFiles(pack).filter((p) => !missing.has(p))));
}

/** Pick out the mapped files from the folder the GM chose (any level above or at the pack folder). */
export async function importPack(packId: string, files: FileList | File[], progress?: (done: number, total: number) => void) {
  const pack = PACKS.find((p) => p.id === packId);
  if (!pack) throw new Error("Unknown sound pack");
  const byPath = new Map<string, File>();
  for (const f of files) {
    const rel = ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split("/");
    // register every suffix, so choosing _Sounds itself or a folder above it both work
    for (let i = 0; i < rel.length; i++) byPath.set(rel.slice(i).join("/"), f);
  }
  const need = neededFiles(pack);
  const found = need.filter((p) => byPath.has(p));
  if (!found.length) throw new Error(`None of the ${pack.title} files are in that folder — choose your “${pack.folder}” folder.`);
  let n = 0;
  for (const p of found) {
    await db.put("files", `pack/${key(pack, p)}`, byPath.get(p)!);
    progress?.(++n, found.length);
  }
  const missing = need.filter((p) => !byPath.has(p));
  const st: PackState = { id: pack.id, title: pack.title, imported: found.length, missing, at: new Date().toISOString() };
  await db.put("kv", "soundpack", st);
  activate(pack, new Set(found));
  return st;
}

/** Back to the built-in sounds (the imported files are removed from this browser). */
export async function removePack() {
  const st = await packState();
  const pack = PACKS.find((p) => p.id === st?.id);
  if (pack) for (const p of neededFiles(pack)) await db.del("files", `pack/${key(pack, p)}`).catch(() => {});
  await db.del("kv", "soundpack");
  setPack(null);
}
