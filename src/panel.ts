import OBR, { Player } from "@owlbear-rodeo/sdk";
import "./style.css";
import { allProducts, forget, libraryHealthy, loadFolder, loadedIndex, product } from "./library";
import {
  CUSTOM_ID, CustomDef, CustomKind, blankDef, deleteDef, exportCustom, importCustom, isCreature, listDefs, markUploaded,
  pendingUploads, previewUrl, rebuildProduct, saveDef,
} from "./custom";
import { EXT, WEATHER, WeatherType, applySideInitiative, currentWeather, presetRangesForScene, setWeather, suggestWeather } from "./compat";
import { esc, renderMarkdown, section } from "./md";
import {
  ArtKind, blobFor, uploadCustomArt, getLinks, kindProgress, setSetupFlag, setupFlag, getStatus, linkArt, placeCard, sceneMarker, showMap, spawn, uploadArt, uploadScenes,
} from "./owl";
import {
  FACES, KEY, RollMessage, TokenMeta, best, cardSummary, d6, emptyCampaign, getCampaign, getShown, heroClass, setCampaign,
} from "./shared";
import type { Campaign, Encounter, PartyMember, Product, Shown } from "./types";
import { BoardCtx, initSound, playerSoundHtml, soundboardHtml, wirePlayerSound, wireSoundboard } from "./soundboard";

/** Readable text for any thrown value (Owlbear rejects with plain objects, not Errors). */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  const o = e as Record<string, unknown> | null;
  const inner = o && typeof o === "object" ? (o.message ?? (o.error as Record<string, unknown>)?.message ?? o.name ?? o.error) : undefined;
  if (typeof inner === "string") return inner;
  try {
    return JSON.stringify(e).slice(0, 300);
  } catch {
    return String(e);
  }
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;
const app = $("#app");

type Tab = "play" | "dice" | "campaign" | "rules" | "library" | "create";
const state = {
  role: "PLAYER" as "GM" | "PLAYER",
  tab: "play" as Tab,
  campaign: emptyCampaign() as Campaign,
  players: [] as Player[],
  me: { id: "", name: "" },
  products: [] as Product[],
  encounter: null as string | null, // selected encounter id, "0" = intro
  follow: true, // follow the open scene
  clearMonsters: true, // remove last encounter's monsters when showing a new map
  showGallery: false,
  showAdvanced: false,
  // whose turn it is, from Owlbear's Initiative Tracker (any device)
  turn: null as null | { kind: "hero" | "monster"; member?: string; name: string },
  manualMember: null as string | null, // this device's dropdown choice
  editing: null as CustomDef | null, // Create tab editor
  editPicture: undefined as Blob | undefined,
  editPreview: "",
  rolls: [] as RollMessage[],
  dice: { mode: "attack" as "attack" | "test", attack: 2, armor: 1, pool: 2, difficulty: 4, label: "" },
  rulesQuery: "",
  busy: "" as string,
  storageError: "" as string,
  libraryBroken: false,
  busyCancel: false, // only Owlbear dialogs can be abandoned
  customFiguresSent: false, // Create tab: figures uploaded, cards next
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
    state.storageError = errText(e);
  }
  if (state.role === "PLAYER") state.tab = "campaign";
  if (state.role === "GM" && state.products.length) {
    state.libraryBroken = !(await libraryHealthy().catch(() => false));
  }
  if (state.role === "GM" && (!state.products.length || state.libraryBroken)) state.tab = "library";
  state.encounter = state.campaign.encounter != null ? String(state.campaign.encounter) : null;
  await initSound(state.role, () => void render()).catch((e) => console.warn("[Hero Kids] sound", e));

  OBR.room.onMetadataChange(async () => {
    state.campaign = await getCampaign();
    render();
  });
  OBR.party.onChange((p) => {
    state.players = p;
    if (state.tab === "campaign") render();
  });
  const watchTurn = async () => {
    if (!(await OBR.scene.isReady())) return;
    const items = await OBR.scene.items.getItems((i) => KEY.token in i.metadata && EXT.initiative in i.metadata);
    const act = items.find((i) => (i.metadata[EXT.initiative] as { active?: boolean }).active);
    const t = act ? (act.metadata[KEY.token] as TokenMeta) : null;
    const next = t ? { kind: t.kind, member: t.member, name: t.name } : null;
    if (JSON.stringify(next) === JSON.stringify(state.turn)) return;
    state.turn = next;
    // a new turn for one of this device's heroes takes over the dropdown choice
    if (next?.member && myMembers().some((m) => m.id === next.member)) state.manualMember = next.member;
    if (state.tab === "campaign" || state.tab === "dice") render();
  };
  OBR.scene.items.onChange(() => void watchTurn());
  OBR.scene.onReadyChange((r) => r && void watchTurn());
  void watchTurn();
  OBR.broadcast.onMessage(KEY.roll, ({ data }) => {
    state.rolls.unshift(data as RollMessage);
    state.rolls = state.rolls.slice(0, 20);
    if (state.tab === "dice") render();
  });
  if (state.role === "GM") refreshPartyCards().catch(() => {});
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
    OBR.scene.onReadyChange((ready) => {
      if (!ready) return;
      follow();
      presetRangesForScene().catch(() => {});
    });
    let lastMap = "";
    OBR.scene.items.onChange(async () => {
      const m = await sceneMarker();
      const key = m ? `${m.product}/${m.map}` : "";
      if (key === lastMap) return;
      lastMap = key;
      await follow();
      if (state.tab === "play") render();
    });
    follow();
    if (await OBR.scene.isReady()) presetRangesForScene().catch(() => {});
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
      ? [["play", "Play"], ["dice", "Dice"], ["campaign", "Campaign"], ["create", "Create"], ["rules", "Rules"], ["library", "Setup"]]
      : [["campaign", "Heroes"], ["dice", "Dice"]];
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
    else if (tab === "create") body = await createView();
    else body = await libraryView();
  } catch (e) {
    body = `<p class="err">${esc(errText(e))}</p>`;
  }
  if (gen !== renderGen || tab !== state.tab) return; // a newer render superseded this one
  const busy =
    (state.busy ? `<div class="busy"><span>${esc(state.busy)}</span>${state.busyCancel ? `<button class="cancel" data-cancel-busy>Cancel</button>` : ""}</div>` : "") +
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
  const links = await getLinks(adv.id);
  const linked = adv.maps.some((m) => m.id in (links ?? {}));
  const setup = !linked && adv.maps.length
    ? `<div class="note">This adventure's maps aren't linked yet — finish the <b>Setup</b> checklist.${status.scenes ? "" : ""}</div>`
    : "";
  let detail = "";
  if (state.encounter === "0" || state.encounter === null) {
    detail = `<h2>Introduction</h2>${renderMarkdown(adv.intro_md ?? "", { shareButtons: true })}`;
  } else {
    const e = encs.find((x) => x.n === state.encounter);
    if (e) detail = await encounterDetail(adv, e, done.includes(e.n));
  }
  const gallery = await mapGallery(adv);
  const sounds = await soundboardHtml(await soundContext(adv));
  return `${pick}<div class="muted small">${esc(meta)} <label class="inline"><input type="checkbox" id="follow" ${state.follow ? "checked" : ""}> follow the table</label></div>${setup}${gallery}${sounds}${chips}<article id="detail">${detail}</article>`;
}

/** The soundboard follows the map on the table, else the selected encounter's map, else the whole adventure. */
async function soundContext(adv: Product): Promise<BoardCtx> {
  const marker = (await OBR.scene.isReady()) ? await sceneMarker() : undefined;
  const enc = adv.encounters?.find((e) => e.n === state.encounter);
  const mapId = marker?.product === adv.id && marker.map ? marker.map : enc?.map;
  const map = adv.maps.find((m) => m.id === mapId);
  const encs = adv.encounters ?? [];
  if (!map) return { pid: adv.id, map: "_", label: adv.title, text: [adv.title, adv.intro_md ?? "", ...encs.map((e) => e.md)].join("\n") };
  const mine = encs.filter((e) => e.map === map.id);
  return { pid: adv.id, map: map.id, label: map.name, text: [map.name, ...mine.map((e) => e.md), mine.length ? "" : adv.intro_md ?? ""].join("\n") };
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
    <div class="maprow">${map
      ? `<span class="muted small">Map: ${esc(map.name)}</span> ${onScreen ? '<span class="pill">on the table</span>' : `<button data-act="showmap" data-p="${adv.id}" data-map="${map.id}">Show on table</button>`}`
      : `<span class="muted small">No single map for this encounter — pick one from <b>Maps</b> above.</span>`}</div>
    ${body}
    ${onScreen ? await weatherRow(e) : ""}
    <h3>Monsters</h3>${monsters}${addMonsterHtml()}
    <div class="btns end"><button class="ghost" data-act="party">Place hero tokens</button>
    <button data-act="done">${isDone ? "Done ✓ — next" : "Mark done & next"}</button></div>`;
}

const thumbs = new Map<string, string>();
async function thumbUrl(pid: string, file: string) {
  const k = `${pid}/${file}`;
  if (!thumbs.has(k)) {
    const blob = await blobFor(pid, file).catch(() => undefined);
    thumbs.set(k, blob ? URL.createObjectURL(blob) : "");
  }
  return thumbs.get(k)!;
}

async function mapGallery(adv: Product): Promise<string> {
  if (!adv.maps.length) return "";
  const marker = (await OBR.scene.isReady()) ? await sceneMarker() : undefined;
  const links = await getLinks(adv.id);
  const cards = [];
  for (const m of adv.maps) {
    const on = marker?.product === adv.id && marker?.map === m.id;
    const url = state.showGallery ? await thumbUrl(adv.id, m.file) : "";
    cards.push(`<button class="mapcard ${on ? "on" : ""}" data-act="showmap" data-p="${adv.id}" data-map="${m.id}" title="Put this map on the table" ${links[m.id] ? "" : "data-unlinked=1"}>
      ${url ? `<img src="${url}" alt="">` : ""}<span>${esc(m.name)}${on ? " ●" : ""}</span></button>`);
  }
  return `<details class="gallery" ${state.showGallery ? "open" : ""}><summary>Maps (${adv.maps.length}) — click one to put it on the table</summary>
    <label class="inline small"><input type="checkbox" id="clearmon" ${state.clearMonsters ? "checked" : ""}> clear monsters when changing maps</label>
    <div class="mapgrid">${cards.join("")}</div></details>`;
}

async function weatherRow(e: Encounter): Promise<string> {
  const cur = await currentWeather().catch(() => null);
  const tip = suggestWeather(e.md);
  const chip = (t: WeatherType | null, label: string) =>
    `<button class="chip ${cur === t ? "on" : ""}" data-act="weather" data-w="${t ?? ""}">${label}${t && t === tip ? " ★" : ""}</button>`;
  return `<h3>Weather</h3><div class="chips">${chip(null, "None")}${WEATHER.map((w) => chip(w.type, w.label)).join("")}</div>
    <p class="muted small">Needs Owlbear's <b>Weather</b> extension enabled in the room.${tip ? " ★ = suggested by the encounter text." : ""}</p>`;
}

function addMonsterHtml(): string {
  const groups = state.products
    .filter((p) => p.tokens.some((t) => p.cards.find((c) => c.id === t.card)?.kind === "monster"))
    .map((p) => `<optgroup label="${esc(p.title)}">${p.tokens
      .filter((t) => p.cards.find((c) => c.id === t.card)?.kind === "monster")
      .map((t) => `<option value="${p.id}|${t.id}">${esc(t.name)}</option>`)
      .join("")}</optgroup>`)
    .join("");
  return `<details class="addmon"><summary>Add other monsters (any book or custom)</summary>
    <div class="btns"><select id="addmon"><option value="">— monster —</option>${groups}</select>
    <input id="addmoncount" type="number" min="1" max="12" value="1" style="width:64px"><button data-act="addmon">Place</button></div></details>`;
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
  const top = state.role === "PLAYER" ? turnBanner() + heroSwitcher() : turnBanner();
  return `${state.role === "PLAYER" ? playerSoundHtml() : ""}${top}<div class="seg"><button data-mode="attack" class="${d.mode === "attack" ? "on" : ""}">Attack</button><button data-mode="test" class="${d.mode === "test" ? "on" : ""}">Ability test</button></div>
    ${form}
    <input id="rlabel" placeholder="What for? (optional)" value="${esc(d.label)}">
    <div class="btns"><button class="big" data-act="roll">Roll!</button>${state.role === "GM" ? `<button class="ghost" data-act="init">Initiative</button>` : ""}</div>
    <ul class="hist">${hist || '<li class="muted">Rolls from everyone at the table show up here.</li>'}</ul>`;
}

/** The hero card image, with a readable text card shown instead if the image can't load. */
function extrasHtml(m: PartyMember): string {
  if (!m.extras?.length) return "";
  return `<h3>Items & skills</h3>${m.extras
    .map((x) => `<div class="extra">${x.url ? `<img src="${esc(x.url)}" alt="" data-hide-broken="1">` : ""}<div><b>${esc(x.name)}</b> <span class="muted small">${esc(x.kind)}</span><div class="small">${esc(x.text)}</div></div></div>`)
    .join("")}`;
}

function heroCardHtml(m: PartyMember): string {
  if (!m.card) return `<p class="muted">No hero picked yet — your GM chooses one in the Campaign tab.</p>`;
  const rules = (m.cardText ?? []).map((r) => `<div class="rule"><b>${esc(r.title)}</b>${r.text ? `<div>${esc(r.text)}</div>` : ""}</div>`).join("");
  const textCard = `<div class="textcard"><div class="tc-head">${esc(heroClass(m.hero))}</div>${rules || `<div class="muted small">Ask your GM for this hero card.</div>`}${m.health ? `<div class="rule"><b>Health:</b> ${"♥".repeat(m.health)}</div>` : ""}</div>`;
  if (!m.cardUrl) return textCard;
  return `<img class="card" src="${esc(m.cardUrl)}" alt="${esc(m.hero)} hero card" data-fallback="1"><div class="fallback" hidden>${textCard}</div>`;
}

/** Heroes assigned to this device. */
const myMembers = (): PartyMember[] => state.campaign.party.filter((m) => m.playerId && m.playerId === state.me.id);

/** The hero this device is playing right now: the Initiative Tracker's turn if it's ours, else the dropdown. */
function currentMember(): PartyMember | undefined {
  const mine = myMembers();
  const byTurn = state.turn?.member ? mine.find((m) => m.id === state.turn!.member) : undefined;
  return byTurn ?? mine.find((m) => m.id === state.manualMember) ?? mine[0];
}

const memberLabel = (m: PartyMember) => (m.hero ? `${m.kid} (${heroClass(m.hero)})` : m.kid);

function turnBanner(): string {
  const t = state.turn;
  if (!t) return "";
  const mine = t.member && myMembers().some((m) => m.id === t.member);
  if (t.kind === "monster") return `<div class="turn monster">👹 Monsters' turn — ${esc(t.name)}</div>`;
  return `<div class="turn ${mine ? "mine" : ""}">${mine ? "⭐ Your turn" : "▶ Turn"}: <b>${esc(t.name)}</b></div>`;
}

function heroSwitcher(): string {
  const mine = myMembers();
  if (mine.length < 2) return "";
  const cur = currentMember();
  return `<label class="row">Playing as <select id="playas">${mine
    .map((m) => `<option value="${m.id}" ${m.id === cur?.id ? "selected" : ""}>${esc(memberLabel(m))}</option>`)
    .join("")}</select></label>`;
}

async function roll() {
  const d = state.dice;
  const cur = state.role === "PLAYER" ? currentMember() : undefined;
  const who = cur ? memberLabel(cur) : state.me.name;
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
  if (state.role === "GM" && (await OBR.scene.isReady())) {
    const n = await applySideInitiative(heroes).catch(() => 0);
    if (n) OBR.notification.show(`Initiative Tracker updated: ${heroes ? "heroes" : "monsters"} first`, "INFO");
  }
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
    const mine = myMembers();
    const cur = currentMember();
    const party = c.party.map((m) => `<li><b>${esc(m.kid)}</b> — ${esc(m.hero || "no hero yet")}</li>`).join("");
    const body = !mine.length
      ? `<p class="muted">Your GM hasn't put a hero on this device yet.</p>`
      : `${heroSwitcher()}${cur ? `<h2>${esc(memberLabel(cur))}</h2>${heroCardHtml(cur)}${extrasHtml(cur)}` : ""}`;
    return `${playerSoundHtml()}${turnBanner()}${body}<h3>${esc(c.name)} — the party</h3><ul>${party || "<li class='muted'>No heroes yet.</li>"}</ul>`;
  }
  const heroes = heroCards();
  const heroOpts = (sel: string) =>
    `<option value="">— hero card —</option>` +
    Array.from(new Set(heroes.map((h) => h.product.title)))
      .map((t) => `<optgroup label="${esc(t)}">${heroes.filter((h) => h.product.title === t).map((h) => `<option value="${h.product.id}|${h.id}" ${sel === `${h.product.id}|${h.id}` ? "selected" : ""}>${esc(h.name)}</option>`).join("")}</optgroup>`)
      .join("");
  const players = state.players.filter((p) => p.role === "PLAYER");
  const devOpts = (sel: string) =>
    `<option value="">No device (GM rolls)</option>` +
    players.map((p) => `<option value="${esc(p.id)}" ${p.id === sel ? "selected" : ""}>${esc(p.name)}</option>`).join("") +
    (sel && !players.some((p) => p.id === sel) ? `<option value="${esc(sel)}" selected>(offline device)</option>` : "");
  const rows = c.party
    .map((m) => `<tr>
      <td><input data-mf="kid" data-m="${esc(m.id)}" value="${esc(m.kid)}" placeholder="Kid's name"></td>
      <td><select data-mf="hero" data-m="${esc(m.id)}">${heroOpts(m.product ? `${m.product}|${m.card}` : "")}</select>
          <select data-mf="device" data-m="${esc(m.id)}">${devOpts(m.playerId)}</select></td>
      <td><button class="ghost x" data-act="delhero" data-m="${esc(m.id)}" title="Remove">×</button></td></tr>`)
    .join("");
  const prog = adventures()
    .map((a) => {
      const d = c.done[a.id]?.length ?? 0, t = a.encounters?.length ?? 0;
      return d || c.finished.includes(a.id) ? `<li>${esc(a.title)} — ${c.finished.includes(a.id) ? "finished ✓" : `${d}/${t} encounters`}</li>` : "";
    })
    .join("");
  return `${turnBanner()}<label>Campaign name<input id="cname" value="${esc(c.name)}"></label>
    <p class="muted small">Each Owlbear room keeps its own campaign. Make one room per campaign and add this extension to each.</p>
    <h3>Party</h3>
    <p class="muted small">One row per hero. Several heroes can share a device (e.g. both kids on one iPad) — the device then follows the Initiative Tracker to show whoever's turn it is.</p>
    <table class="party">${rows || `<tr><td class="muted">No heroes yet.</td></tr>`}</table>
    <div class="btns"><button class="ghost" data-act="addhero">+ Add hero</button></div>
    <h3>Progress</h3><ul>${prog || "<li class='muted'>No adventures played yet.</li>"}</ul>
    <label>Notes (loot, names, inside jokes)<textarea id="notes" rows="5">${esc(c.notes)}</textarea></label>
    <div class="btns"><button data-act="savecamp">Save</button></div>`;
}

// ---------------------------------------------------------------- create

const KIND_LABEL: Record<CustomKind, string> = { hero: "Hero", monster: "Monster", pet: "Pet", item: "Item", skill: "Skill" };

function libraryFigureOptions(sel: string) {
  return state.products
    .filter((p) => p.id !== CUSTOM_ID && p.tokens.length)
    .map((p) => `<optgroup label="${esc(p.title)}">${p.tokens
      .map((t) => `<option value="${p.id}|${t.id}" ${sel === `${p.id}|${t.id}` ? "selected" : ""}>${esc(t.name)}</option>`)
      .join("")}</optgroup>`)
    .join("");
}

function editorHtml(d: CustomDef): string {
  const f = (path: string, label: string, value: string | number, attrs = "") =>
    `<label>${label}<input data-cf="${path}" value="${esc(String(value))}" ${attrs}></label>`;
  const ta = (path: string, label: string, value: string) =>
    `<label>${label}<textarea data-cf="${path}" rows="2">${esc(value)}</textarea></label>`;
  const num = (path: string, label: string, value: number, min: number, max: number) =>
    `<label class="num">${label}<input type="number" data-cf="${path}" value="${value}" min="${min}" max="${max}"></label>`;
  const imgSel = d.image?.source === "lib" ? `${d.image.product}|${d.image.token}` : "";
  const creature = isCreature(d.kind);
  return `<div class="editor">
    <h3>${d.name ? "Edit" : "New"} ${KIND_LABEL[d.kind].toLowerCase()}</h3>
    ${f("name", "Name", d.name, 'placeholder="e.g. Grumble the Goblin King"')}
    <label>Picture <input type="file" id="cpic" accept="image/*"></label>
    ${creature ? `<label>…or use a figure from your books<select data-cf="libimg"><option value="">—</option>${libraryFigureOptions(imgSel)}</select></label>` : ""}
    ${creature ? `<div class="grid4">
        ${num("dice.melee", "Melee", d.dice.melee, 0, 6)}${num("dice.ranged", "Ranged", d.dice.ranged, 0, 6)}
        ${num("dice.magic", "Magic", d.dice.magic, 0, 6)}${num("dice.armor", "Armor", d.dice.armor, 0, 6)}
        ${num("health", "Health", d.health, 1, 5)}${num("size", "Size (squares)", d.size, 1, 4)}
      </div>
      <label>Main attack<select data-cf="attack.type">${["Melee", "Ranged", "Magic"].map((t) => `<option ${t === d.attack.type ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      ${f("attack.name", "Attack name", d.attack.name)}${ta("attack.text", "What it does", d.attack.text)}
      ${f("special.name", "Special action", d.special.name)}${ta("special.text", "What it does", d.special.text)}
      ${f("bonus.name", "Bonus ability", d.bonus.name)}${ta("bonus.text", "What it does", d.bonus.text)}`
    : `${f("itemType", "Type line", d.itemType, d.kind === "skill" ? 'placeholder="Skill / Special Action / Bonus Ability"' : 'placeholder="Item / Equipment"')}
       ${ta("effect", "Effect", d.effect)}`}
    <div class="preview">${state.editPreview ? `<img src="${state.editPreview}" alt="Card preview">` : `<p class="muted small">Preview appears here.</p>`}</div>
    <div class="btns"><button data-act="csave">Save</button><button class="ghost" data-act="ccancel">Cancel</button></div>
  </div>`;
}

async function createView(): Promise<string> {
  if (state.editing) return editorHtml(state.editing);
  const defs = await listDefs();
  const pending = await pendingUploads();
  const custom = await product(CUSTOM_ID);
  const links = await getLinks(CUSTOM_ID);
  const party = state.campaign.party;
  const rows = [];
  for (const d of defs) {
    const card = custom?.cards.find((c) => c.id === d.id);
    const url = card ? await thumbUrl(CUSTOM_ID, card.file) : "";
    const linked = !!links[d.id];
    const give = !isCreature(d.kind) && party.length
      ? `<select data-give="${d.id}"><option value="">Give to…</option>${party.map((m) => `<option value="${m.id}">${esc(m.kid)}</option>`).join("")}</select>` : "";
    const place = linked ? `<button class="ghost" data-act="cplace" data-c="${d.id}">${d.kind === "monster" ? "Place" : "Card on table"}</button>` : "";
    rows.push(`<div class="cust">${url ? `<img src="${url}" alt="">` : ""}<div><b>${esc(d.name || "Unnamed")}</b>
      <div class="muted small">${KIND_LABEL[d.kind]}${d.uploadedRev === d.rev ? (linked ? " · ready" : " · uploaded — needs Link") : " · not uploaded yet"}</div>
      <div class="btns"><button class="ghost" data-act="cedit" data-c="${d.id}">Edit</button>${place}${give}<button class="ghost x" data-act="cdel" data-c="${d.id}" title="Delete">×</button></div></div></div>`);
  }
  return `<p class="muted small">Make your own heroes, monsters, pets, items and skills. They get a card (and a token for creatures), show up in the party picker and the monster lists, and work with health, initiative and dice like everything else.</p>
    <div class="btns">${(Object.keys(KIND_LABEL) as CustomKind[]).map((k) => `<button class="ghost" data-act="cnew" data-k="${k}">+ ${KIND_LABEL[k]}</button>`).join("")}</div>
    ${pending.length ? `<div class="note">${pending.length} new or changed — upload to Owlbear:
        ${pending.some((d) => isCreature(d.kind)) ? `<button ${state.customFiguresSent ? 'class="ghost"' : ""} data-act="cupload" data-kind="tokens">1. Figures${state.customFiguresSent ? " ✓" : ""}</button> <button data-act="cupload" data-kind="cards">2. Cards</button>` : `<button data-act="cupload" data-kind="cards">Upload cards</button>`}
        <div class="muted small">Each opens one Owlbear dialog: figures go to Characters, cards to Props. Link them afterwards.</div></div>`
      : defs.length && defs.some((d) => !links[d.id]) ? `<div class="note">Uploaded — when Owlbear finishes, link them (select the “Custom” images, then Done):
        ${defs.some((d) => isCreature(d.kind)) ? `<button data-act="clink" data-kind="tokens">Link figures</button> ` : ""}<button data-act="clink" data-kind="cards">Link cards</button></div>` : ""}
    <div class="custlist">${rows.join("") || `<p class="muted">Nothing yet.</p>`}</div>
    <details class="advanced"><summary>Back up / restore</summary>
      <p class="muted small">Custom content is stored in this browser. Save a backup file into your <code>_Owlbear Library</code> folder now and then.</p>
      <div class="btns"><button class="ghost" data-act="cexport">Download backup</button><label class="inline">Restore <input type="file" id="cimport" accept="application/json,.json"></label></div>
    </details>`;
}

async function refreshPreview() {
  if (!state.editing) return;
  const url = await previewUrl(state.editing, state.editPicture).catch(() => "");
  if (state.editPreview) URL.revokeObjectURL(state.editPreview);
  state.editPreview = url;
  const box = app.querySelector(".preview");
  if (box) box.innerHTML = url ? `<img src="${url}" alt="Card preview">` : "";
}
let previewTimer = 0;
const schedulePreview = () => { clearTimeout(previewTimer); previewTimer = window.setTimeout(refreshPreview, 300); };

function setPath(obj: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
}

async function reloadProducts() {
  forget(CUSTOM_ID);
  state.products = await allProducts();
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

const KINDS = [
  { kind: "tokens", title: "Figures", short: "figures", what: "hero, monster and pet figures", type: "Characters" },
  { kind: "cards", title: "Cards", short: "cards", what: "hero, monster, item and skill cards", type: "Props" },
  { kind: "maps", title: "Maps", short: "maps", what: "map images", type: "Maps" },
] as const;

async function libraryView(): Promise<string> {
  const idx = await loadedIndex();
  const legacy = !!(await setupFlag("uploaded")); // older versions sent everything as Props in one batch
  const table = await setupFlag("table");
  const sceneOpen = await OBR.scene.isReady();
  const step = (n: number, done: boolean, active: boolean, title: string, body: string, redo = "") =>
    `<li class="step ${done ? "done" : ""} ${active ? "active" : ""}"><div class="num">${done ? "✓" : n}</div><div class="grow"><b>${title}</b>${active || !done ? `<div class="small">${body}</div>` : redo ? `<div class="redo">${redo}</div>` : ""}</div></li>`;
  // Owlbear files a whole upload under one type, so each kind gets its own upload + link.
  // Owlbear doesn't say when an upload finishes; a kind is done once it's linked after its upload.
  const kinds: ((typeof KINDS)[number] & { sent: boolean; done: boolean; prog: { linked: number; total: number } })[] = [];
  for (const k of KINDS) {
    const up = await setupFlag(`up-${k.kind}`) ?? (legacy && k.kind === "cards" ? "legacy" : undefined); // cards were already Props
    const lk = await setupFlag(`link-${k.kind}`) ?? (legacy && k.kind === "cards" ? "legacy" : undefined);
    const prog = await kindProgress(state.products, k.kind);
    const sent = !!up;
    const done = sent && !!lk && lk >= up! && prog.linked >= prog.total;
    kinds.push({ ...k, sent, done, prog });
  }
  const s1 = idx.length > 0 && !state.libraryBroken, s4 = !!table;
  const firstOpen = kinds.findIndex((k) => !k.done);
  const next = !s1 ? 1 : firstOpen >= 0 ? 2 + firstOpen : !s4 ? 5 : 6;
  const kindStep = (k: typeof kinds[number], n: number) => step(n, k.done, next === n,
    `${k.title} → Owlbear ${k.type} ${k.sent ? `(${k.prog.linked}/${k.prog.total} linked)` : ""}`,
    !k.sent
      ? `${k.prog.total} ${k.what}. Owlbear's dialog opens on <b>${k.type}</b>: leave the folder as is, click <b>UPLOAD IMAGES</b> and wait for Owlbear's upload to finish.
         <div class="btns"><button data-act="upkind" data-kind="${k.kind}">Upload ${k.short}</button></div>`
      : `When Owlbear's upload has finished, link them: in the picker click the first image, <b>shift-click the last</b>, then <b>Done</b>.
         <div class="btns"><button data-act="linkkind" data-kind="${k.kind}">Link ${k.short}</button>
         <button class="ghost" data-act="upkind" data-kind="${k.kind}">Open the upload dialog again</button></div>`,
    `<button class="ghost tiny" data-act="upkind" data-kind="${k.kind}">Upload again</button> <button class="ghost tiny" data-act="linkkind" data-kind="${k.kind}">Link again</button>`);
  const legacyNote = legacy && kinds.some((k) => !k.done)
    ? `<div class="note">An earlier version uploaded everything as <b>Props</b>. Cards are fine there; re-do <b>figures</b> and <b>maps</b> below so Owlbear files them as Characters and Maps. Afterwards you can delete the old figure and map copies from Owlbear's Props.</div>`
    : "";
  const checklist = `${legacyNote}<ol class="setup">
    ${step(1, s1, next === 1, "Choose your library folder",
      `${state.libraryBroken ? `<div class="err">Safari lost the stored copy of your library — please choose the folder again (nothing needs re-uploading).</div>` : ""}
       Pick <code>DriveThruRPG/Hero Forge Games/_Owlbear Library</code>.${kinds[0].sent ? "" : " The first Owlbear upload opens by itself afterwards."}
       <input type="file" id="folder" webkitdirectory multiple>`,
      `<label class="inline small">Load again <input type="file" id="folder" webkitdirectory multiple></label>`)}
    ${kinds.map((k, i) => kindStep(k, 2 + i)).join("")}
    ${step(5, s4, next === 5, "Create the table scene (one Owlbear dialog)",
      `Makes an empty “Hero Kids table” scene. Open it from Owlbear's scenes list and leave it open while you play.
       <div class="btns"><button data-act="tablescene">Create table scene</button></div>`,
      `<span class="muted small">Scenes and uploads live in your Owlbear account — in a new room just open “Hero Kids table”.</span> <button class="ghost tiny" data-act="tablescene">Make another</button>`)}
    ${next === 6 ? `<li class="step done"><div class="num">★</div><div><b>Ready.</b> ${sceneOpen ? "Head to <b>Campaign</b> to pick heroes, then <b>Play</b>." : "Open the “Hero Kids table” scene, then go to <b>Play</b>."}</div></li>` : ""}
  </ol>`;
  if (!s1) return checklist + `<p class="muted small version">Hero Kids Table v${esc(__HK_VERSION__)}</p>`;
  const rows = [];
  const btn = (act: string, id: string, done: boolean, label: string, title: string) =>
    `<button class="${done ? "ghost" : ""}" data-act="${act}" data-p="${id}" title="${title}">${label}${done ? " ✓" : ""}</button>`;
  if (state.showAdvanced) {
    for (const e of idx) {
      const st = await getStatus(e.id);
      const links = Object.keys(await getLinks(e.id)).length;
      rows.push(`<tr><td><b>${esc(e.title)}</b><div class="muted small">${e.kind} · ${e.maps} maps · ${e.cards} cards · ${e.tokens} tokens</div></td>
        <td class="acts">
          ${e.maps ? btn("upmaps", e.id, !!st.maps, "Maps", "Upload this book's map images") : ""}
          ${e.tokens ? btn("uptokens", e.id, !!st.tokens, "Tokens", "Upload stand-up figures") : ""}
          ${e.cards ? btn("upcards", e.id, !!st.cards, "Cards", "Upload cards") : ""}
          ${e.tokens + e.cards + e.maps ? `<button class="${links ? "ghost" : ""}" data-act="link" data-p="${e.id}">${links ? `Linked ${links}` : "Link"}</button>` : ""}
        </td></tr>`);
    }
  }
  return `${checklist}
    <p class="muted small version">Hero Kids Table v${esc(__HK_VERSION__)}</p>
    <details class="advanced" ${state.showAdvanced ? "open" : ""}><summary>Advanced</summary>
      <p class="muted small">Re-load a newer library folder: <input type="file" id="folder2" webkitdirectory multiple></p>
      <div class="btns col">
        <button class="ghost" data-act="allscenes">Also make one Owlbear scene per map (optional)</button>
      </div>
      <p class="muted small">Book by book:</p>
      <table class="lib">${rows.join("")}</table>
    </details>`;
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
  $("#clearmon")?.addEventListener("change", (ev) => { state.clearMonsters = (ev.target as HTMLInputElement).checked; });
  $<HTMLDetailsElement>("details.advanced")?.addEventListener("toggle", (ev) => {
    const open = (ev.target as HTMLDetailsElement).open;
    if (open !== state.showAdvanced) { state.showAdvanced = open; render(); }
  });
  $<HTMLDetailsElement>("details.gallery")?.addEventListener("toggle", (ev) => {
    const open = (ev.target as HTMLDetailsElement).open;
    if (open !== state.showGallery) { state.showGallery = open; render(); }
  });
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
  app.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-mf]").forEach((el) =>
    el.addEventListener("change", () => setMember(el.dataset.m!, el.dataset.mf as "kid" | "hero" | "device", el.value)));
  app.querySelectorAll<HTMLImageElement>("img[data-hide-broken]").forEach((img) =>
    img.addEventListener("error", () => (img.hidden = true)));
  app.querySelectorAll<HTMLImageElement>("img[data-fallback]").forEach((img) => {
    const swap = () => {
      img.hidden = true;
      const fb = img.nextElementSibling as HTMLElement | null;
      if (fb) fb.hidden = false;
    };
    if (img.complete && img.naturalWidth === 0) swap();
    else img.addEventListener("error", swap);
  });
  // create tab editor
  app.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-cf]").forEach((el) =>
    el.addEventListener("input", () => {
      const d = state.editing;
      if (!d) return;
      const path = el.dataset.cf!;
      if (path === "libimg") {
        const [p, t] = el.value.split("|");
        d.image = el.value ? { source: "lib", product: p, token: t } : undefined;
        state.editPicture = undefined;
      } else setPath(d as unknown as Record<string, unknown>, path, el.type === "number" ? Math.max(0, +el.value || 0) : el.value);
      schedulePreview();
    }));
  $<HTMLInputElement>("#cpic")?.addEventListener("change", (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (f) (state.editPicture = f), schedulePreview();
  });
  app.querySelectorAll<HTMLSelectElement>("[data-give]").forEach((sel) =>
    sel.addEventListener("change", () => giveTo(sel.dataset.give!, sel.value)));
  $<HTMLInputElement>("#cimport")?.addEventListener("change", async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      const n = await importCustom(f);
      await reloadProducts();
      OBR.notification.show(`Restored ${n} custom entries`, "SUCCESS");
    } catch (e) {
      OBR.notification.show(errText(e), "ERROR");
    }
    render();
  });
  $<HTMLSelectElement>("#playas")?.addEventListener("change", (ev) => {
    state.manualMember = (ev.target as HTMLSelectElement).value;
    render();
  });
  // library
  const folderInputs = [$<HTMLInputElement>("#folder"), $<HTMLInputElement>("#folder2")].filter(Boolean);
  for (const fi of folderInputs) fi.addEventListener("change", async (ev) => {
    const files = (ev.target as HTMLInputElement).files;
    if (!files?.length) return;
    try {
      await loadFolder(files, (d, t, label) => { state.busy = `Loading library… ${d}/${t} (${label})`; render(); });
      state.products = await allProducts();
      state.libraryBroken = false;
      state.busy = "";
      OBR.notification.show(`Library loaded: ${state.products.length} books`, "SUCCESS");
      if (!(await setupFlag("uploaded")) && !(await setupFlag("up-tokens"))) {
        // step 2 starts by itself: Owlbear shows its upload dialog right away
        render();
        return uploadKind("tokens");
      }
    } catch (e) {
      state.busy = "";
      OBR.notification.show(errText(e), "ERROR");
    }
    render();
  });
  app.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => b.addEventListener("click", () => act(b)));
  wireSoundboard();
  wirePlayerSound(() => void render());
  app.querySelectorAll<HTMLButtonElement>("[data-cancel-busy]").forEach((b) => b.addEventListener("click", cancelBusy));
  if (state.busy) app.querySelectorAll<HTMLButtonElement>("main button:not(#soundboard button)").forEach((b) => (b.disabled = true));
}

function showBusyNow(label: string) {
  let el = app.querySelector<HTMLElement>(".busy");
  if (!el) {
    el = document.createElement("div");
    el.className = "busy";
    app.querySelector("nav")?.after(el);
  }
  el.innerHTML = `<span>${esc(label)}</span><button class="cancel" data-cancel-busy>Cancel</button>`;
  el.querySelector("[data-cancel-busy]")?.addEventListener("click", cancelBusy);
  app.querySelectorAll<HTMLButtonElement>("main button").forEach((b) => (b.disabled = true));
}

/** Owlbear's dialogs don't always report back (e.g. closed without uploading) — never leave the panel stuck. */
let busyGen = 0;
function cancelBusy() {
  busyGen++;
  state.busy = "";
  state.busyCancel = false;
  render();
}

async function withBusy(label: string, fn: () => Promise<unknown>) {
  const mine = ++busyGen;
  state.busy = label;
  state.busyCancel = true;
  showBusyNow(label);
  try {
    await fn();
  } catch (e) {
    console.error("[Hero Kids]", label, e);
    OBR.notification.show(`${errText(e)}`, "ERROR");
  } finally {
    // a cancelled dialog that reports back late mustn't clear a newer busy state
    if (mine === busyGen) {
      state.busy = "";
      state.busyCancel = false;
      render();
    }
  }
}

/** Send one kind of art to Owlbear, filed under its proper asset type (one dialog). */
function uploadKind(kind: ArtKind) {
  const k = KINDS.find((x) => x.kind === kind)!;
  return withBusy(`In Owlbear's dialog (${k.type}): click Upload Images`, async () => {
    const n = await uploadArt(state.products, kind);
    OBR.notification.show(`Sending ${n} ${k.short} — when Owlbear's upload finishes, click Link ${k.short}`, "SUCCESS");
  });
}

async function act(b: HTMLButtonElement) {
  const a = b.dataset.act!;
  if (state.busy) return;
  const p = b.dataset.p ? await product(b.dataset.p) : currentAdventure();
  switch (a) {
    case "roll": return roll();
    case "init": return initiative();
    case "scenes":
      if (p) return withBusy(`In Owlbear: pick a folder, then Upload — ${p.maps.length} scenes for ${p.title}`, async () => {
        const n = await uploadScenes([p]);
        OBR.notification.show(`Sent ${n} scenes for ${p.title}`, "SUCCESS");
      });
      return;
    case "uptokens":
    case "upcards":
    case "upmaps": {
      const kind = a.slice(2) as ArtKind;
      if (p) return withBusy(`In Owlbear: ${({ tokens: "Characters", cards: "Props", maps: "Maps" } as const)[kind]} tab → Upload Images (${p.title} ${kind})`, async () => {
        const n = await uploadArt([p], kind);
        OBR.notification.show(`Sent ${n} ${kind} for ${p.title}`, "SUCCESS");
      });
      return;
    }
    case "link":
      if (p) return withBusy(`In Owlbear's picker: select all “${p.title}” images, then Done`, async () => {
        const n = await linkArt([p]);
        OBR.notification.show(`Linked ${n} images for ${p.title}`, n ? "SUCCESS" : "WARNING");
      });
      return;
    case "showmap": {
      const pr = await product(b.dataset.p!);
      const m = pr?.maps.find((x) => x.id === b.dataset.map);
      if (!pr || !m) return;
      return withBusy(`Putting “${m.name}” on the table…`, async () => {
        const r = await showMap(pr, m, { clearMonsters: state.clearMonsters });
        const enc = pr.encounters?.find((e) => e.map === m.id);
        if (state.campaign.adventure !== pr.id) state.campaign.adventure = pr.id;
        if (enc) state.encounter = state.campaign.encounter = enc.n;
        await setCampaign(state.campaign);
        if (r.foreignMaps) OBR.notification.show("This scene has its own map underneath — use an empty “Hero Kids table” scene for best results", "WARNING");
      });
    }
    case "cnew":
      state.editing = blankDef(b.dataset.k as CustomKind);
      state.editPicture = undefined;
      state.editPreview = "";
      await render();
      return refreshPreview();
    case "cedit": {
      const d = (await listDefs()).find((x) => x.id === b.dataset.c);
      if (!d) return;
      state.editing = structuredClone(d);
      state.editPicture = undefined;
      state.editPreview = "";
      await render();
      return refreshPreview();
    }
    case "ccancel":
      state.editing = null;
      return render();
    case "csave": {
      const d = state.editing;
      if (!d) return;
      if (!d.name.trim()) return OBR.notification.show("Give it a name first", "WARNING");
      return withBusy("Drawing the card…", async () => {
        await saveDef(d, state.editPicture);
        state.editing = null;
        await reloadProducts();
        OBR.notification.show(`Saved ${d.name}. Upload it to Owlbear from the Create tab when you're ready.`, "SUCCESS");
      });
    }
    case "cdel": {
      await deleteDef(b.dataset.c!);
      await reloadProducts();
      return render();
    }
    case "cupload": {
      // figures go up as Characters, cards as Props: Owlbear files a whole batch under one type
      const kind = b.dataset.kind as "tokens" | "cards";
      return withBusy(`In Owlbear's dialog (${kind === "tokens" ? "Characters" : "Props"}): click Upload Images`, async () => {
        const pending = new Set((await pendingUploads()).map((d) => d.id));
        const custom = await rebuildProduct();
        const only = { ...custom, cards: custom.cards.filter((c) => pending.has(c.id)), tokens: custom.tokens.filter((t) => pending.has(t.card ?? "")) };
        const n = await uploadCustomArt(only, kind);
        if (kind === "cards") {
          await markUploaded();
          await reloadProducts();
        } else state.customFiguresSent = true;
        OBR.notification.show(`Sending ${n} custom ${kind === "tokens" ? "figures" : "cards"}`, "SUCCESS");
      });
    }
    case "clink": {
      const kind = b.dataset.kind as "tokens" | "cards";
      return withBusy(`In Owlbear's picker (${kind === "tokens" ? "Characters" : "Props"}): select the “Custom” images, then Done`, async () => {
        const custom = await product(CUSTOM_ID);
        if (!custom) return;
        const n = await linkArt([custom], kind);
        await refreshPartyCards();
        OBR.notification.show(`Linked ${n} custom ${kind === "tokens" ? "figures" : "cards"}`, n ? "SUCCESS" : "WARNING");
      });
    }
    case "cplace": {
      const custom = await product(CUSTOM_ID);
      const card = custom?.cards.find((c) => c.id === b.dataset.c);
      if (!custom || !card) return;
      if (card.kind === "monster") {
        const tok = custom.tokens.find((t) => t.card === card.id);
        return withBusy("Placing…", async () => {
          const missing = await spawn([{ name: tok?.name ?? card.name, count: 1 }], [CUSTOM_ID], state.products);
          if (missing.length) OBR.notification.show("Upload and link it first", "WARNING");
        });
      }
      const link = (await getLinks(CUSTOM_ID))[card.id];
      if (link) await placeCard(link, card.name, 0);
      return;
    }
    case "cexport": {
      const blob = await exportCustom();
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(blob);
      a2.download = `hero-kids-custom-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a2);
      a2.click();
      a2.remove();
      return;
    }
    case "addmon": {
      const sel = $<HTMLSelectElement>("#addmon");
      const cnt = Math.max(1, +($<HTMLInputElement>("#addmoncount")?.value ?? 1));
      if (!sel?.value) return;
      const [pid, tid] = sel.value.split("|");
      const pr = state.products.find((x) => x.id === pid);
      const tok = pr?.tokens.find((t) => t.id === tid);
      if (!tok) return;
      return withBusy("Placing monsters…", async () => {
        const missing = await spawn([{ name: tok.name, count: cnt }], [pid], state.products);
        if (missing.length) OBR.notification.show(`No linked token for ${tok.name} — finish Setup / Link`, "WARNING");
      });
    }
    case "upkind":
      return uploadKind(b.dataset.kind as ArtKind);
    case "linkkind": {
      const kind = b.dataset.kind as ArtKind;
      const k = KINDS.find((x) => x.kind === kind)!;
      return withBusy(`In Owlbear's picker (${k.type}): click the first image, shift-click the last, then Done`, async () => {
        const n = await linkArt(state.products, kind);
        if (n) await setSetupFlag(`link-${kind}`);
        await refreshPartyCards();
        const pr = await kindProgress(state.products, kind);
        OBR.notification.show(
          n === 0
            ? `Nothing to link yet — click UPLOAD IMAGES in Owlbear's upload dialog first and let it finish`
            : pr.linked >= pr.total
              ? `All ${pr.total} ${k.short} linked`
              : `Linked ${n} — ${pr.total - pr.linked} ${k.short} still missing (wait for the upload to finish, then Link again)`,
          n && pr.linked >= pr.total ? "SUCCESS" : "WARNING",
        );
      });
    }
    case "tablescene":
      return withBusy("In Owlbear: click Upload — an empty Hero Kids table scene", async () => {
        await uploadScenes([], true);
        await setSetupFlag("table");
        OBR.notification.show("Open the “Hero Kids table” scene from your scenes list", "SUCCESS");
      });
    case "allscenes":
      return withBusy("In Owlbear: pick a folder, then Upload — all maps as scenes (one upload)", async () => {
        const n = await uploadScenes(state.products.filter((x) => x.maps.length));
        OBR.notification.show(`Sent ${n} scenes`, "SUCCESS");
      });
    case "weather":
      try {
        await setWeather((b.dataset.w || null) as WeatherType | null);
      } catch (err) {
        OBR.notification.show(errText(err), "WARNING");
      }
      return render();
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
      const entries = state.campaign.party.filter((m) => m.card).map((m) => ({ name: m.hero, count: 1, product: m.product, card: m.card, member: m.id, label: memberLabel(m) }));
      if (!entries.length) return OBR.notification.show("Pick heroes in the Campaign tab first", "WARNING");
      return withBusy("Placing hero tokens…", async () => {
        const named = [];
        for (const e of entries) {
          const pr = await product(e.product);
          const card = pr?.cards.find((c) => c.id === e.card);
          const tok = pr?.tokens.find((t) => t.id === card?.token);
          named.push({ name: tok?.name ?? e.name, count: 1, member: e.member, label: e.label });
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
      const n = state.campaign.party.length + 1;
      const firstPlayer = state.players.find((x) => x.role === "PLAYER");
      state.campaign.party.push({
        id: `h${Date.now().toString(36)}`, kid: `Hero ${n}`, playerId: firstPlayer?.id ?? "", playerName: firstPlayer?.name ?? "",
        hero: "", product: "", card: "",
      });
      await setCampaign(state.campaign);
      return render();
    }
    case "delhero": {
      state.campaign.party = state.campaign.party.filter((m) => m.id !== b.dataset.m);
      await setCampaign(state.campaign);
      return render();
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

async function giveTo(cardId: string, memberId: string) {
  if (!memberId) return;
  const custom = await product(CUSTOM_ID);
  const def = (await listDefs()).find((d) => d.id === cardId);
  const m = state.campaign.party.find((x) => x.id === memberId);
  if (!custom || !def || !m) return;
  const url = (await getLinks(CUSTOM_ID))[cardId]?.image.url;
  m.extras = [...(m.extras ?? []).filter((x) => x.id !== cardId), { id: cardId, name: def.name, kind: def.itemType || def.kind, text: def.effect.slice(0, 300), url }];
  await setCampaign(state.campaign);
  OBR.notification.show(`Gave ${def.name} to ${m.kid}`, "SUCCESS");
  render();
}

/** Keep each hero's card image address current (it only exists once the art is linked). */
async function refreshPartyCards() {
  let changed = false;
  for (const m of state.campaign.party) {
    if (!m.product || !m.card) continue;
    const url = (await getLinks(m.product))[m.card]?.image.url;
    const p = await product(m.product);
    const card = p?.cards.find((x) => x.id === m.card);
    if (url && url !== m.cardUrl) (m.cardUrl = url), (changed = true);
    if (card && !m.cardText?.length) (m.cardText = cardSummary(card.ocr)), (m.health = card.health ?? undefined), (changed = true);
  }
  if (changed) await setCampaign(state.campaign);
}

async function setMember(id: string, field: "kid" | "hero" | "device", value: string) {
  const c = state.campaign;
  const m = c.party.find((x) => x.id === id);
  if (!m) return;
  if (field === "kid") m.kid = value.trim() || m.kid;
  if (field === "device") {
    m.playerId = value;
    m.playerName = state.players.find((p) => p.id === value)?.name ?? "";
  }
  if (field === "hero") {
    const [pid, cid] = value ? value.split("|") : ["", ""];
    const p = pid ? await product(pid) : undefined;
    const card = p?.cards.find((x) => x.id === cid);
    const links = pid ? await getLinks(pid) : {};
    Object.assign(m, {
      hero: card?.name ?? "", product: pid, card: cid, cardUrl: links[cid]?.image.url,
      cardText: cardSummary(card?.ocr), health: card?.health ?? undefined,
    });
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
window.addEventListener("unhandledrejection", (e) => showFatal(errText(e.reason)));
function showFatal(msg: string) {
  if (!app.querySelector("nav")) app.innerHTML = `<main><p class="err">Hero Kids couldn't start: ${esc(msg)}</p></main>`;
}
OBR.onReady(() => boot().catch((e) => showFatal(errText(e))));
