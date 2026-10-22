import { useEffect, useState } from "react";
import { ArrowUpRight, Layers3, RefreshCw, Settings2, X } from "lucide-react";
import { Box } from "@codex-coco/ui/components/box";
import { GlanceUsage } from "../components/glance-usage";
import { Skeleton } from "@codex-coco/ui/components/skeleton";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import { ThemeProvider } from "@codex-coco/ui/theme";
import { useSavedSettings } from "../client/settings";
import { useGlance, refreshGlance } from "../client/glance";
import type { MainPage } from "../../contracts/windows";
import { GlanceModule } from "../components/glance-module";

/** Read-only cross-module surface; it follows saved settings, never another window's preview draft. */
export function GlancePage() {
  const saved = useSavedSettings();
  const summary = useGlance();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void dismiss();
      }
    };
    const visibility = () => {
      setVisible(document.visibilityState === "visible");
      setNow(Date.now());
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", escape);
    window.codexCoco.ready();
    return () => {
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", visibility);
    };
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
            <div className="glance-modules">
              {summary.snapshot.items
                .filter((item) => item.phase === "error")
                .map((item) => (
                  <GlanceModule
                    key={item.id}
                    item={item}
                    busy={busy}
                    onOpen={() => {
                      void open(item.page);
                    }}
                  />
                ))}
              {summary.snapshot.items
                .filter(
                  (item) =>
                    item.phase !== "error" &&
                    item.metrics?.some((metric) => metric.progress !== undefined),
                )
                .map((item) => (
                  <GlanceUsage
                    key={item.id}
                    item={item}
                    now={now}
                    busy={busy}
                    onOpen={() => {
                      void open(item.page);
                    }}
                  />
                ))}
              <div className="glance-shortcuts">
                {summary.snapshot.items
                  .filter(
                    (item) =>
                      item.phase !== "error" &&
                      !item.metrics?.some((metric) => metric.progress !== undefined),
                  )
                  .map((item) => (
                    <GlanceModule
                      key={item.id}
                      item={item}
                      busy={busy}
                      onOpen={() => {
                        void open(item.page);
                      }}
                    />
                  ))}
              </div>
            </div>
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
