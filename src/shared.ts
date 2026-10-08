import OBR from "@owlbear-rodeo/sdk";
import type { Campaign, Shown } from "./types";

export const ID = "app.herokids.table";
export const KEY = {
  campaign: `${ID}/campaign`,
  shown: `${ID}/shown`,
  token: `${ID}/token`,
  marker: `${ID}/scene`,
  roll: `${ID}/roll`,
};

export interface TokenMeta {
  product: string;
  tokenId: string;
  name: string;
  kind: "monster" | "hero";
  hp: number;
  max: number;
  member?: string; // PartyMember.id for hero tokens
}

export interface RollMessage {
  who: string;
  label: string;
  mode: "attack" | "test";
  attack: number[];
  defense: number[]; // attack mode
  difficulty?: number; // test mode
  success: boolean;
  at: number;
}

/** Older campaigns had one hero per device, keyed by playerId. */
export function migrateCampaign(c: Campaign): Campaign {
  c.party = (c.party ?? []).map((m) => ({
    ...m,
    id: m.id ?? m.playerId,
    kid: m.kid ?? m.playerName,
    playerId: m.playerId?.startsWith("npc-") ? "" : m.playerId ?? "",
  }));
  return c;
}

export const heroClass = (hero: string) => hero.split(" (")[0];

export const emptyCampaign = (): Campaign => ({
  name: "New campaign",
  party: [],
  done: {},
  finished: [],
  notes: "",
});

export async function getCampaign(): Promise<Campaign> {
  const m = await OBR.room.getMetadata();
  return migrateCampaign({ ...emptyCampaign(), ...((m[KEY.campaign] as Campaign) ?? {}) });
}

export async function setCampaign(c: Campaign) {
  await OBR.room.setMetadata({ [KEY.campaign]: c });
}

export async function getShown(): Promise<Shown | null> {
  const m = await OBR.room.getMetadata();
  return (m[KEY.shown] as Shown) ?? null;
}

export const hearts = (hp: number, max: number) =>
  hp <= 0 ? "KO" : "♥".repeat(Math.max(0, hp)) + "♡".repeat(Math.max(0, max - hp));

export const tokenLabel = (t: TokenMeta) => `${t.name} ${hearts(t.hp, t.max)}`;

/**
 * Owlbear joins the extension's origin and the path we give it, so paths must be
 * root-absolute and include the GitHub Pages folder (e.g. "/hero-kids-table/…").
 */
export const basePath = () => window.location.pathname.replace(/[^/]*$/, "");
export const icon = (name: string) => `${basePath()}icons/${name}.svg`;
export const pagePath = (page: string) => `${basePath()}${page}`;

/** Roll n six-sided dice. */
export const d6 = (n: number) =>
  Array.from({ length: Math.max(0, n) }, () => 1 + Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) * 6));

export const best = (dice: number[]) => (dice.length ? Math.max(...dice) : 0);

export const FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
