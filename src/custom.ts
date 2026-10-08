// GM-made content: heroes, monsters, pets, items and skills.
// Each definition is turned into a card image (drawn here, in an original
// parchment style) plus a token for creatures, and packaged as a "Custom" book
// so everything else (party picker, placing monsters, linking, uploads) just works.
import { db } from "./db";
import type { CardInfo, Product, TokenInfo } from "./types";

export type CustomKind = "hero" | "monster" | "pet" | "item" | "skill";
export const CUSTOM_ID = "custom";

export interface Ability {
  name: string;
  text: string;
}

export interface CustomDef {
  id: string;
  kind: CustomKind;
  name: string;
  /** "upload" = picture stored under files/custom/img/<id>.png; "lib" = an existing library figure */
  image?: { source: "upload" } | { source: "lib"; product: string; token: string };
  dice: { melee: number; ranged: number; magic: number; armor: number };
  health: number;
  attack: Ability & { type: "Melee" | "Ranged" | "Magic" };
  special: Ability;
  bonus: Ability;
  size: number; // squares
  itemType: string; // items: "Item" / "Equipment"; skills: "Skill" / "Special Action" / "Bonus Ability"…
  effect: string; // items & skills
  rev: number; // bumped when an uploaded definition changes
  uploadedRev?: number;
  updatedAt: number;
}

export const isCreature = (k: CustomKind) => k === "hero" || k === "monster" || k === "pet";

export function blankDef(kind: CustomKind): CustomDef {
  const creature = isCreature(kind);
  return {
    id: `c${Date.now().toString(36)}`,
    kind,
    name: "",
    dice: kind === "monster" ? { melee: 2, ranged: 0, magic: 0, armor: 1 } : { melee: 2, ranged: 1, magic: 0, armor: 2 },
    health: kind === "monster" ? 2 : 3,
    attack: { type: "Melee", name: creature ? "Strike" : "", text: creature ? "Melee attack at an adjacent target." : "" },
    special: { name: "", text: "" },
    bonus: { name: "", text: "" },
    size: 1,
    itemType: kind === "item" ? "Item" : kind === "skill" ? "Skill" : "",
    effect: "",
    rev: 1,
    updatedAt: Date.now(),
  };
}

// ------------------------------------------------------------- storage

export async function listDefs(): Promise<CustomDef[]> {
  return (await db.get<CustomDef[]>("kv", "custom/defs").catch(() => undefined)) ?? [];
}

async function saveDefs(defs: CustomDef[]) {
  await db.put("kv", "custom/defs", defs);
}

export async function saveDef(def: CustomDef, picture?: Blob) {
  const defs = await listDefs();
  const i = defs.findIndex((d) => d.id === def.id);
  if (i >= 0 && defs[i].uploadedRev && defs[i].uploadedRev === def.rev) def.rev += 1; // changed after upload → new asset names
  def.updatedAt = Date.now();
  if (picture) {
    await db.put("files", `${CUSTOM_ID}/img/${def.id}.png`, await toPng(picture, 1024));
    def.image = { source: "upload" };
  }
  if (i >= 0) defs[i] = def;
  else defs.push(def);
  await saveDefs(defs);
  await rebuildProduct(defs);
}

export async function deleteDef(id: string) {
  const defs = (await listDefs()).filter((d) => d.id !== id);
  await saveDefs(defs);
  await rebuildProduct(defs);
}

export async function markUploaded() {
  const defs = await listDefs();
  for (const d of defs) d.uploadedRev = d.rev;
  await saveDefs(defs);
}

export async function pendingUploads() {
  return (await listDefs()).filter((d) => d.uploadedRev !== d.rev);
}

// ------------------------------------------------------- product build

/** The text a card's rules read as — same shape the library's OCR'd cards use. */
export function rulesText(d: CustomDef): string {
  if (!isCreature(d.kind)) return [d.itemType ? `${d.itemType}:` : "", d.effect].filter(Boolean).join("\n");
  const lines = [`${d.attack.type} Attack: ${d.attack.name || "Attack"}`, d.attack.text];
  if (d.special.name || d.special.text) lines.push(`Special Action: ${d.special.name || "Special"}`, d.special.text);
  if (d.bonus.name || d.bonus.text) lines.push(`Bonus Ability: ${d.bonus.name || "Bonus"}`, d.bonus.text);
  return lines.filter((l) => l !== undefined).join("\n");
}

const assetSuffix = (d: CustomDef) => (d.rev > 1 ? ` (v${d.rev})` : "");

async function pictureFor(d: CustomDef): Promise<Blob | undefined> {
  if (!d.image) return undefined;
  if (d.image.source === "upload") return db.get<Blob>("files", `${CUSTOM_ID}/img/${d.id}.png`);
  const p = await db.get<Product>("products", d.image.product);
  const t = p?.tokens.find((x) => x.id === (d.image as { token: string }).token);
  return t ? db.get<Blob>("files", `${d.image.product}/${t.file}`) : undefined;
}

/** Regenerate every custom card/token image and the "Custom" product record. */
export async function rebuildProduct(defs?: CustomDef[]) {
  defs ??= await listDefs();
  const cards: CardInfo[] = [];
  const tokens: TokenInfo[] = [];
  const files: [string, Blob][] = [];
  for (const d of defs) {
    const pic = await pictureFor(d);
    const picImg = pic ? await blobToImage(pic) : undefined;
    const card = await drawCard(d, picImg);
    const cardFile = `cards/${d.id}.png`;
    files.push([`${CUSTOM_ID}/${cardFile}`, card.blob]);
    const kind = d.kind === "skill" ? "advancement" : d.kind;
    const display = `${d.name || "Unnamed"}${assetSuffix(d)}`;
    const info: CardInfo = {
      id: d.id, file: cardFile, name: display, kind: kind as CardInfo["kind"],
      attack: isCreature(d.kind) ? d.attack.name : undefined, health: isCreature(d.kind) ? d.health : null,
      ocr: rulesText(d), width: card.width, height: card.height,
    };
    if (isCreature(d.kind) && picImg) {
      const tok = await drawToken(picImg);
      const tokFile = `tokens/${d.id}.png`;
      files.push([`${CUSTOM_ID}/${tokFile}`, tok.blob]);
      tokens.push({ id: `t-${d.id}`, file: tokFile, name: display, width: tok.width, height: tok.height, cells: d.size, card: d.id, match: 1 });
      info.token = `t-${d.id}`;
    }
    cards.push(info);
  }
  if (files.length) await db.putMany("files", files);
  const product: Product = { id: CUSTOM_ID, title: "Custom", kind: "expansion", meta: {}, maps: [], cards, tokens };
  await db.put("products", CUSTOM_ID, product);
  return product;
}

// ------------------------------------------------------ export / import

export async function exportCustom(): Promise<Blob> {
  const defs = await listDefs();
  const images: Record<string, string> = {};
  for (const d of defs) {
    if (d.image?.source === "upload") {
      const b = await db.get<Blob>("files", `${CUSTOM_ID}/img/${d.id}.png`);
      if (b) images[d.id] = await blobToDataUrl(b);
    }
  }
  return new Blob([JSON.stringify({ format: "hero-kids-custom", version: 1, defs, images })], { type: "application/json" });
}

export async function importCustom(file: File): Promise<number> {
  const data = JSON.parse(await file.text());
  if (data?.format !== "hero-kids-custom") throw new Error("That file isn't a Hero Kids custom-content export");
  const defs = await listDefs();
  for (const d of data.defs as CustomDef[]) {
    const img = data.images?.[d.id];
    if (img) await db.put("files", `${CUSTOM_ID}/img/${d.id}.png`, await (await fetch(img)).blob());
    const i = defs.findIndex((x) => x.id === d.id);
    if (i >= 0) defs[i] = d;
    else defs.push(d);
  }
  await saveDefs(defs);
  await rebuildProduct(defs);
  return (data.defs as CustomDef[]).length;
}

// --------------------------------------------------------------- drawing

const blobToImage = (b: Blob) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that picture"));
    img.src = URL.createObjectURL(b);
  });

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(b);
  });

const canvasBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), "image/png"));

async function toPng(b: Blob, max: number): Promise<Blob> {
  const img = await blobToImage(b);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return canvasBlob(c);
}

/** Token: the picture itself (transparent PNGs stay transparent), at most 512 px. */
async function drawToken(img: HTMLImageElement) {
  const k = Math.min(1, 512 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return { blob: await canvasBlob(c), width: c.width, height: c.height };
}

const INK = "#3b2a14";
const PAPER = "#f4e7c6";
const EDGE = "#8a6a3a";
const SERIF = 'Georgia, "Times New Roman", serif';
const HEALTH = ["KO", "Hurt", "Bruised", "Battered", "Scratched", "Fine"];

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, lh: number, maxLines = 8) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let n = 0;
  for (const word of words) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > w && line) {
      ctx.fillText(line, x, y);
      y += lh;
      line = word;
      if (++n >= maxLines - 1) break;
    } else line = t;
  }
  if (line) ctx.fillText(line, x, y), (y += lh);
  return y;
}

function die(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillStyle = "#fffaf0";
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(x, y, s, s, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  const r = s * 0.09;
  for (const [px, py] of [[0.28, 0.25], [0.28, 0.5], [0.28, 0.75], [0.72, 0.25], [0.72, 0.5], [0.72, 0.75]]) {
    ctx.beginPath();
    ctx.arc(x + px * s, y + py * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function emptyBox(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.strokeStyle = "#b9a37a";
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, s, s);
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 6);
  ctx.lineTo(x + s - 6, y + s - 6);
  ctx.moveTo(x + s - 6, y + 6);
  ctx.lineTo(x + 6, y + s - 6);
  ctx.stroke();
}

function parchment(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = EDGE;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.roundRect(8, 8, w - 16, h - 16, 28);
  ctx.fill();
  ctx.stroke();
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(1, "rgba(120,80,30,0.18)");
  ctx.fillStyle = g;
  ctx.fill();
}

function fitImage(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const k = Math.min(w / img.width, h / img.height);
  const iw = img.width * k, ih = img.height * k;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

/** Draw a card. Creatures: landscape with dice pools; items/skills: portrait. */
export async function drawCard(d: CustomDef, img?: HTMLImageElement) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  if (isCreature(d.kind)) {
    const W = 1050, H = 740;
    c.width = W;
    c.height = H;
    parchment(ctx, W, H);
    ctx.fillStyle = INK;
    ctx.textBaseline = "alphabetic";
    ctx.font = `bold 52px ${SERIF}`;
    ctx.textAlign = "center";
    ctx.fillText(d.name || "Unnamed", W / 2, 88);
    ctx.font = `italic 24px ${SERIF}`;
    ctx.fillText({ hero: "Hero", monster: "Monster", pet: "Pet" }[d.kind as "hero"] + (d.size > 1 ? ` · ${d.size}×${d.size} squares` : ""), W / 2, 122);
    // dice pools
    ctx.textAlign = "left";
    const rows: [string, number][] = [["Melee", d.dice.melee], ["Ranged", d.dice.ranged], ["Magic", d.dice.magic], ["Armor", d.dice.armor]];
    let y = 160;
    const s = 56;
    for (const [label, n] of rows) {
      ctx.fillStyle = INK;
      ctx.font = `bold 22px ${SERIF}`;
      ctx.fillText(label, 40, y + 36);
      if (n <= 0) emptyBox(ctx, 140, y, s);
      for (let k = 0; k < Math.min(n, 3); k++) die(ctx, 140 + k * (s + 8), y, s);
      if (n > 3) (ctx.fillStyle = INK), ctx.fillText(`+${n - 3}`, 140 + 3 * (s + 8), y + 36);
      y += s + 22;
    }
    // health
    ctx.fillStyle = INK;
    ctx.font = `bold 22px ${SERIF}`;
    ctx.fillText("Health", 40, y + 36);
    for (let k = 0; k < Math.min(d.health, 5); k++) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 3;
      ctx.strokeRect(140 + k * 70, y, 60, 56);
      ctx.font = `16px ${SERIF}`;
      ctx.textAlign = "center";
      ctx.fillText(HEALTH[k], 170 + k * 70, y + 48);
      ctx.textAlign = "left";
    }
    // picture
    if (img) fitImage(ctx, img, 330, 150, 290, H - 200 - (d.health > 3 ? 60 : 0));
    // abilities
    let ty = 170;
    const tx = 640, tw = 370;
    const section = (title: string, text: string) => {
      if (!title && !text) return;
      ctx.fillStyle = INK;
      ctx.font = `bold 24px ${SERIF}`;
      ty = wrap(ctx, title, tx, ty, tw, 28, 2);
      ctx.font = `21px ${SERIF}`;
      ty = wrap(ctx, text, tx, ty, tw, 26, 6) + 16;
    };
    section(`${d.attack.type} Attack: ${d.attack.name || "Attack"}`, d.attack.text);
    section(d.special.name || d.special.text ? `Special Action: ${d.special.name}` : "", d.special.text);
    section(d.bonus.name || d.bonus.text ? `Bonus Ability: ${d.bonus.name}` : "", d.bonus.text);
  } else {
    const W = 670, H = 944;
    c.width = W;
    c.height = H;
    parchment(ctx, W, H);
    ctx.fillStyle = INK;
    ctx.textAlign = "center";
    ctx.font = `bold 46px ${SERIF}`;
    wrap(ctx, d.name || "Unnamed", W / 2, 100, W - 80, 50, 2);
    ctx.font = `italic 28px ${SERIF}`;
    ctx.fillText(d.itemType || (d.kind === "skill" ? "Skill" : "Item"), W / 2, 200);
    if (img) fitImage(ctx, img, 140, 230, W - 280, 330);
    else {
      ctx.font = `120px ${SERIF}`;
      ctx.fillText(d.kind === "skill" ? "✦" : "⚱", W / 2, 440);
    }
    ctx.font = `25px ${SERIF}`;
    wrap(ctx, d.effect, W / 2, 620, W - 100, 32, 8);
  }
  return { blob: await canvasBlob(c), width: c.width, height: c.height };
}

/** Preview helper for the editor. */
export async function previewUrl(d: CustomDef, picture?: Blob): Promise<string> {
  const pic = picture ?? (await pictureFor(d));
  const img = pic ? await blobToImage(pic) : undefined;
  const { blob } = await drawCard(d, img);
  return URL.createObjectURL(blob);
}
