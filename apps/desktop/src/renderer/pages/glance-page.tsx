import { useEffect, useState } from "react";
import { ArrowUpRight, Layers3, RefreshCw, Settings2, X } from "lucide-react";
import { Box } from "@codex-coco/ui/components/box";
import { GlanceBoard } from "../components/glance-board";
import { GlanceReorder } from "../components/glance-reorder";
import { Skeleton } from "@codex-coco/ui/components/skeleton";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import { ThemeProvider } from "@codex-coco/ui/theme";
import { useSavedSettings } from "../client/settings";
import { useGlance, refreshGlance } from "../client/glance";
import type { AppearanceQuickAction } from "../../contracts/glance";
import type { MainPage } from "../../contracts/windows";

/** Public cross-module projection with direct, restricted information-block reordering. */
export function GlancePage() {
  const saved = useSavedSettings();
  const summary = useGlance();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const off = window.codexCoco.onGlanceVisibilityChanged((visible) => {
      setVisible(visible);
      setNow(Date.now());
      if (!visible) {
        setMessage("");
      }
    });
    window.codexCoco.ready();
    return off;
  }, []);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      void dismiss();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    if (!visible) return;
    // A visible-window display clock; this never refreshes module or account data.
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [visible]);
  async function dismiss() {
    try {
      const result = await window.codexCoco.dismissGlance();
      if (!result.ok) setMessage(result.error.message);
    } catch {
      setMessage("速览暂时无法收起，请重试。");
    }
  }
  async function appearanceAction(action: AppearanceQuickAction) {
    setBusy(true);
    setMessage("");
    try {
      const result = await window.codexCoco.appearanceQuickAction({ action });
      if (!result.ok) setMessage(result.error.message);
      await refreshGlance();
    } catch {
      setMessage("布景操作未能发出，请重试或打开外观页面。");
    } finally {
      setBusy(false);
    }
  }
  async function open(page?: MainPage) {
    setBusy(true);
    setMessage("");
    try {
      const result = await window.codexCoco.openMainPage(page ? { page } : {});
      if (!result.ok) setMessage(result.error.message);
    } catch {
      setMessage("主窗口暂时无法打开，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <ThemeProvider preference={saved.settings.theme}>
      <div className="glance-shell" data-visible={visible}>
        <header className="glance-toolbar">
          <h1>Codex Coco</h1>
          <div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="刷新速览"
              title="刷新速览"
              disabled={summary.refreshing}
              onClick={() => {
                void refreshGlance();
              }}
            >
              <RefreshCw />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="打开设置"
              disabled={busy}
              onClick={() => {
                void open("settings");
              }}
            >
              <Settings2 />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="收起速览"
              onClick={() => {
                void dismiss();
              }}
            >
              <X />
            </Button>
          </div>
        </header>
        <main className="glance-content" aria-label="跨模块速览">
          {message && (
            <Alert variant="destructive">
              <AlertTitle>操作未完成</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {(saved.health === "invalid" || saved.health === "future-version") && (
            <Alert variant="destructive">
              <AlertTitle>设置需要恢复</AlertTitle>
              <AlertDescription>原配置已保留，请在主窗口的设置中处理。</AlertDescription>
            </Alert>
          )}
          {summary.failed ? (
            <Alert variant="destructive">
              <AlertTitle>暂时无法读取速览</AlertTitle>
              <AlertDescription>
                <p>请重试，或打开主窗口查看模块状态。旧摘要已隐藏。</p>
                <Button
                  variant="outline"
                  disabled={summary.refreshing}
                  onClick={() => {
                    void refreshGlance();
                  }}
                >
                  重新读取
                </Button>
              </AlertDescription>
            </Alert>
          ) : !summary.snapshot ? (
            <Box gap="md" aria-label="正在读取速览">
              <Skeleton className="h-36" />
              <Skeleton className="h-16" />
            </Box>
          ) : (
            <GlanceReorder snapshot={summary.snapshot} visible={visible} busy={busy}>
              {(layout) => (
                <GlanceBoard
                  onAppearanceAction={(action) => {
                    void appearanceAction(action);
                  }}
                  snapshot={summary.snapshot!}
                  layout={layout}
                  now={now}
                  busy={busy}
                  onOpen={(page) => {
                    void open(page);
                  }}
                />
              )}
            </GlanceReorder>
          )}
        </main>
        <footer className="glance-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="模块管理"
            disabled={busy}
            onClick={() => {
              void open("modules");
            }}
          >
            <Layers3 data-icon="inline-start" />
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              void open();
            }}
          >
            打开主窗口
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </footer>
      </div>
    </ThemeProvider>
  );
}
