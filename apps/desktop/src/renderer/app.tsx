import { useEffect, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@codex-coco/ui/components/dialog";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import { Separator } from "@codex-coco/ui/components/separator";
import { ThemeProvider, useResolvedTheme } from "@codex-coco/ui/theme";
import {
  normalizePrimaryColor,
  themeModes,
  themePresetIds,
  type ThemePreference,
} from "@codex-coco/ui/theme/contract";
import { useSavedSettings } from "./client/settings";

const modeLabels = { light: "浅色", dark: "深色", system: "跟随系统" };
const presetLabels = { neutral: "中性", blue: "蓝色", violet: "紫色" };

function Preview() {
  const mode = useResolvedTheme();
  return (
    <section aria-labelledby="preview-title" className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="preview-title">组件验证</h2>
        <p className="text-muted-foreground">
          当前解析为{mode === "dark" ? "深色" : "浅色"}。按钮、输入和弹层共享主题变量。
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button>默认按钮</Button>
        <Button variant="outline">描边按钮</Button>
        <Button disabled>禁用按钮</Button>
        <Dialog>
          <DialogTrigger render={<Button variant="secondary" />}>查看弹层</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>同一套主题</DialogTitle>
              <DialogDescription>
                这个弹层挂载到文档根部，继承当前模式与主题色。按 Esc 返回。
              </DialogDescription>
            </DialogHeader>
            <Button>主题示例按钮</Button>
          </DialogContent>
        </Dialog>
      </div>
      <p className="text-muted-foreground">
        用量与外观业务尚未接入。当前页面仅验证工程能力，正式信息结构与视觉方向另行评审。
      </p>
    </section>
  );
}

/** Temporary foundation surface, deliberately separate from future business pages. */
export function App() {
  const saved = useSavedSettings();
  const [draft, setDraft] = useState<{ theme: ThemePreference; revision: number } | null>(null);
  const [colorInput, setColorInput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const theme = draft?.theme ?? saved.settings.theme;
  const color = colorInput ?? theme.primaryColor ?? "";
  const invalid = color !== "" && normalizePrimaryColor(color) === null;
  const conflict = draft !== null && draft.revision !== saved.settings.revision;
  const unavailable = saved.health === "invalid" || saved.health === "future-version";

  useEffect(() => {
    window.codexCoco.ready();
  }, []);

  function update(patch: Partial<ThemePreference>) {
    setMessage("");
    setDraft((current) => ({
      theme: { ...(current?.theme ?? saved.settings.theme), ...patch },
      revision: current?.revision ?? saved.settings.revision,
    }));
  }
  function cancel() {
    setDraft(null);
    setColorInput(null);
    setMessage("预览已取消，已恢复保存的设置。");
  }
  async function save() {
    if (invalid || busy || conflict) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await window.codexCoco.saveTheme({
        expectedRevision: draft?.revision ?? saved.settings.revision,
        theme,
      });
      if (!result.ok) setMessage(result.error.message);
      else {
        setDraft(null);
        setColorInput(null);
        setMessage("主题已保存。");
      }
    } catch {
      setMessage("无法连接桌面服务，请重新打开窗口后重试。");
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    setBusy(true);
    try {
      const result = await window.codexCoco.resetSettings();
      if (!result.ok) setMessage(result.error.message);
      else {
        setDraft(null);
        setColorInput(null);
        setMessage("原文件已备份，默认设置已恢复。");
      }
    } catch {
      setMessage("恢复未完成，请检查目录权限后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ThemeProvider preference={theme}>
      <main className="foundation-shell">
        <header className="flex flex-col gap-3">
          <h1>Codex Coco</h1>
          <p className="text-muted-foreground">基建验证工作台</p>
        </header>
        {unavailable && (
          <Alert variant="destructive">
            <AlertTitle>原配置需要处理</AlertTitle>
            <AlertDescription>
              <p>配置损坏或来自更新版本，原文件保持不变。你可以备份原文件并恢复默认设置。</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void recover();
                }}
              >
                备份并恢复默认设置
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <section aria-labelledby="theme-title" className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h2 id="theme-title">主题基础</h2>
            <p className="text-muted-foreground">先预览，确认后保存。取消会恢复已保存的主题。</p>
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
                      const value = event.target.value;
                      setColorInput(value);
                      const parsed = normalizePrimaryColor(value);
                      if (value === "" || parsed) update({ primaryColor: parsed });
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      setColorInput("");
                      update({ primaryColor: null });
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
              disabled={
                busy || invalid || conflict || unavailable || (!draft && colorInput === null)
              }
              onClick={() => {
                void save();
              }}
            >
              {busy ? "正在保存…" : "保存主题"}
            </Button>
            <Button
              variant="outline"
              disabled={busy || (!draft && colorInput === null)}
              onClick={cancel}
            >
              取消预览
            </Button>
            <output aria-live="polite" className="text-muted-foreground">
              {message || (draft || colorInput !== null ? "有未保存的预览" : "已与保存的设置同步")}
            </output>
          </div>
        </section>
        <Separator />
        <Preview />
      </main>
    </ThemeProvider>
  );
}
