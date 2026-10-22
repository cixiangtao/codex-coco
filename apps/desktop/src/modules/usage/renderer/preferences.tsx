import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { Switch } from "@codex-coco/ui/components/switch";
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
    <div className="usage-preferences">
      <SettingsGroup
        title="刷新与本地记录"
        description="启动时仍读取一次；关闭主窗口不停止后台刷新，停用模块即停止。"
      >
        <SettingsRow>
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
            0 表示按需刷新；自动刷新允许 30–3600 秒，失败时自动延后。
          </FieldDescription>
        </SettingsRow>
        <SettingsRow>
          <FieldLabel htmlFor="usage-local-fallback">服务失败时使用本地额度记录</FieldLabel>
          <Switch
            id="usage-local-fallback"
            aria-label="本地额度回退"
            checked={value.localFallbackEnabled}
            disabled={pending}
            onCheckedChange={(checked) => update({ localFallbackEnabled: checked })}
          />
          <FieldDescription>
            服务读取失败时扫描本机记录。历史额度单独标记，不作为当前额度。
          </FieldDescription>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="额度通知">
        <SettingsRow>
          <FieldLabel htmlFor="usage-notifications">系统通知</FieldLabel>
          <Switch
            id="usage-notifications"
            aria-label="用量通知"
            checked={value.notificationsEnabled}
            disabled={pending}
            onCheckedChange={(checked) => update({ notificationsEnabled: checked })}
          />
          <FieldDescription>额度偏低、恢复或刷新失败时提醒；通知权限由系统管理。</FieldDescription>
        </SettingsRow>
        <SettingsRow>
          <FieldLabel htmlFor="usage-warning">剩余额度提醒阈值（%）</FieldLabel>
          <Input
            id="usage-warning"
            type="number"
            min={1}
            max={80}
            value={Number.isNaN(value.warningThreshold) ? "" : value.warningThreshold}
            onChange={(e) => update({ warningThreshold: e.target.valueAsNumber })}
          />
        </SettingsRow>
        <SettingsRow>
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
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="菜单栏显示">
        {(
          [
            { key: "showPrimaryInMenuBar", label: "菜单栏显示主要额度窗口" },
            { key: "showSecondaryInMenuBar", label: "菜单栏显示次要额度窗口" },
            { key: "showMenuBarLabels", label: "菜单栏显示窗口名称" },
          ] as const
        ).map(({ key, label }) => (
          <SettingsRow key={key}>
            <FieldLabel htmlFor={`usage-${key}`}>{label}</FieldLabel>
            <Switch
              id={`usage-${key}`}
              aria-label={label}
              checked={value[key]}
              disabled={pending}
              onCheckedChange={(checked) => update({ [key]: checked })}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
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
    </div>
  );
}
