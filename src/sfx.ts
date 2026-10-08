// Sound playback for the soundboard. The sounds are CC0 community recordings
// rehosted with the extension (public/sounds, see CREDITS.md), fetched by URL so
// any device in the room can play the same sound.
import catalog from "./sounds.json";
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
}
export const SOUNDS = catalog.sounds as Sound[];
export const STAPLES = catalog.staples as string[];
export const CREDITS = catalog.credits as Record<string, { title: string; author: string; url: string }>;
export const CATEGORIES = [...new Set(SOUNDS.map((s) => s.cat))];
export const sound = (id: string) => SOUNDS.find((s) => s.id === id);
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

const buffers = new Map<string, Promise<AudioBuffer>>();
function load(file: string): Promise<AudioBuffer> {
  if (!buffers.has(file)) {
    const p = fetch(soundUrl(file))
      .then((r) => {
        if (!r.ok) throw new Error(`Couldn't load sound ${file} (${r.status})`);
        return r.arrayBuffer();
      })
      .then((b) => new Promise<AudioBuffer>((res, rej) => audio().decodeAudioData(b, res, rej)));
    p.catch(() => buffers.delete(file)); // allow a retry
    buffers.set(file, p);
  }
  return buffers.get(file)!;
}

/** Fetch and decode a set of sounds ahead of time so the first press is instant. */
export function preload(ids: string[]) {
  for (const id of ids) {
    const s = sound(id);
    if (s) for (const f of s.loop ? s.files.slice(0, 1) : s.files) load(f).catch(() => {});
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
  src.connect(master!);
  src.start();
}

interface Playing { src: AudioBufferSourceNode; gain: GainNode }
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
    cur.src.stop(c.currentTime + 2);
    return;
  }
  if (cur) return;
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.connect(master!);
  const src = c.createBufferSource();
  loops.set(id, { src, gain }); // claim the slot before the await so double clicks don't stack
  changed();
  try {
    const buf = await load(s.files[0]);
    if (loops.get(id)?.src !== src) return; // switched off while loading
    src.buffer = buf;
    src.loop = true;
    [src.loopStart, src.loopEnd] = audibleRange(buf);
    src.connect(gain);
    src.start(0, src.loopStart);
    gain.gain.setTargetAtTime(1, c.currentTime, 0.5);
  } catch (e) {
    loops.delete(id);
    changed();
    throw e;
  }
}

/** Make the playing loops exactly this set (used to follow the GM on players' devices). */
export async function syncLoops(ids: string[]) {
  for (const id of playingLoops()) if (!ids.includes(id)) await toggleLoop(id, false);
  for (const id of ids) if (!loops.has(id)) await toggleLoop(id, true).catch(() => {});
}

export function stopAll() {
  for (const id of playingLoops()) void toggleLoop(id, false);
}

// ---------------------------------------------------------------- boards

const WORD = (t: string) => new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");

/** Rank sounds by how often their keywords appear in the scene's text. */
export function suggest(text: string): string[] {
  const scored = SOUNDS.map((s) => ({ s, n: s.tags.reduce((a, t) => a + (text.match(WORD(t))?.length ?? 0), 0) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const loops = scored.filter((x) => x.s.loop).slice(0, 3).map((x) => x.s.id);
  const shots = scored.filter((x) => !x.s.loop && !STAPLES.includes(x.s.id)).slice(0, 10).map((x) => x.s.id);
  return [...loops, ...shots, ...STAPLES];
}
