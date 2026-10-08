import OBR, { Player } from "@owlbear-rodeo/sdk";
import "./style.css";
import { allProducts, loadFolder, loadedIndex, product } from "./library";
import { esc, renderMarkdown, section } from "./md";
import {
  getLinks, getStatus, linkArt, placeCard, sceneMarker, spawn, uploadArt, uploadScenes,
} from "./owl";
import {
  FACES, KEY, RollMessage, best, d6, emptyCampaign, getCampaign, getShown, setCampaign,
} from "./shared";
import type { Campaign, Encounter, Product, Shown } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;
const app = $("#app");

type Tab = "play" | "dice" | "campaign" | "rules" | "library";
const state = {
  role: "PLAYER" as "GM" | "PLAYER",
  tab: "play" as Tab,
  campaign: emptyCampaign() as Campaign,
  players: [] as Player[],
  me: { id: "", name: "" },
  products: [] as Product[],
  encounter: null as string | null, // selected encounter id, "0" = intro
  follow: true, // follow the open scene
  rolls: [] as RollMessage[],
  dice: { mode: "attack" as "attack" | "test", attack: 2, armor: 1, pool: 2, difficulty: 4, label: "" },
  rulesQuery: "",
  busy: "" as string,
  storageError: "" as string,
};

// ------------------------------------------------------------------ boot

async function boot() {
  const params = new URLSearchParams(location.search);
  await applyTheme();
  if (params.get("view") === "shown") return shownView();

  state.role = await OBR.player.getRole();
  state.me = { id: await OBR.player.getId(), name: await OBR.player.getName() };
  state.campaign = await getCampaign();
  state.players = await OBR.party.getPlayers();
  try {
    state.products = await allProducts();
  } catch (e) {
    state.products = [];
    state.storageError = String((e as Error)?.message ?? e);
  }
  if (state.role === "PLAYER") state.tab = "dice";
  if (state.role === "GM" && !state.products.length) state.tab = "library";
  state.encounter = state.campaign.encounter != null ? String(state.campaign.encounter) : null;

  OBR.room.onMetadataChange(async () => {
    state.campaign = await getCampaign();
    render();
  });
  OBR.party.onChange((p) => {
    state.players = p;
    if (state.tab === "campaign") render();
  });
  OBR.broadcast.onMessage(KEY.roll, ({ data }) => {
    state.rolls.unshift(data as RollMessage);
    state.rolls = state.rolls.slice(0, 20);
    if (state.tab === "dice") render();
  });
  if (state.role === "GM") {
    const follow = async () => {
      if (!state.follow || !(await OBR.scene.isReady())) return;
      const m = await sceneMarker();
      if (!m) return;
      if (m.product !== state.campaign.adventure || (m.encounter && m.encounter !== state.encounter)) {
        state.encounter = m.encounter ?? state.encounter;
        if (m.product !== state.campaign.adventure) {
          state.campaign.adventure = m.product;
          await setCampaign(state.campaign);
        }
        if (state.tab === "play") render();
      }
    };
    OBR.scene.onReadyChange((ready) => ready && follow());
    follow();
  }
  render();
}

async function applyTheme() {
  const set = (t: Awaited<ReturnType<typeof OBR.theme.getTheme>>) => {
    const r = document.documentElement.style;
    r.setProperty("--bg", t.background.paper);
    r.setProperty("--bg2", t.background.default);
    r.setProperty("--fg", t.text.primary);
    r.setProperty("--muted", t.text.secondary);
    r.setProperty("--accent", t.primary.main);
    r.setProperty("--accent-fg", t.primary.contrastText);
    document.documentElement.dataset.mode = t.mode.toLowerCase();
  };
  set(await OBR.theme.getTheme());
  OBR.theme.onChange(set);
}

// ---------------------------------------------------------------- render

function tabs(): string {
  const all: [Tab, string][] =
    state.role === "GM"
      ? [["play", "Play"], ["dice", "Dice"], ["campaign", "Campaign"], ["rules", "Rules"], ["library", "Library"]]
      : [["dice", "Dice"], ["campaign", "My hero"]];
  return `<nav class="tabs">${all
    .map(([t, l]) => `<button data-tab="${t}" class="${state.tab === t ? "on" : ""}">${l}</button>`)
    .join("")}</nav>`;
}

let renderGen = 0;
let lastTab: Tab | null = null;
async function render() {
  const gen = ++renderGen;
  const tab = state.tab;
  let body = "";
  try {
    if (tab === "play") body = await playView();
    else if (tab === "dice") body = diceView();
    else if (tab === "campaign") body = await campaignView();
    else if (tab === "rules") body = rulesView();
    else body = await libraryView();
  } catch (e) {
    body = `<p class="err">${esc(String(e))}</p>`;
  }
  if (gen !== renderGen || tab !== state.tab) return; // a newer render superseded this one
  const busy =
    (state.busy ? `<div class="busy">${esc(state.busy)}</div>` : "") +
    (state.storageError && state.role === "GM" ? `<div class="note err">${esc(state.storageError)}</div>` : "");
  const scroll = tab === lastTab ? (document.scrollingElement?.scrollTop ?? 0) : 0;
  app.innerHTML = tabs() + busy + `<main>${body}</main>`;
  if (document.scrollingElement) document.scrollingElement.scrollTop = scroll;
  lastTab = tab;
  wire();
}

// ------------------------------------------------------------------ play

const adventures = () => state.products.filter((p) => p.kind === "adventure");
const currentAdventure = () => state.products.find((p) => p.id === state.campaign.adventure);
const partySize = () => Math.min(4, Math.max(1, state.campaign.party.length || 2));

async function playView(): Promise<string> {
  const advs = adventures();
  if (!advs.length) return emptyLibrary();
  const adv = currentAdventure();
  const pick = `<label class="row">Adventure
    <select id="adv"><option value="">— choose —</option>${advs
      .map((a) => `<option value="${a.id}" ${a.id === adv?.id ? "selected" : ""}>${esc(a.title)}${state.campaign.finished.includes(a.id) ? " ✓" : ""}</option>`)
      .join("")}</select></label>`;
  if (!adv) return pick + `<p class="muted">Pick an adventure to run. Its maps become scenes under <b>Library</b>.</p>`;
  const done = state.campaign.done[adv.id] ?? [];
  const encs = adv.encounters ?? [];
  const meta = [adv.meta.difficulty, adv.meta.duration, `${encs.length} encounters`].filter(Boolean).join(" · ");
  const chips = `<div class="chips"><button class="chip ${state.encounter === "0" || state.encounter === null ? "on" : ""}" data-enc="0">Intro</button>${encs
    .map((e) => `<button class="chip ${state.encounter === e.n ? "on" : ""} ${done.includes(e.n) ? "done" : ""}" data-enc="${e.n}" title="${esc(e.title)}">${e.n}</button>`)
    .join("")}</div>`;
  const status = await getStatus(adv.id);
  const setup = !status.scenes
    ? `<div class="note">Scenes for this adventure aren't in Owlbear yet. <button data-act="scenes" data-p="${adv.id}">Create ${adv.maps.length} scenes</button></div>`
    : "";
  let detail = "";
  if (state.encounter === "0" || state.encounter === null) {
    detail = `<h2>Introduction</h2>${renderMarkdown(adv.intro_md ?? "", { shareButtons: true })}`;
  } else {
    const e = encs.find((x) => x.n === state.encounter);
    if (e) detail = await encounterDetail(adv, e, done.includes(e.n));
  }
  return `${pick}<div class="muted small">${esc(meta)} <label class="inline"><input type="checkbox" id="follow" ${state.follow ? "checked" : ""}> follow open scene</label></div>${setup}${chips}<article id="detail">${detail}</article>`;
}

async function encounterDetail(adv: Product, e: Encounter, isDone: boolean): Promise<string> {
  const n = partySize();
  const map = adv.maps.find((m) => m.id === e.map);
  const marker = (await OBR.scene.isReady()) ? await sceneMarker() : undefined;
  const onScreen = marker?.product === adv.id && marker?.map === e.map;
  const sizes = Object.keys(e.monsters).sort();
  const monsters = sizes.length
    ? `<table class="mon"><tr><th>Heroes</th><th>Monsters</th></tr>${sizes
        .map((k) => `<tr class="${+k === n ? "on" : ""}"><td>${k}</td><td>${e.monsters[k].map((m) => `${m.count} × ${esc(m.name)}`).join(", ")}</td></tr>`)
        .join("")}</table>
      <div class="btns"><button data-act="spawn" data-n="${n}">Place monsters for ${n} hero${n > 1 ? "es" : ""}</button>
      <button class="ghost" data-act="cards">Put monster cards on table</button></div>
      <p class="muted small">${esc(section(e.md, "Monsters").split(/\d\s*Heroe?s?:/)[0].trim())}</p>`
    : `<p class="muted">${esc(section(e.md, "Monsters") || "No monsters listed.")}</p>`;
  const body = renderMarkdown(e.md.replace(/^# .*\n/, ""), { shareButtons: true, skipSections: ["Monsters", "Map"] });
  return `<h2>${e.n}. ${esc(e.title)}</h2>
    <div class="muted small">Map: ${map ? esc(map.name) : "—"} ${onScreen ? '<span class="pill">on screen</span>' : map ? `<span class="pill dim">open the “${esc(adv.title)} — ${esc(map.name)}” scene</span>` : ""}</div>
    ${body}
    <h3>Monsters</h3>${monsters}
    <div class="btns end"><button class="ghost" data-act="party">Place hero tokens</button>
    <button data-act="done">${isDone ? "Done ✓ — next" : "Mark done & next"}</button></div>`;
}

function emptyLibrary() {
  return state.role === "GM"
    ? `<div class="note">No library loaded in this browser yet. Go to <b>Library</b> and choose your “_Owlbear Library” folder.</div>`
    : `<p class="muted">Your GM runs the story. Use <b>Dice</b> to roll!</p>`;
}

// ------------------------------------------------------------------ dice

function diceView(): string {
  const d = state.dice;
  const pool = (id: string, val: number, min: number, max: number) =>
    `<div class="pool">${Array.from({ length: max - min + 1 }, (_, i) => i + min)
      .map((v) => `<button class="die ${v === val ? "on" : ""}" data-pool="${id}" data-v="${v}">${v}</button>`)
      .join("")}</div>`;
  const form =
    d.mode === "attack"
      ? `<label>Attack dice (melee, ranged or magic)</label>${pool("attack", d.attack, 1, 6)}
         <label>Armor dice of the target</label>${pool("armor", d.armor, 0, 6)}
         <p class="muted small">Hit if your highest die is equal to or higher than their highest armor die.</p>`
      : `<label>Dice (1 base + ability pool + 1 for a skill or item)</label>${pool("pool", d.pool, 1, 6)}
         <label>Difficulty</label>${pool("difficulty", d.difficulty, 2, 6)}
         <p class="muted small">Easy 4 · Normal 5 · Hard 6. Succeed if your highest die is equal to or higher.</p>`;
  const hist = state.rolls
    .map(
      (r) => `<li class="${r.success ? "ok" : ""}"><b>${esc(r.who)}</b> ${esc(r.label)}<br>
      <span class="faces">${r.attack.map((x) => `<i class="${x === best(r.attack) ? "hi" : ""}">${FACES[x]}</i>`).join("")}</span>
      ${r.mode === "attack" ? ` vs <span class="faces">${r.defense.map((x) => `<i class="${x === best(r.defense) ? "hi" : ""}">${FACES[x]}</i>`).join("") || "—"}</span>` : ` vs ${r.difficulty}`}
      → <b>${r.mode === "attack" ? (r.success ? "HIT!" : "miss") : r.success ? "Success!" : "Fail"}</b></li>`,
    )
    .join("");
  return `<div class="seg"><button data-mode="attack" class="${d.mode === "attack" ? "on" : ""}">Attack</button><button data-mode="test" class="${d.mode === "test" ? "on" : ""}">Ability test</button></div>
    ${form}
    <input id="rlabel" placeholder="What for? (optional)" value="${esc(d.label)}">
    <div class="btns"><button class="big" data-act="roll">Roll!</button>${state.role === "GM" ? `<button class="ghost" data-act="init">Initiative</button>` : ""}</div>
    <ul class="hist">${hist || '<li class="muted">Rolls from everyone at the table show up here.</li>'}</ul>`;
}

async function roll() {
  const d = state.dice;
  const mine = state.campaign.party.find((m) => m.playerId === state.me.id);
  const who = mine ? `${state.me.name} (${mine.hero.split(" (")[0]})` : state.me.name;
  let msg: RollMessage;
  if (d.mode === "attack") {
    const a = d6(d.attack), def = d6(d.armor);
    msg = { who, label: d.label || "attacks", mode: "attack", attack: a, defense: def, success: best(a) >= best(def), at: Date.now() };
  } else {
    const a = d6(d.pool);
    msg = { who, label: d.label || "ability test", mode: "test", attack: a, defense: [], difficulty: d.difficulty, success: best(a) >= d.difficulty, at: Date.now() };
  }
  await OBR.broadcast.sendMessage(KEY.roll, msg, { destination: "ALL" });
}

async function initiative() {
  const h = d6(1)[0], m = d6(1)[0];
  const heroes = h >= m;
  await OBR.broadcast.sendMessage(
    KEY.roll,
    { who: "Initiative", label: `heroes ${FACES[h]} vs monsters ${FACES[m]} — ${heroes ? "heroes go first!" : "monsters go first!"}`, mode: "test", attack: [h], defense: [], difficulty: m, success: heroes, at: Date.now() } satisfies RollMessage,
    { destination: "ALL" },
  );
}

// -------------------------------------------------------------- campaign

function heroCards() {
  const out: { product: Product; id: string; name: string }[] = [];
  for (const p of state.products) for (const c of p.cards) if (c.kind === "hero" || c.kind === "pet") out.push({ product: p, id: c.id, name: c.name });
  return out;
}

async function campaignView(): Promise<string> {
  const c = state.campaign;
  if (state.role === "PLAYER") {
    const mine = c.party.find((m) => m.playerId === state.me.id);
    const party = c.party.map((m) => `<li><b>${esc(m.playerName)}</b> — ${esc(m.hero)}</li>`).join("");
    return `<h2>${esc(c.name)}</h2>${mine ? `<p>You are playing <b>${esc(mine.hero)}</b>.</p>${mine.cardUrl ? `<img class="card" src="${esc(mine.cardUrl)}" alt="${esc(mine.hero)} hero card">` : ""}` : `<p class="muted">Your GM hasn't picked your hero yet.</p>`}
      <h3>The party</h3><ul>${party || "<li class='muted'>No heroes yet.</li>"}</ul>`;
  }
  const heroes = heroCards();
  const opts = (sel: string) =>
    `<option value="">— hero —</option>` +
    Array.from(new Set(heroes.map((h) => h.product.title)))
      .map((t) => `<optgroup label="${esc(t)}">${heroes.filter((h) => h.product.title === t).map((h) => `<option value="${h.product.id}|${h.id}" ${sel === `${h.product.id}|${h.id}` ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</optgroup>`)
      .join("");
  const players = state.players.filter((p) => p.role === "PLAYER");
  const rows = [
    ...players.map((p) => ({ id: p.id, name: p.name })),
    ...c.party.filter((m) => !players.some((p) => p.id === m.playerId)).map((m) => ({ id: m.playerId, name: m.playerName })),
  ];
  const rowHtml = rows
    .map((r) => {
      const m = c.party.find((x) => x.playerId === r.id);
      return `<tr><td>${esc(r.name)}</td><td><select data-hero="${esc(r.id)}" data-name="${esc(r.name)}">${opts(m ? `${m.product}|${m.card}` : "")}</select></td></tr>`;
    })
    .join("");
  const prog = adventures()
    .map((a) => {
      const d = c.done[a.id]?.length ?? 0, t = a.encounters?.length ?? 0;
      return d || c.finished.includes(a.id) ? `<li>${esc(a.title)} — ${c.finished.includes(a.id) ? "finished ✓" : `${d}/${t} encounters`}</li>` : "";
    })
    .join("");
  return `<label>Campaign name<input id="cname" value="${esc(c.name)}"></label>
    <p class="muted small">Each Owlbear room keeps its own campaign. Make one room per campaign and add this extension to each.</p>
    <h3>Party</h3>
    <table class="party">${rowHtml || `<tr><td class="muted">Players appear here when they join the room.</td></tr>`}</table>
    <div class="btns"><input id="newhero" placeholder="Extra hero (no device), e.g. Sam"><button class="ghost" data-act="addhero">Add</button></div>
    <h3>Progress</h3><ul>${prog || "<li class='muted'>No adventures played yet.</li>"}</ul>
    <label>Notes (loot, names, inside jokes)<textarea id="notes" rows="5">${esc(c.notes)}</textarea></label>
    <div class="btns"><button data-act="savecamp">Save</button></div>`;
}

// ----------------------------------------------------------------- rules

function rulesView(): string {
  const q = state.rulesQuery.toLowerCase();
  const srcs = state.products.filter((p) => p.sections?.length);
  const items = srcs.flatMap((p) => (p.sections ?? []).map((s) => ({ p, s })))
    .filter(({ s }) => !/^(credits|table of contents|overview)$/i.test(s.title))
    .filter(({ s }) => !q || s.title.toLowerCase().includes(q) || s.md.toLowerCase().includes(q));
  return `<input id="rq" placeholder="Search rules (e.g. prone, potion, initiative)" value="${esc(state.rulesQuery)}">
    ${items
      .slice(0, 80)
      .map(({ p, s }) => `<details ${q ? "open" : ""}><summary>${esc(s.title)} <span class="muted small">${esc(p.title)}</span></summary>${renderMarkdown(s.md)}</details>`)
      .join("") || `<p class="muted">Nothing found.</p>`}`;
}

// --------------------------------------------------------------- library

async function libraryView(): Promise<string> {
  const idx = await loadedIndex();
  const rows = [];
  for (const e of idx) {
    const s = await getStatus(e.id);
    const links = Object.keys(await getLinks(e.id)).length;
    rows.push(`<tr><td><b>${esc(e.title)}</b><div class="muted small">${e.kind} · ${e.maps} maps · ${e.cards} cards · ${e.tokens} tokens · ${(e.bytes / 1e6).toFixed(1)} MB</div></td>
      <td class="acts">
        ${e.maps ? `<button class="${s.scenes ? "ghost" : ""}" data-act="scenes" data-p="${e.id}" title="Upload maps as Owlbear scenes">${s.scenes ? "Scenes ✓" : "Scenes"}</button>` : ""}
        ${e.tokens + e.cards ? `<button class="${s.art ? "ghost" : ""}" data-act="art" data-p="${e.id}" title="Upload tokens and cards to your Owlbear storage">${s.art ? "Art ✓" : "Art"}</button>` : ""}
        ${e.tokens + e.cards ? `<button class="${links ? "ghost" : ""}" data-act="link" data-p="${e.id}" title="Pick the uploaded art in Owlbear so tokens can be placed automatically">${links ? `Linked ${links}` : "Link"}</button>` : ""}
      </td></tr>`);
  }
  return `<div class="note"><b>1.</b> Choose your <code>_Owlbear Library</code> folder (stays in this browser only).
      <input type="file" id="folder" webkitdirectory multiple></div>
    ${idx.length ? `<div class="note"><b>2.</b> <b>Scenes</b> turns each map into an Owlbear scene. <b>Art</b> uploads tokens and cards (two confirmations). <b>Link</b> opens Owlbear's picker — search is pre-filled, select all results, click Done — so the Play tab can place monsters for you.</div>
      <div class="btns"><button data-act="allscenes">Create scenes for everything</button><button class="ghost" data-act="allart">Upload all art</button></div>
      <table class="lib">${rows.join("")}</table>` : ""}`;
}

// ------------------------------------------------------------------ wire

function wire() {
  app.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => { state.tab = b.dataset.tab as Tab; render(); }));
  $("#adv")?.addEventListener("change", async (ev) => {
    state.campaign.adventure = (ev.target as HTMLSelectElement).value || undefined;
    state.encounter = "0";
    state.campaign.encounter = "0";
    await setCampaign(state.campaign);
  });
  $("#follow")?.addEventListener("change", (ev) => { state.follow = (ev.target as HTMLInputElement).checked; });
  app.querySelectorAll<HTMLButtonElement>("[data-enc]").forEach((b) =>
    b.addEventListener("click", async () => {
      state.encounter = b.dataset.enc!;
      state.campaign.encounter = state.encounter;
      render();
      await setCampaign(state.campaign);
    }));
  app.querySelectorAll<HTMLButtonElement>("button.share").forEach((b) =>
    b.addEventListener("click", async () => {
      const bq = b.closest("blockquote")!;
      const text = Array.from(bq.querySelectorAll("p")).map((p) => p.textContent).join("\n\n");
      const adv = currentAdventure();
      const enc = adv?.encounters?.find((e) => e.n === state.encounter);
      const shown: Shown = { title: enc ? enc.title : adv?.title ?? "", text, at: Date.now() };
      await OBR.room.setMetadata({ [KEY.shown]: shown });
      OBR.notification.show("Shown to players", "SUCCESS");
    }));
  // dice
  app.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => { state.dice.mode = b.dataset.mode as "attack" | "test"; render(); }));
  app.querySelectorAll<HTMLButtonElement>("[data-pool]").forEach((b) =>
    b.addEventListener("click", () => {
      (state.dice as unknown as Record<string, number>)[b.dataset.pool!] = +b.dataset.v!;
      render();
    }));
  $("#rlabel")?.addEventListener("input", (ev) => { state.dice.label = (ev.target as HTMLInputElement).value; });
  $("#rq")?.addEventListener("input", (ev) => {
    state.rulesQuery = (ev.target as HTMLInputElement).value;
    const pos = (ev.target as HTMLInputElement).selectionStart;
    render().then(() => { const i = $<HTMLInputElement>("#rq"); i.focus(); i.setSelectionRange(pos, pos); });
  });
  // campaign
  app.querySelectorAll<HTMLSelectElement>("[data-hero]").forEach((s) =>
    s.addEventListener("change", () => setHero(s.dataset.hero!, s.dataset.name!, s.value)));
  // library
  $<HTMLInputElement>("#folder")?.addEventListener("change", async (ev) => {
    const files = (ev.target as HTMLInputElement).files;
    if (!files?.length) return;
    try {
      await loadFolder(files, (d, t, label) => { state.busy = `Loading library… ${d}/${t} (${label})`; render(); });
      state.products = await allProducts();
      state.busy = "";
      OBR.notification.show(`Library loaded: ${state.products.length} books`, "SUCCESS");
    } catch (e) {
      state.busy = "";
      OBR.notification.show(String(e), "ERROR");
    }
    render();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => b.addEventListener("click", () => act(b)));
}

function showBusyNow(label: string) {
  let el = app.querySelector<HTMLElement>(".busy");
  if (!el) {
    el = document.createElement("div");
    el.className = "busy";
    app.querySelector("nav")?.after(el);
  }
  el.textContent = label;
  app.querySelectorAll<HTMLButtonElement>("main button").forEach((b) => (b.disabled = true));
}

async function withBusy(label: string, fn: () => Promise<unknown>) {
  state.busy = label;
  showBusyNow(label);
  try {
    await fn();
  } catch (e) {
    OBR.notification.show(String((e as Error)?.message ?? e), "ERROR");
  } finally {
    state.busy = "";
    render();
  }
}

async function act(b: HTMLButtonElement) {
  const a = b.dataset.act!;
  if (state.busy) return;
  const p = b.dataset.p ? await product(b.dataset.p) : currentAdventure();
  switch (a) {
    case "roll": return roll();
    case "init": return initiative();
    case "scenes":
      if (p) return withBusy(`Creating ${p.maps.length} scenes for ${p.title}… confirm the folder in Owlbear`, () => uploadScenes(p));
      return;
    case "art":
      if (p) return withBusy(`Uploading art for ${p.title}… confirm each folder in Owlbear`, async () => {
        if (p.tokens.length) await uploadArt(p, "tokens");
        if (p.cards.length) await uploadArt(p, "cards");
      });
      return;
    case "link":
      if (p) return withBusy(`In Owlbear's picker: select all “${p.title}” images, then Done`, async () => {
        const n = await linkArt(p);
        OBR.notification.show(`Linked ${n} images for ${p.title}`, n ? "SUCCESS" : "WARNING");
      });
      return;
    case "allscenes":
      return withBusy("Creating scenes for every book… confirm each upload in Owlbear", async () => {
        for (const x of state.products) if (x.maps.length && !(await getStatus(x.id)).scenes) await uploadScenes(x);
      });
    case "allart":
      return withBusy("Uploading all art… confirm each upload in Owlbear", async () => {
        for (const x of state.products) if (x.tokens.length + x.cards.length && !(await getStatus(x.id)).art) {
          if (x.tokens.length) await uploadArt(x, "tokens");
          if (x.cards.length) await uploadArt(x, "cards");
        }
      });
    case "spawn": {
      const adv = currentAdventure();
      const e = adv?.encounters?.find((x) => x.n === state.encounter);
      if (!adv || !e) return;
      const list = e.monsters[String(b.dataset.n)] ?? e.monsters[Object.keys(e.monsters).pop()!];
      return withBusy("Placing monsters…", async () => {
        const missing = await spawn(list, [adv.id, "monster-compendium", "hero-kids-fantasy-rpg"], state.products);
        if (missing.length) OBR.notification.show(`No linked token for: ${missing.join(", ")} — use Library → Art + Link`, "WARNING");
      });
    }
    case "party": {
      const entries = state.campaign.party.map((m) => ({ name: m.hero, count: 1, product: m.product, card: m.card }));
      if (!entries.length) return OBR.notification.show("Pick heroes in the Campaign tab first", "WARNING");
      return withBusy("Placing hero tokens…", async () => {
        const named = [];
        for (const e of entries) {
          const pr = await product(e.product);
          const card = pr?.cards.find((c) => c.id === e.card);
          const tok = pr?.tokens.find((t) => t.id === card?.token);
          named.push({ name: tok?.name ?? e.name, count: 1 });
        }
        const missing = await spawn(named, entries.map((e) => e.product), state.products, "hero");
        if (missing.length) OBR.notification.show(`No linked token for: ${missing.join(", ")}`, "WARNING");
      });
    }
    case "cards": {
      const adv = currentAdventure();
      const e = adv?.encounters?.find((x) => x.n === state.encounter);
      if (!adv || !e) return;
      const names = Array.from(new Set(Object.values(e.monsters).flat().map((m) => m.name.toLowerCase())));
      let slot = 0;
      for (const x of [adv, ...state.products.filter((q) => q !== adv)]) {
        const links = await getLinks(x.id);
        for (const c of x.cards) {
          const i = names.indexOf(c.name.toLowerCase());
          if (i >= 0 && links[c.id]) {
            await placeCard(links[c.id], c.name, slot++);
            names.splice(i, 1);
          }
        }
      }
      if (names.length) OBR.notification.show(`No linked card for: ${names.join(", ")}`, "WARNING");
      return;
    }
    case "done": {
      const adv = currentAdventure();
      if (!adv || state.encounter == null) return;
      const d = new Set(state.campaign.done[adv.id] ?? []);
      d.add(state.encounter);
      state.campaign.done[adv.id] = Array.from(d);
      const encs = adv.encounters ?? [];
      const idx = encs.findIndex((x) => x.n === state.encounter);
      const next = encs.slice(idx + 1).find((x) => !d.has(x.n));
      if (!next && encs.every((x) => d.has(x.n)) && !state.campaign.finished.includes(adv.id)) {
        state.campaign.finished.push(adv.id);
        OBR.notification.show(`${adv.title} finished! 🎉`, "SUCCESS");
      }
      state.encounter = next?.n ?? state.encounter;
      state.campaign.encounter = state.encounter;
      await setCampaign(state.campaign);
      return render();
    }
    case "addhero": {
      const name = $<HTMLInputElement>("#newhero")?.value.trim();
      if (!name) return;
      state.campaign.party.push({ playerId: `npc-${Date.now()}`, playerName: name, hero: "", product: "", card: "" });
      await setCampaign(state.campaign);
      return;
    }
    case "savecamp": {
      state.campaign.name = $<HTMLInputElement>("#cname").value || "Campaign";
      state.campaign.notes = $<HTMLTextAreaElement>("#notes").value.slice(0, 4000);
      await setCampaign(state.campaign);
      OBR.notification.show("Campaign saved", "SUCCESS");
      return;
    }
  }
}

async function setHero(playerId: string, playerName: string, value: string) {
  const c = state.campaign;
  c.party = c.party.filter((m) => m.playerId !== playerId);
  if (value) {
    const [pid, cid] = value.split("|");
    const p = await product(pid);
    const card = p?.cards.find((x) => x.id === cid);
    const links = await getLinks(pid);
    c.party.push({ playerId, playerName, hero: card?.name ?? cid, product: pid, card: cid, cardUrl: links[cid]?.image.url });
  }
  await setCampaign(c);
}

// ------------------------------------------------- players' story modal

async function shownView() {
  const draw = (s: Shown | null) => {
    app.innerHTML = `<div class="shown"><h1>${esc(s?.title ?? "")}</h1>${(s?.text ?? "").split(/\n\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}
      <button class="big" id="close">Got it!</button></div>`;
    $("#close").addEventListener("click", () => OBR.modal.close(KEY.shown));
  };
  draw(await getShown());
  OBR.room.onMetadataChange((m) => draw((m[KEY.shown] as Shown) ?? null));
}

window.addEventListener("error", (e) => showFatal(e.message));
window.addEventListener("unhandledrejection", (e) => showFatal(String(e.reason?.message ?? e.reason)));
function showFatal(msg: string) {
  if (!app.querySelector("nav")) app.innerHTML = `<main><p class="err">Hero Kids couldn't start: ${esc(msg)}</p></main>`;
}
OBR.onReady(() => boot().catch((e) => showFatal(String(e?.message ?? e))));
