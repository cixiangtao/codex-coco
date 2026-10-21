import { useEffect, useState } from "react";
import { ArrowUpRight, Layers3, RefreshCw, Settings2, TriangleAlert, X } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import { ThemeProvider } from "@codex-coco/ui/theme";
import { useSavedSettings } from "../client/settings";
import { useGlance, refreshGlance } from "../client/glance";
import type { MainPage } from "../../contracts/windows";
import type { GlancePhase } from "../../contracts/glance";

const phaseLabels: Record<GlancePhase, string> = {
  unavailable: "尚未接入",
  disabled: "已停用",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  error: "需要处理",
};

/** Read-only cross-module surface; it follows saved settings, never another window's preview draft. */
export function GlancePage() {
  const saved = useSavedSettings();
  const summary = useGlance();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void dismiss();
      }
    };
    window.addEventListener("keydown", escape);
    window.codexCoco.ready();
    return () => window.removeEventListener("keydown", escape);
  }, []);
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
      <div className="glance-shell">
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
          ) : (
            summary.snapshot?.items.map((item) => (
              <section className="glance-item" key={item.id} aria-label={item.title}>
                <div className="glance-item-heading">
                  <h2>{item.title}</h2>
                  <span data-error={item.phase === "error"}>
                    {item.phase === "error" && <TriangleAlert aria-hidden="true" />}
                    {phaseLabels[item.phase]}
                  </span>
                </div>
                <p>{item.description}</p>
                {item.metrics && (
                  <dl className="glance-metrics">
                    {item.metrics.map((metric) => (
                      <div key={metric.id}>
                        <dt>{metric.label}</dt>
                        <dd>
                          <strong>{metric.value}</strong>
                          <span>{metric.detail}</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                {item.capturedAt !== undefined && (
                  <p className="glance-captured">
                    读取于{" "}
                    {new Date(item.capturedAt).toLocaleString("zh-CN", {
                      month: "numeric",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}{" "}
                    · 请在主窗口刷新确认
                  </p>
                )}
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    void open(item.page);
                  }}
                >
                  {item.phase === "error" ? "前往处理" : `打开${item.title}`}
                  <ArrowUpRight data-icon="inline-end" />
                </Button>
              </section>
            ))
          )}
        </main>
        <footer className="glance-actions">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void open("modules");
            }}
          >
            <Layers3 data-icon="inline-start" />
            模块管理
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
