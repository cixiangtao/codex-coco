import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { GlanceLayoutStore } from "../apps/desktop/src/application/glance-layout-store";
import {
  defaultGlanceLayout,
  glanceLayoutSchema,
  reorderGlanceLayoutSchema,
} from "../apps/desktop/src/contracts/glance-layout";
import { glanceDetailSchema } from "../apps/desktop/src/contracts/glance";
import { moveGlanceBlock } from "../apps/desktop/src/renderer/lib/glance-order";

describe("information blocks", () => {
  it("moves selected blocks in either direction without losing or mutating a selection", () => {
    const blocks = defaultGlanceLayout.blocks;
    const original = [...blocks];
    for (const id of blocks)
      for (let index = 0; index < blocks.length; index++) {
        const moved = moveGlanceBlock(blocks, id, index);
        expect(moved[index]).toBe(id);
        expect([...moved].sort()).toEqual([...blocks].sort());
      }
    expect(blocks).toEqual(original);
    expect(moveGlanceBlock(blocks, "usage.trend", 0)).toEqual(blocks);
    expect(moveGlanceBlock(blocks, blocks[0]!, -1)).toEqual(blocks);
    expect(moveGlanceBlock(blocks, blocks[0]!, 999).at(-1)).toBe(blocks[0]);
    for (const input of [
      { expectedRevision: 0, blocks: ["usage.today", "usage.today"] },
      { expectedRevision: 0, blocks: ["private.script"] },
      { expectedRevision: 0, blocks: [], value: {} },
      { expectedRevision: -1, blocks: [] },
    ])
      expect(reorderGlanceLayoutSchema.safeParse(input).success).toBe(false);
  });
  it("limits popover writes to exact permutations and rejects concurrent selection changes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "glance-reorder-"));
    try {
      const store = new GlanceLayoutStore(join(directory, "layout.json"));
      await store.load();
      const original = store.snapshot();
      for (const blocks of [
        original.value.blocks.slice(1),
        [...original.value.blocks, "usage.trend"],
        [...original.value.blocks.slice(0, -1), "usage.trend"],
      ])
        await expect(store.reorder({ expectedRevision: 0, blocks })).rejects.toMatchObject({
          code: "INVALID_INPUT",
        });
      const blocks = [...original.value.blocks].reverse();
      const saved = await store.reorder({ expectedRevision: 0, blocks });
      expect(saved.value.blocks).toEqual(blocks);
      const reopened = new GlanceLayoutStore(join(directory, "layout.json"));
      expect((await reopened.load()).value.blocks).toEqual(blocks);
      const changes = await Promise.allSettled([
        store.save({ expectedRevision: saved.revision, value: { blocks: ["appearance.status"] } }),
        store.reorder({ expectedRevision: saved.revision, blocks: original.value.blocks }),
      ]);
      expect(changes[0].status).toBe("fulfilled");
      expect(changes[1]).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
      expect(store.snapshot().value.blocks).toEqual(["appearance.status"]);
      await writeFile(join(directory, "layout.json"), "damaged-original");
      const damaged = new GlanceLayoutStore(join(directory, "layout.json"));
      await damaged.load();
      await expect(
        damaged.reorder({ expectedRevision: 0, blocks: original.value.blocks }),
      ).rejects.toMatchObject({ code: "SETTINGS_UNAVAILABLE" });
      expect(await readFile(join(directory, "layout.json"), "utf8")).toBe("damaged-original");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
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
