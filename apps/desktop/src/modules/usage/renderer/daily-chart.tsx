import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@codex-coco/ui/components/tooltip";
import { formatTokens, formatExactTokens } from "../../../renderer/lib/token-format";
import type { TrendSnapshot } from "../contract";

/** Hover and focus inspect the same public daily totals; neither starts a source read. */
export function UsageDailyChart({
  points,
  source,
}: {
  points: TrendSnapshot["points"];
  source: TrendSnapshot["source"];
}) {
  const peak = Math.max(0, ...points.map((point) => point.tokens));
  const maximum = Math.max(1, peak);
  const total = points.reduce((sum, point) => sum + point.tokens, 0);
  return (
    <>
      <div className="usage-chart-wrap">
        <div className="usage-chart-axis" aria-hidden="true">
          <span>{formatTokens(peak)}</span>
          <span>0</span>
        </div>
        <TooltipProvider delay={100}>
          <section className="usage-chart h-32" aria-label="每日用量柱状图">
            {points.map((point, index) => (
              <Tooltip key={point.day}>
                <TooltipTrigger
                  className="usage-chart-point"
                  aria-label={`${point.day} · ${formatExactTokens(point.tokens)} tokens`}
                >
                  <span
                    className="usage-chart-bar"
                    data-last={index === points.length - 1}
                    style={{ transform: `scaleY(${point.tokens / maximum})` }}
                    aria-hidden="true"
                  />
                </TooltipTrigger>
                <TooltipContent variant="data" sideOffset={8}>
                  <div className="usage-chart-tooltip">
                    <div className="usage-chart-tooltip-heading">
                      <span className="usage-chart-tooltip-dot" aria-hidden="true" />
                      <time dateTime={point.day}>{point.day.replaceAll("-", "/")}</time>
                      <span>本机计数</span>
                    </div>
                    <div className="usage-chart-tooltip-value">
                      <strong>{formatTokens(point.tokens)}</strong>
                      <span>tokens</span>
                    </div>
                    <dl>
                      <div>
                        <dt>精确计数</dt>
                        <dd>{formatExactTokens(point.tokens)}</dd>
                      </div>
                      <div>
                        <dt>范围占比</dt>
                        <dd>
                          {total > 0
                            ? `${Number(((point.tokens / total) * 100).toFixed(1))}%`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p>
                      {source === "thread-totals"
                        ? "按线程创建日归集的累计估算"
                        : "本机记录 · 含无归属计数"}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            ))}
          </section>
        </TooltipProvider>
      </div>
      <div
        className="usage-chart-dates"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {points.map((point, index) => (
          <span key={point.day}>
            {index === 0 ||
            index === points.length - 1 ||
            (index % Math.ceil(points.length / 5) === 0 && index < points.length - 2)
              ? point.day.slice(5).replace("-", "/")
              : ""}
          </span>
        ))}
      </div>
      <details className="usage-data-details">
        <summary>查看每日计数</summary>
        <table className="w-full text-left text-sm">
          <caption className="sr-only">本机每日 token 计数</caption>
          <thead>
            <tr>
              <th scope="col">日期</th>
              <th scope="col">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {points.map((point) => (
              <tr key={point.day}>
                <th scope="row">{point.day}</th>
                <td>
                  <strong>{formatTokens(point.tokens)}</strong>
                  <span className="usage-exact-count">{formatExactTokens(point.tokens)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
