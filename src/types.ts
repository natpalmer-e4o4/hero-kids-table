// Shape of the library produced by tools/hk_extract.py

export interface MapInfo {
  id: string;
  file: string;
  name: string;
  page: number;
  width: number;
  height: number;
  dpi: number; // px per grid square in the image
  cols: number;
  rows: number;
  aligned: boolean;
}

export interface CardInfo {
  id: string;
  file: string;
  name: string;
  kind: "hero" | "monster" | "pet" | "item" | "advancement";
  attack?: string;
  health?: number | null;
  ocr?: string;
  width: number;
  height: number;
  token?: string;
}

export interface TokenInfo {
  id: string;
  file: string;
  name: string;
  width: number;
  height: number;
  cells?: number;
  card?: string;
  match?: number;
}

export interface MonsterEntry {
  count: number;
  name: string;
}

export interface Encounter {
  n: string; // "1", "4a" …
  title: string;
  pages: number[];
  md: string;
  monsters: Record<string, MonsterEntry[]>;
  read_aloud: string[];
  map: string | null;
}

export interface Section {
  title: string;
  md: string;
}

export interface Product {
  id: string;
  title: string;
  kind: "core" | "adventure" | "expansion";
  meta: Record<string, string>;
  maps: MapInfo[];
  cards: CardInfo[];
  tokens: TokenInfo[];
  intro_md?: string;
  encounters?: Encounter[];
  sections?: Section[];
}

export interface LibraryIndexEntry {
  id: string;
  title: string;
  kind: Product["kind"];
  maps: number;
  cards: number;
  tokens: number;
  encounters: number;
  bytes: number;
}

/** An image already uploaded to the GM's Owlbear storage. */
export interface LinkedImage {
  name: string;
  image: { url: string; mime: string; width: number; height: number };
  grid: { dpi: number; offset: { x: number; y: number } };
}

export interface ProductStatus {
  scenes?: string; // ISO date uploaded
  tokens?: string;
  cards?: string;
  art?: string; // legacy
  linked?: number; // count of linked images
}

export interface PartyMember {
  playerId: string;
  playerName: string;
  hero: string; // display name
  product: string;
  card: string;
  cardUrl?: string;
  token?: string;
}

export interface Campaign {
  name: string;
  party: PartyMember[];
  adventure?: string; // product id
  encounter?: string; // "0" = intro
  done: Record<string, string[]>; // product id -> finished encounter numbers
  finished: string[]; // finished adventures
  notes: string;
}

export interface Shown {
  title: string;
  text: string;
  at: number;
}
