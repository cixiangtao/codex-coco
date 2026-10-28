import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { UpdateSettings } from "../update-settings";
import { RegisteredModulePage } from "../modules-panel";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { ColorPicker } from "@codex-coco/ui/components/color-picker";
import { useResolvedTheme } from "@codex-coco/ui/theme";
import { resolveTheme } from "@codex-coco/ui/theme/resolve";
import { FieldDescription, FieldLabel, FieldTitle } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@codex-coco/ui/components/dialog";
import { themeModes, themePresetIds } from "@codex-coco/ui/theme/contract";
import type { ThemeEditor } from "../client/theme-editor";
import applicationLogo from "../assets/icon.svg";
const modeLabels = { light: "浅色", dark: "深色", system: "跟随系统" };
const presetLabels = {
  neutral: "中性",
  red: "红色",
  yellow: "黄色",
  blue: "蓝色",
  green: "绿色",
  violet: "紫色",
};

/** Edits the shared host-backed theme with a window-local draft. */
export function SettingsPage({ editor }: { editor: ThemeEditor }) {
  const {
    theme,
    color,
    invalid,
    conflict,
    unavailable,
    busy,
    message,
    dirty,
    update,
    changeColor,
    selectPreset,
    cancel,
    save,
  } = editor;
  const resolvedMode = useResolvedTheme();
  const currentColor = resolveTheme(theme, resolvedMode).primary;
  return (
    <div className="settings-page">
      <header className="desktop-page-heading">
        <h2>设置</h2>
        <p>调整 Codex Coco 的使用体验。</p>
      </header>
      <section aria-label="窗口外观" className="settings-sections">
        <SettingsGroup
          title="窗口外观"
          description="调整 Codex Coco 自身的主题，与外部 Codex 布景分别管理。"
          disabled={busy || unavailable}
        >
          <SettingsRow>
            <FieldTitle id="mode-label">显示模式</FieldTitle>
            <ToggleGroup
              aria-labelledby="mode-label"
              value={[theme.mode]}
              onValueChange={(values) => {
                const mode = themeModes.find((item) => item === values[0]);
                if (mode) update({ mode });
              }}
              variant="outline"
            >
              {themeModes.map((mode) => (
                <ToggleGroupItem key={mode} value={mode}>
                  {modeLabels[mode]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingsRow>
          <SettingsRow>
            <FieldTitle id="preset-label">配色预设</FieldTitle>
            <ToggleGroup
              aria-labelledby="preset-label"
              className="flex-wrap"
              value={theme.primaryColor === null ? [theme.presetId] : []}
              onValueChange={(values) => {
                const presetId = themePresetIds.find((item) => item === values[0]);
                if (presetId) selectPreset(presetId);
              }}
              variant="outline"
            >
              {themePresetIds.map((preset) => (
                <ToggleGroupItem key={preset} value={preset}>
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full border border-foreground/10"
                    style={{
                      backgroundColor: resolveTheme(
                        { ...theme, presetId: preset, primaryColor: null },
                        resolvedMode,
                      ).primary,
                    }}
                  />
                  {presetLabels[preset]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </SettingsRow>
          <SettingsRow layout="stacked" data-invalid={invalid}>
            <FieldLabel htmlFor="primary-color">自定义主色</FieldLabel>
            <div className="theme-color-editor">
              <ColorPicker
                label="自定义主色调色板"
                value={currentColor}
                onValueChange={changeColor}
                disabled={busy || unavailable}
              />
              <div className="theme-color-details">
                <div className="flex items-center gap-3">
                  <span className="theme-color-swatch" aria-hidden="true" />
                  <div>
                    <p className="text-sm font-medium">{color ? "自定义颜色" : "跟随配色预设"}</p>
                    <p className="text-xs text-muted-foreground">{currentColor.toUpperCase()}</p>
                  </div>
                </div>
                <Input
                  id="primary-color"
                  placeholder="输入 HEX 色值"
                  value={color}
                  aria-invalid={invalid}
                  aria-describedby="color-help"
                  spellCheck={false}
                  onChange={(event) => {
                    changeColor(event.target.value);
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => {
                    changeColor("");
                  }}
                >
                  使用预设主色
                </Button>
              </div>
            </div>
            <FieldDescription id="color-help">
              {invalid
                ? "请输入 #RGB 或 #RRGGBB 格式的颜色。"
                : "拖动色板或色相条即可即时预览，也可用方向键微调。保存后同步到所有窗口，取消可恢复原主题。"}
            </FieldDescription>
          </SettingsRow>
        </SettingsGroup>
        {conflict && (
          <Alert>
            <AlertTitle>其他窗口已更新设置</AlertTitle>
            <AlertDescription>当前预览保留。请取消预览，再基于最新设置修改。</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || invalid || conflict || unavailable || !dirty}
            onClick={() => {
              void save();
            }}
          >
            {busy ? "正在保存…" : "保存主题"}
          </Button>
          <Button variant="outline" disabled={busy || !dirty} onClick={cancel}>
            取消预览
          </Button>
          <output aria-live="polite" className="text-muted-foreground">
            {message || (dirty ? "有未保存的预览" : "已与保存的设置同步")}
          </output>
        </div>
      </section>

      <section className="about-section" aria-labelledby="about-title">
        <SettingsGroup title={<span id="about-title">关于</span>}>
          <SettingsRow>
            <FieldTitle>Codex Coco</FieldTitle>
            <FieldDescription>一个按自己习惯打磨的 Codex 桌面伴侣。</FieldDescription>
            <Dialog>
              <DialogTrigger render={<Button variant="outline" />}>关于 Codex Coco</DialogTrigger>
              <DialogContent>
                <img
                  src={applicationLogo}
                  width={80}
                  height={80}
                  alt="Codex Coco 标志"
                  className="mx-auto"
                />
                <DialogHeader>
                  <DialogTitle>Codex Coco</DialogTitle>
                  <DialogDescription>
                    独立的 Codex 桌面伴侣，提供用量、外观与菜单栏速览。
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">
                  Codex Coco 是独立项目，与 OpenAI 没有隶属或官方支持关系。
                </p>
              </DialogContent>
            </Dialog>
          </SettingsRow>
        </SettingsGroup>
      </section>
      <UpdateSettings />
      <RegisteredModulePage moduleId="desktop-tools" />
    </div>
  );
}
