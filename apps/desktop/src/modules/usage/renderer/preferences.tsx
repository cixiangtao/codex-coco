import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import type { ModuleSnapshot } from "../../../contracts/modules";
import { acceptModuleSnapshot } from "../../../renderer/client/modules";
import { usageConfigSchema, usageDefaults, type UsageConfig } from "../contract";

/** Saved opt-in policy belongs to the module, independent of how many windows are open. */
export function UsagePreferences({ snapshot }: { snapshot: ModuleSnapshot }) {
  const saved = usageConfigSchema.safeParse(snapshot.config.value);
  const [edit, setEdit] = useState<{ value: UsageConfig; revision: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const value = edit?.value ?? (saved.success ? saved.data : usageDefaults);
  const valid = usageConfigSchema.safeParse(value).success;
  const conflict = edit !== null && edit.revision !== snapshot.config.revision;
  function update(next: Partial<UsageConfig>) {
    setEdit({ value: { ...value, ...next }, revision: edit?.revision ?? snapshot.config.revision });
    setMessage("");
  }
  async function save() {
    if (!edit) return;
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.saveModuleConfig({
        moduleId: "usage",
        expectedRevision: edit.revision,
        value: edit.value,
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      acceptModuleSnapshot(response.value);
      setEdit(null);
      setMessage("用量偏好已保存。");
    } catch {
      setMessage("偏好未能保存，请重试。");
    } finally {
      setPending(false);
    }
  }
  return (
    <details className="usage-preferences">
      <summary>刷新、通知与菜单栏设置</summary>
      <FieldGroup className="py-5">
        <Field>
          <FieldLabel htmlFor="usage-interval">自动刷新间隔（秒）</FieldLabel>
          <Input
            id="usage-interval"
            type="number"
            min={0}
            max={3600}
            value={Number.isNaN(value.refreshIntervalSeconds) ? "" : value.refreshIntervalSeconds}
            onChange={(e) => update({ refreshIntervalSeconds: e.target.valueAsNumber })}
          />
          <FieldDescription>
            0 表示不定时刷新，启动时仍读取一次；自动刷新允许 30–3600
            秒。保存后按间隔读取，失败逐步延长间隔；关闭窗口后仍会运行。停用模块即停止。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>系统通知</FieldLabel>
          <ToggleGroup
            aria-label="用量通知"
            value={[value.notificationsEnabled ? "on" : "off"]}
            onValueChange={(values) => {
              if (values.length) update({ notificationsEnabled: values[0] === "on" });
            }}
            variant="outline"
          >
            <ToggleGroupItem value="off">关闭</ToggleGroupItem>
            <ToggleGroupItem value="on">开启</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            剩余额度进入提醒/严重区间、恢复或刷新失败时提醒。由系统控制通知权限，不影响读取结果。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="usage-warning">剩余额度提醒阈值（%）</FieldLabel>
          <Input
            id="usage-warning"
            type="number"
            min={1}
            max={80}
            value={Number.isNaN(value.warningThreshold) ? "" : value.warningThreshold}
            onChange={(e) => update({ warningThreshold: e.target.valueAsNumber })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="usage-critical">严重阈值（%）</FieldLabel>
          <Input
            id="usage-critical"
            type="number"
            min={0}
            max={50}
            value={Number.isNaN(value.criticalThreshold) ? "" : value.criticalThreshold}
            onChange={(e) => update({ criticalThreshold: e.target.valueAsNumber })}
          />
          <FieldDescription>严重阈值必须小于提醒阈值。</FieldDescription>
        </Field>
        {(
          [
            { key: "showPrimaryInMenuBar", label: "菜单栏显示主要额度窗口" },
            { key: "showSecondaryInMenuBar", label: "菜单栏显示次要额度窗口" },
            { key: "showMenuBarLabels", label: "菜单栏显示窗口名称" },
          ] as const
        ).map(({ key, label }) => (
          <Field key={key}>
            <FieldLabel>{label}</FieldLabel>
            <ToggleGroup
              aria-label={label}
              value={[value[key] ? "on" : "off"]}
              onValueChange={(values) => {
                if (values.length) update({ [key]: values[0] === "on" });
              }}
              variant="outline"
            >
              <ToggleGroupItem value="off">关闭</ToggleGroupItem>
              <ToggleGroupItem value="on">开启</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        ))}
        <Field>
          <FieldLabel>服务失败时使用本地额度记录</FieldLabel>
          <ToggleGroup
            aria-label="本地额度回退"
            value={[value.localFallbackEnabled ? "on" : "off"]}
            onValueChange={(values) => {
              if (values.length) update({ localFallbackEnabled: values[0] === "on" });
            }}
            variant="outline"
          >
            <ToggleGroupItem value="off">关闭</ToggleGroupItem>
            <ToggleGroupItem value="on">开启</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            默认关闭。开启后服务读取失败时扫描本机记录，历史额度仍默认收起，不进入菜单栏当前额度。
          </FieldDescription>
        </Field>
        {!valid && <p role="alert">请检查刷新间隔和阈值，严重阈值需要低于提醒阈值。</p>}
        {conflict && <p role="alert">偏好已在其他窗口更新，请取消当前修改后重新编辑。</p>}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={!edit || !valid || conflict || pending}
            onClick={() => {
              void save();
            }}
          >
            保存用量设置
          </Button>
          <Button
            variant="outline"
            disabled={!edit || pending}
            onClick={() => {
              setEdit(null);
              setMessage("");
            }}
          >
            取消修改
          </Button>
        </div>
        <output aria-live="polite">{message}</output>
      </FieldGroup>
    </details>
  );
}
