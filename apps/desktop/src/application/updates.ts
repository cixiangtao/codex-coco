import { readFile, writeFile, mkdir, rename, unlink, lstat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  updateSnapshotSchema,
  releaseCheckSchema,
  releasesUrl,
  type ReleaseCheck,
  updatePreferencesSchema,
  updateDefaults,
  saveUpdatePreferencesSchema,
  updateActionSchema,
  type UpdateSnapshot,
  type UpdatePreferences,
} from "../contracts/updates";
import { SettingsError } from "./settings-store";
/** App-wide updater stays owned until application quit; it is not a business module. */
export interface UpdateEngine {
  supported(): Promise<boolean>;
  check(signal: AbortSignal): Promise<ReleaseCheck | null>;
  download(
    version: string,
    signal: AbortSignal,
    progress: (percent: number) => void,
  ): Promise<void>;
  openRelease(url: string): Promise<void>;
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
      phase: "idle",
      reason: null,
      installSupported: false,
      releaseUrl: null,
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
      this.state.preferences.intervalHours &&
      this.state.reason !== "SETTINGS_UNAVAILABLE"
    )
      this.timer = setTimeout(() => {
        if (!this.pending && !["downloaded", "installing"].includes(this.state.phase))
          this.begin("check");
        else this.schedule();
      }, this.state.preferences.intervalHours * 3600_000);
  }
  async load() {
    this.publish({ installSupported: await this.engine.supported() });
    try {
      if ((await lstat(this.file)).size > 8192) throw new Error("INVALID");
      const stored = JSON.parse(await readFile(this.file, "utf8")) as {
        version?: unknown;
        revision?: unknown;
        preferences?: unknown;
      };
      if (
        (stored.version !== 1 && stored.version !== 2) ||
        !Number.isSafeInteger(stored.revision) ||
        Number(stored.revision) < 0
      )
        throw new Error("INVALID");
      // Legacy custom feeds are retired. Preserve the file until the next explicit save/reset.
      const legacy = z.strictObject({
        source: z
          .string()
          .max(2048)
          .refine(
            (value) =>
              !value ||
              (z.url().safeParse(value).success &&
                value.startsWith("https://") &&
                !/[?#@\s]/.test(value) &&
                value.endsWith("/")),
          ),
        intervalHours: updatePreferencesSchema.shape.intervalHours,
      });
      let preferences: UpdatePreferences;
      if (stored.version === 1) {
        legacy.parse(stored.preferences);
        preferences = { ...updateDefaults };
      } else preferences = updatePreferencesSchema.parse(stored.preferences);
      this.publish({
        revision: Number(stored.revision),
        preferences,
        phase: "idle",
        reason: null,
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
      throw new SettingsError("INVALID_INPUT", "更新设置无效，请检查后台检查间隔。");
    if (this.state.reason === "SETTINGS_UNAVAILABLE")
      throw new SettingsError("SETTINGS_UNAVAILABLE", "更新设置损坏，请先重置并保留备份。");
    if (this.pending || this.state.phase === "downloaded" || this.state.phase === "installing")
      throw new SettingsError("CONFLICT", "请等待当前更新结束；下载完成后重启应用可修改更新偏好。");
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
        await writeFile(temporary, JSON.stringify({ version: 2, revision, preferences }), {
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
        phase: "idle",
        reason: null,
        availableVersion: null,
        releaseUrl: null,
        checkedAt: null,
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
    if (action === "open-release") {
      try {
        await this.engine.openRelease(this.state.releaseUrl ?? releasesUrl);
      } catch {
        throw new SettingsError("INVALID_INPUT", "无法打开 GitHub 发布页面，请稍后重试。");
      }
      return this.snapshot();
    }
    if (action === "cancel") {
      if (this.state.phase === "installing")
        throw new SettingsError("CONFLICT", "安装任务不能取消。");
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
          phase: "idle",
          reason: null,
          availableVersion: null,
          releaseUrl: null,
          checkedAt: null,
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
      clearTimeout(this.timer);
      this.publish({ phase: "installing", reason: null });
      this.pending = (async () => {
        try {
          if (!(await this.engine.supported())) {
            this.publish({
              phase: "unsupported",
              reason: "SIGNED_INSTALL_REQUIRED",
              installSupported: false,
            });
            return;
          }
          if (!this.stopped) this.engine.install();
        } catch {
          this.publish({ phase: "error", reason: "INSTALL_FAILED" });
        }
      })();
      try {
        await this.pending;
      } finally {
        this.pending = null;
        if (this.snapshot().phase !== "installing") this.schedule();
      }
      return this.snapshot();
    }
    if (this.state.phase === "downloaded")
      throw new SettingsError("CONFLICT", "更新包已下载，请确认安装或重新打开应用后再检查。");
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
    if (action === "check") {
      this.available = false;
      this.publish({ availableVersion: null, releaseUrl: null, checkedAt: null });
    }
    this.pending = (async () => {
      try {
        controller.signal.throwIfAborted();
        if (action === "check") {
          const result = await this.engine.check(controller.signal);
          controller.signal.throwIfAborted();
          const checked = result === null ? null : releaseCheckSchema.parse(result);
          this.available = checked?.available ?? false;
          this.publish({
            phase: checked ? (checked.available ? "available" : "up-to-date") : "no-release",
            availableVersion: checked?.available ? checked.version : null,
            releaseUrl: checked?.releaseUrl ?? null,
            checkedAt: Date.now(),
          });
        } else {
          const supported = await this.engine.supported();
          controller.signal.throwIfAborted();
          if (!supported) {
            this.publish({
              phase: "unsupported",
              reason: "SIGNED_INSTALL_REQUIRED",
              installSupported: false,
            });
            return;
          }
          const version = this.state.availableVersion;
          if (!version) throw new Error("RELEASE_REQUIRED");
          await this.engine.download(version, controller.signal, (percent) => {
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
