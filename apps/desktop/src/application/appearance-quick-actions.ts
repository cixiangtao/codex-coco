import { appearanceQuickActionSchema } from "../contracts/glance";
import { ModuleError, type ModuleHost } from "./module-host";

/** A narrow glance capability: no paths, arbitrary operations, configuration or private results. */
export class AppearanceQuickActions {
  busy = false;
  constructor(private readonly host: Pick<ModuleHost, "snapshots" | "glanceDetails" | "run">) {}

  async execute(input: unknown, confirmRestart: () => Promise<boolean>, correlationId?: string) {
    const parsed = appearanceQuickActionSchema.safeParse(input);
    if (!parsed.success) throw new ModuleError("INVALID_INPUT", "布景快捷操作无效。");
    if (this.busy) throw new ModuleError("MODULE_BUSY", "正在处理布景，请稍候。");
    const { action } = parsed.data;
    const check = () => {
      const snapshot = this.host.snapshots().find((item) => item.id === "appearance");
      if (!snapshot || snapshot.phase !== "running")
        throw new ModuleError("MODULE_UNAVAILABLE", "请先在主窗口启用外观模块。");
      if (snapshot.operation && ["running", "cancelling"].includes(snapshot.operation.phase))
        throw new ModuleError("MODULE_BUSY", "正在处理布景，请稍候。");
      if (this.host.glanceDetails().get("appearance")?.appearanceAction !== action)
        throw new ModuleError("CONFLICT", "Codex 状态已变化，请按最新提示操作。");
      return snapshot;
    };
    const { revision, generation } = check();
    this.busy = true;
    try {
      if (action === "restart" && !(await confirmRestart()))
        return { outcome: "cancelled" as const };
      const after = check();
      if (revision !== after.revision || generation !== after.generation)
        throw new ModuleError("CONFLICT", "确认期间设置或状态已变化，请重新操作。");
      this.host.run(
        {
          moduleId: "appearance",
          operation: action === "apply" ? "apply" : `${action}-application`,
          input: {},
        },
        correlationId,
      );
      return { outcome: "started" as const };
    } finally {
      this.busy = false;
    }
  }
}
