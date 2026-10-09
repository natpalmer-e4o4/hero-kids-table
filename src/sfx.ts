// Sound playback for the GM's soundboard: CC0 community recordings rehosted with
// the extension (public/sounds, see CREDITS.md); a sound pack the GM owns, mapped
// onto the same buttons and imported into this browser; and "My sounds".
// Pack and My-sounds audio is stored locally only, never uploaded.
import catalog from "./sounds.json";
import { db } from "./db";
import { basePath } from "./shared";

export interface Sound {
  id: string;
  name: string;
  cat: string;
  files: string[];
  tags: string[];
  credit: string[];
  loop?: boolean;
  len?: number;
  local?: boolean; // a My sound: files[0] is its id in this browser's storage
  packed?: boolean; // played from the imported sound pack (files are "pack:<path>")
  gains?: number[]; // per-file level correction in dB
  staple?: boolean; // always suggested (pack buttons like "Encounter!")
}
/** A sound pack mapped onto the board: replacement files per built-in button, plus new buttons. */
export interface ActivePack { slots: Record<string, { files: string[]; gains: number[] }>; extras: Sound[] }
const BUILTIN = catalog.sounds as Sound[];
export const STAPLES = catalog.staples as string[];
export const CREDITS = catalog.credits as Record<string, { title: string; author: string; url: string }>;
let mine: Sound[] = [];
export const setMySounds = (list: Sound[]) => { mine = list; };
let pack: ActivePack | null = null;
export const setPack = (p: ActivePack | null) => { pack = p; buffers.clear(); };
const withPack = (s: Sound): Sound => {
  const o = pack?.slots[s.id];
  return o ? { ...s, files: o.files, gains: o.gains, packed: true } : s;
};
export const allSounds = () => [...mine, ...(pack?.extras ?? []), ...BUILTIN.map(withPack)];
export const categories = () => [...new Set(allSounds().map((s) => s.cat))];
export function sound(id: string): Sound | undefined {
  const b = BUILTIN.find((s) => s.id === id);
  return mine.find((s) => s.id === id) ?? pack?.extras.find((s) => s.id === id) ?? (b && withPack(b));
}
export const soundUrl = (file: string) => `${basePath()}sounds/${file}`;
export const creditsUrl = () => `${basePath()}sounds/CREDITS.md`;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let volume = 0.8;

function audio(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(ctx.destination);
    // iPad suspends audio when the screen sleeps; let the UI offer a new tap
    ctx.onstatechange = () => stateListeners.forEach((cb) => cb());
  }
  return ctx;
}
const stateListeners = new Set<() => void>();
export const onAudioStateChange = (cb: () => void) => (stateListeners.add(cb), () => stateListeners.delete(cb));

/** Call from a click/tap: browsers only allow sound after the person interacts. */
export async function unlockAudio() {
  // iPad: play even when the device is on silent, like a media app would
  try {
    const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (s) s.type = "playback";
  } catch { /* older Safari */ }
  const c = audio();
  if (c.state !== "running") await c.resume().catch(() => {});
  const s = c.createBufferSource();
  s.buffer = c.createBuffer(1, 1, 22050); // a silent blip fully unlocks iOS
  s.connect(c.destination);
  s.start();
  return c.state === "running";
}
export const audioReady = () => ctx?.state === "running";

export function setVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (master && ctx) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
}
export const getVolume = () => volume;

async function localBlob(id: string): Promise<Blob> {
  const key = id.startsWith("pack:") ? `pack/${id.slice(5)}` : `mysounds/${id}`;
  const b = await db.get<Blob>("files", key);
  if (!b) throw new Error(id.startsWith("pack:")
    ? "A sound-pack file is missing from this browser — import your sound pack folder again (Sounds → Edit board)."
    : "That sound's file is missing from this browser — import it again under My sounds.");
  return b;
}
const dbToGain = (db = 0) => Math.pow(10, db / 20);

const buffers = new Map<string, Promise<AudioBuffer>>();
function load(file: string): Promise<AudioBuffer> {
  if (!buffers.has(file)) {
    const bytes = file.startsWith("my:") || file.startsWith("pack:")
      ? localBlob(file).then((b) => b.arrayBuffer())
      : fetch(soundUrl(file)).then((r) => {
          if (!r.ok) throw new Error(`Couldn't load sound ${file} (${r.status})`);
          return r.arrayBuffer();
        });
    const p = bytes.then((b) => new Promise<AudioBuffer>((res, rej) => audio().decodeAudioData(b, res, rej)));
    p.catch(() => buffers.delete(file)); // allow a retry
    buffers.set(file, p);
  }
  return buffers.get(file)!;
}

/** Fetch and decode a set of sounds ahead of time so the first press is instant. */
export function preload(ids: string[]) {
  for (const id of ids) {
    const s = sound(id);
    if (s && !(s.local && s.loop)) for (const f of s.loop ? s.files.slice(0, 1) : s.files) load(f).catch(() => {});
  }
}

const lastVariant = new Map<string, number>();
/** Play a one-shot; picks a different take each press so repeats don't sound robotic. */
export async function play(id: string) {
  const s = sound(id);
  if (!s) return;
  if (s.loop) return void toggleLoop(id);
  let k = Math.floor(Math.random() * s.files.length);
  if (s.files.length > 1 && k === lastVariant.get(id)) k = (k + 1) % s.files.length;
  lastVariant.set(id, k);
  const buf = await load(s.files[k]);
  const c = audio();
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = dbToGain(s.gains?.[k]);
  src.connect(g).connect(master!);
  src.start();
}

interface Playing { gain: GainNode; stop: (at: number) => void; token: object }
const loops = new Map<string, Playing>();
const listeners = new Set<() => void>();
export const onLoopsChange = (cb: () => void) => (listeners.add(cb), () => listeners.delete(cb));
const changed = () => listeners.forEach((cb) => cb());
export const loopOn = (id: string) => loops.has(id);
export const playingLoops = () => [...loops.keys()];

/** Where real audio starts/ends: MP3 encoders pad both ends with a little silence. */
function audibleRange(b: AudioBuffer): [number, number] {
  const d = b.getChannelData(0);
  const lim = Math.min(d.length >> 2, Math.floor(b.sampleRate * 0.2));
  let a = 0;
  while (a < lim && Math.abs(d[a]) < 1e-4) a++;
  let z = d.length - 1;
  while (z > d.length - lim && Math.abs(d[z]) < 1e-4) z--;
  return [a / b.sampleRate, (z + 1) / b.sampleRate];
}

export async function toggleLoop(id: string, on = !loops.has(id)) {
  const s = sound(id);
  if (!s?.loop) return;
  const c = audio();
  const cur = loops.get(id);
  if (!on) {
    if (!cur) return;
    loops.delete(id);
    changed();
    cur.gain.gain.setTargetAtTime(0, c.currentTime, 0.4);
    cur.stop(c.currentTime + 2);
    return;
  }
  if (cur) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(master!);
  const token = {};
  const slot: Playing = { gain, stop: () => {}, token };
  loops.set(id, slot); // claim the slot before the await so double clicks don't stack
  changed();
  const still = () => loops.get(id)?.token === token; // not switched off while loading
  try {
    if (s.local && !s.packed) {
      // imported files can be long (10-minute ambiences): stream them instead of decoding into memory
      const url = URL.createObjectURL(await localBlob(s.files[0]));
      if (!still()) return URL.revokeObjectURL(url);
      const el = new Audio(url);
      el.loop = true;
      c.createMediaElementSource(el).connect(gain);
      await el.play();
      if (!still()) { el.pause(); URL.revokeObjectURL(url); return; }
      slot.stop = (at) => setTimeout(() => { el.pause(); URL.revokeObjectURL(url); }, Math.max(0, at - c.currentTime) * 1000);
    } else {
      const buf = await load(s.files[0]);
      if (!still()) return;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      [src.loopStart, src.loopEnd] = audibleRange(buf);
      src.connect(gain);
      src.start(0, src.loopStart);
      slot.stop = (at) => src.stop(at);
    }
    gain.gain.setTargetAtTime(dbToGain(s.gains?.[0]), c.currentTime, 0.5);
  } catch (e) {
    loops.delete(id);
    changed();
    throw e;
  }
}

export function stopAll() {
  for (const id of playingLoops()) void toggleLoop(id, false);
}

// ---------------------------------------------------------------- boards

const WORD = (t: string) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");

/** Rank sounds by how often their keywords appear in the scene's text. */
export function suggest(text: string): string[] {
  // the GM's own sounds win over built-in ones that match equally well
  const scored = allSounds().map((s) => ({ s, n: s.tags.reduce((a, t) => a + (text.match(WORD(t))?.length ?? 0), 0) * (s.local ? 2 : 1) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const loops = scored.filter((x) => x.s.loop).slice(0, 3).map((x) => x.s.id);
  const shots = scored.filter((x) => !x.s.loop && !STAPLES.includes(x.s.id)).slice(0, 10).map((x) => x.s.id);
  const extra = allSounds().filter((s) => s.staple).map((s) => s.id);
  return [...loops, ...shots.filter((id) => !extra.includes(id)), ...extra, ...STAPLES];
}
