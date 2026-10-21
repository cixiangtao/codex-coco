import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import { Separator } from "@codex-coco/ui/components/separator";
import type { ModuleSnapshot } from "../../../contracts/modules";
import { acceptModuleSnapshot, waitForModuleOperation } from "../../../renderer/client/modules";
import {
  appearanceConfigSchema,
  appearanceDefaults,
  appearanceFailures,
  appearanceResultSchema,
  type AppearanceConfig,
} from "../contract";

type Layer = "wallpaper" | "main" | "sidebar";
const labels = { wallpaper: "全局壁纸", main: "主面板插画", sidebar: "侧栏插画" };
/** Draft settings remain separate from applying a style to another application. */
export default function AppearancePage({ snapshot }: { snapshot: ModuleSnapshot }) {
  const config = appearanceConfigSchema.safeParse(snapshot.config.value);
  const [draftState, setDraft] = useState<AppearanceConfig>(
    config.success ? config.data : appearanceDefaults,
  );
  const [baseRevision, setBaseRevision] = useState(snapshot.config.revision);
  const [dirty, setDirty] = useState(false);
  const draft = dirty ? draftState : config.success ? config.data : appearanceDefaults;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [previews, setPreviews] = useState<Partial<Record<Layer, string>>>({});
  const task = snapshot.operation;
  const busy = pending || task?.phase === "running" || task?.phase === "cancelling";
  const enabled = snapshot.phase === "running";
  const parsed = appearanceResultSchema.safeParse(task?.result);
  const result = parsed.success ? parsed.data : null;
  const conflict = dirty && baseRevision !== snapshot.config.revision;
  function update(next: AppearanceConfig) {
    if (!dirty) setBaseRevision(snapshot.config.revision);
    setDraft(next);
    setDirty(true);
    setMessage("");
  }
  async function run(operation: string, layer?: Layer) {
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "appearance",
        operation,
        input: {},
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      acceptModuleSnapshot(response.value);
      if (layer && response.value.operation) {
        const completed = await waitForModuleOperation("appearance", response.value.operation.id);
        const result = appearanceResultSchema.safeParse(completed.result);
        if (result.success && result.data.imported) {
          update({
            ...draft,
            [layer]: { ...draft[layer], image: result.data.imported, enabled: true },
          });
          const preview = result.data.preview;
          if (preview) setPreviews((previous) => ({ ...previous, [layer]: preview }));
        }
      }
    } catch {
      setMessage("外观服务连接失败，请重新打开窗口后重试。");
    } finally {
      setPending(false);
    }
  }
  async function save(apply: boolean) {
    if (!appearanceConfigSchema.safeParse(draft).success) {
      setMessage("请检查端口与图层数值是否在允许范围内。");
      return;
    }
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.saveModuleConfig({
        moduleId: "appearance",
        expectedRevision: dirty ? baseRevision : snapshot.config.revision,
        value: draft,
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      acceptModuleSnapshot(response.value);
      setBaseRevision(response.value.config.revision);
      setDirty(false);
      if (apply) await run("apply");
      else setMessage("布景配置已保存。");
    } catch {
      setMessage("配置未能保存，请重试。");
    } finally {
      setPending(false);
    }
  }
  async function enable() {
    setPending(true);
    try {
      const response = await window.codexCoco.enableModule({
        moduleId: "appearance",
        enabled: true,
      });
      if (response.ok) acceptModuleSnapshot(response.value);
      else setMessage(response.error.message);
    } catch {
      setMessage("模块未能启用，请在模块管理中检查状态。");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <header className="desktop-page-heading">
        <h2>外观</h2>
        <p>为外部 Codex 配置壁纸、主面板和侧栏布景。</p>
      </header>
      {message && <output aria-live="polite">{message}</output>}
      {result?.status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>布景操作未完成</AlertTitle>
          <AlertDescription>{appearanceFailures[result.reason!]}</AlertDescription>
        </Alert>
      )}
      {!enabled && (
        <Alert>
          <AlertTitle>布景尚未连接</AlertTitle>
          <AlertDescription>
            <p>
              启用后可导入图片和检查本机连接。应用布景需要 Codex
              已开启远程调试；启用不会自动启动或重启 Codex。
            </p>
            <Button
              disabled={busy || snapshot.phase !== "disabled"}
              onClick={() => {
                void enable();
              }}
            >
              启用外观模块
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {conflict && (
        <Alert variant="destructive">
          <AlertTitle>配置已在其他窗口更新</AlertTitle>
          <AlertDescription>
            <Button
              variant="outline"
              onClick={() => {
                setDirty(false);
                setPreviews({});
              }}
            >
              载入已保存配置
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="appearance-port">Codex 本机调试端口</FieldLabel>
          <Input
            id="appearance-port"
            type="number"
            min={1024}
            max={65535}
            value={Number.isNaN(draft.port) ? "" : draft.port}
            onChange={(e) => update({ ...draft, port: e.target.valueAsNumber })}
          />
          <FieldDescription>
            仅连接
            127.0.0.1。启动参数示例：--remote-debugging-port=9229。修改端口前需撤销原端口的布景。
          </FieldDescription>
        </Field>
        {(["wallpaper", "main", "sidebar"] as const).map((layer) => (
          <Field key={layer}>
            <h3>{labels[layer]}</h3>
            <ToggleGroup
              aria-label={`${labels[layer]}开关`}
              value={[draft[layer].enabled ? "on" : "off"]}
              onValueChange={(values) => {
                if (values.length)
                  update({ ...draft, [layer]: { ...draft[layer], enabled: values[0] === "on" } });
              }}
              variant="outline"
            >
              <ToggleGroupItem value="off">关闭</ToggleGroupItem>
              <ToggleGroupItem value="on">启用</ToggleGroupItem>
            </ToggleGroup>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                disabled={!enabled || busy}
                onClick={() => {
                  void run("import-image", layer);
                }}
              >
                导入{labels[layer]}
              </Button>
              <span className="text-muted-foreground">
                {draft[layer].image ? "已选自定义图片" : "未选择图片"}
              </span>
              {draft[layer].image && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    update({ ...draft, [layer]: { ...draft[layer], image: null } });
                    setPreviews((previous) => ({ ...previous, [layer]: undefined }));
                  }}
                >
                  清除图片
                </Button>
              )}
            </div>
            {previews[layer] && (
              <img
                src={previews[layer]}
                alt={`${labels[layer]}图片预览`}
                className="max-h-40 max-w-full rounded-lg object-contain"
              />
            )}
            <div className="grid grid-cols-2 gap-4">
              {(["x", "y"] as const).map((axis) => (
                <Field key={axis}>
                  <FieldLabel htmlFor={`${layer}-${axis}`}>
                    {axis === "x" ? "水平位置" : "垂直位置"} {draft[layer][axis]}%
                  </FieldLabel>
                  <Input
                    id={`${layer}-${axis}`}
                    type="range"
                    min={0}
                    max={100}
                    value={draft[layer][axis]}
                    onChange={(e) =>
                      update({
                        ...draft,
                        [layer]: { ...draft[layer], [axis]: e.target.valueAsNumber },
                      })
                    }
                  />
                </Field>
              ))}
              {layer === "wallpaper" ? (
                <>
                  <Field>
                    <FieldLabel>图片适配</FieldLabel>
                    <ToggleGroup
                      aria-label="壁纸适配"
                      value={[draft.wallpaper.fit]}
                      onValueChange={(values) => {
                        if (values[0] === "cover" || values[0] === "contain")
                          update({ ...draft, wallpaper: { ...draft.wallpaper, fit: values[0] } });
                      }}
                      variant="outline"
                    >
                      <ToggleGroupItem value="cover">铺满</ToggleGroupItem>
                      <ToggleGroupItem value="contain">完整显示</ToggleGroupItem>
                    </ToggleGroup>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="wallpaper-transparency">
                      面板透明度 {Math.round(draft.wallpaper.transparency * 100)}%
                    </FieldLabel>
                    <Input
                      id="wallpaper-transparency"
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={draft.wallpaper.transparency}
                      onChange={(e) =>
                        update({
                          ...draft,
                          wallpaper: { ...draft.wallpaper, transparency: e.target.valueAsNumber },
                        })
                      }
                    />
                  </Field>
                </>
              ) : (
                (
                  [
                    { key: "size", title: "插画宽度", min: 80, max: 1200, step: 1 },
                    { key: "blur", title: "模糊程度", min: 0, max: 30, step: 1 },
                    { key: "opacity", title: "不透明度", min: 0, max: 1, step: 0.01 },
                  ] as const
                ).map(({ key, title, min, max, step }) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`${layer}-${key}`}>
                      {title} {draft[layer][key]}
                    </FieldLabel>
                    <Input
                      id={`${layer}-${key}`}
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={draft[layer][key]}
                      onChange={(e) =>
                        update({
                          ...draft,
                          [layer]: { ...draft[layer], [key]: e.target.valueAsNumber },
                        })
                      }
                    />
                  </Field>
                ))
              )}
            </div>
            <Separator />
          </Field>
        ))}
      </FieldGroup>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!enabled || busy || conflict}
          onClick={() => {
            void save(true);
          }}
        >
          保存并应用布景
        </Button>
        <Button
          variant="outline"
          disabled={busy || conflict || !dirty}
          onClick={() => {
            void save(false);
          }}
        >
          仅保存配置
        </Button>
        <Button
          variant="outline"
          disabled={!enabled || busy}
          onClick={() => {
            void run("inspect");
          }}
        >
          检查连接
        </Button>
        <Button
          variant="outline"
          disabled={!enabled || busy}
          onClick={() => {
            void run("verify");
          }}
        >
          验证布景
        </Button>
        <Button
          variant="outline"
          disabled={!enabled || busy}
          onClick={() => {
            void run("remove");
          }}
        >
          撤销布景
        </Button>
      </div>
      <output aria-live="polite">
        {busy
          ? "正在处理布景…"
          : result?.active
            ? `正在同步 ${result.targets} 个 Codex 窗口，停用模块或退出时撤销。`
            : result?.targets
              ? `已识别 ${result.targets} 个 Codex 窗口。`
              : "保存配置后，点击应用才会修改目标窗口。"}
      </output>
    </div>
  );
}
