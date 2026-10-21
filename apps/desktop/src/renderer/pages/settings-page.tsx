import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@codex-coco/ui/components/field";
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
import { Separator } from "@codex-coco/ui/components/separator";
import { themeModes, themePresetIds } from "@codex-coco/ui/theme/contract";
import type { ThemeEditor } from "../client/theme-editor";
const modeLabels = { light: "浅色", dark: "深色", system: "跟随系统" };
const presetLabels = { neutral: "中性", blue: "蓝色", violet: "紫色" };

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
    cancel,
    save,
  } = editor;
  return (
    <div className="settings-page">
      <header className="desktop-page-heading">
        <h2>设置</h2>
        <p>调整 Codex Coco 的使用体验。</p>
      </header>
      <section aria-labelledby="theme-title" className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h3 id="theme-title">窗口外观</h3>
          <p className="text-muted-foreground">
            调整 Codex Coco 自身的主题，与外部 Codex 布景分别管理。
          </p>
        </div>
        <fieldset disabled={busy || unavailable} className="min-w-0">
          <legend className="sr-only">主题设置</legend>
          <FieldGroup>
            <Field>
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
            </Field>
            <Field>
              <FieldTitle id="preset-label">配色预设</FieldTitle>
              <ToggleGroup
                aria-labelledby="preset-label"
                value={[theme.presetId]}
                onValueChange={(values) => {
                  const presetId = themePresetIds.find((item) => item === values[0]);
                  if (presetId) update({ presetId });
                }}
                variant="outline"
              >
                {themePresetIds.map((preset) => (
                  <ToggleGroupItem key={preset} value={preset}>
                    {presetLabels[preset]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Field>
            <Field data-invalid={invalid}>
              <FieldLabel htmlFor="primary-color">自定义主色</FieldLabel>
              <div className="flex flex-wrap gap-3">
                <Input
                  id="primary-color"
                  className="w-52"
                  placeholder="例如 #245dd8"
                  value={color}
                  aria-invalid={invalid}
                  aria-describedby="color-help"
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
              <FieldDescription id="color-help">
                {invalid
                  ? "请输入 #RGB 或 #RRGGBB 格式的颜色。"
                  : "留空使用预设主色；文字与焦点颜色自动适配。"}
              </FieldDescription>
            </Field>
          </FieldGroup>
        </fieldset>
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

      <Separator />
      <section className="about-section" aria-labelledby="about-title">
        <div>
          <h3 id="about-title">关于</h3>
          <p>一个按自己习惯打磨的 Codex 桌面伴侣。</p>
        </div>
        <Dialog>
          <DialogTrigger render={<Button variant="outline" />}>关于 Codex Coco</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Codex Coco</DialogTitle>
              <DialogDescription>
                本地开发版。用量与外观业务正在建设，菜单栏速览已提供模块状态与主窗口入口。
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Codex Coco 是独立项目，与 OpenAI 没有隶属或官方支持关系。
            </p>
          </DialogContent>
        </Dialog>
      </section>
    </div>
  );
}
