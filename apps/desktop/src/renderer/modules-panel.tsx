import { Suspense, useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import type { ModuleSnapshot } from "../contracts/modules";
import { useModules, acceptModuleSnapshot } from "./client/modules";
import { modulePages } from "./module-pages";

function ModulePanel({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const Page = Object.hasOwn(modulePages, snapshot.id) ? modulePages[snapshot.id] : undefined;
  const unavailable = ["invalid", "future-version", "unavailable"].includes(snapshot.config.health);
  async function control(reset: boolean) {
    setBusy(true);
    try {
      const result = reset
        ? await window.codexCoco.resetModuleConfig({ moduleId: snapshot.id })
        : await window.codexCoco.enableModule({
            moduleId: snapshot.id,
            enabled: !snapshot.config.enabled,
          });
      if (result.ok) {
        acceptModuleSnapshot(result.value);
        setMessage(reset ? "模块配置已备份并恢复。" : "模块启停请求已完成。");
      } else setMessage(result.error.message);
    } catch {
      setMessage("模块服务连接失败，请重新打开窗口。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={snapshot.title} className="flex flex-col gap-4">
      <h3>{snapshot.title}</h3>
      <p className="text-muted-foreground">
        期望：{snapshot.config.enabled ? "启用" : "停用"}；运行阶段：{snapshot.phase}；运行代次：
        {snapshot.generation}
      </p>
      {(unavailable || snapshot.error) && (
        <Alert variant="destructive">
          <AlertTitle>模块需要处理</AlertTitle>
          <AlertDescription>
            {unavailable
              ? snapshot.config.health === "unavailable"
                ? "无法读取模块配置，请检查目录和权限；原文件未被覆盖。"
                : "配置损坏或来自更新版本，原文件已保留。"
              : `资源状态：${snapshot.error}`}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={busy || unavailable}
          onClick={() => {
            void control(false);
          }}
        >
          {snapshot.config.enabled ? "停用模块" : "启用模块"}
        </Button>
        {unavailable && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void control(true);
            }}
          >
            备份并恢复模块配置
          </Button>
        )}
      </div>
      <output aria-live="polite" className="text-muted-foreground">
        {message}
      </output>
      {Page && (
        <Suspense fallback={<p>正在载入模块验证区…</p>}>
          <Page snapshot={snapshot} />
        </Suspense>
      )}
    </section>
  );
}

/** Temporary host surface; absent in normal launches while the business registry is empty. */
export function ModulesPanel() {
  const modules = useModules();
  if (!modules.length) return null;
  return (
    <section aria-labelledby="modules-title" className="flex flex-col gap-6">
      <h2 id="modules-title">模块链路验证</h2>
      <p className="text-muted-foreground">仅验证合成任务、取消与配置；这里不是正式业务页面。</p>
      {modules.map((snapshot) => (
        <ModulePanel key={snapshot.id} snapshot={snapshot} />
      ))}
    </section>
  );
}
