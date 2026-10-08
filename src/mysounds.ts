// "My sounds": audio files the GM imports from their own computer (e.g. purchased
// packs). They're stored in this browser only — like the library folder — and play
// on this computer only. Nothing is uploaded anywhere.
import { db } from "./db";
import { Sound, setMySounds } from "./sfx";

export interface MySound { id: string; name: string; loop: boolean; tags: string[]; type: string; size: number }

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm)$/i;
const LOOPY = /(loop|ambien|ambience|amb[_ -]|atmos|background|bg[_ -]|soundscape|room ?tone|drone|bed[_ -])/i;
const STOP = new Set(["the", "and", "with", "from", "for", "sfx", "sound", "sounds", "effect", "effects", "audio", "wav", "mp3", "ogg",
  "loop", "loops", "looped", "seamless", "version", "var", "variation", "mix", "full", "short", "long", "pack", "library", "free", "royalty",
  "stereo", "mono", "khz", "bit", "hd", "sd", "one", "shot", "oneshot"]);

const slug = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pretty = (file: string) =>
  file.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").replace(/\s+\d+$/, "").replace(/\s+/g, " ").trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
/** Keywords from the file and folder names, so the board can suggest them for matching maps. */
function tagsFrom(path: string): string[] {
  const words = path.replace(/\.[a-z0-9]+$/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/);
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)))];
}

function duration(file: Blob): Promise<number> {
  return new Promise((res) => {
    const a = new Audio();
    const url = URL.createObjectURL(file);
    const done = (d: number) => { URL.revokeObjectURL(url); res(d); };
    a.preload = "metadata";
    a.onloadedmetadata = () => done(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 5000);
    a.src = url;
  });
}

export async function listMySounds(): Promise<MySound[]> {
  return (await db.get<MySound[]>("kv", "mysounds").catch(() => undefined)) ?? [];
}

async function save(list: MySound[]) {
  await db.put("kv", "mysounds", list);
  publish(list);
}

function publish(list: MySound[]) {
  setMySounds(list.map((m): Sound => ({ id: m.id, name: m.name, cat: "My sounds", files: [m.id], tags: m.tags, credit: [], loop: m.loop, local: true })));
}

/** Load the stored list into the soundboard (call once at start-up). */
export async function initMySounds() {
  publish(await listMySounds());
}

/** Import audio files (a multi-file pick or a whole folder). Re-importing a file replaces it. */
export async function importSounds(files: FileList | File[], progress?: (done: number, total: number) => void) {
  const audio = [...files].filter((f) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name));
  const list = await listMySounds();
  let n = 0;
  for (const f of audio) {
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const id = `my:${slug(f.name)}`;
    const secs = await duration(f);
    const entry: MySound = {
      id,
      name: pretty(f.name),
      loop: LOOPY.test(path) || secs >= 25,
      tags: tagsFrom(path),
      type: f.type || "audio/mpeg",
      size: f.size,
    };
    await db.put("files", `mysounds/${id}`, f);
    const i = list.findIndex((m) => m.id === id);
    if (i >= 0) list[i] = { ...entry, loop: list[i].loop, name: list[i].name };
    else list.push(entry);
    progress?.(++n, audio.length);
  }
  await save(list);
  return { added: n, skipped: files.length - audio.length };
}

export async function deleteMySound(id: string) {
  await db.del("files", `mysounds/${id}`);
  await save((await listMySounds()).filter((m) => m.id !== id));
}

export async function setMySoundLoop(id: string, loop: boolean) {
  await save((await listMySounds()).map((m) => (m.id === id ? { ...m, loop } : m)));
}
