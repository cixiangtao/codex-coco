import { describe, expect, it } from "vitest";
import { buildGlanceItems } from "../apps/desktop/src/application/glance";
import { glanceBounds } from "../apps/desktop/src/desktop/main/glance-bounds";
import { mainPages, openMainPageSchema } from "../apps/desktop/src/contracts/windows";
import type { ModuleSnapshot } from "../apps/desktop/src/contracts/modules";

function moduleSnapshot(id: string): ModuleSnapshot {
  return {
    id,
    title: `公开模块 ${id}`,
    revision: 2,
    generation: 1,
    phase: "running",
    error: null,
    config: {
      schemaVersion: 1,
      revision: 1,
      enabled: true,
      health: "ok",
      value: { secret: "PRIVATE_VALUE" },
    },
    operations: ["private-operation"],
    operation: {
      id: "private-task",
      name: "private-operation",
      generation: 1,
      phase: "succeeded",
      progress: 100,
      result: { secret: "PRIVATE_RESULT" },
      error: null,
    },
  };
}

describe("glance projection", () => {
  it("marks absent capabilities honestly without synthetic quotas", () => {
    expect(buildGlanceItems([]).map(({ id, phase, page }) => ({ id, phase, page }))).toEqual([
      { id: "usage", phase: "unavailable", page: "usage" },
      { id: "appearance", phase: "unavailable", page: "appearance" },
    ]);
  });
  it("includes registered modules while stripping configuration, operations, results and errors", () => {
    const snapshot = moduleSnapshot("extra");
    snapshot.error = "PRIVATE_ERROR";
    const output = buildGlanceItems([snapshot]);
    expect(output[0]).toEqual({
      id: "extra",
      title: "公开模块 extra",
      phase: "error",
      page: "modules",
      description: "模块暂时不可用，请前往主窗口处理。",
    });
    expect(JSON.stringify(output)).not.toMatch(
      /PRIVATE_|private-operation|private-task|secret|generation/,
    );
    expect(snapshot.config.value).toEqual({ secret: "PRIVATE_VALUE" });
  });
  it("routes recovery first while preserving unaffected module order", () => {
    const usage = moduleSnapshot("usage");
    const skin = moduleSnapshot("appearance");
    skin.config.health = "future-version";
    expect(
      buildGlanceItems([usage, skin]).map(({ id, phase, page }) => ({ id, phase, page })),
    ).toEqual([
      { id: "appearance", phase: "error", page: "modules" },
      { id: "usage", phase: "running", page: "usage" },
    ]);
  });
  it("offers recovery for a failed task without classifying cancellation as failure", () => {
    const snapshot = moduleSnapshot("extra");
    snapshot.operation!.phase = "failed";
    snapshot.operation!.error = "PRIVATE_TASK_ERROR";
    const item = buildGlanceItems([snapshot])[0];
    expect(item?.phase).toBe("error");
    expect(item?.description).toContain("最近操作未完成");
    snapshot.operation!.phase = "cancelled";
    expect(buildGlanceItems([snapshot]).find((entry) => entry.id === "extra")?.phase).toBe(
      "running",
    );
  });
});

it("allows only explicit main pages or the default main-window action", () => {
  for (const page of mainPages) expect(openMainPageSchema.parse({ page })).toEqual({ page });
  expect(openMainPageSchema.parse({})).toEqual({});
  for (const input of [
    { page: "https://example.com" },
    { page: "../settings" },
    { page: "glance" },
    { page: "settings", url: "file:///private" },
    null,
    "settings",
  ]) {
    expect(openMainPageSchema.safeParse(input).success).toBe(false);
  }
});

describe("glance placement in screen DIP coordinates", () => {
  const work = { x: -1600, y: -900, width: 1600, height: 900 };
  it("places a menu-bar popover below the anchor on a negative-origin display", () => {
    const result = glanceBounds({ x: -1200, y: -924, width: 100, height: 24 }, work);
    expect(result).toEqual({ x: -1330, y: -892, width: 360, height: 520 });
  });
  it("opens above a bottom taskbar and clamps both horizontal edges", () => {
    const result = glanceBounds({ x: -30, y: 0, width: 30, height: 30 }, work);
    expect(result.x + result.width).toBeLessThanOrEqual(-8);
    expect(result.y + result.height).toBeLessThanOrEqual(-4);
    expect(glanceBounds({ x: -1800, y: -900, width: 10, height: 20 }, work).x).toBe(-1592);
  });
  it("shrinks to constrained work areas without escaping their bounds", () => {
    const workArea = { x: 300, y: 100, width: 240, height: 200 };
    const result = glanceBounds({ x: 500, y: 300, width: 10, height: 10 }, workArea);
    expect(result.width).toBe(224);
    expect(result.height).toBe(184);
    expect(result.x).toBeGreaterThanOrEqual(workArea.x);
    expect(result.y).toBeGreaterThanOrEqual(workArea.y);
    expect(result.x + result.width).toBeLessThanOrEqual(workArea.x + workArea.width);
    expect(result.y + result.height).toBeLessThanOrEqual(workArea.y + workArea.height);
  });
});

it("projects only the appearance module's bounded quick action without exposing task or configuration", () => {
  const appearance = moduleSnapshot("appearance");
  const other = moduleSnapshot("extra");
  const items = buildGlanceItems(
    [appearance, other],
    new Map([
      ["appearance", { description: "请重启", appearanceAction: "restart", busy: false }],
      ["extra", { description: "其他模块", appearanceAction: "restart" }],
    ]),
  );
  expect(items.find((item) => item.id === "appearance")?.appearanceAction).toBe("restart");
  expect(items.find((item) => item.id === "extra")?.appearanceAction).toBeUndefined();
  expect(JSON.stringify(items)).not.toMatch(/PRIVATE_|private-task|secret|generation/);
  appearance.phase = "disabled";
  expect(
    buildGlanceItems(
      [appearance],
      new Map([["appearance", { description: "请重启", appearanceAction: "restart" }]]),
    ).find((item) => item.id === "appearance")?.appearanceAction,
  ).toBeUndefined();
});
