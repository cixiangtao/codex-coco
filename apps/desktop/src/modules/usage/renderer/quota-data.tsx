import { Clock3, UserRound } from "lucide-react";
import { Badge } from "@codex-coco/ui/components/badge";
import { Box } from "@codex-coco/ui/components/box";
import { Card, CardHeader, CardTitle, CardContent } from "@codex-coco/ui/components/card";
import { ProgressRing } from "@codex-coco/ui/components/progress-ring";
import { recoveryLabel, shortDateTime } from "../../../renderer/lib/presentation-time";
import {
  remainingPercent,
  usageBucketTitle,
  usageWindowTitle,
  usagePlanTitle,
  type UsageSnapshot,
} from "../contract";

export const dateTime = shortDateTime;

export function UsageAccount({ data }: { data: UsageSnapshot }) {
  return (
    <div aria-label="账号信息" className="usage-account">
      <UserRound aria-hidden="true" />
      <span>{data.account?.label ?? "账号标识不可用"}</span>
      <Badge tone="primary">{usagePlanTitle(data.account?.plan)}</Badge>
    </div>
  );
}

export function QuotaData({
  data,
  historical = false,
  showAccount = true,
  now = data.capturedAt,
}: {
  data: UsageSnapshot;
  historical?: boolean;
  showAccount?: boolean;
  now?: number;
}) {
  return (
    <Box className="usage-data" gap="md">
      <div className="usage-quota-heading">
        <h3>{historical ? "历史额度记录" : "订阅额度"}</h3>
        {showAccount && <UsageAccount data={data} />}
      </div>
      {data.credits && (
        <p aria-label="额外额度" className="usage-source">
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
      {data.buckets.map((bucket, index) => (
        <section
          className="usage-bucket"
          key={bucket.id}
          aria-label={usageBucketTitle(bucket.id, index)}
        >
          {data.buckets.length > 1 && <h3>{usageBucketTitle(bucket.id, index)}</h3>}
          <div className="usage-quota-grid">
            {bucket.windows.map((window, windowIndex) => {
              const remaining = remainingPercent(window.usedPercent);
              const tone = historical
                ? "neutral"
                : remaining <= 5
                  ? "warning"
                  : windowIndex === 0
                    ? "primary"
                    : "success";
              return (
                <Card
                  key={window.kind}
                  tone={tone}
                  className="usage-quota-card"
                  aria-label={usageWindowTitle(window)}
                >
                  <CardHeader>
                    <CardTitle>{usageWindowTitle(window)}</CardTitle>
                    <Badge>
                      {historical ? "历史记录" : `已用 ${Number(window.usedPercent.toFixed(1))}%`}
                    </Badge>
                  </CardHeader>
                  <CardContent className="usage-quota-content">
                    <ProgressRing
                      value={remaining}
                      label={`${usageBucketTitle(bucket.id, index)} · ${usageWindowTitle(window)}`}
                      valuePrefix="剩余"
                      caption="剩余额度"
                      tone={tone}
                      animated={!historical}
                    />
                    <Box gap="sm" className="usage-quota-detail">
                      <span>额度恢复</span>
                      <strong>
                        {historical
                          ? "以当前读取为准"
                          : recoveryLabel(
                              window.resetsAt === null ? null : window.resetsAt * 1000,
                              now,
                            )}
                      </strong>
                      <div>
                        <Clock3 aria-hidden="true" />
                        {window.resetsAt === null ? (
                          <span>恢复时间未知</span>
                        ) : (
                          <span>
                            <time dateTime={new Date(window.resetsAt * 1000).toISOString()}>
                              {dateTime(window.resetsAt * 1000)}
                            </time>{" "}
                          </span>
                        )}
                      </div>
                    </Box>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
      <p className="usage-source">
        读取于{" "}
        <time dateTime={new Date(data.capturedAt).toISOString()}>{dateTime(data.capturedAt)}</time>{" "}
        · {data.source === "local-session" ? "本机会话历史记录" : "Codex CLI"}
      </p>
    </Box>
  );
}
