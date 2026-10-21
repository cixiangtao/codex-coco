import { UsageToolsPanel } from "./tools-panel";
import { UsageResetCards } from "./reset-cards";
import { UsageTrend, UsageTokenSummary } from "./trend";
import { UsagePreferences } from "./preferences";
import { useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@codex-coco/ui/components/empty";
import type { ModuleSnapshot } from "../../../contracts/modules";
import { acceptModuleSnapshot } from "../../../renderer/client/modules";
import {
  remainingPercent,
  usageBucketTitle,
  usageFailures,
  usageState,
  usageConfigSchema,
  usageWindowTitle,
  usagePlanTitle,
  type UsageSnapshot,
  type TrendSnapshot,
} from "../contract";

const dateTime = (time: number) =>
  new Date(time).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
function QuotaData({ data, trend }: { data: UsageSnapshot; trend?: TrendSnapshot | null }) {
  return (
    <div className="usage-data">
      <section aria-label="账号信息" className="flex flex-wrap items-center gap-3">
        <h3>账号信息</h3>
        <span>{data.account?.label ?? "账号标识不可用"}</span>
        <strong>{usagePlanTitle(data.account?.plan)}</strong>
      </section>
      {data.credits && (
        <p aria-label="额外额度">
          额外额度：
          {data.credits.unlimited
            ? "不限量"
            : data.credits.balance !== null
              ? data.credits.balance.toLocaleString("zh-CN")
              : data.credits.hasCredits
                ? "有可用额度（余额未知）"
                : "暂无可用额度"}
        </p>
      )}
      {trend && <UsageTokenSummary trend={trend} />}
      <p className="usage-source">
        读取于{" "}
        <time dateTime={new Date(data.capturedAt).toISOString()}>{dateTime(data.capturedAt)}</time>{" "}
        · {data.source === "local-session" ? "本机会话历史记录" : "Codex CLI"}
      </p>
      {data.buckets.map((bucket, index) => (
        <section
          className="usage-bucket"
          key={bucket.id}
          aria-label={usageBucketTitle(bucket.id, index)}
        >
          <h3>{usageBucketTitle(bucket.id, index)}</h3>
          <dl className="usage-windows">
            {bucket.windows.map((window) => (
              <div className="usage-window" key={window.kind}>
                <dt>{usageWindowTitle(window)}</dt>
                <dd>
                  <strong>剩余 {Number(remainingPercent(window.usedPercent).toFixed(1))}%</strong>
                  <span>已用 {Number(window.usedPercent.toFixed(1))}%</span>
                </dd>
                <dd>
                  {window.resetsAt === null ? (
                    "恢复时间未知"
                  ) : (
                    <>
                      <time dateTime={new Date(window.resetsAt * 1000).toISOString()}>
                        {dateTime(window.resetsAt * 1000)}
                      </time>
                      <span>恢复时间</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Main-window reads are opt-in; operation results contain only validated public quota fields. */
export default function UsagePage({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(Date.now);
  const config = usageConfigSchema.safeParse(snapshot.config.value);
  const automatic = config.success ? config.data.refreshIntervalSeconds : 0;
  const operation = snapshot.operation;
  const running = operation?.phase === "running" || operation?.phase === "cancelling";
  const result = usageState(snapshot);
  const current = result?.status === "ready" ? result.data : null;
  const capturedAt = current?.capturedAt;
  const failed = result?.status === "error" ? result : null;
  const unavailable =
    ["invalid", "future-version", "unavailable"].includes(snapshot.config.health) ||
    snapshot.phase === "error";
  const busy = pending || running || snapshot.phase === "starting" || snapshot.phase === "stopping";
  useEffect(() => {
    if (capturedAt === undefined) return;
    // Display freshness only; this timer never starts a source read or network request.
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [capturedAt]);
  async function refresh(enable = false) {
    setPending(true);
    setMessage("");
    try {
      if (enable) {
        const activated = await window.codexCoco.enableModule({ moduleId: "usage", enabled: true });
        if (!activated.ok) {
          setMessage(activated.error.message);
          return;
        }
        acceptModuleSnapshot(activated.value);
      }
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "usage",
        operation: "refresh",
        input: { forceTrend: true },
      });
      if (response.ok) acceptModuleSnapshot(response.value);
      else setMessage(response.error.message);
    } catch {
      setMessage("用量服务连接失败，请重新打开窗口后重试。");
    } finally {
      setPending(false);
    }
  }
  async function cancel() {
    if (!operation) return;
    setPending(true);
    try {
      const response = await window.codexCoco.cancelModuleOperation({
        moduleId: "usage",
        operationId: operation.id,
      });
      if (response.ok) acceptModuleSnapshot(response.value);
      else setMessage(response.error.message);
    } catch {
      setMessage("取消请求未完成，请重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="usage-page">
      <header className="desktop-page-heading">
        <h2>用量</h2>
        <p>查看本机 Codex CLI 登录的 ChatGPT 订阅额度。</p>
      </header>
      {snapshot.phase === "running" && (
        <div className="usage-toolbar">
          <Button
            disabled={busy || unavailable}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw data-icon="inline-start" />
            {failed ? "重新读取" : "刷新用量"}
          </Button>
          {running && (
            <Button
              variant="outline"
              disabled={pending || operation?.phase === "cancelling"}
              onClick={() => {
                void cancel();
              }}
            >
              {operation?.name === "refresh" ? "取消读取" : "取消任务"}
            </Button>
          )}
          <output aria-live="polite">
            {running
              ? operation?.phase === "cancelling"
                ? "正在取消读取…"
                : operation?.name === "refresh"
                  ? "正在读取额度…"
                  : "正在处理辅助任务…"
              : operation?.phase === "cancelled"
                ? "任务已取消，已读取的数据已保留。"
                : automatic > 0
                  ? `已开启自动刷新，间隔 ${automatic} 秒；失败时会延长。`
                  : "手动刷新，不在后台轮询。"}
          </output>
        </div>
      )}
      <UsagePreferences snapshot={snapshot} />
      {message && (
        <Alert variant="destructive">
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {unavailable ? (
        <Alert variant="destructive">
          <AlertTitle>用量模块需要处理</AlertTitle>
          <AlertDescription>请在模块管理中检查运行状态或恢复配置，然后重试。</AlertDescription>
        </Alert>
      ) : snapshot.phase !== "running" ? (
        <Empty className="desktop-module-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Activity aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>按需读取用量</EmptyTitle>
            <EmptyDescription>
              启用后通过本机 Codex CLI 读取订阅额度。Codex Coco
              不接收或保存登录令牌；默认仅手动读取，可在下方设置中开启自动刷新，不会创建对话。
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              disabled={busy}
              onClick={() => {
                void refresh(true);
              }}
            >
              启用并读取用量
            </Button>
          </EmptyContent>
        </Empty>
      ) : running &&
        operation?.name === "refresh" &&
        (!result || result.status === "tools" || result.status === "source") ? (
        <div className="usage-loading" aria-label="正在读取用量">
          <p>正在等待 Codex CLI 返回额度，读取完成后这里会更新。</p>
        </div>
      ) : failed ? (
        <>
          <Alert variant="destructive">
            <AlertTitle>{usageFailures[failed.reason].title}</AlertTitle>
            <AlertDescription>
              <p>{usageFailures[failed.reason].recovery}</p>
              <p>检查于 {dateTime(failed.checkedAt)}</p>
            </AlertDescription>
          </Alert>
          {failed.previous && (
            <details className="usage-previous">
              <summary>查看上次成功记录（非当前状态）</summary>
              <p>这是上次读取的记录，可能属于此前的登录，不代表当前账号状态。</p>
              <QuotaData data={failed.previous} />
            </details>
          )}
        </>
      ) : result?.status === "local" ? (
        <>
          <Alert variant={result.reason ? "destructive" : "default"}>
            <AlertTitle>
              {result.reason ? usageFailures[result.reason].title : "本地统计已更新"}
            </AlertTitle>
            <AlertDescription>
              本机历史记录不代表当前服务额度；请恢复连接后刷新确认。
            </AlertDescription>
          </Alert>
          {result.data && (
            <details className="usage-previous">
              <summary>查看本机历史额度（非当前服务状态）</summary>
              <QuotaData data={result.data} />
            </details>
          )}
        </>
      ) : current ? (
        <>
          {(now - current.capturedAt > 10 * 60_000 ||
            current.buckets.some((bucket) =>
              bucket.windows.some(
                (window) => window.resetsAt !== null && window.resetsAt * 1000 <= now,
              ),
            )) && (
            <Alert>
              <AlertTitle>请刷新确认当前额度</AlertTitle>
              <AlertDescription>
                记录已超过 10 分钟或恢复时间已到，下方数值仍是上次读取的记录。
              </AlertDescription>
            </Alert>
          )}
          <QuotaData data={current} trend={result?.trend ?? null} />
        </>
      ) : (
        <Empty className="desktop-module-empty">
          <EmptyHeader>
            <EmptyTitle>
              {operation?.phase === "cancelled"
                ? "读取已取消"
                : operation?.phase === "failed"
                  ? "读取未完成"
                  : "准备读取额度"}
            </EmptyTitle>
            <EmptyDescription>
              点击上方“刷新用量”获取当前记录。只读取额度窗口，不读取对话内容。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <UsageResetCards snapshot={snapshot} />
      <UsageTrend snapshot={snapshot} />
      <UsageToolsPanel snapshot={snapshot} />
    </div>
  );
}
