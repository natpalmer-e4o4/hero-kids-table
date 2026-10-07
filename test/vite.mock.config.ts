import { defineConfig } from "vite";
import { resolve } from "path";

// Same app, with the Owlbear SDK swapped for an in-memory mock.
export default defineConfig({
  root: resolve(__dirname, ".."),
  base: "./",
  resolve: { alias: { "@owlbear-rodeo/sdk": resolve(__dirname, "obr-mock.ts") } },
  build: {
    outDir: resolve(__dirname, "../dist-mock"),
    rollupOptions: { input: { panel: resolve(__dirname, "../index.html"), background: resolve(__dirname, "../background.html") } },
  },
});
