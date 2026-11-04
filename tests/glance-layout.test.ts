import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { GlanceLayoutStore } from "../apps/desktop/src/application/glance-layout-store";
import {
  defaultGlanceLayout,
  glanceLayoutSchema,
  reorderGlanceLayoutSchema,
  type GlanceBlockId,
} from "../apps/desktop/src/contracts/glance-layout";
import { glanceDetailSchema } from "../apps/desktop/src/contracts/glance";
import { glanceCards, moveGlanceCard } from "../apps/desktop/src/renderer/lib/glance-order";
import { glanceGridPositions } from "../apps/desktop/src/renderer/lib/glance-grid";

describe("information blocks", () => {
  it("packs mixed-width drag previews in saved order without overlap or scaling", () => {
    const rects = [
      { left: 16, top: 50, width: 328, height: 140 },
      { left: 16, top: 198, width: 328, height: 60 },
      { left: 16, top: 266, width: 160, height: 80 },
      { left: 184, top: 266, width: 160, height: 80 },
      { left: 16, top: 354, width: 328, height: 40 },
    ];
    expect(glanceGridPositions(rects, 328, 8, 2, 3)).toEqual([
      { left: 16, top: 50 },
      { left: 16, top: 198 },
      { left: 184, top: 266 },
      { left: 16, top: 266 },
      { left: 16, top: 354 },
    ]);
    for (let active = 0; active < rects.length; active++) {
      for (let over = 0; over < rects.length; over++) {
        const positions = glanceGridPositions(rects, 328, 8, active, over);
        positions.forEach((position, index) => {
          const rect = rects[index]!;
          expect(position.left).toBeGreaterThanOrEqual(16);
          expect(position.left + rect.width).toBeLessThanOrEqual(344);
          for (let other = index + 1; other < positions.length; other++) {
            const next = positions[other]!;
            const shape = rects[other]!;
            expect(
              position.left + rect.width <= next.left ||
                next.left + shape.width <= position.left ||
                position.top + rect.height <= next.top ||
                next.top + shape.height <= position.top,
            ).toBe(true);
          }
        });
      }
    }
    expect(
      glanceGridPositions(
        rects.map((rect) => ({ ...rect, width: 248 })),
        248,
        8,
        2,
        3,
      ).map((position) => position.left),
    ).toEqual([16, 16, 16, 16, 16]);
  });
  it("moves whole Cards in either direction without losing or mutating a selection", () => {
    const blocks = defaultGlanceLayout.blocks;
    const original = [...blocks];
    const cards = glanceCards(blocks);
    for (const { id } of cards)
      for (let index = 0; index < cards.length; index++) {
        const moved = moveGlanceCard(blocks, id, index);
        expect(glanceCards(moved)[index]!.id).toBe(id);
        expect([...moved].sort()).toEqual([...blocks].sort());
        expect(moved.indexOf("usage.secondary")).toBe(moved.indexOf("usage.primary") + 1);
      }
    expect(blocks).toEqual(original);
    expect(moveGlanceCard(blocks, "usage.trend", 0)).toEqual(blocks);
    expect(moveGlanceCard(blocks, "usage.quota", -1)).toEqual(blocks);
    expect(moveGlanceCard(blocks, "usage.quota", 999).slice(-2)).toEqual([
      "usage.primary",
      "usage.secondary",
    ]);
    for (const input of [
      { expectedRevision: 0, blocks: ["usage.today", "usage.today"] },
      { expectedRevision: 0, blocks: ["private.script"] },
      { expectedRevision: 0, blocks: ["usage.quota"] },
      { expectedRevision: 0, blocks: [], value: {} },
      { expectedRevision: -1, blocks: [] },
    ])
      expect(reorderGlanceLayoutSchema.safeParse(input).success).toBe(false);
  });
  it("groups historical split windows at the first occurrence without rewriting a no-op", () => {
    const blocks: GlanceBlockId[] = [
      "usage.today",
      "usage.secondary",
      "usage.week",
      "usage.primary",
    ];
    expect(glanceCards(blocks)).toEqual([
      { id: "usage.today", blocks: ["usage.today"] },
      { id: "usage.quota", blocks: ["usage.secondary", "usage.primary"] },
      { id: "usage.week", blocks: ["usage.week"] },
    ]);
    expect(moveGlanceCard(blocks, "usage.quota", 1)).toEqual(blocks);
    expect(moveGlanceCard(blocks, "usage.quota", 0)).toEqual([
      "usage.secondary",
      "usage.primary",
      "usage.today",
      "usage.week",
    ]);
  });
  it("preserves individually selected windows while treating both windows as one drag target", () => {
    for (const window of ["usage.primary", "usage.secondary"] as const) {
      const blocks: GlanceBlockId[] = [window, "usage.today"];
      expect(glanceCards(blocks)[0]).toEqual({ id: "usage.quota", blocks: [window] });
      expect(moveGlanceCard(blocks, "usage.quota", 1)).toEqual(["usage.today", window]);
    }
    expect(glanceCards(["usage.primary", "usage.secondary"])).toEqual([
      { id: "usage.quota", blocks: ["usage.primary", "usage.secondary"] },
    ]);
    expect(glanceLayoutSchema.safeParse({ blocks: ["usage.quota"] }).success).toBe(false);
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
