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

import { labels, type Layer, type AppearanceLaunchFeedback } from "./editor-types";
import { AppearanceLayerEditor } from "./layer-editor";
import { AppearancePresetPanel } from "./library-panel";
import { AppearanceConnectionPanel } from "./connection-panel";
import { Box } from "@codex-coco/ui/components/box";
import { Badge } from "@codex-coco/ui/components/badge";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import { AppearanceImagePicker } from "./image-picker";
import { ArrowLeftIcon, ImagesIcon, Settings2Icon } from "lucide-react";
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
  const [launchFeedback, setLaunchFeedback] = useState<AppearanceLaunchFeedback | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<Layer>("main");
  const [view, setView] = useState<"editor" | "connection">("editor");
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [pickerLayer, setPickerLayer] = useState<Layer | null>(null);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [savedForLater, setSavedForLater] = useState(false);
  const regionSelection = useRef<HTMLDivElement>(null);
  const currentDraft = useRef(draft);
  useEffect(() => {
    currentDraft.current = draft;
  }, [draft]);
  const editVersion = useRef(0);
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
    editVersion.current++;
    currentDraft.current = next;
    setDraft(next);
    setDirty(true);
    setMessage("");
  }
  async function run(operation: string, layer?: Layer, input: Record<string, string> = {}) {
    setPending(true);
    setMessage("");
    const launching = operation === "launch-application" || operation === "restart-application";
    if (launching) setLaunchFeedback({ operation, phase: "pending", reason: null });
    else if (operation === "choose-application") setLaunchFeedback(null);
    try {
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "appearance",
        operation,
        input,
      });
      if (!response.ok) {
        setMessage(response.error.message);
        if (launching) setLaunchFeedback({ operation, phase: "error", reason: "LAUNCH_FAILED" });
        return;
      }
      acceptModuleSnapshot(response.value);
      if (launching) {
        if (!response.value.operation) throw new Error("LAUNCH_FAILED");
        const completed = await waitForModuleOperation(
          "appearance",
          response.value.operation.id,
          65_000,
        );
        const parsed = appearanceResultSchema.safeParse(completed.result);
        const reason =
          completed.phase === "succeeded" && parsed.success && parsed.data.status === "ready"
            ? null
            : parsed.success
              ? (parsed.data.reason ?? "LAUNCH_FAILED")
              : "LAUNCH_FAILED";
        setLaunchFeedback({
          operation,
          phase: completed.phase === "cancelled" ? "cancelled" : reason ? "error" : "ready",
          reason,
          applied: parsed.success && parsed.data.active,
        });
        if (!reason) setSavedForLater(false);
        if (operation === "launch-application" && reason === "APP_RUNNING") setConfirmRestart(true);
      }
      if (!launching && !layer && response.value.operation) {
        const completed = await waitForModuleOperation(
          "appearance",
          response.value.operation.id,
          300_000,
        );
        const result = appearanceResultSchema.safeParse(completed.result);
        if (completed.phase === "cancelled") setMessage("操作已取消。");
        else if (completed.phase !== "succeeded" || !result.success)
          setMessage("操作未完成，请重试。");
        else if (result.data.status === "error")
          setMessage(appearanceFailures[result.data.reason!]);
        else if (operation === "apply") {
          setSavedForLater(false);
          setMessage(
            result.data.active ? "已应用当前布景。" : "所有图层已关闭，当前没有布景需要应用。",
          );
        } else if (operation === "remove") setMessage("布景已撤销。");
        else if (operation === "verify") setMessage("布景验证通过。");
        else if (operation === "remove-image") setMessage("图片副本已删除，原始文件保持不变。");
      }
      if (layer && response.value.operation) {
        const completed = await waitForModuleOperation(
          "appearance",
          response.value.operation.id,
          300_000,
        );
        const result = appearanceResultSchema.safeParse(completed.result);
        if (result.success && result.data.imported) {
          const latest = currentDraft.current;
          update({
            ...latest,
            [layer]: { ...latest[layer], image: result.data.imported, enabled: true },
          });
          const preview = result.data.preview;
          if (preview)
            setPreviews((previous) => ({ ...previous, [result.data.imported!]: preview }));
        } else if (completed.phase === "cancelled") setMessage("图片导入已取消。");
        else if (completed.phase !== "succeeded" || !result.success)
          setMessage("图片导入未完成，请重试。");
        else if (result.data.status === "error")
          setMessage(appearanceFailures[result.data.reason!]);
      }
    } catch {
      if (launching) setLaunchFeedback({ operation, phase: "error", reason: "LAUNCH_FAILED" });
      else setMessage("外观服务连接失败，请重新打开窗口后重试。");
    } finally {
      setPending(false);
    }
  }
  async function save(apply: boolean) {
    const savedVersion = editVersion.current;
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
      setSavedForLater(true);
      if (savedVersion === editVersion.current) setDirty(false);
      if (apply) await run("apply");
      else setMessage("布景配置已保存。");
    } catch {
      setMessage("配置未能保存，请重试。");
    } finally {
      setPending(false);
    }
  }
  async function loadGallery() {
    setGalleryLoading(true);
    setGalleryError(null);
    setPending(true);
    try {
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "appearance",
        operation: "list-gallery",
        input: {},
      });
      if (!response.ok || !response.value.operation) throw new Error("GALLERY_FAILED");
      acceptModuleSnapshot(response.value);
      const completed = await waitForModuleOperation(
        "appearance",
        response.value.operation.id,
        30_000,
      );
      const parsed = appearanceResultSchema.safeParse(completed.result);
      if (completed.phase !== "succeeded" || !parsed.success || parsed.data.status !== "ready")
        throw new Error("GALLERY_FAILED");
    } catch {
      setGalleryError("图片库未能载入，请重试，或从本机导入图片。");
    } finally {
      setGalleryLoading(false);
      setPending(false);
    }
  }
  function openImagePicker() {
    setPickerLayer(selectedLayer);
    void loadGallery();
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
          <h2>{view === "editor" ? "外观" : "连接设置"}</h2>
          <p>
            {view === "editor"
              ? "选择区域，让 Codex 换个样子。"
              : "管理 Codex 应用、启动偏好与本机连接。"}
          </p>
        </div>
        <div className="appearance-heading-actions">
          {view === "editor" ? (
            <>
              <PinBlockButton id="appearance.status" />
              <Button variant="ghost" onClick={() => setView("connection")}>
                <Settings2Icon />
                连接设置
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setView("editor")}>
              <ArrowLeftIcon />
              返回布景编辑
            </Button>
          )}
        </div>
      </header>
      {enabled && view === "editor" && (
        <div className="appearance-connection-strip" aria-label="布景连接状态">
          <div>
            <Badge tone={result?.active ? "success" : "neutral"}>
              {result?.active
                ? "Codex 中已有布景"
                : result?.connection === "ready"
                  ? "Codex 已连接"
                  : "等待连接 Codex"}
            </Badge>
            <span>
              {result?.active
                ? "编辑后保存并应用，才会更新当前效果。"
                : result?.connection === "needs-restart"
                  ? "Codex 需要重启后才能连接。"
                  : result?.connection === "stopped"
                    ? "Codex 尚未运行，可先完成布景编辑。"
                    : result?.connection === "not-selected"
                      ? "可先编辑布景，再选择要连接的 Codex。"
                      : result?.connection === "ready"
                        ? "布景准备好后即可应用。"
                        : "可先编辑布景，再检查本机连接。"}
            </span>
          </div>
          {!result?.active && (
            <Button variant="link" size="sm" onClick={() => setView("connection")}>
              设置连接
            </Button>
          )}
        </div>
      )}
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
              启用后可选择图片和连接
              Codex。若已选择应用且开启自动连接，会尝试启动或恢复连接；需要重启时会先请你确认。
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
      <section hidden={view !== "editor"} className="appearance-editor-view" aria-label="布景编辑">
        <div className="appearance-editor-toolbar">
          <ToggleGroup
            ref={regionSelection}
            aria-label="预览定位图层"
            variant="outline"
            value={[selectedLayer]}
            onValueChange={(items) => {
              if (items[0] && Object.hasOwn(labels, items[0])) setSelectedLayer(items[0] as Layer);
            }}
          >
            {(["wallpaper", "main", "sidebar"] as const).map((layer) => (
              <ToggleGroupItem key={layer} value={layer}>
                {labels[layer]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            variant="ghost"
            aria-expanded={presetsOpen}
            aria-controls="appearance-presets"
            onClick={() => setPresetsOpen(!presetsOpen)}
          >
            <ImagesIcon />
            布景预设
          </Button>
        </div>
        <div id="appearance-presets" hidden={!presetsOpen}>
          <AppearancePresetPanel
            draft={draft}
            update={update}
            busy={busy}
            onLoad={() => setPresetsOpen(false)}
          />
        </div>
        <div className="appearance-workspace">
          <AppearancePreview
            selected={selectedLayer}
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
            preview={
              draft[selectedLayer].image
                ? (previews[draft[selectedLayer].image] ??
                  result?.gallery.find((item) => item.id === draft[selectedLayer].image)?.preview)
                : undefined
            }
            imageTitle={
              result?.gallery.find((item) => item.id === draft[selectedLayer].image)?.title
            }
            enabled={enabled}
            busy={busy}
            update={update}
            onChoose={openImagePicker}
            onImport={(layer) => {
              void run("import-image", layer);
            }}
          />
        </div>
      </section>
      <section hidden={view !== "connection"} aria-label="连接设置">
        <AppearanceConnectionPanel
          launchFeedback={launchFeedback}
          draft={draft}
          update={update}
          enabled={enabled}
          busy={busy}
          dirty={dirty}
          result={result}
          run={run}
          onRestart={() => setConfirmRestart(true)}
        />
      </section>
      <AppearanceImagePicker
        open={pickerLayer !== null}
        returnFocus={() =>
          regionSelection.current?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? null
        }
        onOpenChange={(open) => {
          if (!open) setPickerLayer(null);
        }}
        layer={pickerLayer ?? selectedLayer}
        selectedImage={draft[pickerLayer ?? selectedLayer].image}
        gallery={result?.gallery ?? []}
        loading={galleryLoading}
        error={galleryError}
        busy={busy}
        onRetry={() => {
          void loadGallery();
        }}
        onSelect={(item) => {
          if (!pickerLayer) return;
          const latest = currentDraft.current;
          update({
            ...latest,
            [pickerLayer]: { ...latest[pickerLayer], image: item.id, enabled: true },
          });
          setPreviews((previous) => ({ ...previous, [item.id]: item.preview }));
          setPickerLayer(null);
        }}
        onImport={() => {
          const layer = pickerLayer;
          setPickerLayer(null);
          if (layer) void run("import-image", layer);
        }}
        canRemove={!dirty}
        onRemove={(id) => {
          setPickerLayer(null);
          void run("remove-image", undefined, { id });
        }}
      />
      <footer className="appearance-save-bar">
        <div className="appearance-draft-status">
          <Badge tone={dirty ? "warning" : "neutral"}>
            {dirty ? "有未保存修改" : savedForLater ? "已保存，待应用" : "配置已保存"}
          </Badge>
          <span>
            {dirty
              ? "修改只在本地预览中，尚未更新 Codex。"
              : savedForLater
                ? "Codex 保持原有效果，可继续应用。"
                : "选图和调节只改变草稿。"}
          </span>
        </div>
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
        {message && <output aria-live="polite">{message}</output>}
        <output aria-live="polite">
          {busy
            ? "正在处理布景…"
            : result?.active
              ? `已应用到 ${result.targets} 个 Codex 窗口，停用模块或退出时撤销。`
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
              会请求所选应用正常退出，等待退出后开启布景连接并应用已保存设置；拒绝退出时不会强制终止。未保存的修改不会应用。
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
