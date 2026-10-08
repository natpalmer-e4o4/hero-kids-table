// Interop with Owlbear's own extensions (Initiative Tracker, Weather, Dynamic
// Fog, Ranges). We only write data in the shapes those extensions read; none of
// their code is included. If an extension isn't enabled in the room, the extra
// metadata is simply ignored.
import OBR, { Item } from "@owlbear-rodeo/sdk";
import { KEY, TokenMeta } from "./shared";

export const EXT = {
  initiative: "rodeo.owlbear.initiative-tracker/metadata",
  weather: "rodeo.owlbear.weather/weather",
  light: "rodeo.owlbear.dynamic-fog/light",
  range: "rodeo.owlbear.ranges/range",
};

// ------------------------------------------------------------ initiative

export interface InitiativeMeta {
  count: string; // the tracker sorts with parseFloat(count), high first
  active: boolean;
}

export const initiativeEntry = (): InitiativeMeta => ({ count: "0", active: false });

/**
 * Hero Kids initiative is by side: one d6 for the heroes, one for the monsters,
 * heroes win ties. Write that into the Initiative Tracker's counts so the whole
 * winning side sorts first, and mark the first of them active.
 */
export async function applySideInitiative(heroesFirst: boolean) {
  const items = await OBR.scene.items.getItems((i) => KEY.token in i.metadata);
  if (!items.length) return 0;
  const isHero = (i: Item) => (i.metadata[KEY.token] as TokenMeta).kind === "hero";
  const ordered = [...items.filter((i) => isHero(i) === heroesFirst), ...items.filter((i) => isHero(i) !== heroesFirst)];
  const firstId = ordered.find((i) => (i.metadata[KEY.token] as TokenMeta).hp > 0)?.id;
  await OBR.scene.items.updateItems(
    items.map((i) => i.id),
    (drafts) => {
      for (const d of drafts) {
        const winning = isHero(d as Item) === heroesFirst;
        d.metadata[EXT.initiative] = { count: winning ? "2" : "1", active: d.id === firstId } satisfies InitiativeMeta;
      }
    },
  );
  return items.length;
}

// --------------------------------------------------------------- weather

export type WeatherType = "SNOW" | "RAIN" | "SAND" | "FIRE" | "CLOUD" | "BLOOM";
export const WEATHER: { type: WeatherType; label: string; words: RegExp }[] = [
  { type: "SNOW", label: "Snow", words: /\b(snow\w*|blizzard|winter|frost\w*|icy|yule\w*)\b/i },
  { type: "RAIN", label: "Rain", words: /\b(rain\w*|storm\w*|downpour|drizzl\w*|thunder\w*)\b/i },
  { type: "FIRE", label: "Embers", words: /\b(fire|flames?|burning|blaze|embers?|smoke|inferno)\b/i },
  { type: "SAND", label: "Sand", words: /\b(sand\w*|desert|dust\w*)\b/i },
  { type: "CLOUD", label: "Fog", words: /\b(fog\w*|mist\w*|cloud\w*|haze)\b/i },
  { type: "BLOOM", label: "Petals", words: /\b(blossom\w*|petals?|flowers?|bloom\w*|spring time|glade)\b/i },
];

/** Best weather guess for an encounter, from its text. */
export function suggestWeather(text: string): WeatherType | null {
  let best: { type: WeatherType; n: number } | null = null;
  for (const w of WEATHER) {
    const n = (text.match(new RegExp(w.words, "gi")) ?? []).length;
    if (n >= 2 && (!best || n > best.n)) best = { type: w.type, n };
  }
  return best?.type ?? null;
}

const mapItems = () => OBR.scene.items.getItems((i) => i.layer === "MAP");

export async function currentWeather(): Promise<WeatherType | null> {
  const maps = await mapItems();
  const w = maps.find((m) => EXT.weather in m.metadata)?.metadata[EXT.weather] as { type?: WeatherType } | undefined;
  return w?.type ?? null;
}

/** Put weather on the scene's map (Weather extension), or clear it. */
export async function setWeather(type: WeatherType | null) {
  const maps = await mapItems();
  if (!maps.length) throw new Error("Open one of the Hero Kids scenes first");
  await OBR.scene.items.updateItems(
    maps.map((m) => m.id),
    (drafts) => {
      for (const d of drafts) {
        if (type) d.metadata[EXT.weather] = { type, speed: 1, density: 3, direction: { x: -1, y: -1 } };
        else delete d.metadata[EXT.weather];
      }
    },
  );
}

// ----------------------------------------------------------- dynamic fog

/** A hero's torch for the Dynamic Fog extension: 6 squares, soft edge. */
export const heroLight = (dpi: number) => ({ attenuationRadius: 6 * dpi, sourceRadius: 25, falloff: 0.2 });

// ---------------------------------------------------------------- ranges

/** Hero Kids reach, for the Ranges mode of the measure tool. Radii are in squares. */
export const HERO_KIDS_RANGE = {
  id: "hero-kids",
  name: "Hero Kids",
  type: "square" as const, // diagonal moves cost 1, like the game
  rings: [
    { id: "hk-melee", name: "Melee", radius: 1 },
    { id: "hk-magic", name: "Magic", radius: 4 },
    { id: "hk-ranged", name: "Ranged", radius: 6 },
  ],
};

/** Once per Hero Kids scene, preset the Ranges tool to Hero Kids reach. */
export async function presetRangesForScene() {
  const meta = await OBR.scene.getMetadata();
  const flag = `${KEY.marker}/ranges-set`;
  if (meta[flag]) return;
  const hasMarker = (await OBR.scene.items.getItems((i) => KEY.marker in i.metadata)).length > 0;
  if (!hasMarker) return;
  await OBR.scene.setMetadata({ [EXT.range]: HERO_KIDS_RANGE, [flag]: true });
}

