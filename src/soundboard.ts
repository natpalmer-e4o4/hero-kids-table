// Per-map soundboard, played on the GM's computer only. Boards are saved per map in
// this browser; "My sounds" are audio files the GM imported from their own computer.
import OBR from "@owlbear-rodeo/sdk";
import { db } from "./db";
import { esc } from "./md";
import { MySound, deleteMySound, importSounds, listMySounds, setMySoundLoop } from "./mysounds";
import {
  allSounds, categories, creditsUrl, getVolume, loopOn, onLoopsChange, play, playingLoops, preload, setVolume, sound, stopAll,
  suggest, toggleLoop, unlockAudio,
} from "./sfx";

/** Which board to show: one per map, or per adventure when no map is in play. */
export interface BoardCtx { pid: string; map: string; label: string; text: string }

const ui = { open: true, editing: false, importing: "" };
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

export async function soundboardHtml(c: BoardCtx): Promise<string> {
  ctx = c;
  const { ids, custom } = await boardFor(c);
  preload(ids);
  const loops = ids.map(sound).filter((s) => s?.loop);
  const shots = ids.map(sound).filter((s) => s && !s.loop);
  const loopChips = loops
    .map((s) => `<button class="chip snd-loop ${loopOn(s!.id) ? "on" : ""}" data-snd-loop="${esc(s!.id)}" title="Background sound — click to start/stop">${esc(s!.name)}</button>`)
    .join("");
  // a loop that's still playing from another map stays reachable
  const strays = playingLoops().filter((id) => !ids.includes(id) && sound(id))
    .map((id) => `<button class="chip snd-loop on" data-snd-loop="${esc(id)}" title="Still playing from another board">${esc(sound(id)!.name)}</button>`)
    .join("");
  const buttons = shots.map((s) => `<button class="snd ${s!.local ? "mine" : ""}" data-snd="${esc(s!.id)}">${esc(s!.name)}</button>`).join("");
  const editor = ui.editing ? editorHtml(ids, await listMySounds()) : "";
  return `<details class="sounds" id="soundboard" ${ui.open ? "open" : ""}>
    <summary>🔊 Sounds — ${esc(c.label)} <span class="muted small">${custom ? "(your board)" : "(suggested)"}</span></summary>
    ${loopChips || strays ? `<div class="chips snd-loops">${loopChips}${strays}</div>` : ""}
    <div class="sndgrid">${buttons || `<span class="muted small">No sounds on this board yet — click Edit board.</span>`}</div>
    <div class="sndctl">
      <label class="inline small" title="Volume">🔈<input type="range" id="sndvol" min="0" max="100" value="${Math.round(getVolume() * 100)}"></label>
      <button class="ghost small" data-snd-stop>■ Stop all</button>
      <button class="ghost small" data-snd-edit>${ui.editing ? "Close editor" : "Edit board"}</button>
    </div>
    ${editor}
  </details>`;
}

function editorHtml(ids: string[], mine: MySound[]): string {
  const pick = (id: string, name: string, title: string) =>
    `<span class="pick ${ids.includes(id) ? "on" : ""}"><button class="ghost" data-snd-prev="${esc(id)}" title="Preview">▶</button><button data-snd-pick="${esc(id)}" title="${esc(title)}">${ids.includes(id) ? "✓ " : "+ "}${esc(name)}</button></span>`;
  const myRows = mine
    .map((m) => `<div class="myrow">${pick(m.id, m.name, m.tags.join(", "))}
      <button class="ghost small" data-my-loop="${esc(m.id)}" title="Switch between a background loop and a one-shot">${m.loop ? "Loop" : "One-shot"}</button>
      <button class="ghost small x" data-my-del="${esc(m.id)}" title="Remove from this browser">×</button></div>`)
    .join("");
  const mySection = `<h4>My sounds${mine.length ? ` (${mine.length})` : ""}</h4>
    <p class="muted small">Import audio files from this computer (e.g. packs you bought). They stay in this browser and play on this computer only. File and folder names become keywords, so they're suggested for matching maps.</p>
    ${ui.importing ? `<p class="small">${esc(ui.importing)}</p>` : `<div class="btns">
      <label class="filebtn">Add sound files<input type="file" id="myfiles" multiple accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac"></label>
      <label class="filebtn ghost">Add a folder<input type="file" id="myfolder" webkitdirectory multiple></label></div>`}
    <div class="mylist">${myRows}</div>`;
  const cats = categories().filter((c) => c !== "My sounds")
    .map((cat) => `<h4>${esc(cat)}</h4><div class="sndpick">${allSounds().filter((s) => s.cat === cat)
      .map((s) => pick(s.id, s.name, s.tags.slice(0, 8).join(", "))).join("")}</div>`).join("");
  return `<div class="sndedit">
    <p class="muted small">Tap a sound to add it to (or remove it from) this ${ctx?.map === "_" ? "adventure" : "map"}'s board. ▶ previews it.</p>
    ${mySection}
    ${cats}
    <div class="btns"><button class="ghost" data-snd-reset>Back to suggestions</button><button data-snd-done>Done</button></div>
    <p class="muted small">Built-in sounds are free CC0 community recordings (Kenney, OpenGameArt artists) — <a href="${creditsUrl()}" target="_blank" rel="noopener">credits</a>.</p>
  </div>`;
}

async function refresh() {
  const el = document.getElementById("soundboard");
  if (!el || !ctx) return;
  el.outerHTML = await soundboardHtml(ctx);
  wireSoundboard();
}

onLoopsChange(() => {
  document.querySelectorAll<HTMLElement>("[data-snd-loop]").forEach((b) => b.classList.toggle("on", loopOn(b.dataset.sndLoop!)));
});

async function importPicked(files: FileList | null) {
  if (!files?.length) return;
  ui.importing = "Importing…";
  await refresh();
  try {
    const r = await importSounds(files, (d, t) => {
      ui.importing = `Importing ${d}/${t}…`;
      const p = document.querySelector("#soundboard .sndedit p.small:not(.muted)");
      if (p) p.textContent = ui.importing;
    });
    OBR.notification.show(
      r.added ? `Added ${r.added} sound${r.added > 1 ? "s" : ""}${r.skipped ? ` (${r.skipped} non-audio files skipped)` : ""}` : "No audio files found there",
      r.added ? "SUCCESS" : "WARNING",
    );
  } catch (e) {
    notify(e);
  }
  ui.importing = "";
  refresh();
}

export function wireSoundboard() {
  const root = document.getElementById("soundboard");
  if (!root || !ctx) return;
  const c = ctx;
  root.addEventListener("toggle", () => (ui.open = (root as HTMLDetailsElement).open));
  root.querySelectorAll<HTMLButtonElement>("[data-snd]").forEach((b) =>
    b.addEventListener("click", () => {
      void unlockAudio(); // must start inside the click
      play(b.dataset.snd!).catch(notify);
      b.classList.add("hit");
      setTimeout(() => b.classList.remove("hit"), 200);
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
  root.querySelectorAll<HTMLButtonElement>("[data-my-loop]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.myLoop!;
      if (loopOn(id)) await toggleLoop(id, false);
      await setMySoundLoop(id, !sound(id)?.loop);
      refresh();
    }));
  root.querySelectorAll<HTMLButtonElement>("[data-my-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.myDel!;
      if (loopOn(id)) await toggleLoop(id, false);
      await deleteMySound(id);
      refresh();
    }));
  root.querySelector<HTMLInputElement>("#myfiles")?.addEventListener("change", (ev) => importPicked((ev.target as HTMLInputElement).files));
  root.querySelector<HTMLInputElement>("#myfolder")?.addEventListener("change", (ev) => importPicked((ev.target as HTMLInputElement).files));
  root.querySelector("[data-snd-reset]")?.addEventListener("click", async () => {
    await db.del("kv", boardKey(c));
    refresh();
  });
  root.querySelector("[data-snd-done]")?.addEventListener("click", () => { ui.editing = false; refresh(); });
  root.querySelector("[data-snd-edit]")?.addEventListener("click", () => { ui.editing = !ui.editing; refresh(); });
  root.querySelector("[data-snd-stop]")?.addEventListener("click", () => stopAll());
  root.querySelector<HTMLInputElement>("#sndvol")?.addEventListener("input", (ev) => setVolume(+(ev.target as HTMLInputElement).value / 100));
}
