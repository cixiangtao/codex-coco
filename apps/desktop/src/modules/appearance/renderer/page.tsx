import { PinBlockButton } from "../../../renderer/components/pin-block";
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
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import type { ModuleSnapshot } from "../../../contracts/modules";
import { acceptModuleSnapshot, waitForModuleOperation } from "../../../renderer/client/modules";
import {
  appearanceConfigSchema,
  appearanceDefaults,
  appearanceFailures,
  appearanceResultSchema,
  type AppearanceConfig,
} from "../contract";

import { type Layer } from "./editor-types";
import { AppearanceLayerEditor } from "./layer-editor";
import { AppearanceLibraryPanel } from "./library-panel";
import { AppearanceConnectionPanel } from "./connection-panel";
import { Box } from "@codex-coco/ui/components/box";
import { Badge } from "@codex-coco/ui/components/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@codex-coco/ui/components/tabs";
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
  const [selectedLayer, setSelectedLayer] = useState<Layer>("main");
  const [activeTab, setActiveTab] = useState("editor");
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
    <Box gap="lg" className="appearance-page">
      <header className="desktop-page-heading appearance-heading">
        <div>
          <h2>外观</h2>
          <p>壁纸、主面板与侧栏布景</p>
        </div>
        <PinBlockButton id="appearance.status" />
        <Badge tone={dirty ? "warning" : result?.active ? "success" : "neutral"}>
          {dirty ? "有未保存修改" : result?.active ? "同步中" : enabled ? "未应用布景" : "已停用"}
        </Badge>
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
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (typeof value === "string") setActiveTab(value);
        }}
      >
        <TabsList aria-label="外观功能">
          <TabsTrigger value="editor">布景编辑</TabsTrigger>
          <TabsTrigger value="library">图片与预设</TabsTrigger>
          <TabsTrigger value="connection">连接设置</TabsTrigger>
        </TabsList>
        <TabsContent value="editor">
          <div className="appearance-workspace">
            <AppearancePreview
              selected={selectedLayer}
              onSelect={setSelectedLayer}
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
            <AppearanceLayerEditor
              draft={draft}
              layer={selectedLayer}
              previews={previews}
              enabled={enabled}
              busy={busy}
              update={update}
              onImport={(layer) => {
                void run("import-image", layer);
              }}
            />
          </div>
          <Button
            variant="ghost"
            className="appearance-library-link"
            onClick={() => setActiveTab("library")}
          >
            从图片库选择或载入预设
          </Button>
        </TabsContent>
        <TabsContent value="library">
          <AppearanceLibraryPanel
            draft={draft}
            update={update}
            enabled={enabled}
            busy={busy}
            dirty={dirty}
            result={result}
            run={run}
            libraryLayer={selectedLayer}
            onSelect={setSelectedLayer}
          />
        </TabsContent>
        <TabsContent value="connection">
          <AppearanceConnectionPanel
            draft={draft}
            update={update}
            enabled={enabled}
            busy={busy}
            dirty={dirty}
            result={result}
            run={run}
            onRestart={() => setConfirmRestart(true)}
          />
        </TabsContent>
      </Tabs>
      <footer className="appearance-save-bar">
        <div className="appearance-save-actions">
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
            variant="ghost"
            disabled={busy || !dirty}
            onClick={() => {
              setDirty(false);
              setMessage("");
            }}
          >
            放弃修改
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
      </footer>
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
    </Box>
  );
}
