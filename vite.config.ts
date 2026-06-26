import { defineConfig } from "vite";

// The dashboard lives in web/ and builds to ./dist, which wrangler serves as
// static assets. Zero runtime deps — the charts are hand-built SVG.
export default defineConfig({
  root: "web",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    target: "es2022",
  },
});
