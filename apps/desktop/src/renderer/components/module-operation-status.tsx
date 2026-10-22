import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import type { ModuleSnapshot } from "../../contracts/modules";
import { acceptModuleSnapshot } from "../client/modules";

const labels: Record<string, string> = {
  "launch-application": "启动并应用布景",
  "restart-application": "重启并应用布景",
  apply: "应用布景",
  remove: "撤销布景",
  verify: "验证布景",
  inspect: "检查连接",
  "import-image": "导入图片",
  "choose-application": "选择应用",
  "list-models": "读取模型目录",
  "run-intelligence": "样本检测",
  "update-cli": "更新 CLI",
  "load-intelligence-history": "读取检测历史",
  "clear-intelligence-history": "清空检测历史",
  "inspect-cli": "检查 CLI",
  "scan-local": "扫描本机用量",
  "import-tray-icon": "导入菜单栏图标",
  "inspect-system": "检查系统状态",
  "apply-login": "应用开机启动设置",
  "apply-sharing": "应用共享设置",
  "choose-shared-directory": "选择共享目录",
};
/** Shared task feedback stays visible across module tabs; only fixed operation names are presented. */
export function ModuleOperationStatus({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<{ id: string; message: string } | null>(null);
  const task = snapshot.operation;
  if (!task || task.phase === "succeeded" || !labels[task.name]) return null;
  const running = task.phase === "running" || task.phase === "cancelling";
  async function cancel() {
    if (!task) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await window.codexCoco.cancelModuleOperation({
        moduleId: snapshot.id,
        operationId: task.id,
      });
      if (result.ok) acceptModuleSnapshot(result.value);
      else setFailure({ id: task.id, message: result.error.message });
    } catch {
      setFailure({ id: task.id, message: "停止请求未完成，请重试。" });
    } finally {
      setPending(false);
    }
  }
  return (
    <Alert
      variant={task.phase === "failed" ? "destructive" : "default"}
      className="mb-4"
      aria-label={`${snapshot.title}操作状态`}
    >
      <AlertTitle>
        {labels[task.name]}
        {task.phase === "failed" ? "未完成" : task.phase === "cancelled" ? "已取消" : "进行中"}
      </AlertTitle>
      <AlertDescription>
        <output aria-live="polite">
          {(failure?.id === task.id ? failure.message : "") ||
            (task.phase === "cancelling"
              ? "正在停止操作，请稍候。"
              : task.phase === "failed"
                ? "操作未能完成，可以重试；已保存设置仍然保留。"
                : task.phase === "cancelled"
                  ? "操作已停止，可以继续调整设置或重新操作。"
                  : task.progress > 0
                    ? `当前进度 ${Math.round(task.progress)}%`
                    : "正在处理，完成后会自动更新。")}
        </output>
        {running && (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || task.phase === "cancelling"}
            onClick={() => {
              void cancel();
            }}
          >
            停止当前操作
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
