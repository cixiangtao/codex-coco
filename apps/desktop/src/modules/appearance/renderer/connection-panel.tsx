import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import { SettingsGroup, SettingsRow } from "@codex-coco/ui/components/settings-group";
import { Switch } from "@codex-coco/ui/components/switch";
import { Box } from "@codex-coco/ui/components/box";
import type { AppearanceConfig, AppearanceResult } from "../contract";
import type { AppearanceRun, AppearanceLaunchFeedback } from "./editor-types";
import { appearanceFailures } from "../contract";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";

export function AppearanceConnectionPanel({
  draft,
  update,
  enabled,
  busy,
  dirty,
  result,
  run,
  onRestart,
  launchFeedback,
}: {
  draft: AppearanceConfig;
  update(value: AppearanceConfig): void;
  enabled: boolean;
  busy: boolean;
  dirty: boolean;
  result: AppearanceResult | null;
  run: AppearanceRun;
  onRestart(): void;
  launchFeedback: AppearanceLaunchFeedback | null;
}) {
  return (
    <Box gap="lg" aria-label="Codex 启动与恢复">
      <SettingsGroup
        title="本机连接"
        description="仅连接本机 127.0.0.1。更换端口或目标前，请先撤销旧布景。"
      >
        <SettingsRow>
          <FieldLabel>调试端口方式</FieldLabel>
          <ToggleGroup
            aria-label="调试端口方式"
            variant="outline"
            value={[draft.portMode]}
            onValueChange={(items) => {
              if (items[0] === "auto" || items[0] === "fixed")
                update({ ...draft, portMode: items[0] });
            }}
          >
            <ToggleGroupItem value="fixed">固定端口</ToggleGroupItem>
            <ToggleGroupItem value="auto">自动分配</ToggleGroupItem>
          </ToggleGroup>
        </SettingsRow>
        <SettingsRow>
          <FieldLabel htmlFor="appearance-port">Codex 本机调试端口</FieldLabel>
          <Input
            id="appearance-port"
            type="number"
            min={1024}
            max={65535}
            value={Number.isNaN(draft.port) ? "" : draft.port}
            onChange={(e) => update({ ...draft, port: e.target.valueAsNumber })}
          />
          <FieldDescription>启动参数示例：--remote-debugging-port=9229。</FieldDescription>
        </SettingsRow>
        <SettingsRow>
          <FieldLabel htmlFor="appearance-restore">Codex Coco 启用时恢复布景</FieldLabel>
          <Switch
            id="appearance-restore"
            checked={draft.restoreOnEnable}
            onCheckedChange={(checked) => update({ ...draft, restoreOnEnable: checked })}
          />
          <FieldDescription>
            只重新连接已运行的目标；失败会退避，不自动启动或重启。
          </FieldDescription>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="目标应用">
        <SettingsRow>
          <FieldLabel>Codex 应用</FieldLabel>
          <Button
            variant="outline"
            disabled={!enabled || busy}
            onClick={() => {
              void run("choose-application");
            }}
          >
            选择 Codex 应用
          </Button>
          <FieldDescription>
            {result?.appSelected ? "已选择应用" : "尚未选择应用"} ·{" "}
            {result?.connectedPort ? `本机端口 ${result.connectedPort}` : "尚未连接"}
          </FieldDescription>
        </SettingsRow>
        <SettingsRow layout="stacked">
          <FieldLabel>启动与重启</FieldLabel>
          <div className="appearance-connection-actions">
            <Button
              variant="outline"
              disabled={!enabled || busy || dirty}
              onClick={() => {
                void run("launch-application");
              }}
            >
              启动所选应用
            </Button>
            <Button variant="outline" disabled={!enabled || busy || dirty} onClick={onRestart}>
              明确重启所选应用
            </Button>
          </div>
          <FieldDescription>
            {dirty
              ? "有未保存修改，请先点击底部的“仅保存配置”，再启动或重启。"
              : "启动或重启成功后自动应用已保存布景。重启前会提示确认。"}
          </FieldDescription>
          {launchFeedback && (
            <Alert
              variant={launchFeedback.phase === "error" ? "destructive" : "default"}
              aria-label="Codex 启动状态"
            >
              <AlertTitle>
                {launchFeedback.phase === "pending"
                  ? launchFeedback.operation === "restart-application"
                    ? "正在重启 Codex"
                    : "正在启动 Codex"
                  : launchFeedback.phase === "ready"
                    ? launchFeedback.applied
                      ? "Codex 已启动，布景已应用"
                      : "Codex 已启动并连接"
                    : launchFeedback.phase === "cancelled"
                      ? "启动操作已停止"
                      : "Codex 启动未完成"}
              </AlertTitle>
              <AlertDescription>
                <p>
                  {launchFeedback.phase === "pending"
                    ? "正在等待 Codex 主窗口就绪，随后自动应用并验证已保存布景。"
                    : launchFeedback.phase === "ready"
                      ? launchFeedback.applied
                        ? "已保存布景已应用，正在持续同步窗口。"
                        : "已保存设置中的所有图层均已关闭，无需应用布景。"
                      : launchFeedback.phase === "cancelled"
                        ? "已停止后续操作；已经启动的 Codex 会保留，可以检查连接后继续。"
                        : appearanceFailures[launchFeedback.reason ?? "LAUNCH_FAILED"]}
                </p>
                {launchFeedback.phase === "error" && launchFeedback.reason === "APP_RUNNING" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || dirty || !enabled}
                    onClick={onRestart}
                  >
                    保存工作后重启 Codex
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </SettingsRow>
        <SettingsRow layout="stacked">
          <FieldLabel>布景检查与恢复</FieldLabel>
          <div className="appearance-connection-actions">
            <Button
              variant="outline"
              disabled={!enabled || busy}
              onClick={() => {
                void run("inspect");
              }}
            >
              检查连接
            </Button>
            <Button
              variant="outline"
              disabled={!enabled || busy}
              onClick={() => {
                void run("verify");
              }}
            >
              验证布景
            </Button>
            <Button
              variant="outline"
              disabled={!enabled || busy}
              onClick={() => {
                void run("remove");
              }}
            >
              撤销布景
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </Box>
  );
}
