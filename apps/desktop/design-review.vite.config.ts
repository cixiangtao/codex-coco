import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

/** Independent synthetic review surface; never imported by the Electron entry. */
export default defineConfig({
  root: resolve(root, "src/renderer/design-review"),
  plugins: [react(), tailwindcss()],
  server: { host: "127.0.0.1", port: 5190, strictPort: true },
  preview: { host: "127.0.0.1", port: 5190, strictPort: true },
  build: { outDir: resolve(root, "../../work/design-review"), emptyOutDir: true },
});
