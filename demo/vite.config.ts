import { defineConfig } from "vite";

export default defineConfig({
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
