// Everything that touches the Owlbear scene / asset storage.
import OBR, { buildImage, buildImageUpload, buildLabel, buildSceneUpload, Image, Item } from "@owlbear-rodeo/sdk";
import { db } from "./db";
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

/** One scene per map. Each scene carries a hidden marker so the panel knows which encounter is on screen. */
export async function uploadScenes(p: Product, maps: MapInfo[] = p.maps) {
  const uploads = [];
  for (const m of maps) {
    const blob = await blobFor(p.id, m.file);
    if (!blob) throw new Error(`Missing ${m.file} – reload the library folder`);
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
  await OBR.assets.uploadScenes(uploads, true);
  await setStatus(p.id, { scenes: new Date().toISOString() });
}

/** Upload stand-up tokens (characters) and cards (props) to the GM's Owlbear storage. */
export async function uploadArt(p: Product, what: "tokens" | "cards") {
  if (what === "tokens") {
    const ups = [];
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
    if (ups.length) await OBR.assets.uploadImages(ups, "CHARACTER");
  } else {
    const ups = [];
    for (const c of p.cards) {
      const blob = await blobFor(p.id, c.file);
      if (!blob) continue;
      // cards are shown 4 squares wide on the table
      ups.push(
        buildImageUpload(new File([blob], `${c.id}.webp`, { type: "image/webp" }))
          .name(cardAssetName(p, c))
          .dpi(c.width / 4)
          .offset({ x: c.width / 2, y: c.height / 2 })
          .build(),
      );
    }
    if (ups.length) await OBR.assets.uploadImages(ups, "PROP");
  }
  await setStatus(p.id, { art: new Date().toISOString() });
}

/**
 * Owlbear doesn't hand back URLs on upload, so the GM picks the uploaded images
 * once in Owlbear's own picker and we remember their URLs.
 */
export async function linkArt(p: Product): Promise<number> {
  const picked = await OBR.assets.downloadImages(true, short(p));
  const byName = new Map(picked.map((d) => [d.name, d]));
  const links: Record<string, LinkedImage> = (await db.get("kv", `links/${p.id}`)) ?? {};
  let n = 0;
  for (const t of p.tokens) {
    const d = byName.get(tokenAssetName(p, t));
    if (d) {
      links[t.id] = { name: t.name, image: d.image, grid: d.grid };
      n++;
    }
  }
  for (const c of p.cards) {
    const d = byName.get(cardAssetName(p, c));
    if (d) {
      links[c.id] = { name: c.name, image: d.image, grid: d.grid };
      n++;
    }
  }
  await db.put("kv", `links/${p.id}`, links);
  await setStatus(p.id, { linked: Object.keys(links).length });
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
          .metadata({ [KEY.token]: meta })
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
