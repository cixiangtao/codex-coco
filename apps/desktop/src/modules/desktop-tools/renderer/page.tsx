import { PinBlockButton } from "../../../renderer/components/pin-block";
import { useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { Switch } from "@codex-coco/ui/components/switch";
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
import { acceptModuleSnapshot, waitForModuleOperation } from "../../../renderer/client/modules";
import {
  desktopToolsConfigSchema,
  desktopToolsDefaults,
  desktopToolsResultSchema,
  bundledTrayIcons,
  nativeTrayIcons,
  type DesktopToolsConfig,
} from "../contract";

/** Main settings expose system actions without granting the glance window write permissions. */
export default function DesktopToolsPage({ snapshot }: { snapshot: ModuleSnapshot }) {
  const parsed = desktopToolsConfigSchema.safeParse(snapshot.config.value);
  const stored = parsed.success ? parsed.data : desktopToolsDefaults;
  const [draft, setDraft] = useState<{ value: DesktopToolsConfig; revision: number } | null>(null);
  const value = draft?.value ?? stored;
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"login" | "sharing" | null>(null);
  const result = desktopToolsResultSchema.safeParse(snapshot.operation?.result);
  const state = result.success ? result.data : null;
  const busy =
    pending ||
    snapshot.operation?.phase === "running" ||
    snapshot.operation?.phase === "cancelling";
  const enabled = snapshot.phase === "running";
  const conflict = draft !== null && draft.revision !== snapshot.config.revision;
  function update(patch: Partial<DesktopToolsConfig>) {
    setDraft({
      value: { ...value, ...patch },
      revision: draft?.revision ?? snapshot.config.revision,
    });
    setMessage("");
  }
  async function run(operation: string) {
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.runModuleOperation({
        moduleId: "desktop-tools",
        operation,
        input: {},
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      acceptModuleSnapshot(response.value);
      if (operation !== "import-tray-icon" && response.value.operation) {
        const completed = await waitForModuleOperation(
          "desktop-tools",
          response.value.operation.id,
          300_000,
        );
        const result = desktopToolsResultSchema.safeParse(completed.result);
        if (completed.phase === "cancelled") setMessage("操作已取消。");
        else if (
          completed.phase !== "succeeded" ||
          !result.success ||
          result.data.status === "error"
        )
          setMessage("系统偏好操作未完成，请检查下方状态后重试。");
        else if (operation === "apply-login")
          setMessage(result.data.openAtLogin ? "已开启开机启动。" : "已关闭开机启动。");
        else if (operation === "apply-sharing")
          setMessage(result.data.sharing ? "共享快照已开启。" : "共享快照已关闭。");
        else if (operation === "inspect-system")
          setMessage(
            `系统状态已更新；开机启动${result.data.openAtLogin ? "已开启" : "已关闭"}，共享快照${result.data.sharing ? "已开启" : "已关闭"}。`,
          );
      }
      if (operation === "import-tray-icon" && response.value.operation) {
        const completed = await waitForModuleOperation(
          "desktop-tools",
          response.value.operation.id,
          300_000,
        );
        const imported = desktopToolsResultSchema.safeParse(completed.result);
        if (imported.success && imported.data.imported) {
          const id = imported.data.imported;
          update({
            iconId: id,
            customIcons: value.customIcons.some((icon) => icon.id === id)
              ? value.customIcons
              : [...value.customIcons, { id, title: `自定义图标 ${value.customIcons.length + 1}` }],
          });
          setPreview(imported.data.preview);
        }
      }
    } catch {
      setMessage("系统偏好操作未完成，请重试。");
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (!draft || !desktopToolsConfigSchema.safeParse(draft.value).success) return false;
    setPending(true);
    try {
      const response = await window.codexCoco.saveModuleConfig({
        moduleId: "desktop-tools",
        expectedRevision: draft.revision,
        value: draft.value,
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return false;
      }
      acceptModuleSnapshot(response.value);
      setDraft(null);
      const removed = stored.customIcons.filter(
        (icon) => !draft.value.customIcons.some((current) => current.id === icon.id),
      );
      let failedDeletion = false;
      for (const icon of removed) {
        try {
          const deletion = await window.codexCoco.runModuleOperation({
            moduleId: "desktop-tools",
            operation: "remove-tray-icon",
            input: { id: icon.id },
          });
          if (!deletion.ok || !deletion.value.operation) {
            failedDeletion = true;
            continue;
          }
          acceptModuleSnapshot(deletion.value);
          const completed = await waitForModuleOperation(
            "desktop-tools",
            deletion.value.operation.id,
          );
          const result = desktopToolsResultSchema.safeParse(completed.result);
          if (!result.success || result.data.status === "error") failedDeletion = true;
        } catch {
          failedDeletion = true;
        }
      }
      setMessage(
        failedDeletion
          ? "偏好已保存，部分图标副本未能删除。"
          : "菜单栏与共享偏好已保存；开机启动需单独确认应用。",
      );
      return true;
    } catch {
      setMessage("偏好未能保存。");
      return false;
    } finally {
      setPending(false);
    }
  }
  async function enable() {
    setPending(true);
    try {
      const response = await window.codexCoco.enableModule({
        moduleId: "desktop-tools",
        enabled: true,
      });
      if (response.ok) acceptModuleSnapshot(response.value);
      else setMessage(response.error.message);
    } catch {
      setMessage("模块未能启用。");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="flex flex-col gap-5" aria-label="系统与菜单栏设置">
      <h3 className="info-block-title">
        系统与菜单栏 <PinBlockButton id="desktop-tools.status" />
      </h3>
      {!enabled && (
        <Alert>
          <AlertTitle>系统偏好模块尚未启用</AlertTitle>
          <AlertDescription>
            <p>启用后恢复菜单栏偏好，不会自动修改登录项。</p>
            <Button
              disabled={busy || snapshot.phase !== "disabled"}
              onClick={() => {
                void enable();
              }}
            >
              启用系统与菜单栏
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {state?.status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>系统偏好操作未完成</AlertTitle>
          <AlertDescription>
            {state.reason === "IMAGE_INVALID"
              ? "图标不可用，请选择有效图片或不超过 300 帧的 GIF。"
              : "请检查系统权限、图标和共享目录后重试。"}
          </AlertDescription>
        </Alert>
      )}
      {conflict && (
        <Alert variant="destructive">
          <AlertTitle>其他窗口已更新偏好</AlertTitle>
          <AlertDescription>请取消当前修改后重新编辑。</AlertDescription>
        </Alert>
      )}
      <SettingsGroup title="菜单栏图标" disabled={busy}>
        <SettingsRow layout="stacked">
          <FieldLabel>菜单栏图标</FieldLabel>
          <ToggleGroup
            className="settings-icon-options"
            aria-label="菜单栏图标"
            value={[value.iconId]}
            variant="outline"
            onValueChange={(values) => {
              if (values[0])
                update({
                  iconId: values[0] as DesktopToolsConfig["iconId"],
                  speed: value.iconSpeeds[values[0]] ?? 1,
                });
            }}
          >
            {[...nativeTrayIcons, ...bundledTrayIcons, ...value.customIcons].map((icon) => (
              <ToggleGroupItem key={icon.id} value={icon.id}>
                {icon.title}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>
            保留完整 Codex Coco 名称；彩色 GIF 与自定义图片不会强制转换为黑白。
          </FieldDescription>
        </SettingsRow>
        <SettingsRow layout="stacked">
          <Button
            variant="outline"
            disabled={!enabled || busy || value.customIcons.length >= 40}
            onClick={() => {
              void run("import-tray-icon");
            }}
          >
            导入自定义菜单栏图标
          </Button>
          {value.customIcons.length > 0 && (
            <details>
              <summary>管理自定义图标</summary>
              <ul className="flex flex-col gap-3">
                {value.customIcons.map((icon) => (
                  <li key={icon.id} className="flex items-center gap-3">
                    <span>{icon.title}</span>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        const speeds = { ...value.iconSpeeds };
                        delete speeds[icon.id];
                        update({
                          customIcons: value.customIcons.filter(
                            (current) => current.id !== icon.id,
                          ),
                          iconId: value.iconId === icon.id ? "grid" : value.iconId,
                          iconSpeeds: speeds,
                        });
                      }}
                    >
                      从列表移除
                    </Button>
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                保存偏好后删除 Codex Coco 中的图标副本，原文件不变。
              </p>
            </details>
          )}
          {preview && (
            <img src={preview} alt="自定义菜单栏图标预览" className="size-12 object-contain" />
          )}
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="动画与性能" disabled={busy}>
        {(
          [
            { key: "animate", title: "播放图标动画" },
            { key: "followsCpu", title: "动画速度跟随系统 CPU" },
          ] as const
        ).map(({ key, title }) => (
          <SettingsRow key={key}>
            <FieldLabel htmlFor={`desktop-${key}`}>{title}</FieldLabel>
            <Switch
              id={`desktop-${key}`}
              aria-label={title}
              checked={value[key]}
              onCheckedChange={(checked) => update({ [key]: checked })}
            />
          </SettingsRow>
        ))}
        <SettingsRow>
          <FieldLabel htmlFor="tray-animation-speed">
            基础动画速度 {value.speed.toFixed(1)}×
          </FieldLabel>
          <Input
            id="tray-animation-speed"
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={value.speed}
            onChange={(event) =>
              update({
                speed: event.target.valueAsNumber,
                iconSpeeds: { ...value.iconSpeeds, [value.iconId]: event.target.valueAsNumber },
              })
            }
          />
          <FieldDescription>
            静态图标或关闭动画时，不启动 CPU 采样；动画关闭、停用或退出会清理计时器。
          </FieldDescription>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup
        title="系统集成"
        disabled={busy}
        description="先保存偏好，再单独应用到系统；停用模块不会撤销已保存的登录项。"
      >
        <SettingsRow>
          <FieldLabel htmlFor="desktop-launchAtLogin">期望随 macOS 登录启动</FieldLabel>
          <Switch
            id="desktop-launchAtLogin"
            checked={value.launchAtLogin}
            onCheckedChange={(checked) => update({ launchAtLogin: checked })}
          />
        </SettingsRow>
        <SettingsRow layout="stacked">
          <FieldLabel>登录项状态与应用</FieldLabel>
          <p className="text-muted-foreground">
            系统登录项：
            {state
              ? state.loginSupported
                ? state.openAtLogin
                  ? "已开启"
                  : "已关闭"
                : "需要 macOS 安装版"
              : "尚未检查"}{" "}
            · 当前图标 {state?.frameCount ?? 0} 帧
          </p>
          <Button
            variant="outline"
            disabled={!enabled || busy || draft !== null || state?.loginSupported === false}
            onClick={() => setConfirm("login")}
          >
            应用开机启动设置
          </Button>
        </SettingsRow>
        <SettingsRow>
          <FieldLabel htmlFor="desktop-shareWidgetSnapshot">写入 Widget 共享快照</FieldLabel>
          <Switch
            id="desktop-shareWidgetSnapshot"
            checked={value.shareWidgetSnapshot}
            onCheckedChange={(checked) => update({ shareWidgetSnapshot: checked })}
          />
        </SettingsRow>
        <SettingsRow layout="stacked">
          <FieldLabel>Widget 共享目录</FieldLabel>
          <p className="text-muted-foreground">
            共享文件只含公开状态、额度摘要与时间，不含账号、配置或模型回答。默认写入 Codex Coco
            的独立共享目录；系统 Widget 需要签名的原生扩展与 App Group 容器。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={!enabled || busy || draft !== null}
              onClick={() => setConfirm("sharing")}
            >
              应用共享快照设置
            </Button>
            <Button
              variant="outline"
              disabled={!enabled || busy}
              onClick={() => {
                void run("choose-shared-directory");
              }}
            >
              选择 Widget 共享目录
            </Button>
            <Button
              variant="ghost"
              disabled={!enabled || busy}
              onClick={() => {
                void run("reveal-shared-snapshot");
              }}
            >
              在 Finder 中显示快照
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={!draft || busy || conflict}
          onClick={() => {
            void save();
          }}
        >
          保存菜单栏偏好
        </Button>
        <Button
          variant="outline"
          disabled={!draft || busy}
          onClick={() => {
            setDraft(null);
            setPreview(null);
          }}
        >
          取消偏好修改
        </Button>
        <Button
          variant="outline"
          disabled={!enabled || busy}
          onClick={() => {
            void run("inspect-system");
          }}
        >
          检查系统状态
        </Button>
      </div>
      <output aria-live="polite">{message}</output>
      <Dialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "login" ? "应用 macOS 登录项设置？" : "应用共享快照设置？"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "login"
                ? `将${stored.launchAtLogin ? "开启" : "关闭"} Codex Coco 的 macOS 登录启动。停用此模块不会撤销已保存的系统登录项。`
                : `将${stored.shareWidgetSnapshot ? "开启" : "关闭"}公开摘要文件写入。原生 Widget 扩展可读取这个文件，操作不涉及网络或云同步。`}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button variant="outline" onClick={() => setConfirm(null)}>
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                const action = confirm;
                setConfirm(null);
                void run(action === "login" ? "apply-login" : "apply-sharing");
              }}
            >
              确认应用
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
