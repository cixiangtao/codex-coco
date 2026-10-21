import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@codex-coco/ui/components/field";
import type { ModuleSnapshot } from "../../../contracts/modules";
import type { Result } from "../../../contracts/bridge";
import { acceptModuleSnapshot } from "../../../renderer/client/modules";
import { fixtureConfigSchema } from "../contract";

/** Minimal synthetic workflow; layout and controls are not a product design proposal. */
export default function FixturePage({ snapshot }: { snapshot: ModuleSnapshot }) {
  const [draft, setDraft] = useState<{ label: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const saved = fixtureConfigSchema.parse(snapshot.config.value);
  const label = draft?.label ?? saved.label;
  const invalid = !fixtureConfigSchema.safeParse({ label }).success;
  const conflict = draft !== null && draft.revision !== snapshot.config.revision;
  const unavailable = ["invalid", "future-version", "unavailable"].includes(snapshot.config.health);
  const active =
    snapshot.operation?.phase === "running" || snapshot.operation?.phase === "cancelling";
  async function action(request: () => Promise<Result<ModuleSnapshot>>, savedConfig = false) {
    setBusy(true);
    try {
      const result = await request();
      if (result.ok) {
        acceptModuleSnapshot(result.value);
        if (savedConfig) setDraft(null);
        setMessage(savedConfig ? "模块配置已保存，下次任务使用新配置。" : "模块请求已受理。");
      } else setMessage(result.error.message);
    } catch {
      setMessage("无法连接模块服务，请重新打开窗口。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <FieldGroup>
        <Field data-invalid={invalid} data-disabled={unavailable}>
          <FieldLabel htmlFor={`${snapshot.id}-label`}>合成任务名称</FieldLabel>
          <Input
            id={`${snapshot.id}-label`}
            value={label}
            aria-invalid={invalid}
            disabled={unavailable || busy}
            aria-describedby={`${snapshot.id}-help`}
            onChange={(event) =>
              setDraft({
                label: event.target.value,
                revision: draft?.revision ?? snapshot.config.revision,
              })
            }
          />
          <FieldDescription id={`${snapshot.id}-help`}>
            {conflict
              ? "配置已在其他窗口更新，请取消草稿后重试。"
              : "1–40 个字符。已运行的任务保留原配置，下次任务读取新配置。"}
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={busy || unavailable || !draft || invalid || conflict}
          onClick={() => {
            void action(
              () =>
                window.codexCoco.saveModuleConfig({
                  moduleId: snapshot.id,
                  expectedRevision: draft?.revision ?? snapshot.config.revision,
                  value: { label },
                }),
              true,
            );
          }}
        >
          保存模块配置
        </Button>
        <Button variant="outline" disabled={!draft || busy} onClick={() => setDraft(null)}>
          取消模块草稿
        </Button>
        <Button
          disabled={busy || active || snapshot.phase !== "running"}
          onClick={() => {
            void action(() =>
              window.codexCoco.runModuleOperation({
                moduleId: snapshot.id,
                operation: "count",
                input: { steps: 12 },
              }),
            );
          }}
        >
          运行合成任务
        </Button>
        <Button
          variant="outline"
          disabled={busy || !active || snapshot.operation?.phase === "cancelling"}
          onClick={() => {
            const operationId = snapshot.operation?.id;
            if (operationId)
              void action(() =>
                window.codexCoco.cancelModuleOperation({ moduleId: snapshot.id, operationId }),
              );
          }}
        >
          取消合成任务
        </Button>
      </div>
      <output aria-live="polite" className="text-muted-foreground">
        {message}
      </output>
      <p data-testid={`${snapshot.id}-task`}>
        {snapshot.operation
          ? `任务：${snapshot.operation.phase}；进度：${snapshot.operation.progress}%；结果：${JSON.stringify(snapshot.operation.result)}${snapshot.operation.error ? `；错误：${snapshot.operation.error}` : ""}`
          : "尚无合成任务"}
      </p>
    </div>
  );
}
