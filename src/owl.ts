// Everything that touches the Owlbear scene / asset storage.
import OBR, { buildImage, buildImageUpload, buildLabel, buildSceneUpload, Image, Item } from "@owlbear-rodeo/sdk";
import { db } from "./db";
import { EXT, heroLight, initiativeEntry } from "./compat";
import { KEY, TokenMeta, tokenLabel } from "./shared";
import type { CardInfo, LinkedImage, MapInfo, Product, ProductStatus, TokenInfo } from "./types";

/** Levenshtein distance – OCR'd names can be a letter off ("Eitin" vs "Ettin"). */
function lev(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return d[b.length];
}

export const blobFor = (productId: string, file: string) => db.get<Blob>("files", `${productId}/${file}`);

export async function getStatus(pid: string): Promise<ProductStatus> {
  return (await db.get<ProductStatus>("kv", `status/${pid}`)) ?? {};
}
export async function setStatus(pid: string, patch: Partial<ProductStatus>) {
  await db.put("kv", `status/${pid}`, { ...(await getStatus(pid)), ...patch });
}

const short = (p: Product) => p.title;
export const tokenAssetName = (p: Product, t: TokenInfo) => `${t.name} · ${short(p)}`;
export const cardAssetName = (p: Product, c: CardInfo) => `Card: ${c.name} · ${short(p)}`;
export const mapAssetName = (p: Product, m: MapInfo) => `Map: ${m.name} · ${short(p)}`;
export type ArtKind = "tokens" | "cards" | "maps";
export const ART_TYPE = { tokens: "CHARACTER", cards: "PROP", maps: "MAP" } as const;

/**
 * IMPORTANT: every exported upload function makes exactly ONE Owlbear dialog call.
 * Calling the upload APIs back-to-back replaces the open dialog before the GM
 * confirms it, so earlier batches are silently dropped.
 */

async function sceneUploadsFor(p: Product, maps: MapInfo[] = p.maps) {
  const uploads = [];
  for (const m of maps) {
    const blob = await blobFor(p.id, m.file);
    if (!blob) throw new Error(`Missing ${p.title} ${m.file} – choose the library folder again`);
    const enc = p.encounters?.find((e) => e.map === m.id);
    const marker = buildLabel()
      .plainText(enc ? `E${enc.n}` : m.name)
      .position({ x: -400, y: -400 })
      .visible(false)
      .locked(true)
      .layer("NOTE")
      .metadata({ [KEY.marker]: { product: p.id, map: m.id, encounter: enc?.n ?? null, cols: m.cols, rows: m.rows } })
      .build();
    const file = new File([blob], `${m.id}.jpg`, { type: blob.type || "image/jpeg" });
    uploads.push(
      buildSceneUpload()
        .name(`${p.title} — ${m.name}`)
        .gridType("SQUARE")
        .gridMeasurement("CHEBYSHEV") // Hero Kids: diagonal moves cost 1
        .fogFilled(false)
        .baseMap(buildImageUpload(file).name(m.name).dpi(m.dpi).offset({ x: 0, y: 0 }).locked(true).build())
        .items([marker])
        .build(),
    );
  }
  return uploads;
}

/** One scene per map, for one or many books, in a single Owlbear dialog. */
export async function uploadScenes(products: Product[], tableScene = false) {
  const uploads = [];
  if (tableScene) {
    uploads.push(
      buildSceneUpload().name("Hero Kids table").gridType("SQUARE").gridMeasurement("CHEBYSHEV").fogFilled(false).items([]).build(),
    );
  }
  for (const p of products) uploads.push(...(await sceneUploadsFor(p)));
  if (!uploads.length) return 0;
  await OBR.assets.uploadScenes(uploads, true);
  for (const p of products) if (p.maps.length) await setStatus(p.id, { scenes: new Date().toISOString() });
  return uploads.length;
}

/** Tokens (as Characters) or cards (as Props) for one or many books, in a single Owlbear dialog. */
export async function uploadArt(products: Product[], what: ArtKind) {
  const ups = [];
  for (const p of products) {
    if (what === "tokens") {
      for (const t of p.tokens) {
        const blob = await blobFor(p.id, t.file);
        if (!blob) continue;
        const cells = t.cells ?? 1;
        ups.push(
          buildImageUpload(new File([blob], `${t.id}.webp`, { type: "image/webp" }))
            .name(tokenAssetName(p, t))
            .dpi(Math.max(t.width, t.height) / cells)
            .offset({ x: t.width / 2, y: t.height / 2 })
            .build(),
        );
      }
    } else if (what === "maps") {
      for (const m of p.maps) {
        const blob = await blobFor(p.id, m.file);
        if (!blob) continue;
        ups.push(
          buildImageUpload(new File([blob], `${m.id}.jpg`, { type: blob.type || "image/jpeg" }))
            .name(mapAssetName(p, m))
            .dpi(m.dpi)
            .offset({ x: 0, y: 0 })
            .locked(true)
            .build(),
        );
      }
    } else {
      for (const c of p.cards) {
        const blob = await blobFor(p.id, c.file);
        if (!blob) continue;
        ups.push(
          buildImageUpload(new File([blob], `${c.id}.webp`, { type: "image/webp" }))
            .name(cardAssetName(p, c))
            .dpi(c.width / 4) // cards lie 4 squares wide on the table
            .offset({ x: c.width / 2, y: c.height / 2 })
            .build(),
        );
      }
    }
  }
  if (!ups.length) return 0;
  await OBR.assets.uploadImages(ups, ART_TYPE[what]);
  for (const p of products) {
    const n = what === "tokens" ? p.tokens.length : what === "maps" ? p.maps.length : p.cards.length;
    if (n) await setStatus(p.id, { [what]: new Date().toISOString() });
  }
  return ups.length;
}

/**
 * Owlbear doesn't hand back URLs on upload, so the GM picks the uploaded images
 * once in Owlbear's own picker (select all, Done) and we remember their URLs.
 */
export async function linkArt(products: Product[], what?: ArtKind): Promise<number> {
  const search = products.length === 1 ? short(products[0]) : "·";
  const picked = await OBR.assets.downloadImages(true, search, what ? ART_TYPE[what] : undefined);
  const byName = new Map(picked.map((d) => [d.name, d]));
  let n = 0;
  for (const p of products) {
    const links: Record<string, LinkedImage> = (await db.get("kv", `links/${p.id}`)) ?? {};
    for (const t of p.tokens) {
      const d = byName.get(tokenAssetName(p, t));
      if (d) (links[t.id] = { name: t.name, image: d.image, grid: d.grid }), n++;
    }
    for (const c of p.cards) {
      const d = byName.get(cardAssetName(p, c));
      if (d) (links[c.id] = { name: c.name, image: d.image, grid: d.grid }), n++;
    }
    for (const m of p.maps) {
      const d = byName.get(mapAssetName(p, m));
      if (d) (links[m.id] = { name: m.name, image: d.image, grid: { dpi: m.dpi, offset: { x: 0, y: 0 } } }), n++;
    }
    await db.put("kv", `links/${p.id}`, links);
    await setStatus(p.id, { linked: Object.keys(links).length });
  }
  return n;
}

export async function getLinks(pid: string): Promise<Record<string, LinkedImage>> {
  return (await db.get("kv", `links/${pid}`)) ?? {};
}

/** Find a token for a monster name: this product first, then any other loaded product. */
export async function findToken(
  name: string,
  preferred: string[],
  allProducts: Product[],
): Promise<{ product: Product; token: TokenInfo; card?: CardInfo; link?: LinkedImage } | null> {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "").replace(/s$/, "");
  const want = norm(name);
  const close = (a: string, b: string) => a === b || (Math.abs(a.length - b.length) <= 2 && lev(a, b) <= Math.max(1, Math.floor(b.length / 8)));
  const order = [
    ...preferred.map((id) => allProducts.find((p) => p.id === id)).filter(Boolean),
    ...allProducts.filter((p) => !preferred.includes(p.id)),
  ] as Product[];
  let fallback: { product: Product; token: TokenInfo; card?: CardInfo; link?: LinkedImage } | null = null;
  for (const p of order) {
    const links = await getLinks(p.id);
    for (const t of p.tokens) {
      if (!close(norm(t.name.replace(/\s*\(alt\)$/, "")), want)) continue;
      const card = p.cards.find((c) => c.id === t.card);
      const hit = { product: p, token: t, card, link: links[t.id] };
      if (hit.link) return hit;
      fallback ??= hit;
    }
  }
  return fallback;
}

async function sceneMarker() {
  const items = await OBR.scene.items.getItems((i) => KEY.marker in i.metadata);
  items.sort((a, b) => (a.layer === "MAP" ? 0 : 1) - (b.layer === "MAP" ? 0 : 1));
  return items[0]?.metadata[KEY.marker] as
    | { product: string; map: string; encounter: string | null; cols: number; rows: number }
    | undefined;
}
export { sceneMarker };

/** Place tokens on a "bench" just right of the map so the GM can drag them into place. */
export async function spawn(
  entries: { name: string; count: number }[],
  preferred: string[],
  allProducts: Product[],
  kind: "monster" | "hero" = "monster",
): Promise<string[]> {
  const dpi = await OBR.scene.grid.getDpi();
  const marker = await sceneMarker();
  const cols = marker?.cols ?? 12;
  const items: Item[] = [];
  const missing: string[] = [];
  let row = 0;
  const existing = await OBR.scene.items.getItems((i) => KEY.token in i.metadata);
  let col = kind === "hero" ? -2 : cols + 1;
  if (kind === "monster") col += Math.floor(existing.filter((i) => (i.metadata[KEY.token] as TokenMeta).kind === "monster").length / 8);
  for (const e of entries) {
    const found = await findToken(e.name, preferred, allProducts);
    if (!found?.link) {
      missing.push(e.name);
      continue;
    }
    const { link, token, card, product } = found;
    const max = card?.health ?? (kind === "hero" ? 3 : 1);
    for (let k = 0; k < e.count; k++) {
      const meta: TokenMeta = { product: product.id, tokenId: token.id, name: e.name, kind, hp: max, max };
      const cells = token.cells ?? 1;
      items.push(
        buildImage(link.image, link.grid)
          .name(e.name)
          .plainText(tokenLabel(meta))
          .textItemType("LABEL")
          .layer("CHARACTER")
          .position({ x: (col + 0.5 * cells) * dpi, y: (row + 0.5 * cells) * dpi })
          .metadata({
            [KEY.token]: meta,
            [EXT.initiative]: initiativeEntry(), // shows up in Owlbear's Initiative Tracker
            ...(kind === "hero" ? { [EXT.light]: heroLight(dpi) } : {}), // torch for Dynamic Fog
          })
          .build(),
      );
      row += cells;
      if (row >= 8) {
        row = 0;
        col += kind === "hero" ? -1 : 1;
      }
    }
  }
  if (items.length) await OBR.scene.items.addItems(items);
  return missing;
}

/** Change health on selected tokens. */
export async function changeHealth(ids: string[], delta: number) {
  await OBR.scene.items.updateItems<Image>(
    (i) => ids.includes(i.id) && KEY.token in i.metadata,
    (drafts) => {
      for (const d of drafts) {
        const m = { ...(d.metadata[KEY.token] as TokenMeta) };
        m.hp = Math.max(0, Math.min(m.max, m.hp + delta));
        d.metadata[KEY.token] = m;
        if (d.text) d.text.plainText = tokenLabel(m);
        d.rotation = m.hp === 0 ? 90 : 0; // knocked over when KO'd
      }
    },
  );
}

export async function setMaxHealth(ids: string[], max: number) {
  await OBR.scene.items.updateItems<Image>(
    (i) => ids.includes(i.id) && KEY.token in i.metadata,
    (drafts) => {
      for (const d of drafts) {
        const m = { ...(d.metadata[KEY.token] as TokenMeta), max, hp: max };
        d.metadata[KEY.token] = m;
        if (d.text) d.text.plainText = tokenLabel(m);
        d.rotation = 0;
      }
    },
  );
}

/** Put a card image on the table next to the map. */
export async function placeCard(link: LinkedImage, name: string, slot = 0) {
  const dpi = await OBR.scene.grid.getDpi();
  const marker = await sceneMarker();
  const rows = marker?.rows ?? 8;
  const item = buildImage(link.image, link.grid)
    .name(name)
    .layer("PROP")
    .position({ x: (2 + slot * 4.5) * dpi, y: (rows + 2) * dpi })
    .build();
  await OBR.scene.items.addItems([item]);
}

/**
 * "Go to map": Owlbear extensions can't switch scenes, so we swap the map on the
 * table in the current scene instead. Our previous map (and, optionally, the
 * previous encounter's monsters) are removed; heroes stay.
 */
export async function showMap(p: Product, m: MapInfo, opts: { clearMonsters: boolean }) {
  const link = (await getLinks(p.id))[m.id];
  if (!link) throw new Error(`“${m.name}” isn't linked yet — Library → All map images, then Link maps`);
  const enc = p.encounters?.find((e) => e.map === m.id);
  const ours = await OBR.scene.items.getItems((i) => KEY.marker in i.metadata);
  const monsters = opts.clearMonsters
    ? await OBR.scene.items.getItems((i) => KEY.token in i.metadata && (i.metadata[KEY.token] as TokenMeta).kind === "monster")
    : [];
  const foreignMaps = await OBR.scene.items.getItems((i) => i.layer === "MAP" && !(KEY.marker in i.metadata));
  const toDelete = [...ours, ...monsters].map((i) => i.id);
  if (toDelete.length) await OBR.scene.items.deleteItems(toDelete);
  const item = buildImage(link.image, { dpi: m.dpi, offset: { x: 0, y: 0 } })
    .name(`${p.title} — ${m.name}`)
    .layer("MAP")
    .locked(true)
    .disableHit(false)
    .position({ x: 0, y: 0 })
    .zIndex(-1)
    .metadata({ [KEY.marker]: { product: p.id, map: m.id, encounter: enc?.n ?? null, cols: m.cols, rows: m.rows } })
    .build();
  await OBR.scene.items.addItems([item]);
  const dpi = await OBR.scene.grid.getDpi();
  await OBR.viewport.animateToBounds({
    min: { x: -2 * dpi, y: -1 * dpi },
    max: { x: (m.cols + 2) * dpi, y: (m.rows + 1) * dpi },
    width: (m.cols + 4) * dpi,
    height: (m.rows + 2) * dpi,
    center: { x: (m.cols / 2) * dpi, y: (m.rows / 2) * dpi },
  });
  return { removed: toDelete.length, foreignMaps: foreignMaps.length };
}
