import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { Field, FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@codex-coco/ui/components/card";
import type { AppearanceConfig, AppearanceResult } from "../contract";
import { type AppearanceRun } from "./editor-types";

export function AppearanceConnectionPanel({
  draft,
  update,
  enabled,
  busy,
  dirty,
  result,
  run,
  onRestart,
}: {
  draft: AppearanceConfig;
  update(value: AppearanceConfig): void;
  enabled: boolean;
  busy: boolean;
  dirty: boolean;
  result: AppearanceResult | null;
  run: AppearanceRun;
  onRestart(): void;
}) {
  return (
    <Card aria-label="Codex 启动与恢复">
      <CardHeader>
        <div>
          <CardTitle>Codex 启动与恢复</CardTitle>
          <CardDescription>连接本机目标，管理启动和恢复策略。</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="appearance-connection-fields">
          <p className="text-muted-foreground">
            {result?.appSelected ? "已选择应用" : "尚未选择应用"} ·{" "}
            {result?.connectedPort ? `本机端口 ${result.connectedPort}` : "尚未连接"}
          </p>
          <Field>
            <FieldLabel htmlFor="appearance-port">Codex 本机调试端口</FieldLabel>
            <Input
              id="appearance-port"
              type="number"
              min={1024}
              max={65535}
              value={Number.isNaN(draft.port) ? "" : draft.port}
              onChange={(e) => update({ ...draft, port: e.target.valueAsNumber })}
            />
            <FieldDescription>
              仅连接
              127.0.0.1。启动参数示例：--remote-debugging-port=9229。修改端口前需撤销原端口的布景。
            </FieldDescription>
          </Field>
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
          <ToggleGroup
            aria-label="启动后恢复已保存布景"
            variant="outline"
            value={[draft.restoreOnEnable ? "on" : "off"]}
            onValueChange={(items) => {
              if (items.length) update({ ...draft, restoreOnEnable: items[0] === "on" });
            }}
          >
            <ToggleGroupItem value="off">手动应用</ToggleGroupItem>
            <ToggleGroupItem value="on">启动后恢复已保存布景</ToggleGroupItem>
          </ToggleGroup>
          <p className="text-muted-foreground">
            恢复只尝试连接已运行的目标，连接失败会退避；不会自动启动或重启应用。更换目标前请先撤销旧布景。
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={!enabled || busy}
              onClick={() => {
                void run("choose-application");
              }}
            >
              选择 Codex 应用
            </Button>
            <Button
              variant="outline"
              disabled={!enabled || busy || dirty}
              onClick={() => {
                void run("launch-application");
              }}
            >
              启动所选应用
            </Button>
            <Button
              variant="outline"
              disabled={!enabled || busy || dirty}
              onClick={() => onRestart()}
            >
              明确重启所选应用
            </Button>
          </div>
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
        </div>
      </CardContent>
    </Card>
  );
}
