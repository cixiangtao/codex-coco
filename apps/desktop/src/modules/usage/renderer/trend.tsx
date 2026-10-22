import { UsageDailyChart } from "./daily-chart";
import { formatTokens, formatExactTokens } from "../../../renderer/lib/token-format";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@codex-coco/ui/components/card";
import { Box } from "@codex-coco/ui/components/box";
import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import type { ModuleSnapshot } from "../../../contracts/modules";
import { acceptModuleSnapshot } from "../../../renderer/client/modules";
import { usageConfigSchema, usageState, trendTotals, type TrendSnapshot } from "../contract";

export function UsageTokenSummary({ trend }: { trend: TrendSnapshot }) {
  const totals = trendTotals(trend);
  return (
    <div className="usage-token-card">
      <dl className="usage-token-summary" aria-label="用量统计摘要">
        {(
          [
            ["今日估算", totals.today],
            ["近 7 天", totals.week],
            ["近 30 天", totals.month],
          ] as const
        ).map(([label, value], index) => (
          <div
            key={label}
            data-tone={index === 0 ? "primary" : index === 1 ? "success" : "warning"}
          >
            <dt>
              <span aria-hidden="true" />
              {label}
            </dt>
            <dd title={`${formatExactTokens(value)} tokens`}>
              <strong>{trend.source === "none" ? "暂无数据" : formatTokens(value)}</strong>
              {trend.source !== "none" && <span>tokens</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Local activity is explicitly read and labeled; no messages or account identifiers enter this view. */
export function UsageTrend({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const config = usageConfigSchema.safeParse(snapshot.config.value);
  const state = usageState(snapshot);
  const trend = state ? state.trend : null;
  const busy =
    pending ||
    snapshot.operation?.phase === "running" ||
    snapshot.operation?.phase === "cancelling";
  const enabled = snapshot.phase === "running";
  const days = config.success ? config.data.trendDays : 30;
  const points = trend?.points.slice(-days) ?? [];
  const total = points.reduce((sum, point) => sum + point.tokens, 0);
  async function run(operation: string, input: Record<string, boolean> = {}) {
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "usage",
        operation,
        input,
      });
      if (response.ok) acceptModuleSnapshot(response.value);
      else setMessage(response.error.message);
    } catch {
      setMessage("本地统计未能开始，请重试。");
    } finally {
      setPending(false);
    }
  }
  async function range(days: number) {
    if (!config.success) return;
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.saveModuleConfig({
        moduleId: "usage",
        expectedRevision: snapshot.config.revision,
        value: { ...config.data, trendDays: days },
      });
      if (response.ok) acceptModuleSnapshot(response.value);
      else setMessage(response.error.message);
    } catch {
      setMessage("日期范围未能保存。");
    } finally {
      setPending(false);
    }
  }
  return (
    <Box gap="lg">
      <Card aria-label="本地用量趋势" className="usage-trend-card">
        <CardHeader>
          <div>
            <CardTitle>每日用量</CardTitle>
            <p className="usage-source">本机计数 · 含无归属记录</p>
          </div>
          <ToggleGroup
            aria-label="趋势日期范围"
            value={[String(days)]}
            disabled={busy}
            onValueChange={(values) => {
              const next = Number(values[0]);
              if ([7, 14, 30].includes(next)) void range(next);
            }}
            className="usage-range"
          >
            <ToggleGroupItem value="7">7 天</ToggleGroupItem>
            <ToggleGroupItem value="14">14 天</ToggleGroupItem>
            <ToggleGroupItem value="30">30 天</ToggleGroupItem>
          </ToggleGroup>
        </CardHeader>
        <CardContent>
          <Box gap="md">
            {trend && <UsageTokenSummary trend={trend} />}
            {message && <output aria-live="polite">{message}</output>}
            {snapshot.operation?.name === "scan-trend" && busy && (
              <output aria-live="polite">
                正在扫描 {Math.round(snapshot.operation.progress)}%
              </output>
            )}
            {snapshot.operation?.name === "scan-trend" && snapshot.operation.phase === "failed" && (
              <Alert variant="destructive">
                <AlertTitle>本地统计未完成</AlertTitle>
                <AlertDescription>
                  请检查记录目录和权限后重试。损坏记录不会作为正常用量显示。
                </AlertDescription>
              </Alert>
            )}
            {snapshot.operation?.name === "choose-local-home" &&
              snapshot.operation.phase === "failed" && (
                <Alert variant="destructive">
                  <AlertTitle>Codex 数据目录未能更新</AlertTitle>
                  <AlertDescription>
                    请选择 Codex 数据目录，而非 sessions
                    子目录，并检查读取权限。此前的目录设置已保留。
                  </AlertDescription>
                </Alert>
              )}
            {trend?.source === "thread-totals" && (
              <Alert>
                <AlertTitle>当前展示线程累计量</AlertTitle>
                <AlertDescription>
                  按线程创建日期归集累计
                  tokens，这是估算分布，不代表实际每日消耗，也无法确认当前账号归属。
                </AlertDescription>
              </Alert>
            )}
            {trend?.limited && (
              <Alert variant="destructive">
                <AlertTitle>统计结果不完整</AlertTitle>
                <AlertDescription>
                  部分文件不可读或达到扫描限制，下方只表示成功读取的记录。可检查目录后重建索引。
                </AlertDescription>
              </Alert>
            )}
            {trend && trend.source !== "none" ? (
              <UsageDailyChart points={points} source={trend.source} />
            ) : (
              <div className="usage-chart-empty">
                <p>
                  {trend
                    ? "所选范围内没有可统计的计数记录，不代表实际用量为零。"
                    : "刷新额度后更新本机计数，也可手动扫描。"}
                </p>
                <Button
                  variant="outline"
                  disabled={!enabled || busy}
                  onClick={() => {
                    void run("scan-trend", { force: false });
                  }}
                >
                  扫描本机用量
                </Button>
              </div>
            )}
          </Box>
        </CardContent>
        {trend && trend.source !== "none" && (
          <CardFooter className="usage-trend-footer">
            <span>
              {days} 天 · {formatTokens(total)} tokens
            </span>
            {trend && (
              <time dateTime={new Date(trend.capturedAt).toISOString()}>
                {new Date(trend.capturedAt).toLocaleString("zh-CN", {
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                统计
              </time>
            )}
          </CardFooter>
        )}
        <details className="usage-data-details">
          <summary>数据来源与维护</summary>
          <Box gap="md" className="pt-3">
            <p className="usage-source">
              仅提取本机 Codex 记录中的计数，不展示或上传对话。没有账号归属的记录可能来自这台 Mac
              上使用过的其他账号。
            </p>
            {trend && (
              <p className="usage-source">
                {trend.scope === "current-account-and-unassigned"
                  ? "已排除可识别的其他账号，仍包含无归属记录。"
                  : "尚未关联当前账号，展示此目录的本机记录。"}{" "}
                无归属 tokens：{formatTokens(trend.unassignedTokens)}。扫描 {trend.scannedFiles}{" "}
                个文件，复用 {trend.reusedFiles} 个索引。
              </p>
            )}
            <p className="usage-source">
              额度、模型与本地统计使用同一 Codex 数据目录。切换目录后请刷新用量；请选择包含
              sessions、config.toml 或登录数据的目录。
            </p>
            <div className="flex flex-wrap gap-2">
              {trend && trend.source !== "none" && (
                <Button
                  variant="outline"
                  disabled={!enabled || busy}
                  onClick={() => {
                    void run("scan-trend", { force: false });
                  }}
                >
                  扫描本机用量
                </Button>
              )}
              <Button
                variant="outline"
                disabled={!enabled || busy}
                onClick={() => {
                  void run("scan-trend", { force: true });
                }}
              >
                重建本地索引
              </Button>
              <Button
                variant="outline"
                disabled={!enabled || busy}
                onClick={() => {
                  void run("choose-local-home");
                }}
              >
                选择 Codex 数据目录
              </Button>
            </div>
          </Box>
        </details>
      </Card>
    </Box>
  );
}
