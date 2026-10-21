import { readFile, mkdir, writeFile, rename, unlink, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createDefaultSettings,
  saveThemeSchema,
  settingsSchema,
  type Settings,
  type SettingsSnapshot,
} from "../contracts/settings";
import type { ErrorCode } from "../contracts/bridge";

/** A stable code reaches the UI; underlying filesystem diagnostics remain in the host. */
export class SettingsError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const legacySchema = z.strictObject({
  schemaVersion: z.literal(0),
  mode: z.enum(["light", "dark", "system"]),
});

/** Versioned atomic settings with revision conflicts and explicit damaged-file recovery. */
export class SettingsStore {
  private snapshot: SettingsSnapshot = { settings: createDefaultSettings(), health: "missing" };
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(snapshot: SettingsSnapshot) => void>();
  constructor(private readonly path: string) {}

  async load() {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) this.snapshot.health = "invalid";
      else if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      return this.getSnapshot();
    }
    const version = z.object({ schemaVersion: z.number() }).safeParse(data);
    if (version.success && version.data.schemaVersion > 1) {
      this.snapshot.health = "future-version";
      return this.getSnapshot();
    }
    const current = settingsSchema.safeParse(data);
    if (current.success) this.snapshot = { health: "ok", settings: current.data };
    else {
      const legacy = legacySchema.safeParse(data);
      if (!legacy.success) this.snapshot.health = "invalid";
      else {
        const next = createDefaultSettings();
        next.theme.mode = legacy.data.mode;
        await this.backup();
        await this.persist(next);
        this.snapshot = { health: "ok", settings: next };
      }
    }
    return this.getSnapshot();
  }

  getSnapshot(): SettingsSnapshot {
    return structuredClone(this.snapshot);
  }

  subscribe(listener: (snapshot: SettingsSnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async saveTheme(input: unknown) {
    const parsed = saveThemeSchema.safeParse(input);
    if (!parsed.success)
      throw new SettingsError("INVALID_INPUT", "主题设置无效，请检查颜色和显示模式。");
    return this.serialized(async () => {
      if (this.snapshot.health === "invalid" || this.snapshot.health === "future-version") {
        throw new SettingsError("SETTINGS_UNAVAILABLE", "原配置已保留，请先备份并恢复默认设置。");
      }
      if (parsed.data.expectedRevision !== this.snapshot.settings.revision) {
        throw new SettingsError("CONFLICT", "设置已在其他窗口更新，请取消预览后重试。");
      }
      const next: Settings = {
        schemaVersion: 1,
        revision: this.snapshot.settings.revision + 1,
        theme: parsed.data.theme,
      };
      await this.persist(next);
      return this.publish(next);
    });
  }

  /** Preserves an existing file before replacing it, including unknown future versions. */
  reset() {
    return this.serialized(async () => {
      if (this.snapshot.health !== "missing") await this.backup();
      const next = createDefaultSettings();
      next.revision = this.snapshot.settings.revision + 1;
      await this.persist(next);
      return this.publish(next);
    });
  }

  async flush() {
    await this.queue;
  }

  private publish(settings: Settings) {
    this.snapshot = { settings, health: "ok" };
    for (const listener of this.listeners) listener(this.getSnapshot());
    return this.getSnapshot();
  }

  private async backup() {
    await copyFile(this.path, `${this.path}.backup-${randomUUID()}`, constants.COPYFILE_EXCL);
  }

  private async persist(settings: Settings) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
    }
  }
}
