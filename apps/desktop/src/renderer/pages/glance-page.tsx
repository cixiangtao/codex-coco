import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Layers3,
  RefreshCw,
  Settings2,
  TriangleAlert,
  X,
  Palette,
  Activity,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@codex-coco/ui/components/card";
import { Box } from "@codex-coco/ui/components/box";
import { Badge } from "@codex-coco/ui/components/badge";
import { ProgressRing } from "@codex-coco/ui/components/progress-ring";
import { Skeleton } from "@codex-coco/ui/components/skeleton";
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
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void dismiss();
      }
    };
    const visibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", escape);
    window.codexCoco.ready();
    return () => {
      window.removeEventListener("keydown", escape);
      document.removeEventListener("visibilitychange", visibility);
    };
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
            summary.snapshot.items.map((item) => {
              const capacities =
                item.phase === "error"
                  ? []
                  : (item.metrics?.filter((metric) => metric.progress !== undefined) ?? []);
              const statistics =
                item.phase === "error"
                  ? []
                  : (item.metrics?.filter((metric) => metric.progress === undefined) ?? []);
              if (capacities.length)
                return (
                  <section key={item.id} className="glance-usage" aria-label={item.title}>
                    <div className="glance-item-heading">
                      <h2 className="sr-only">{item.title}</h2>
                      <p className="glance-account">{item.description}</p>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`打开${item.title}`}
                        disabled={busy}
                        onClick={() => {
                          void open(item.page);
                        }}
                      >
                        <ArrowUpRight />
                      </Button>
                    </div>
                    <div className="glance-quota-grid">
                      {capacities.map((metric, index) => {
                        const tone =
                          metric.progress! <= 5
                            ? "warning"
                            : index % 2 === 0
                              ? "primary"
                              : "success";
                        return (
                          <Card
                            key={metric.id}
                            tone={tone}
                            density="compact"
                            className="glance-quota"
                          >
                            <CardHeader>
                              <CardTitle>{metric.label.replace(/^通用额度 · /, "")}</CardTitle>
                            </CardHeader>
                            <CardContent>
                              <ProgressRing
                                value={metric.progress!}
                                label={metric.label}
                                valuePrefix="剩余"
                                caption="剩余额度"
                                size="sm"
                                tone={tone}
                              />
                              <p className="glance-quota-reset">{metric.detail}</p>
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                    {statistics.length > 0 && (
                      <Card density="compact">
                        <CardContent>
                          <dl className="glance-statistics">
                            {statistics.map((metric) => (
                              <div key={metric.id}>
                                <dt>{metric.label}</dt>
                                <dd title={`${metric.value} · ${metric.detail}`}>
                                  <strong>
                                    {metric.numericValue === undefined
                                      ? metric.value
                                      : new Intl.NumberFormat("en", {
                                          notation: "compact",
                                          maximumFractionDigits: 1,
                                        }).format(metric.numericValue)}
                                  </strong>
                                  {metric.numericValue !== undefined && metric.unit && (
                                    <span>{metric.unit}</span>
                                  )}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </CardContent>
                      </Card>
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
                  </section>
                );
              return (
                <Card
                  key={item.id}
                  className="glance-item"
                  density="compact"
                  aria-label={item.title}
                >
                  <CardHeader>
                    <div className="glance-module-title">
                      {item.phase === "error" ? (
                        <TriangleAlert aria-hidden="true" />
                      ) : item.id === "appearance" ? (
                        <Palette aria-hidden="true" />
                      ) : (
                        <Activity aria-hidden="true" />
                      )}
                      <CardTitle>{item.title}</CardTitle>
                    </div>
                    <Badge
                      tone={
                        item.phase === "error"
                          ? "danger"
                          : item.phase === "running"
                            ? "success"
                            : "neutral"
                      }
                    >
                      {phaseLabels[item.phase]}
                    </Badge>
                    {item.phase !== "error" && (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`打开${item.title}`}
                        title={item.description}
                        disabled={busy}
                        onClick={() => {
                          void open(item.page);
                        }}
                      >
                        <ArrowUpRight />
                      </Button>
                    )}
                  </CardHeader>
                  {(item.phase === "error" ||
                    statistics.length > 0 ||
                    item.phase === "running") && (
                    <CardContent>
                      {(item.phase === "error" || item.phase === "running") && (
                        <p>{item.description}</p>
                      )}
                      {statistics.length > 0 && (
                        <dl className="glance-statistics">
                          {statistics.map((metric) => (
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
                    </CardContent>
                  )}
                  {item.phase === "error" && (
                    <Button
                      variant="ghost"
                      className="glance-module-open"
                      disabled={busy}
                      onClick={() => {
                        void open(item.page);
                      }}
                    >
                      前往处理
                      <ArrowUpRight data-icon="inline-end" />
                    </Button>
                  )}
                </Card>
              );
            })
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
