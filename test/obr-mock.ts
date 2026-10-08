// In-memory stand-in for @owlbear-rodeo/sdk so the panel can be exercised in a
// plain browser. Every call is recorded on window.__obr for the test to inspect.
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const log: { api: string; args: Any[] }[] = [];
const rec = (api: string, ...args: Any[]) => log.push({ api, args });
const listeners: Record<string, ((x: Any) => void)[]> = {};
const on = (k: string, cb: (x: Any) => void) => ((listeners[k] ??= []).push(cb), () => {});
const emit = (k: string, x: Any) => (listeners[k] ?? []).forEach((cb) => cb(x));

const role = (new URLSearchParams(location.search).get("role") ?? "GM") as "GM" | "PLAYER";
let roomMeta: Record<string, Any> = {};
let items: Any[] = [];
let sceneReady = false;
let sceneMeta: Record<string, Any> = {};

function builder(kind: string, init: Any = {}) {
  const obj: Any = { type: kind, id: Math.random().toString(36).slice(2), metadata: {}, text: { plainText: "" }, rotation: 0, ...init };
  const p: Any = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "build") return () => obj;
        return (v: Any) => {
          if (prop === "plainText") obj.text.plainText = v;
          else obj[prop] = v;
          return p;
        };
      },
    },
  );
  return p;
}

const OBR: Any = {
  onReady: (cb: () => void) => setTimeout(cb, 0),
  isAvailable: true,
  player: {
    getRole: async () => role,
    getId: async () => (role === "GM" ? "gm-1" : "kid-1"),
    getName: async () => (role === "GM" ? "Dad" : "Ava"),
  },
  party: {
    getPlayers: async () => [
      { id: "kid-1", name: "Ava", role: "PLAYER" },
      { id: "kid-2", name: "Leo", role: "PLAYER" },
    ],
    onChange: (cb: Any) => on("party", cb),
  },
  room: {
    getMetadata: async () => roomMeta,
    setMetadata: async (u: Any) => {
      rec("room.setMetadata", u);
      roomMeta = { ...roomMeta, ...JSON.parse(JSON.stringify(u)) };
      emit("room", roomMeta);
    },
    onMetadataChange: (cb: Any) => on("room", cb),
  },
  theme: {
    getTheme: async () => ({
      mode: "DARK",
      primary: { main: "#bb99ff", contrastText: "#000" },
      background: { default: "#222639", paper: "#3d4051" },
      text: { primary: "#fff", secondary: "rgba(255,255,255,.7)" },
    }),
    onChange: () => () => {},
  },
  broadcast: {
    sendMessage: async (ch: string, data: Any, opt: Any) => {
      rec("broadcast", ch, data, opt);
      emit("bc:" + ch, { data, connectionId: "x" });
    },
    onMessage: (ch: string, cb: Any) => on("bc:" + ch, cb),
  },
  viewport: { animateToBounds: async (b: Any) => rec("viewport.animateToBounds", b) },
  notification: { show: async (m: string, v?: string) => rec("notify", m, v) },
  modal: { open: async (m: Any) => rec("modal.open", m), close: async (id: string) => rec("modal.close", id) },
  contextMenu: { create: async (m: Any) => rec("contextMenu.create", m.id) },
  assets: {
    uploadScenes: async (s: Any[], d: Any) => rec("assets.uploadScenes", s.map((x: Any) => ({ name: x.name, base: x.baseMap?.name, dpi: x.baseMap?.dpi, fileType: x.baseMap?.file?.type, size: x.baseMap?.file?.size, items: x.items.length })), d),
    uploadImages: async (i: Any[], t: Any) => rec("assets.uploadImages", i.map((x: Any) => ({ name: x.name, dpi: x.dpi, size: x.file?.size })), t),
    downloadImages: async (_m: Any, search: string) => {
      rec("assets.downloadImages", search);
      // pretend the GM selected everything previously uploaded
      const ups = log.filter((l) => l.api === "assets.uploadImages").flatMap((l) => l.args[0]);
      return ups.map((u: Any, k: number) => ({
        name: u.name,
        image: { url: `https://cdn.example/${k}.webp`, mime: "image/webp", width: 300, height: 400 },
        grid: { dpi: u.dpi, offset: { x: 150, y: 200 } },
        type: "CHARACTER",
      }));
    },
  },
  scene: {
    isReady: async () => sceneReady,
    getMetadata: async () => sceneMeta,
    setMetadata: async (u: Any) => {
      rec("scene.setMetadata", u);
      sceneMeta = { ...sceneMeta, ...JSON.parse(JSON.stringify(u)) };
    },
    onReadyChange: (cb: Any) => on("sceneReady", cb),
    grid: { getDpi: async () => 150 },
    items: {
      getItems: async (f: Any) => (typeof f === "function" ? items.filter(f) : items),
      addItems: async (a: Any[]) => {
        rec("scene.addItems", a.map((x) => ({ name: x.name, layer: x.layer, pos: x.position, label: x.text?.plainText, meta: x.metadata, url: x.image?.url })));
        items.push(...a);
        emit("items", items);
      },
      deleteItems: async (ids: string[]) => {
        rec("scene.deleteItems", ids.length);
        items = items.filter((i) => !ids.includes(i.id));
        emit("items", items);
      },
      onChange: (cb: Any) => on("items", cb),
      updateItems: async (f: Any, upd: Any) => {
        const sel =
          typeof f === "function" ? items.filter(f) : typeof f[0] === "string" ? items.filter((i) => f.includes(i.id)) : f;
        upd(sel);
        rec("scene.updateItems", sel.map((x: Any) => ({ name: x.name, label: x.text?.plainText, rot: x.rotation, meta: x.metadata })));
      },
    },
  },
};

(window as Any).__obr = {
  log,
  OBR,
  dump: () => JSON.parse(JSON.stringify({ roomMeta, items })),
  seed(state: Any) {
    roomMeta = state.roomMeta;
    items = state.items;
    sceneReady = true;
    emit("room", roomMeta);
    emit("sceneReady", true);
    emit("items", items);
  },
  setActive(name: string) {
    for (const i of items) {
      const im = i.metadata["rodeo.owlbear.initiative-tracker/metadata"];
      if (im) im.active = i.name === name;
    }
    emit("items", items);
  },
  openScene(marker: Any) {
    items = [
      { id: "m", layer: "NOTE", metadata: { "app.herokids.table/scene": marker } },
      { id: "map", layer: "MAP", name: "Map", metadata: {} },
    ];
    sceneReady = true;
    emit("sceneReady", true);
  },
};

export default OBR;
export const buildImage = (image: Any, grid: Any) => builder("IMAGE", { image, grid });
export const buildLabel = () => builder("LABEL");
export const buildImageUpload = (file: Any) => builder("IMAGE_UPLOAD", { file });
export const buildSceneUpload = () => builder("SCENE_UPLOAD", { items: [] });
export type Player = Any;
export type Image = Any;
export type Item = Any;
