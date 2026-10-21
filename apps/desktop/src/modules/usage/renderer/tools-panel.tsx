import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@codex-coco/ui/components/dialog";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import type { ModuleSnapshot } from "../../../contracts/modules";
import { acceptModuleSnapshot } from "../../../renderer/client/modules";
import { usageState } from "../contract";

const failures = {
  MODELS_UNAVAILABLE: "模型列表不可用，请刷新列表或检查登录与 CLI 版本。",
  SAMPLE_FAILED: "部分样本未完成，请检查模型访问权限与 CLI 状态。",
  HISTORY_INVALID: "检测历史无法读取，原文件已保留；可以备份并清空后重试。",
  CLI_UNAVAILABLE: "CLI 或版本信息不可用，请检查安装和网络。",
  UPDATE_FAILED: "CLI 更新未完成，请按原安装方式检查后重试。",
};
/** Explicit paid samples remain separate from quota polling and never run on page load. */
export function UsageToolsPanel({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [runs, setRuns] = useState(3);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState<
    "run-intelligence" | "update-cli" | "clear-intelligence-history" | null
  >(null);
  const state = usageState(snapshot);
  const tools = state ? state.tools : null;
  const selected = tools?.models.find((value) => value.id === model);
  const busy =
    pending ||
    snapshot.phase !== "running" ||
    snapshot.operation?.phase === "running" ||
    snapshot.operation?.phase === "cancelling";
  async function run(operation: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "usage",
        operation,
        input: operation === "run-intelligence" ? { model, effort, runs } : {},
      });
      if (response.ok) acceptModuleSnapshot(response.value);
      else setMessage(response.error.message);
    } catch {
      setMessage("辅助工具请求未完成，请重试。");
    } finally {
      setPending(false);
    }
  }
  const completed = tools?.samples.filter((value) => value.correct !== null) ?? [];
  const correct = completed.filter((value) => value.correct).length;
  return (
    <details>
      <summary>样本检测与 CLI 维护</summary>
      <div className="flex flex-col gap-5 py-5">
        <p className="text-muted-foreground">
          固定糖果题的重复样本检测会消耗模型额度，仅由你明确开始。结果用于对比本次样本，不能代表模型整体能力；少量错误不等于降智。
        </p>
        {tools?.error && (
          <Alert variant="destructive">
            <AlertTitle>辅助工具需要检查</AlertTitle>
            <AlertDescription>{failures[tools.error]}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run("list-models");
            }}
          >
            读取可用模型
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run("load-intelligence-history");
            }}
          >
            读取检测历史
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void run("check-cli");
            }}
          >
            检查 CLI 版本
          </Button>
        </div>
        <FieldGroup>
          <Field>
            <FieldLabel>检测模型</FieldLabel>
            <ToggleGroup
              aria-label="检测模型"
              value={[model ?? "default"]}
              onValueChange={(values) => {
                if (values.length) {
                  setModel(values[0] === "default" ? null : values[0]!);
                  setEffort(null);
                }
              }}
              variant="outline"
            >
              <ToggleGroupItem value="default">CLI 默认</ToggleGroupItem>
              {tools?.models.map((value) => (
                <ToggleGroupItem key={value.id} value={value.id}>
                  {value.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              检测忽略用户配置，使用所选模型或 CLI 内置默认模型；不会接入用户的
              MCP、应用或项目上下文。
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel>推理强度</FieldLabel>
            <ToggleGroup
              aria-label="检测推理强度"
              value={[effort ?? "default"]}
              onValueChange={(values) => {
                if (values.length) setEffort(values[0] === "default" ? null : values[0]!);
              }}
              variant="outline"
            >
              <ToggleGroupItem value="default">默认</ToggleGroupItem>
              {selected?.efforts.map((value) => (
                <ToggleGroupItem key={value} value={value}>
                  {value}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="intelligence-runs">样本次数（1–5）</FieldLabel>
            <Input
              id="intelligence-runs"
              type="number"
              min={1}
              max={5}
              value={Number.isNaN(runs) ? "" : runs}
              onChange={(event) => setRuns(event.target.valueAsNumber)}
            />
          </Field>
        </FieldGroup>
        <Button
          disabled={busy || !Number.isInteger(runs) || runs < 1 || runs > 5}
          onClick={() => setConfirm("run-intelligence")}
        >
          开始样本检测
        </Button>
        {snapshot.operation?.name === "run-intelligence" &&
          snapshot.operation.phase === "running" && (
            <output aria-live="polite">
              检测进度 {Math.round(snapshot.operation.progress)}%，每个样本最多等待 120 秒。
            </output>
          )}
        {tools && tools.samples.length > 0 && (
          <>
            <p>
              已完成 {completed.length}/{tools.requestedRuns ?? tools.samples.length} 个样本，正确{" "}
              {correct} 个，正确率{" "}
              {completed.length ? Math.round((correct / completed.length) * 100) : 0}%。
            </p>
            {tools.samples.map((sample) => (
              <details key={sample.index}>
                <summary>
                  样本 {sample.index} ·{" "}
                  {sample.correct === null ? "未完成" : sample.correct ? "通过" : "未通过"} ·{" "}
                  {(sample.elapsedMs / 1000).toFixed(1)} 秒
                </summary>
                <p>
                  答案：{sample.answer ?? "未知"} · 输入 {sample.inputTokens ?? "未知"} / 输出{" "}
                  {sample.outputTokens ?? "未知"} / 推理 {sample.reasoningTokens ?? "未知"} tokens
                </p>
                <p className="whitespace-pre-wrap">{sample.explanation}</p>
              </details>
            ))}
          </>
        )}
        {tools && tools.history.length > 0 && (
          <details>
            <summary>最近 {tools.history.length} 条检测历史</summary>
            <ul className="flex flex-col gap-3">
              {tools.history.map((entry) => (
                <li key={entry.id}>
                  {new Date(entry.capturedAt).toLocaleString("zh-CN")} · {entry.model} ·{" "}
                  {entry.effort ?? "默认"} · {entry.correct}/{entry.completed} 通过 ·{" "}
                  {entry.averageTokensPerSecond === null
                    ? "速度未知"
                    : `${entry.averageTokensPerSecond.toFixed(1)} tokens/s`}
                </li>
              ))}
            </ul>
          </details>
        )}
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirm("clear-intelligence-history")}
        >
          备份并清空检测历史
        </Button>
        <p>
          Codex CLI：{tools?.cliVersion ?? "尚未检查"} · 最新稳定版：
          {tools?.latestCliVersion ?? "尚未获取"}
        </p>
        <p className="text-muted-foreground">
          安装方式：
          {
            (
              {
                unknown: "未识别",
                standalone: "独立安装",
                "package-manager": "包管理器",
                homebrew: "Homebrew",
              } as const
            )[tools?.installation ?? "unknown"]
          }
          。更新使用 CLI 自带命令，不调用任意 shell 脚本。
        </p>
        <Button
          variant="outline"
          disabled={busy || !tools?.cliVersion}
          onClick={() => setConfirm("update-cli")}
        >
          更新 Codex CLI
        </Button>
        {message && <output aria-live="polite">{message}</output>}
      </div>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "run-intelligence"
                ? "开始消耗额度的样本检测？"
                : confirm === "update-cli"
                  ? "更新已安装的 Codex CLI？"
                  : "备份并清空检测历史？"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "run-intelligence"
                ? `将运行 ${runs} 个固定题目样本，使用临时目录和临时会话，不操作项目文件。`
                : confirm === "update-cli"
                  ? "将调用已安装 CLI 自带的 update 命令，可能下载并替换该 CLI。完成后会再次读取版本。"
                  : "原历史文件会先备份，之后清空当前列表。"}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const operation = confirm;
                setConfirm(null);
                if (operation) void run(operation);
              }}
            >
              确认执行
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </details>
  );
}
