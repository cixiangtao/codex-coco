import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@codex-coco/ui/components/dialog";
import type { ModuleSnapshot } from "../../../contracts/modules";
import { acceptModuleSnapshot } from "../../../renderer/client/modules";
import { usageResultSchema } from "../contract";

const outcomes = {
  reset: "重置卡已兑换",
  alreadyRedeemed: "此兑换此前已完成",
  nothingToReset: "当前没有可重置的额度窗口",
  noCredit: "服务确认没有可用重置卡",
  pending: "兑换结果尚未确认",
  rejected: "兑换未能发起",
};
/** A mutation is always explicit. Retry uses the durable attempt key instead of creating another. */
export function UsageResetCards({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const parsed = usageResultSchema.safeParse(snapshot.operation?.result);
  const state = parsed.success ? parsed.data : null;
  const credits = state?.status === "ready" ? state.data.resetCredits : null;
  const feedback = state?.reset;
  const busy =
    pending ||
    snapshot.phase !== "running" ||
    snapshot.operation?.phase === "running" ||
    snapshot.operation?.phase === "cancelling";
  async function run(operation: string, input: Record<string, string | null> = {}) {
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
      setMessage("请求未能确认。请检查上次兑换，避免重复发起。");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="flex flex-col gap-3" aria-label="重置卡">
      <h3>重置卡</h3>
      {credits ? (
        <>
          <p>服务可用重置卡：{credits.availableCount} 次</p>
          {credits.credits === null ? (
            <p className="text-muted-foreground">服务仅返回数量，兑换时由服务选择可用卡。</p>
          ) : (
            credits.credits.map((credit, index) => (
              <div key={credit.reference} className="flex flex-wrap items-center gap-3">
                <span>
                  重置卡 {index + 1} ·{" "}
                  {credit.expiresAt === null
                    ? "到期时间未知"
                    : new Date(credit.expiresAt * 1000).toLocaleString("zh-CN") + " 到期"}
                </span>
                <Button
                  variant="outline"
                  disabled={
                    busy ||
                    feedback?.outcome === "pending" ||
                    (credit.expiresAt !== null &&
                      credit.expiresAt * 1000 <=
                        (state?.status === "ready" ? state.data.capturedAt : 0))
                  }
                  onClick={() => setSelected(credit.reference)}
                >
                  兑换这张重置卡
                </Button>
              </div>
            ))
          )}
          {credits.availableCount > 0 &&
            (credits.credits === null || credits.credits.length === 0) && (
              <Button
                variant="outline"
                disabled={busy || feedback?.outcome === "pending"}
                onClick={() => setSelected(null)}
              >
                兑换一张可用重置卡
              </Button>
            )}
        </>
      ) : (
        <p className="text-muted-foreground">
          成功读取服务额度后显示可用数量；缺少数据不会显示为零。
        </p>
      )}
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          void run("reset-status");
        }}
      >
        检查上次兑换
      </Button>
      {feedback && (
        <Alert
          variant={
            feedback.outcome === "pending" || feedback.outcome === "rejected"
              ? "destructive"
              : "default"
          }
        >
          <AlertTitle>{outcomes[feedback.outcome]}</AlertTitle>
          <AlertDescription>
            <p>
              {feedback.outcome === "pending"
                ? "请求可能已被服务处理。请沿用同一次兑换重试，不要重新兑换另一张卡。"
                : feedback.outcome === "reset" || feedback.outcome === "alreadyRedeemed"
                  ? "额度以重新读取的服务记录为准，不会根据兑换结果自行改成 100%。"
                  : "请刷新服务额度后确认可用状态。"}
            </p>
            {feedback.outcome === "pending" && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  void run("consume-reset", {
                    attemptKey: feedback.attemptKey,
                    reference: feedback.reference,
                  });
                }}
              >
                重试同一次兑换
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {message && <output aria-live="polite">{message}</output>}
      <Dialog
        open={selected !== undefined}
        onOpenChange={(open) => {
          if (!open) setSelected(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>兑换一张 Codex 重置卡？</DialogTitle>
            <DialogDescription>
              这会向当前登录账号发出实际兑换请求，可能消耗一张重置卡。服务决定可重置的窗口；完成后重新读取额度。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setSelected(undefined)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const reference = selected ?? null;
                setSelected(undefined);
                void run("consume-reset", { attemptKey: crypto.randomUUID(), reference });
              }}
            >
              确认兑换
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
