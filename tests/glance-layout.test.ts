import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { GlanceLayoutStore } from "../apps/desktop/src/application/glance-layout-store";
import {
  defaultGlanceLayout,
  glanceLayoutSchema,
} from "../apps/desktop/src/contracts/glance-layout";
import { glanceDetailSchema } from "../apps/desktop/src/contracts/glance";

describe("information blocks", () => {
  it("rejects duplicate, arbitrary and private block definitions and oversized daily projections", () => {
    expect(glanceLayoutSchema.safeParse({ blocks: [] }).success).toBe(true);
    for (const value of [
      { blocks: ["usage.today", "usage.today"] },
      { blocks: ["custom.script"] },
      { blocks: [], script: "PRIVATE" },
    ])
      expect(glanceLayoutSchema.safeParse(value).success).toBe(false);
    const series = { points: [{ day: "2026-10-22", tokens: 0 }], estimated: false, limited: false };
    expect(glanceDetailSchema.safeParse({ description: "公开计数", series }).success).toBe(true);
    expect(
      glanceDetailSchema.safeParse({
        description: "公开计数",
        series: { ...series, path: "PRIVATE" },
      }).success,
    ).toBe(false);
    expect(
      glanceDetailSchema.safeParse({
        description: "公开计数",
        series: { ...series, points: Array(8).fill(series.points[0]) },
      }).success,
    ).toBe(false);
  });
  it("persists independent ordered preferences, rejects stale writes and preserves damaged originals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glance-layout-"));
    try {
      const path = join(directory, "layout.json");
      const store = new GlanceLayoutStore(path);
      expect((await store.load()).value).toEqual(defaultGlanceLayout);
      expect(await readdir(directory)).toEqual([]);
      const saved = await store.save({
        expectedRevision: 0,
        value: { blocks: ["appearance.status", "usage.today"] },
      });
      expect(saved.value.blocks).toEqual(["appearance.status", "usage.today"]);
      await expect(
        store.save({ expectedRevision: 0, value: { blocks: [] } }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(JSON.parse(await readFile(path, "utf8")).value).toEqual(saved.value);
      const restart = new GlanceLayoutStore(path);
      expect((await restart.load()).value).toEqual(saved.value);
      await writeFile(path, "damaged-original");
      const damaged = new GlanceLayoutStore(path);
      expect((await damaged.load()).health).toBe("invalid");
      await expect(
        damaged.save({ expectedRevision: 0, value: { blocks: [] } }),
      ).rejects.toMatchObject({ code: "SETTINGS_UNAVAILABLE" });
      expect(await readFile(path, "utf8")).toBe("damaged-original");
      expect((await damaged.reset()).value).toEqual(defaultGlanceLayout);
      const backup = (await readdir(directory)).find((entry) =>
        entry.startsWith("layout.json.backup-"),
      );
      expect(await readFile(join(directory, backup!), "utf8")).toBe("damaged-original");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
