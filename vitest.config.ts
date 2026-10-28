import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 5000,
    // Stdio fixtures keep short protocol deadlines; bound simultaneous child-process startup.
    maxWorkers: 4,
  },
});
