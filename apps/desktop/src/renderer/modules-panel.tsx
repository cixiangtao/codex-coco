import { Suspense, useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import type { ModuleSnapshot } from "../contracts/modules";
import { useModules, acceptModuleSnapshot } from "./client/modules";
import { modulePages } from "./module-pages";
import { navigation } from "./shell/navigation";

function ModulePanel({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const Page =
    snapshot.id !== "desktop-tools" &&
    !navigation.some((item) => item.id === snapshot.id && item.group === "primary") &&
    Object.hasOwn(modulePages, snapshot.id)
      ? modulePages[snapshot.id]
      : undefined;
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
        {
          {
            disabled: "已停用",
            starting: "启动中",
            running: "已启用",
            stopping: "停止中",
            error: "需要处理",
          }[snapshot.phase]
        }
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

/** Primary module pages live in navigation; other registered pages may render their controls here. */
export function ModulesPanel() {
  const modules = useModules();
  if (!modules.length) return null;
  return (
    <section aria-labelledby="modules-title" className="flex flex-col gap-6">
      <h2 id="modules-title">已接入的模块</h2>
      {modules.map((snapshot) => (
        <ModulePanel key={snapshot.id} snapshot={snapshot} />
      ))}
    </section>
  );
}

export function RegisteredModulePage({ moduleId }: { moduleId: string }) {
  const snapshot = useModules().find((item) => item.id === moduleId);
  const Page = Object.hasOwn(modulePages, moduleId) ? modulePages[moduleId] : undefined;
  return snapshot && Page ? (
    <Suspense fallback={<p>正在载入模块页面…</p>}>
      <Page snapshot={snapshot} />
    </Suspense>
  ) : (
    <p>模块页面暂时不可用，请重新打开窗口。</p>
  );
}
