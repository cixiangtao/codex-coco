import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsStore } from "../apps/desktop/src/application/settings-store";

const dirs: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-settings-"));
  dirs.push(directory);
  const path = join(directory, "settings.json");
  return { directory, path, store: new SettingsStore(path) };
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("settings persistence", () => {
  it("does not create files on a missing-config read, then saves a validated canonical theme", async () => {
    const { store, directory, path } = await fixture();
    const initial = await store.load();
    expect(initial.health).toBe("missing");
    expect(await readdir(directory)).toEqual([]);
    await store.saveTheme({
      expectedRevision: 0,
      theme: { mode: "dark", presetId: "blue", primaryColor: "#ABC" },
    });
    const reopened = new SettingsStore(path);
    const result = await reopened.load();
    expect(result.settings.theme.primaryColor).toBe("#aabbcc");
    expect(result.settings.revision).toBe(1);
    expect(await readdir(directory)).toEqual(["settings.json"]);
  });
  it("rejects invalid input and revision races without overwriting the successful write", async () => {
    const { store, path } = await fixture();
    await store.load();
    await expect(
      store.saveTheme({ expectedRevision: 0, theme: { mode: "unsafe" } }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const theme = { mode: "light", presetId: "neutral", primaryColor: null };
    const results = await Promise.allSettled([
      store.saveTheme({ expectedRevision: 0, theme }),
      store.saveTheme({ expectedRevision: 0, theme: { ...theme, mode: "dark" } }),
    ]);
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected"]);
    expect(JSON.parse(await readFile(path, "utf8")).theme.mode).toBe("light");
  });
  it.each([
    ['{"schemaVersion":99}', "future-version"],
    ["broken json", "invalid"],
  ])("preserves %s until explicit backed-up recovery", async (raw, health) => {
    const { store, path, directory } = await fixture();
    await writeFile(path, raw);
    expect((await store.load()).health).toBe(health);
    await expect(
      store.saveTheme({
        expectedRevision: 0,
        theme: { mode: "dark", presetId: "blue", primaryColor: null },
      }),
    ).rejects.toMatchObject({ code: "SETTINGS_UNAVAILABLE" });
    expect(await readFile(path, "utf8")).toBe(raw);
    await store.reset();
    const backup = (await readdir(directory)).find((file) => file.includes(".backup-"));
    expect(backup).toBeDefined();
    expect(await readFile(join(directory, backup!), "utf8")).toBe(raw);
    expect((await new SettingsStore(path).load()).health).toBe("ok");
  });
  it("migrates its own legacy schema once, preserving the original", async () => {
    const { store, path, directory } = await fixture();
    await writeFile(path, JSON.stringify({ schemaVersion: 0, mode: "dark" }));
    expect((await store.load()).settings.theme.mode).toBe("dark");
    await new SettingsStore(path).load();
    expect((await readdir(directory)).filter((name) => name.includes("backup"))).toHaveLength(1);
  });
  it("publishes only saved revisions and releases subscriptions", async () => {
    const { store } = await fixture();
    await store.load();
    const revisions: number[] = [];
    const dispose = store.subscribe((value) => revisions.push(value.settings.revision));
    await store.saveTheme({
      expectedRevision: 0,
      theme: { mode: "dark", presetId: "neutral", primaryColor: null },
    });
    dispose();
    await store.reset();
    expect(revisions).toEqual([1]);
  });
});
