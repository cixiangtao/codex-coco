import { AppearancePreview } from "./preview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@codex-coco/ui/components/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [presetTitle, setPresetTitle] = useState("");
  const [libraryLayer, setLibraryLayer] = useState<Layer>("main");
  const task = snapshot.operation;
  const busy = pending || task?.phase === "running" || task?.phase === "cancelling";
  const enabled = snapshot.phase === "running";
  const parsed = appearanceResultSchema.safeParse(snapshot.state ?? task?.result);
  const result = parsed.success ? parsed.data : null;
  const previewRequests = useRef(new Set<string>());
  const previewInFlight = useRef(false);
  const selectedImages = useMemo(
    () => [draft.wallpaper.image, draft.main.image, draft.sidebar.image],
    [draft.wallpaper.image, draft.main.image, draft.sidebar.image],
  );
  useEffect(() => {
    if (!enabled || busy || previewInFlight.current) return;
    const id = selectedImages.find((id) => id && !previews[id] && !previewRequests.current.has(id));
    if (!id) return;
    previewRequests.current.add(id);
    previewInFlight.current = true;
    void (async () => {
      try {
        const response = await window.codexCoco.runModuleOperation({
          moduleId: "appearance",
          operation: "preview-image",
          input: { id },
        });
        if (!response.ok || !response.value.operation) {
          previewRequests.current.delete(id);
          return;
        }
        acceptModuleSnapshot(response.value);
        const operation = await waitForModuleOperation(
          "appearance",
          response.value.operation.id,
          30_000,
        );
        const parsed = appearanceResultSchema.safeParse(operation.result);
        if (parsed.success && parsed.data.preview)
          setPreviews((previous) => ({ ...previous, [id]: parsed.data.preview! }));
      } catch {
        setMessage("部分图片预览未能载入，可以通过重新选择图片重试。");
      } finally {
        previewInFlight.current = false;
      }
    })();
  }, [enabled, busy, selectedImages, previews]);
  const conflict = dirty && baseRevision !== snapshot.config.revision;
  function update(next: AppearanceConfig) {
    if (!dirty) setBaseRevision(snapshot.config.revision);
    setDraft(next);
    setDirty(true);
    setMessage("");
  }
  async function run(operation: string, layer?: Layer, input: Record<string, string> = {}) {
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "appearance",
        operation,
        input,
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      acceptModuleSnapshot(response.value);
      if (layer && response.value.operation) {
        const completed = await waitForModuleOperation(
          "appearance",
          response.value.operation.id,
          300_000,
        );
        const result = appearanceResultSchema.safeParse(completed.result);
        if (result.success && result.data.imported) {
          update({
            ...draft,
            [layer]: { ...draft[layer], image: result.data.imported, enabled: true },
          });
          const preview = result.data.preview;
          if (preview)
            setPreviews((previous) => ({ ...previous, [result.data.imported!]: preview }));
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
              }}
            >
              载入已保存配置
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <section className="flex flex-col gap-3" aria-label="Codex 启动与恢复">
        <h3>Codex 启动与恢复</h3>
        <p className="text-muted-foreground">
          {result?.appSelected ? "已选择应用" : "尚未选择应用"} ·{" "}
          {result?.connectedPort ? `本机端口 ${result.connectedPort}` : "尚未连接"}
        </p>
        <ToggleGroup
          aria-label="调试端口方式"
          variant="outline"
          value={[draft.portMode]}
          onValueChange={(items) => {
            if (items[0] === "auto" || items[0] === "fixed")
              update({ ...draft, portMode: items[0] });
          }}
        >
          <ToggleGroupItem value="fixed">固定端口</ToggleGroupItem>
          <ToggleGroupItem value="auto">自动分配</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup
          aria-label="启动后恢复已保存布景"
          variant="outline"
          value={[draft.restoreOnEnable ? "on" : "off"]}
          onValueChange={(items) => {
            if (items.length) update({ ...draft, restoreOnEnable: items[0] === "on" });
          }}
        >
          <ToggleGroupItem value="off">手动应用</ToggleGroupItem>
          <ToggleGroupItem value="on">启动后恢复已保存布景</ToggleGroupItem>
        </ToggleGroup>
        <p className="text-muted-foreground">
          恢复只尝试连接已运行的目标，连接失败会退避；不会自动启动或重启应用。更换目标前请先撤销旧布景。
        </p>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={!enabled || busy}
            onClick={() => {
              void run("choose-application");
            }}
          >
            选择 Codex 应用
          </Button>
          <Button
            variant="outline"
            disabled={!enabled || busy || dirty}
            onClick={() => {
              void run("launch-application");
            }}
          >
            启动所选应用
          </Button>
          <Button
            variant="outline"
            disabled={!enabled || busy || dirty}
            onClick={() => setConfirmRestart(true)}
          >
            明确重启所选应用
          </Button>
        </div>
      </section>
      <section className="flex flex-col gap-3" aria-label="布景图片库">
        <h3>图片库</h3>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={!enabled || busy}
            onClick={() => {
              void run("list-gallery");
            }}
          >
            载入图片库
          </Button>
          <ToggleGroup
            aria-label="图库应用图层"
            variant="outline"
            value={[libraryLayer]}
            onValueChange={(items) => {
              if (items[0] && Object.hasOwn(labels, items[0])) setLibraryLayer(items[0] as Layer);
            }}
          >
            {(["wallpaper", "main", "sidebar"] as const).map((layer) => (
              <ToggleGroupItem key={layer} value={layer}>
                {labels[layer]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {result?.gallery.map((item) => (
            <div key={item.id} className="flex flex-col gap-2">
              <button
                type="button"
                className="rounded-lg border p-2 text-left"
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
      </section>
      <AppearancePreview
        value={draft}
        images={Object.fromEntries(
          (["wallpaper", "main", "sidebar"] as const).map((layer) => [
            layer,
            (draft[layer].image ? previews[draft[layer].image] : undefined) ??
              result?.gallery.find((item) => item.id === draft[layer].image)?.preview,
          ]),
        )}
        onChange={update}
      />
      <section className="flex flex-col gap-3" aria-label="布景预设">
        <h3>布景预设</h3>
        <div className="flex gap-3">
          <Input
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
                presets: [...presets, { id: crypto.randomUUID(), title: presetTitle.trim(), look }],
              });
              setPresetTitle("");
            }}
          >
            保存为预设
          </Button>
        </div>
        {draft.presets.map((preset) => (
          <div className="flex items-center gap-3" key={preset.id}>
            <span>{preset.title}</span>
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
                update({ ...draft, presets: draft.presets.filter((item) => item.id !== preset.id) })
              }
            >
              删除预设
            </Button>
          </div>
        ))}
        <p className="text-muted-foreground">
          最多保存 12 组。预设与图层配置一起保存，载入后需明确应用。
        </p>
      </section>
      <Dialog open={confirmRestart} onOpenChange={setConfirmRestart}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重启所选应用？</DialogTitle>
            <DialogDescription>
              请先保存目标应用中的工作。Codex Coco
              会请求所选应用正常退出，等待退出后带本机调试参数启动；拒绝退出时不会强制终止。此操作只在明确确认后执行。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setConfirmRestart(false)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setConfirmRestart(false);
                void run("restart-application");
              }}
            >
              确认重启
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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
                  }}
                >
                  清除图片
                </Button>
              )}
            </div>
            {draft[layer].image && previews[draft[layer].image] && (
              <img
                src={previews[draft[layer].image!]}
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
