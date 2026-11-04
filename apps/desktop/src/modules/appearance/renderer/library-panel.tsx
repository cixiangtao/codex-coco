import { useState } from "react";
import { Box } from "@codex-coco/ui/components/box";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import type { AppearanceConfig } from "../contract";

interface AppearancePresetPanelProps {
  draft: AppearanceConfig;
  update(value: AppearanceConfig): void;
  busy: boolean;
  onLoad?(): void;
}

/** Preset edits belong to the page draft; loading a scene keeps connection preferences intact. */
export function AppearancePresetPanel({ draft, update, busy, onLoad }: AppearancePresetPanelProps) {
  const [presetTitle, setPresetTitle] = useState("");
  const atLimit = draft.presets.length >= 12;
  return (
    <Box gap="lg" className="appearance-preset-panel">
      <SettingsGroup title="收藏当前布景" description="预设记录壁纸、主面板和侧栏的完整组合。">
        <SettingsRow layout="stacked">
          <FieldLabel htmlFor="appearance-preset-title">预设名称</FieldLabel>
          <div className="appearance-preset-create">
            <Input
              id="appearance-preset-title"
              placeholder="为这套布景取个名字"
              value={presetTitle}
              maxLength={60}
              onChange={(event) => setPresetTitle(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={busy || atLimit || !presetTitle.trim()}
              onClick={() => {
                const { port, wallpaper, main, sidebar } = draft;
                update({
                  ...draft,
                  presets: [
                    ...draft.presets,
                    {
                      id: crypto.randomUUID(),
                      title: presetTitle.trim(),
                      look: { port, wallpaper, main, sidebar },
                    },
                  ],
                });
                setPresetTitle("");
              }}
            >
              加入预设
            </Button>
          </div>
          <FieldDescription>
            {atLimit
              ? "已达到 12 组上限，可先删除不再使用的预设。"
              : "加入和删除先保留在草稿中，点击页面底部的保存按钮后生效。"}
          </FieldDescription>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title={`我的预设 · ${draft.presets.length}/12`}
        aria-label="布景预设"
        description="载入会替换当前三个区域的草稿；保存并应用后才会修改 Codex。"
      >
        {draft.presets.length === 0 ? (
          <SettingsRow layout="stacked">
            <p className="appearance-library-empty">
              还没有预设。调好一套喜欢的布景后，可以在这里收藏。
            </p>
          </SettingsRow>
        ) : (
          draft.presets.map((preset) => (
            <SettingsRow key={preset.id}>
              <FieldLabel>{preset.title}</FieldLabel>
              <div className="appearance-preset-actions">
                <Button
                  variant="outline"
                  disabled={busy}
                  aria-label={`载入预设：${preset.title}`}
                  onClick={() => {
                    update({ ...draft, ...preset.look, port: draft.port });
                    onLoad?.();
                  }}
                >
                  载入
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`删除预设：${preset.title}`}
                  onClick={() =>
                    update({
                      ...draft,
                      presets: draft.presets.filter((item) => item.id !== preset.id),
                    })
                  }
                >
                  删除
                </Button>
              </div>
            </SettingsRow>
          ))
        )}
      </SettingsGroup>
    </Box>
  );
}
