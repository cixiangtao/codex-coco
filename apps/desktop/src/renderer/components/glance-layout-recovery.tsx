import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import { acceptGlanceLayout, useGlanceLayout } from "../client/glance-layout";

/** Recovery stays reachable from every main page without a separate layout editor. */
export function GlanceLayoutRecovery() {
  const saved = useGlanceLayout();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  if (!saved) return null;
  if (["ok", "missing"].includes(saved.health))
    return message ? (
      <output aria-live="polite" className="desktop-recovery-message">
        {message}
      </output>
    ) : null;
  return (
    <Alert variant="destructive" className="desktop-recovery">
      <AlertTitle>速览设置需要恢复</AlertTitle>
      <AlertDescription>
        <p>原配置已保留，恢复时先备份原文件，再使用默认组合。之后可通过功能面板图钉调整。</p>
        <Button
          disabled={pending}
          variant="outline"
          onClick={async () => {
            setPending(true);
            setMessage("");
            try {
              const result = await window.codexCoco.resetGlanceLayout();
              if (result.ok) {
                acceptGlanceLayout(result.value);
                setMessage("速览设置已备份并恢复。");
              } else setMessage(result.error.message);
            } catch {
              setMessage("恢复未完成，原配置已保留。");
            } finally {
              setPending(false);
            }
          }}
        >
          备份并恢复速览设置
        </Button>
        <output aria-live="polite">{message}</output>
      </AlertDescription>
    </Alert>
  );
}
