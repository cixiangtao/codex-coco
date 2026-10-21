import { readFile, writeFile, mkdir, rename, unlink, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import {
  updateSnapshotSchema,
  updatePreferencesSchema,
  updateDefaults,
  saveUpdatePreferencesSchema,
  updateActionSchema,
  type UpdateSnapshot,
} from "../contracts/updates";
import { SettingsError } from "./settings-store";
/** App-wide updater stays owned until application quit; it is not a business module. */
export interface UpdateEngine {
  supported(): Promise<boolean>;
  check(source: string): Promise<{ version: string; available: boolean }>;
  download(signal: AbortSignal, progress: (percent: number) => void): Promise<void>;
  install(): void;
  onError?(listener: () => void): () => void;
}
export class ApplicationUpdates {
  private state: UpdateSnapshot;
  private listeners = new Set<(snapshot: UpdateSnapshot) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<void> | null = null;
  private controller: AbortController | null = null;
  private stopped = false;
  private saving = false;
  private writeSettled: Promise<void> | null = null;
  private releaseWrite: (() => void) | undefined;
  private available = false;
  private unsubscribe: (() => void) | undefined;
  constructor(
    private readonly file: string,
    version: string,
    private readonly engine: UpdateEngine,
  ) {
    this.state = {
      revision: 0,
      preferences: updateDefaults,
      currentVersion: version,
      phase: "unconfigured",
      reason: "SOURCE_UNCONFIGURED",
      availableVersion: null,
      progress: null,
      checkedAt: null,
    };
  }
  snapshot() {
    return updateSnapshotSchema.parse(this.state);
  }
  subscribe(listener: (snapshot: UpdateSnapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private publish(patch: Partial<UpdateSnapshot>) {
    this.state = { ...this.state, ...patch };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        /* A closed observer cannot undo a persisted preference. */
      }
    }
  }
  private schedule() {
    clearTimeout(this.timer);
    if (
      !this.stopped &&
      this.state.preferences.source &&
      this.state.preferences.intervalHours &&
      this.state.reason !== "SETTINGS_UNAVAILABLE"
    )
      this.timer = setTimeout(() => {
        if (!this.pending && this.state.phase !== "downloaded") this.begin("check");
        else this.schedule();
      }, this.state.preferences.intervalHours * 3600_000);
  }
  async load() {
    try {
      if ((await lstat(this.file)).size > 8192) throw new Error("INVALID");
      const stored = JSON.parse(await readFile(this.file, "utf8")) as {
        version?: unknown;
        revision?: unknown;
        preferences?: unknown;
      };
      if (
        stored.version !== 1 ||
        !Number.isSafeInteger(stored.revision) ||
        Number(stored.revision) < 0
      )
        throw new Error("INVALID");
      const preferences = updatePreferencesSchema.parse(stored.preferences);
      this.publish({
        revision: Number(stored.revision),
        preferences,
        phase: preferences.source ? "idle" : "unconfigured",
        reason: preferences.source ? null : "SOURCE_UNCONFIGURED",
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        this.publish({ phase: "error", reason: "SETTINGS_UNAVAILABLE" });
    }
    this.unsubscribe = this.engine.onError?.(() => {
      if (!this.stopped)
        this.publish({
          phase: "error",
          reason: this.state.phase === "installing" ? "INSTALL_FAILED" : "DOWNLOAD_FAILED",
        });
    });
    this.schedule();
  }
  async save(input: unknown) {
    if (this.stopped) throw new SettingsError("SETTINGS_UNAVAILABLE", "应用正在退出。");
    if (this.saving) throw new SettingsError("CONFLICT", "更新设置正在保存，请稍候。");
    const parsed = saveUpdatePreferencesSchema.safeParse(input);
    if (!parsed.success)
      throw new SettingsError("INVALID_INPUT", "更新设置无效，请检查 HTTPS 更新目录和检查间隔。");
    if (this.state.reason === "SETTINGS_UNAVAILABLE")
      throw new SettingsError("SETTINGS_UNAVAILABLE", "更新设置损坏，请先重置并保留备份。");
    if (this.pending || this.state.phase === "downloaded" || this.state.phase === "installing")
      throw new SettingsError("CONFLICT", "请等待当前更新结束；下载完成后重启应用可更换更新源。");
    if (parsed.data.expectedRevision !== this.state.revision)
      throw new SettingsError("CONFLICT", "更新设置已在其他窗口修改，请重新载入。");
    const revision = this.state.revision + 1;
    const preferences = parsed.data.value;
    this.saving = true;
    this.writeSettled = new Promise((resolve) => {
      this.releaseWrite = resolve;
    });
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, revision, preferences }), {
          flag: "wx",
          mode: 0o600,
        });
        await rename(temporary, this.file);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
      this.available = false;
      this.publish({
        revision,
        preferences,
        phase: preferences.source ? "idle" : "unconfigured",
        reason: preferences.source ? null : "SOURCE_UNCONFIGURED",
        availableVersion: null,
        progress: null,
      });
      this.schedule();
      return this.snapshot();
    } finally {
      this.saving = false;
      this.releaseWrite?.();
      this.writeSettled = null;
    }
  }
  async action(input: unknown) {
    if (this.stopped) throw new SettingsError("SETTINGS_UNAVAILABLE", "应用正在退出。");
    const parsed = updateActionSchema.safeParse(input);
    if (!parsed.success) throw new SettingsError("INVALID_INPUT", "更新操作无效。");
    const action = parsed.data.action;
    if (this.saving) throw new SettingsError("CONFLICT", "更新设置正在保存，请稍候。");
    if (action === "cancel") {
      this.controller?.abort();
      if (this.pending) this.publish({ phase: "cancelling" });
      return this.snapshot();
    }
    if (action === "reset") {
      if (this.pending || this.state.phase === "downloaded" || this.state.phase === "installing")
        throw new SettingsError("CONFLICT", "请先结束当前更新。");
      this.saving = true;
      this.writeSettled = new Promise((resolve) => {
        this.releaseWrite = resolve;
      });
      try {
        await rename(this.file, `${this.file}.backup-${Date.now()}`).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
        this.publish({
          revision: this.state.revision + 1,
          preferences: updateDefaults,
          phase: "unconfigured",
          reason: "SOURCE_UNCONFIGURED",
          availableVersion: null,
          progress: null,
        });
        this.available = false;
        this.schedule();
        return this.snapshot();
      } finally {
        this.saving = false;
        this.releaseWrite?.();
        this.writeSettled = null;
      }
    }
    if (this.pending || this.state.phase === "installing")
      throw new SettingsError("CONFLICT", "更新任务仍在处理，请稍候。");
    if (action === "install") {
      if (this.state.phase !== "downloaded")
        throw new SettingsError("INVALID_INPUT", "尚无校验完成的更新包。");
      this.publish({ phase: "installing", reason: null });
      try {
        this.engine.install();
      } catch {
        this.publish({ phase: "error", reason: "INSTALL_FAILED" });
      }
      return this.snapshot();
    }
    if (this.state.phase === "downloaded")
      throw new SettingsError("CONFLICT", "更新包已下载，请确认安装或重新打开应用后再检查。");
    if (!this.state.preferences.source) {
      this.publish({ phase: "unconfigured", reason: "SOURCE_UNCONFIGURED" });
      return this.snapshot();
    }
    if (this.state.reason === "SETTINGS_UNAVAILABLE")
      throw new SettingsError("SETTINGS_UNAVAILABLE", "请先恢复更新设置。");
    if (action === "download" && !this.available)
      throw new SettingsError("INVALID_INPUT", "请先检查可用版本。");
    this.begin(action);
    return this.snapshot();
  }
  private begin(action: "check" | "download") {
    clearTimeout(this.timer);
    const controller = new AbortController();
    this.controller = controller;
    this.publish({
      phase: action === "check" ? "checking" : "downloading",
      reason: null,
      progress: null,
    });
    this.pending = (async () => {
      try {
        if (!(await this.engine.supported())) {
          this.publish({ phase: "unsupported", reason: "SIGNED_INSTALL_REQUIRED" });
          return;
        }
        controller.signal.throwIfAborted();
        if (action === "check") {
          const checked = await this.engine.check(this.state.preferences.source);
          controller.signal.throwIfAborted();
          if (
            !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(checked.version) ||
            checked.version.length > 80
          )
            throw new Error("INVALID");
          this.available = checked.available;
          this.publish({
            phase: checked.available ? "available" : "up-to-date",
            availableVersion: checked.available ? checked.version : null,
            checkedAt: Date.now(),
          });
        } else {
          await this.engine.download(controller.signal, (percent) => {
            if (!controller.signal.aborted && !this.stopped && Number.isFinite(percent))
              this.publish({ progress: Math.max(0, Math.min(100, Math.round(percent))) });
          });
          controller.signal.throwIfAborted();
          this.publish({ phase: "downloaded", progress: 100 });
        }
      } catch {
        if (!this.stopped)
          this.publish(
            controller.signal.aborted
              ? { phase: this.available ? "available" : "idle", reason: null, progress: null }
              : {
                  phase: "error",
                  reason: action === "check" ? "CHECK_FAILED" : "DOWNLOAD_FAILED",
                  progress: null,
                },
          );
      } finally {
        this.controller = null;
        this.pending = null;
        this.schedule();
      }
    })();
  }
  async shutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    await Promise.all([this.pending, this.writeSettled]);
    this.unsubscribe?.();
    this.listeners.clear();
  }
}
