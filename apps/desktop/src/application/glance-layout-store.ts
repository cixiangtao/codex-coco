import { ModuleConfigStore } from "./module-config-store";
import { SettingsError } from "./settings-store";
import {
  defaultGlanceLayout,
  glanceLayoutSchema,
  saveGlanceLayoutSchema,
  reorderGlanceLayoutSchema,
  type GlanceLayoutSnapshot,
} from "../contracts/glance-layout";

/** Reuses atomic versioned storage without registering a background module or persisting data. */
export class GlanceLayoutStore {
  private store: ModuleConfigStore;
  constructor(path: string) {
    this.store = new ModuleConfigStore(path, {
      version: 1,
      defaults: defaultGlanceLayout,
      schema: glanceLayoutSchema,
      migrations: {},
    });
  }
  snapshot(): GlanceLayoutSnapshot {
    const snapshot = this.store.snapshot();
    return {
      revision: snapshot.revision,
      health: snapshot.health,
      value: glanceLayoutSchema.parse(snapshot.value),
    };
  }
  async load() {
    await this.store.load();
    return this.snapshot();
  }
  async save(input: unknown) {
    const parsed = saveGlanceLayoutSchema.safeParse(input);
    if (!parsed.success) throw new SettingsError("INVALID_INPUT", "速览信息块或排列无效。");
    await this.store.update({ value: parsed.data.value }, parsed.data.expectedRevision);
    return this.snapshot();
  }
  async reset() {
    await this.store.reset();
    return this.snapshot();
  }
  /** Validate the selection before the revision-checked atomic write; stale writes cannot change it. */
  async reorder(input: unknown) {
    const parsed = reorderGlanceLayoutSchema.safeParse(input);
    if (!parsed.success) throw new SettingsError("INVALID_INPUT", "速览排序无效。");
    const current = this.snapshot();
    if (parsed.data.expectedRevision !== current.revision)
      throw new SettingsError("CONFLICT", "速览组合已更新，请载入最新顺序后重试。");
    const { blocks } = parsed.data;
    if (
      blocks.length !== current.value.blocks.length ||
      blocks.some((id) => !current.value.blocks.includes(id))
    )
      throw new SettingsError("INVALID_INPUT", "悬浮窗只能调整已添加信息块的顺序。");
    await this.store.update({ value: { blocks } }, parsed.data.expectedRevision);
    return this.snapshot();
  }
  flush() {
    return this.store.flush();
  }
}
