// Writes the build version into dist/manifest.json so Owlbear sees each deploy as a new version.
// Version = 1.1.<GitHub Actions run number> (or HK_VERSION if set).
import fs from "fs";
const v = process.env.HK_VERSION || `1.1.${process.env.GITHUB_RUN_NUMBER ?? 0}`;
const p = "dist/manifest.json";
const m = JSON.parse(fs.readFileSync(p, "utf8"));
m.version = v;
fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
console.log(`manifest version ${v}`);
