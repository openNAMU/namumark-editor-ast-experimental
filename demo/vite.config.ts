import { defineConfig } from "vite";

export default defineConfig({
  // Deployed under a GitHub Pages project subpath
  // (https://opennamu.github.io/namumark-editor-ast-experimental/), so assets
  // must be referenced relative to that base. Overridable via BASE_PATH for
  // local dev / other hosts; defaults to "/" so `vite dev` keeps working.
  base: process.env.BASE_PATH ?? "/",
  // The Emscripten module + .wasm live in @namumark/wasm/dist. Vite needs to
  // leave the .wasm asset alone and serve it; the editor passes a locateFile
  // that points the loader at the bundled URL (see src/main.ts).
  optimizeDeps: {
    // Don't pre-bundle the wasm package; its .mjs uses dynamic wasm fetching.
    exclude: ["@namumark/wasm"],
  },
  server: {
    fs: {
      // Allow serving files from the monorepo root (workspace packages + wasm).
      allow: [".."],
    },
  },
});
