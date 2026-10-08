import { defineConfig } from "vite";
import { resolve } from "path";

// Relative base so the build works from any GitHub Pages sub-path.
export default defineConfig({
  base: "./",
  define: { __HK_VERSION__: JSON.stringify(process.env.HK_VERSION ?? "dev") },
  server: { cors: true },
  preview: { cors: true },
  build: {
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "index.html"),
        background: resolve(__dirname, "background.html"),
      },
    },
  },
});
