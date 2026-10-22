import { ModuleConfigStore } from "./module-config-store";
import { SettingsError } from "./settings-store";
import {
  defaultGlanceLayout,
  glanceLayoutSchema,
  saveGlanceLayoutSchema,
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
  flush() {
    return this.store.flush();
  }
}
