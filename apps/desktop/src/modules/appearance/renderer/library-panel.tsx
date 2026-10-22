import { useState } from "react";
import { Box } from "@codex-coco/ui/components/box";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import type { AppearanceConfig, AppearanceResult } from "../contract";
import { labels, type Layer, type AppearanceRun } from "./editor-types";

export function AppearanceLibraryPanel({
  draft,
  update,
  enabled,
  busy,
  dirty,
  result,
  run,
  libraryLayer,
  onSelect,
}: {
  draft: AppearanceConfig;
  update(value: AppearanceConfig): void;
  enabled: boolean;
  busy: boolean;
  dirty: boolean;
  result: AppearanceResult | null;
  run: AppearanceRun;
  libraryLayer: Layer;
  onSelect(layer: Layer): void;
}) {
  const [presetTitle, setPresetTitle] = useState("");
  return (
    <Box gap="lg">
      <SettingsGroup
        title="图片库"
        aria-label="布景图片库"
        description="将图片放到当前选择的图层，应用前可继续调整。"
      >
        <SettingsRow>
          <FieldLabel>图库应用图层</FieldLabel>
          <ToggleGroup
            aria-label="图库应用图层"
            variant="outline"
            value={[libraryLayer]}
            onValueChange={(items) => {
              if (items[0] && Object.hasOwn(labels, items[0])) onSelect(items[0] as Layer);
            }}
          >
            {(["wallpaper", "main", "sidebar"] as const).map((layer) => (
              <ToggleGroupItem key={layer} value={layer}>
                {labels[layer]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow layout="stacked">
          <FieldLabel>可用图片</FieldLabel>
          <Button
            variant="outline"
            disabled={!enabled || busy}
            onClick={() => {
              void run("list-gallery");
            }}
          >
            载入图片库
          </Button>
          {!result?.gallery.length && (
            <p className="appearance-library-empty">
              {enabled
                ? "载入内置图片与已导入副本，或在布景编辑中导入图片。"
                : "启用外观模块后可载入图片库。"}
            </p>
          )}
          <div className="appearance-gallery-grid">
            {result?.gallery.map((item) => (
              <div key={item.id} className="flex flex-col gap-2">
                <button
                  type="button"
                  className="appearance-gallery-image"
                  aria-pressed={draft[libraryLayer].image === item.id}
                  disabled={busy}
                  onClick={() => {
                    update({
                      ...draft,
                      [libraryLayer]: { ...draft[libraryLayer], enabled: true, image: item.id },
                    });
                  }}
                >
                  <img src={item.preview} alt={item.title} className="h-24 w-full object-contain" />
                  <span>{item.title}</span>
                </button>
                {!item.builtin && (
                  <Button
                    variant="ghost"
                    disabled={busy || dirty}
                    onClick={() => {
                      void run("remove-image", undefined, { id: item.id });
                    }}
                  >
                    删除图片副本
                  </Button>
                )}
              </div>
            ))}
          </div>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title="布景预设"
        aria-label="布景预设"
        description="最多保存 12 组。预设与图层配置一起保存，载入后需明确应用。"
      >
        <SettingsRow layout="stacked">
          <FieldLabel htmlFor="appearance-preset-title">预设名称</FieldLabel>
          <div className="flex flex-wrap gap-3">
            <Input
              id="appearance-preset-title"
              aria-label="预设名称"
              placeholder="预设名称"
              value={presetTitle}
              maxLength={60}
              onChange={(event) => setPresetTitle(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || draft.presets.length >= 12 || !presetTitle.trim()}
              onClick={() => {
                const { presets, portMode, restoreOnEnable, ...look } = draft;
                void portMode;
                void restoreOnEnable;
                update({
                  ...draft,
                  presets: [
                    ...presets,
                    { id: crypto.randomUUID(), title: presetTitle.trim(), look },
                  ],
                });
                setPresetTitle("");
              }}
            >
              保存为预设
            </Button>
          </div>
          <FieldDescription>保存当前三层组合，之后可以再次载入。</FieldDescription>
        </SettingsRow>
        {draft.presets.map((preset) => (
          <SettingsRow key={preset.id}>
            <FieldLabel>{preset.title}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  update({ ...draft, ...preset.look, port: draft.port });
                }}
              >
                载入预设
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  update({
                    ...draft,
                    presets: draft.presets.filter((item) => item.id !== preset.id),
                  })
                }
              >
                删除预设
              </Button>
            </div>
          </SettingsRow>
        ))}
      </SettingsGroup>
    </Box>
  );
}
