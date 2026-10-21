import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { JsonValue, ModuleConfigSnapshot } from "../contracts/modules";
import { SettingsError } from "./settings-store";

/** Each module owns its schema; a migration at key n converts n to n + 1. */
export interface ModuleConfigDefinition {
  version: number;
  defaults: JsonValue;
  schema: z.ZodType<JsonValue>;
  migrations: Readonly<Record<number, (value: JsonValue) => JsonValue>>;
}
const envelopeSchema = z.strictObject({
  schemaVersion: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  enabled: z.boolean(),
  value: z.json(),
});

/** Independent files and write queues prevent one module from overwriting another. */
export class ModuleConfigStore {
  private current: ModuleConfigSnapshot;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly path: string,
    private readonly definition: ModuleConfigDefinition,
  ) {
    this.current = this.defaults();
  }
  private defaults(): ModuleConfigSnapshot {
    return {
      schemaVersion: this.definition.version,
      revision: 0,
      enabled: false,
      value: this.definition.schema.parse(structuredClone(this.definition.defaults)),
      health: "missing",
    };
  }
  snapshot() {
    return structuredClone(this.current);
  }

  async load() {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(this.path, "utf8"));
    } catch (error) {
      if (error instanceof SyntaxError) this.current.health = "invalid";
      else if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
        this.current.health = "unavailable";
      return this.snapshot();
    }
    const version = z.object({ schemaVersion: z.number() }).safeParse(raw);
    if (version.success && version.data.schemaVersion > this.definition.version) {
      this.current.health = "future-version";
      return this.snapshot();
    }
    const parsed = envelopeSchema.safeParse(raw);
    if (!parsed.success) {
      this.current.health = "invalid";
      return this.snapshot();
    }
    const next = parsed.data;
    const migrated = next.schemaVersion < this.definition.version;
    try {
      while (next.schemaVersion < this.definition.version) {
        const migrate = this.definition.migrations[next.schemaVersion];
        if (!migrate) throw new Error("MIGRATION_MISSING");
        next.value = migrate(next.value);
        next.schemaVersion++;
      }
      next.value = this.definition.schema.parse(next.value);
    } catch {
      this.current.health = "invalid";
      return this.snapshot();
    }
    if (migrated) {
      next.revision++;
      try {
        await this.backup();
        await this.persist({ ...next, health: "ok" });
      } catch {
        this.current.health = "unavailable";
        return this.snapshot();
      }
    }
    this.current = { ...next, health: "ok" };
    return this.snapshot();
  }
  private serialize<T>(operation: () => Promise<T>) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  /** Applies only the requested fields to the latest snapshot under the write lock. */
  update(patch: { enabled?: boolean; value?: JsonValue }, expectedRevision?: number) {
    return this.serialize(async () => {
      if (["invalid", "future-version", "unavailable"].includes(this.current.health))
        throw new SettingsError("SETTINGS_UNAVAILABLE", "模块原配置已保留，请先备份并恢复。");
      if (expectedRevision !== undefined && expectedRevision !== this.current.revision)
        throw new SettingsError("CONFLICT", "模块设置已更新，请重新载入后再保存。");
      const parsed = this.definition.schema.safeParse(
        patch.value === undefined ? this.current.value : patch.value,
      );
      if (!parsed.success) throw new SettingsError("INVALID_INPUT", "模块配置无效。");
      const next: ModuleConfigSnapshot = {
        ...this.current,
        ...patch,
        value: parsed.data,
        revision: this.current.revision + 1,
        health: "ok",
      };
      await this.persist(next);
      this.current = next;
      return this.snapshot();
    });
  }
  /** Recovery always disables the module and preserves the original bytes first. */
  reset() {
    return this.serialize(async () => {
      if (this.current.health !== "missing") await this.backup();
      const next = {
        ...this.defaults(),
        revision: this.current.revision + 1,
        health: "ok" as const,
      };
      await this.persist(next);
      this.current = next;
      return this.snapshot();
    });
  }
  async flush() {
    await this.queue;
  }
  private async backup() {
    await copyFile(this.path, `${this.path}.backup-${randomUUID()}`, constants.COPYFILE_EXCL);
  }
  private async persist(snapshot: ModuleConfigSnapshot) {
    const { health: _health, ...data } = snapshot;
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      });
    }
  }
}
