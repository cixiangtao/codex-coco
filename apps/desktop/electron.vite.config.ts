import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(root, "src/desktop/main/index.ts"),
          "foundation-worker": resolve(root, "src/modules/foundation-fixture/worker.ts"),
        },
        external: ["electron", /^node:/],
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: resolve(root, "src/desktop/preload/index.ts"),
        external: ["electron"],
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    plugins: [react(), tailwindcss()],
    build: { minify: true, rollupOptions: { input: resolve(root, "src/renderer/index.html") } },
  },
});
