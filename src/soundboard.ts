// Per-map soundboard. The GM's laptop plays sounds locally (a click is always
// allowed to make sound); "Players hear it too" mirrors them to players' devices
// once someone there taps "turn on sounds" (browsers need one tap per device).
import OBR from "@owlbear-rodeo/sdk";
import { db } from "./db";
import { esc } from "./md";
import { ID } from "./shared";
import {
  CATEGORIES, SOUNDS, audioReady, creditsUrl, getVolume, loopOn, onAudioStateChange, onLoopsChange, play, playingLoops,
  preload, setVolume, sound, stopAll, suggest, syncLoops, toggleLoop, unlockAudio,
} from "./sfx";

export const SOUND_KEY = `${ID}/sound`; // room metadata: { share, loops }
export const SFX_CHANNEL = `${ID}/sfx`;

interface SharedSound { share: boolean; loops: string[] }
let shared: SharedSound = { share: false, loops: [] };

/** Which board to show: one per map, or per adventure when no map is in play. */
export interface BoardCtx { pid: string; map: string; label: string; text: string }

const ui = { open: true, editing: false };
let ctx: BoardCtx | null = null;

const boardKey = (c: BoardCtx) => `sound-board:${c.pid}:${c.map}`;
async function savedBoard(c: BoardCtx) {
  return (await db.get<string[]>("kv", boardKey(c)).catch(() => undefined)) ?? null;
}
export async function boardFor(c: BoardCtx): Promise<{ ids: string[]; custom: boolean }> {
  const saved = await savedBoard(c);
  const ids = (saved ?? suggest(c.text)).filter((id) => sound(id));
  return { ids, custom: !!saved };
}

const notify = (e: unknown) => OBR.notification.show(e instanceof Error ? e.message : String(e), "ERROR");

// ------------------------------------------------------------------ GM

export async function soundboardHtml(c: BoardCtx): Promise<string> {
  ctx = c;
  const { ids, custom } = await boardFor(c);
  preload(ids);
  const loops = ids.map(sound).filter((s) => s?.loop);
  const shots = ids.map(sound).filter((s) => s && !s.loop);
  const loopChips = loops
    .map((s) => `<button class="chip snd-loop ${loopOn(s!.id) ? "on" : ""}" data-snd-loop="${s!.id}" title="Background sound — click to start/stop">${esc(s!.name)}</button>`)
    .join("");
  // a loop that's still playing from another map stays reachable
  const strays = playingLoops().filter((id) => !ids.includes(id))
    .map((id) => `<button class="chip snd-loop on" data-snd-loop="${id}" title="Still playing from another board">${esc(sound(id)!.name)}</button>`)
    .join("");
  const buttons = shots.map((s) => `<button class="snd" data-snd="${s!.id}">${esc(s!.name)}</button>`).join("");
  const editor = ui.editing ? editorHtml(ids) : "";
  return `<details class="sounds" id="soundboard" ${ui.open ? "open" : ""}>
    <summary>🔊 Sounds — ${esc(c.label)} <span class="muted small">${custom ? "(your board)" : "(suggested)"}</span></summary>
    ${loopChips || strays ? `<div class="chips snd-loops">${loopChips}${strays}</div>` : ""}
    <div class="sndgrid">${buttons || `<span class="muted small">No sounds on this board yet — click Edit board.</span>`}</div>
    <div class="sndctl">
      <label class="inline small" title="Volume on this computer">🔈<input type="range" id="sndvol" min="0" max="100" value="${Math.round(getVolume() * 100)}"></label>
      <button class="ghost small" data-snd-stop>■ Stop all</button>
      <label class="inline small"><input type="checkbox" id="sndshare" ${shared.share ? "checked" : ""}> Players hear it too</label>
      <button class="ghost small" data-snd-edit>${ui.editing ? "Close editor" : "Edit board"}</button>
    </div>
    ${shared.share ? `<p class="muted small">Each player device taps <b>Turn on sounds</b> once in its Hero Kids panel, then hears whatever you play.</p>` : ""}
    ${editor}
  </details>`;
}

function editorHtml(ids: string[]): string {
  const cats = CATEGORIES.map((cat) => `<h4>${esc(cat)}</h4><div class="sndpick">${SOUNDS.filter((s) => s.cat === cat)
    .map((s) => `<span class="pick ${ids.includes(s.id) ? "on" : ""}"><button class="ghost" data-snd-prev="${s.id}" title="Preview">▶</button><button data-snd-pick="${s.id}" title="${esc(s.tags.slice(0, 8).join(", "))}">${ids.includes(s.id) ? "✓ " : "+ "}${esc(s.name)}</button></span>`)
    .join("")}</div>`).join("");
  return `<div class="sndedit">
    <p class="muted small">Tap a sound to add it to (or remove it from) this ${ctx?.map === "_" ? "adventure" : "map"}'s board. ▶ previews it.</p>
    ${cats}
    <div class="btns"><button class="ghost" data-snd-reset>Back to suggestions</button><button data-snd-done>Done</button></div>
    <p class="muted small">All sounds are free CC0 community recordings (Kenney, OpenGameArt artists), hosted with this extension — <a href="${creditsUrl()}" target="_blank" rel="noopener">credits</a>.</p>
  </div>`;
}

async function refresh() {
  const el = document.getElementById("soundboard");
  if (!el || !ctx) return;
  el.outerHTML = await soundboardHtml(ctx);
  wireSoundboard();
}

async function setShared(next: Partial<SharedSound>) {
  shared = { ...shared, ...next };
  await OBR.room.setMetadata({ [SOUND_KEY]: shared });
}

let loopSync = 0;
onLoopsChange(() => {
  document.querySelectorAll<HTMLElement>("[data-snd-loop]").forEach((b) => b.classList.toggle("on", loopOn(b.dataset.sndLoop!)));
  if (shared.share) {
    // tell players' devices which background sounds are on (debounced)
    clearTimeout(loopSync);
    loopSync = window.setTimeout(() => void setShared({ loops: playingLoops() }).catch(() => {}), 250);
  }
});

export function wireSoundboard() {
  const root = document.getElementById("soundboard");
  if (!root || !ctx) return;
  const c = ctx;
  root.addEventListener("toggle", () => (ui.open = (root as HTMLDetailsElement).open));
  root.querySelectorAll<HTMLButtonElement>("[data-snd]").forEach((b) =>
    b.addEventListener("click", () => {
      void unlockAudio(); // must start inside the click
      const id = b.dataset.snd!;
      play(id).catch(notify);
      b.classList.add("hit");
      setTimeout(() => b.classList.remove("hit"), 200);
      if (shared.share) OBR.broadcast.sendMessage(SFX_CHANNEL, { id }).catch(() => {});
    }));
  root.querySelectorAll<HTMLButtonElement>("[data-snd-loop]").forEach((b) =>
    b.addEventListener("click", () => {
      void unlockAudio();
      toggleLoop(b.dataset.sndLoop!).catch(notify);
    }));
  root.querySelectorAll<HTMLButtonElement>("[data-snd-prev]").forEach((b) =>
    b.addEventListener("click", () => {
      void unlockAudio();
      const s = sound(b.dataset.sndPrev!);
      if (s?.loop) toggleLoop(s.id).catch(notify);
      else play(b.dataset.sndPrev!).catch(notify);
    }));
  root.querySelectorAll<HTMLButtonElement>("[data-snd-pick]").forEach((b) =>
    b.addEventListener("click", async () => {
      const { ids } = await boardFor(c);
      const id = b.dataset.sndPick!;
      const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
      await db.put("kv", boardKey(c), next);
      refresh();
    }));
  root.querySelector("[data-snd-reset]")?.addEventListener("click", async () => {
    await db.del("kv", boardKey(c));
    refresh();
  });
  root.querySelector("[data-snd-done]")?.addEventListener("click", () => { ui.editing = false; refresh(); });
  root.querySelector("[data-snd-edit]")?.addEventListener("click", () => { ui.editing = !ui.editing; refresh(); });
  root.querySelector("[data-snd-stop]")?.addEventListener("click", () => stopAll());
  root.querySelector<HTMLInputElement>("#sndvol")?.addEventListener("input", (ev) => setVolume(+(ev.target as HTMLInputElement).value / 100));
  root.querySelector<HTMLInputElement>("#sndshare")?.addEventListener("change", async (ev) => {
    const on = (ev.target as HTMLInputElement).checked;
    await setShared({ share: on, loops: on ? playingLoops() : [] }).catch(notify);
    refresh();
  });
}

// --------------------------------------------------------------- players

let muted = false;
try { muted = localStorage.getItem("hk-sound-muted") === "1"; } catch { /* storage blocked */ }

/** Listen for the GM's sounds. `changed` re-renders the panel when the banner should change. */
export async function initSound(role: "GM" | "PLAYER", changed: () => void) {
  const read = (m: Record<string, unknown>) => {
    const v = m[SOUND_KEY] as SharedSound | undefined;
    shared = { share: !!v?.share, loops: v?.loops ?? [] };
  };
  read(await OBR.room.getMetadata());
  if (role === "GM") {
    OBR.room.onMetadataChange((m) => read(m));
    return;
  }
  const follow = () => {
    if (!audioReady()) return;
    void syncLoops(shared.share && !muted ? shared.loops : []);
  };
  OBR.room.onMetadataChange((m) => {
    const was = shared.share;
    read(m);
    follow();
    if (was !== shared.share) changed();
  });
  OBR.broadcast.onMessage(SFX_CHANNEL, ({ data }) => {
    if (shared.share && !muted && audioReady()) play((data as { id: string }).id).catch(() => {});
  });
  onAudioStateChange(changed);
}

export function playerSoundHtml(): string {
  if (!shared.share) return "";
  if (!audioReady()) return `<button class="sndon" data-snd-unlock>🔊 Turn on sounds</button>`;
  return `<div class="sndstatus small">🔊 Table sounds ${muted ? "muted" : "on"} <button class="ghost small" data-snd-mute>${muted ? "Unmute" : "Mute"}</button></div>`;
}

export function wirePlayerSound(changed: () => void) {
  document.querySelector("[data-snd-unlock]")?.addEventListener("click", async () => {
    await unlockAudio();
    if (!muted) void syncLoops(shared.loops);
    changed();
  });
  document.querySelector("[data-snd-mute]")?.addEventListener("click", () => {
    muted = !muted;
    try { localStorage.setItem("hk-sound-muted", muted ? "1" : "0"); } catch { /* fine */ }
    void syncLoops(muted ? [] : shared.loops);
    changed();
  });
}
