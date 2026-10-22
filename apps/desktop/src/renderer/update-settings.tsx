import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { useEffect, useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { Alert, AlertTitle, AlertDescription } from "@codex-coco/ui/components/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@codex-coco/ui/components/dialog";
import {
  updatePreferencesSchema,
  type UpdateSnapshot,
  type UpdateAction,
  type UpdatePreferences,
} from "../contracts/updates";
const labels: Record<UpdateSnapshot["phase"], string> = {
  unconfigured: "尚未配置发布源",
  idle: "等待检查",
  checking: "正在检查更新",
  available: "发现可用版本",
  "up-to-date": "当前已是最新版本",
  downloading: "正在下载并校验",
  cancelling: "正在等待更新任务取消",
  downloaded: "更新包校验完成",
  installing: "正在交给系统验证、安装并重启",
  unsupported: "需要签名的 macOS 安装版",
  error: "更新操作未完成",
};
const reasons = {
  SOURCE_UNCONFIGURED: "当前仅维护本地仓库，没有配置发布源。",
  SIGNED_INSTALL_REQUIRED: "自动替换需要正式签名的 macOS 安装版；当前运行模式不支持。",
  CHECK_FAILED: "检查失败，请检查更新目录与网络后重试。",
  DOWNLOAD_FAILED: "下载或校验失败，请重新检查版本后再试。",
  INSTALL_FAILED: "系统未能验证或安装更新，当前应用不会冒充更新成功。",
  SETTINGS_UNAVAILABLE: "更新设置损坏，重置时会先保留原文件备份。",
};
/** Shared updater status, window-local draft and explicit download/install confirmations. */
export function UpdateSettings() {
  const [state, setState] = useState<UpdateSnapshot | null>(null);
  const [draft, setDraft] = useState<{ value: UpdatePreferences; revision: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [confirm, setConfirm] = useState<"download" | "install" | "reset" | null>(null);
  useEffect(() => {
    let live = true;
    const off = window.codexCoco.onUpdatesChanged((value) => {
      if (live) setState(value);
    });
    void window.codexCoco
      .updates()
      .then((result) => {
        if (live) {
          if (result.ok) setState(result.value);
          else setMessage(result.error.message);
        }
      })
      .catch(() => {
        if (live) setMessage("更新服务不可用。");
      });
    return () => {
      live = false;
      off();
    };
  }, []);
  if (!state)
    return (
      <section aria-label="应用更新">
        <h3>应用更新</h3>
        <p>{message || "正在载入更新状态…"}</p>
      </section>
    );
  const value = draft?.value ?? state.preferences;
  const busy =
    pending || ["checking", "downloading", "cancelling", "installing"].includes(state.phase);
  const conflict = Boolean(draft && draft.revision !== state.revision);
  const edit = (patch: Partial<UpdatePreferences>) => {
    setDraft({ value: { ...value, ...patch }, revision: draft?.revision ?? state.revision });
    setMessage("");
  };
  async function run(input: UpdateAction) {
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.updateAction(input);
      if (response.ok) {
        setState(response.value);
        if (input.action === "reset") setDraft(null);
      } else setMessage(response.error.message);
    } catch {
      setMessage("更新服务连接失败。");
    } finally {
      setPending(false);
    }
  }
  async function save() {
    if (!draft) return;
    setPending(true);
    setMessage("");
    try {
      const response = await window.codexCoco.saveUpdatePreferences({
        expectedRevision: draft.revision,
        value: draft.value,
      });
      if (response.ok) {
        setState(response.value);
        setDraft(null);
        setMessage("更新偏好已保存。");
      } else setMessage(response.error.message);
    } catch {
      setMessage("更新偏好未能保存。");
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="flex flex-col gap-4" aria-label="应用更新">
      <h3>应用更新</h3>
      <p>
        当前版本 {state.currentVersion} · <output>{labels[state.phase]}</output>
        {state.availableVersion ? ` · ${state.availableVersion}` : ""}
      </p>
      {state.reason && (
        <Alert variant={state.phase === "error" ? "destructive" : "default"}>
          <AlertTitle>{labels[state.phase]}</AlertTitle>
          <AlertDescription>{reasons[state.reason]}</AlertDescription>
        </Alert>
      )}
      {conflict && <p role="alert">其他窗口已更新设置，请取消本地修改后重新编辑。</p>}
      <SettingsGroup>
        <SettingsRow layout="stacked">
          <FieldLabel htmlFor="update-source">发布源目录</FieldLabel>
          <Input
            id="update-source"
            value={value.source}
            placeholder="https://updates.example.com/codex-coco/"
            onChange={(event) => edit({ source: event.target.value })}
            disabled={busy || state.phase === "downloaded"}
          />
          <FieldDescription>
            使用可信发布者提供的 HTTPS 目录及 latest-mac.yml。默认留空，不会请求网络。
          </FieldDescription>
        </SettingsRow>
        <SettingsRow>
          <FieldLabel htmlFor="update-interval">后台检查间隔（小时）</FieldLabel>
          <Input
            id="update-interval"
            type="number"
            min={0}
            max={168}
            value={Number.isNaN(value.intervalHours) ? "" : value.intervalHours}
            onChange={(event) => edit({ intervalHours: event.target.valueAsNumber })}
            disabled={busy}
          />
          <FieldDescription>
            0 为手动；自动检查支持 4–168 小时，只查版本，不自动下载或安装。
          </FieldDescription>
        </SettingsRow>
      </SettingsGroup>
      <div className="flex flex-wrap gap-3">
        <Button
          disabled={
            busy ||
            !draft ||
            conflict ||
            !updatePreferencesSchema.safeParse(value).success ||
            state.phase === "downloaded"
          }
          onClick={() => {
            void save();
          }}
        >
          保存更新偏好
        </Button>
        <Button variant="ghost" disabled={pending || !draft} onClick={() => setDraft(null)}>
          取消更新偏好修改
        </Button>
        <Button
          variant="outline"
          disabled={busy || Boolean(draft) || state.phase === "downloaded"}
          onClick={() => {
            void run({ action: "check" });
          }}
        >
          检查 Codex Coco 更新
        </Button>
        <Button
          variant="outline"
          disabled={
            busy || !state.availableVersion || state.phase === "downloaded" || Boolean(draft)
          }
          onClick={() => setConfirm("download")}
        >
          下载更新包
        </Button>
        <Button
          disabled={busy || state.phase !== "downloaded"}
          onClick={() => setConfirm("install")}
        >
          安装并重启 Codex Coco
        </Button>
        <Button
          variant="outline"
          disabled={pending || !["checking", "downloading"].includes(state.phase)}
          onClick={() => {
            void run({ action: "cancel" });
          }}
        >
          取消更新任务
        </Button>
        <Button
          variant="ghost"
          disabled={busy || state.phase === "downloaded"}
          onClick={() => setConfirm("reset")}
        >
          重置更新设置
        </Button>
      </div>
      {state.progress !== null && (
        <progress aria-label="更新包下载进度" value={state.progress} max={100} />
      )}
      <p className="text-muted-foreground">
        下载由更新引擎校验 SHA-512；安装阶段由 macOS
        验证应用签名并替换。下载后普通退出不会自动安装。检查请求取消后会等待底层请求结束。
      </p>
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
              {confirm === "install"
                ? "安装并重启 Codex Coco？"
                : confirm === "download"
                  ? "下载更新包？"
                  : "重置更新设置？"}
            </DialogTitle>
            <DialogDescription>
              {confirm === "install"
                ? "请先保存当前工作。系统将验证已校验的更新包，正常退出后替换并重新打开 Codex Coco。"
                : confirm === "download"
                  ? "将从已保存的发布源下载所列版本并校验完整性，不会自动安装。"
                  : "会停用后台检查、清空发布源，并保留现有配置文件备份。"}
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
                if (action)
                  void run(action === "install" ? { action, confirmed: true } : { action });
              }}
            >
              确认继续
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
