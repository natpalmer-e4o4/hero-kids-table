// Always-on part of the extension (runs for the GM and every player).
import OBR from "@owlbear-rodeo/sdk";
import { changeHealth, setMaxHealth } from "./owl";
import { FACES, KEY, RollMessage, icon, pagePath } from "./shared";
import type { Shown } from "./types";

const hasToken = { key: ["metadata", KEY.token], value: undefined, operator: "!=" as const };

OBR.onReady(async () => {
  // ---- health on tokens (anyone can use it: kids love marking off monster hits)
  await OBR.contextMenu.create({
    id: `${KEY.token}/hit`,
    icons: [{ icon: icon("hit"), label: "Hit! (mark 1 damage)", filter: { every: [hasToken] } }],
    shortcut: "H",
    onClick: (ctx) => changeHealth(ctx.items.map((i) => i.id), -1),
  });
  await OBR.contextMenu.create({
    id: `${KEY.token}/heal`,
    icons: [{ icon: icon("heal"), label: "Heal 1", filter: { every: [hasToken] } }],
    onClick: (ctx) => changeHealth(ctx.items.map((i) => i.id), +1),
  });
  for (const n of [1, 2, 3, 4, 5]) {
    await OBR.contextMenu.create({
      id: `${KEY.token}/max${n}`,
      icons: [
        {
          icon: icon("card"),
          label: `Set health to ${n} box${n > 1 ? "es" : ""}`,
          filter: { every: [hasToken], roles: ["GM"], max: 1 },
        },
      ],
      onClick: (ctx) => setMaxHealth(ctx.items.map((i) => i.id), n),
    });
  }

  // ---- dice results for everyone
  OBR.broadcast.onMessage(KEY.roll, async ({ data }) => {
    const r = data as RollMessage;
    const a = r.attack.map((d) => FACES[d]).join("");
    const msg =
      r.mode === "attack"
        ? `${r.who} — ${r.label}: ${a} vs ${r.defense.map((d) => FACES[d]).join("") || "—"} → ${r.success ? "HIT!" : "miss"}`
        : `${r.who} — ${r.label}: ${a} vs ${r.difficulty} → ${r.success ? "Success!" : "not this time"}`;
    await OBR.notification.show(msg, r.success ? "SUCCESS" : "DEFAULT");
  });

  // ---- read-aloud text the GM chose to show the players
  let lastShown = 0;
  const role = await OBR.player.getRole();
  const showIfNew = async (m: Record<string, unknown>) => {
    const s = m[KEY.shown] as Shown | undefined;
    if (!s || s.at <= lastShown) return;
    const first = lastShown === 0;
    lastShown = s.at;
    if (first && Date.now() - s.at > 60_000) return; // don't replay old text on join
    if (role === "PLAYER") {
      await OBR.modal.open({ id: KEY.shown, url: pagePath("index.html?view=shown"), width: 720, height: 520 });
    }
  };
  showIfNew(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(showIfNew);
});
