import { describe, expect, it } from "vitest";
import { ModuleManager } from "../apps/desktop/src/application/modules";

describe("built-in module lifecycle", () => {
  it("cancels a queued enable before it acquires resources", async () => {
    let starts = 0;
    const manager = new ModuleManager([
      {
        id: "fixture",
        start: async () => {
          starts++;
          return async () => {};
        },
      },
    ]);
    const pending = manager.enable("fixture");
    await manager.disable("fixture");
    await pending;
    expect(starts).toBe(0);
    expect(manager.statuses()[0]?.phase).toBe("disabled");
  });
  it("starts once, cleans up, and can start a new generation", async () => {
    let resources = 0;
    const manager = new ModuleManager([
      {
        id: "fixture",
        start: async () => {
          resources++;
          return async () => {
            resources--;
          };
        },
      },
    ]);
    await Promise.all([manager.enable("fixture"), manager.enable("fixture")]);
    expect(resources).toBe(1);
    await manager.disable("fixture");
    expect(resources).toBe(0);
    await manager.enable("fixture");
    expect(manager.statuses()[0]?.generation).toBe(2);
    await manager.shutdown();
    expect(resources).toBe(0);
    await expect(manager.enable("fixture")).rejects.toThrow("MANAGER_CLOSED");
  });
  it("isolates failed and hung starts from unrelated modules", async () => {
    const manager = new ModuleManager(
      [
        { id: "hung", start: () => new Promise(() => {}) },
        {
          id: "broken",
          start: async () => {
            throw new Error("private failure");
          },
        },
        { id: "healthy", start: async () => async () => {} },
      ],
      25,
    );
    const results = await Promise.allSettled([
      manager.enable("hung"),
      manager.enable("broken"),
      manager.enable("healthy"),
    ]);
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected", "fulfilled"]);
    expect(manager.statuses().find((status) => status.id === "healthy")?.phase).toBe("running");
    const statuses = await manager.shutdown();
    expect(statuses.find((status) => status.id === "hung")?.phase).toBe("error");
  });
  it("cancels an in-flight start and cleans a late startup result", async () => {
    let cleaned = false;
    let started!: () => void;
    const starting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const manager = new ModuleManager([
      {
        id: "fixture",
        start: (signal) => {
          started();
          return new Promise((resolve) =>
            signal.addEventListener(
              "abort",
              () =>
                resolve(async () => {
                  cleaned = true;
                }),
              { once: true },
            ),
          );
        },
      },
    ]);
    const pending = manager.enable("fixture");
    await starting;
    await manager.disable("fixture");
    await pending;
    expect(cleaned).toBe(true);
    expect(manager.statuses()[0]?.phase).toBe("disabled");
  });
  it("reports cleanup timeout as an error, never as disabled", async () => {
    const manager = new ModuleManager(
      [{ id: "fixture", start: async () => () => new Promise(() => {}) }],
      20,
    );
    await manager.enable("fixture");
    await manager.shutdown();
    expect(manager.statuses()[0]).toMatchObject({ phase: "error", error: "MODULE_STOP_FAILED" });
  });
});
