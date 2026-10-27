import { expect, it, vi } from "vitest";
import { AppearanceQuickActions } from "../apps/desktop/src/application/appearance-quick-actions";
import type { GlanceDetail } from "../apps/desktop/src/contracts/glance";
import type { ModuleSnapshot } from "../apps/desktop/src/contracts/modules";
import type { ModuleHost } from "../apps/desktop/src/application/module-host";

function fixture() {
  const snapshot: ModuleSnapshot = {
    id: "appearance",
    title: "外观",
    revision: 1,
    generation: 1,
    phase: "running",
    error: null,
    config: { health: "ok", enabled: true, revision: 1, schemaVersion: 2, value: {} },
    operations: [],
    operation: null,
  };
  const detail: GlanceDetail = { description: "公开提示", appearanceAction: "restart" };
  const run = vi.fn<ModuleHost["runInteractive"]>(async (_input, _id, beforeRun) => {
    beforeRun?.();
    return snapshot;
  });
  const gateway = new AppearanceQuickActions({
    snapshots: () => [snapshot],
    glanceDetails: () => new Map([["appearance", detail]]),
    runInteractive: run,
  });
  return { gateway, snapshot, detail, run };
}
it("restricts glance to a current public action and returns no module result", async () => {
  const { gateway, run, detail } = fixture();
  const consent = vi.fn(async () => true);
  for (const input of [
    { action: "restart", path: "/private" },
    { action: "remove" },
    { action: "launch" },
    null,
  ])
    await expect(gateway.execute(input, consent)).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
  expect(consent).not.toHaveBeenCalled();
  expect(await gateway.execute({ action: "restart" }, consent)).toEqual({ outcome: "started" });
  expect(run).toHaveBeenCalledWith(
    { moduleId: "appearance", operation: "restart-application", input: {} },
    undefined,
    expect.any(Function),
  );
  detail.appearanceAction = "launch";
  consent.mockClear();
  await gateway.execute({ action: "launch" }, consent);
  expect(consent).not.toHaveBeenCalled();
});
it("cancellation and changes during confirmation never restart; concurrent submissions are refused", async () => {
  const { gateway, run, snapshot } = fixture();
  expect(await gateway.execute({ action: "restart" }, async () => false)).toEqual({
    outcome: "cancelled",
  });
  await expect(
    gateway.execute({ action: "restart" }, async () => {
      snapshot.revision++;
      return true;
    }),
  ).rejects.toThrow("确认期间");
  let resolve!: (value: boolean) => void;
  const pending = gateway.execute(
    { action: "restart" },
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  await expect(gateway.execute({ action: "restart" }, async () => true)).rejects.toThrow(
    "正在处理",
  );
  resolve(false);
  await pending;
  snapshot.phase = "disabled";
  await expect(gateway.execute({ action: "restart" }, async () => true)).rejects.toThrow("启用");
  expect(run).not.toHaveBeenCalled();
  expect(gateway.busy).toBe(false);
});
it("revalidates the public action after waiting for maintenance", async () => {
  const { gateway, run, snapshot } = fixture();
  run.mockImplementationOnce(async (_input, _id, beforeRun) => {
    snapshot.revision++;
    beforeRun?.();
    return snapshot;
  });
  await expect(gateway.execute({ action: "restart" }, async () => true)).rejects.toThrow(
    "确认期间",
  );
  expect(gateway.busy).toBe(false);
});
