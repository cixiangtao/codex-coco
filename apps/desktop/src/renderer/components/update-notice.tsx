import { useEffect, useState } from "react";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import { Button } from "@codex-coco/ui/components/button";
import type { UpdateAction, UpdateSnapshot } from "../../contracts/updates";

/** Keeps discovered updates visible across main-window pages; restart requires the explicit button. */
export function UpdateNotice() {
  const [state, setState] = useState<UpdateSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    const off = window.codexCoco.onUpdatesChanged((value) => {
      if (live) setState(value);
    });
    void window.codexCoco
      .updates()
      .then((result) => {
        if (live && result.ok) setState(result.value);
      })
      .catch(() => undefined);
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!state?.availableVersion) return null;
  const busy =
    pending || ["checking", "downloading", "cancelling", "installing"].includes(state.phase);
  async function run(action: UpdateAction) {
    setPending(true);
    setMessage("");
    try {
      const result = await window.codexCoco.updateAction(action);
      if (result.ok) setState(result.value);
      else setMessage(result.error.message);
    } catch {
      setMessage("更新服务不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <Alert
      className="desktop-recovery sticky top-0 z-20"
      variant={state.phase === "error" ? "destructive" : "default"}
    >
      <AlertTitle>
        {state.phase === "downloading"
          ? `正在下载更新 ${state.progress ?? 0}%`
          : state.phase === "installing"
            ? "正在安装并重启 Codex Coco"
            : state.phase === "cancelling"
              ? "正在取消更新"
              : state.phase === "error"
                ? "更新未完成，可以重试"
                : `Codex Coco ${state.availableVersion} 可用`}
      </AlertTitle>
      <AlertDescription>
        <p>点击更新会下载、校验并重启，请先保存工作。</p>
        <div className="flex flex-wrap gap-3">
          {state.installSupported ? (
            <Button
              disabled={busy}
              onClick={() => {
                void run({
                  action: state.phase === "downloaded" ? "install" : "update",
                  confirmed: true,
                });
              }}
            >
              {state.phase === "downloaded" ? "重启完成更新" : "更新并重启"}
            </Button>
          ) : (
            <Button
              disabled={busy}
              onClick={() => {
                void run({ action: "open-release" });
              }}
            >
              查看下载页面
            </Button>
          )}
          {["checking", "downloading"].includes(state.phase) && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => {
                void run({ action: "cancel" });
              }}
            >
              取消更新
            </Button>
          )}
        </div>
        {message && <output aria-live="polite">{message}</output>}
      </AlertDescription>
    </Alert>
  );
}
