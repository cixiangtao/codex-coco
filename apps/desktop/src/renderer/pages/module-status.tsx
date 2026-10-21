import { Activity, Palette } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from "@codex-coco/ui/components/empty";
import { useModules } from "../client/modules";
import { ModulesPanel } from "../modules-panel";
import type { PageId } from "../shell/navigation";

const plannedModules = {
  usage: {
    title: "用量",
    icon: Activity,
    description: "查看账号余量、恢复时间与同步状态。",
    detail:
      "用量模块尚未接入。连接账号后，这里将提供完整用量信息，菜单栏将提供对应摘要。当前不会读取账号或请求用量。",
  },
  appearance: {
    title: "外观",
    icon: Palette,
    description: "为外部 Codex 选择和管理布景。",
    detail:
      "外观模块尚未接入，暂时不能连接或修改外部 Codex。你可以先在设置中调整 Codex Coco 自身的界面主题。",
  },
} as const;

/** Unimplemented capabilities have no synthetic account, quota or apply operation. */
export function ModuleStatusPage({
  moduleId,
  onPage,
}: {
  moduleId: keyof typeof plannedModules;
  onPage(page: PageId): void;
}) {
  const { title, icon: Icon, description, detail } = plannedModules[moduleId];
  return (
    <div>
      <header className="desktop-page-heading">
        <h2>{title}</h2>
        <p>{description}</p>
      </header>
      <Empty className="desktop-module-empty">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{title}模块准备中</EmptyTitle>
          <EmptyDescription>{detail}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            onClick={() => onPage(moduleId === "appearance" ? "settings" : "modules")}
          >
            {moduleId === "appearance" ? "调整 Codex Coco 主题" : "查看模块管理"}
          </Button>
        </EmptyContent>
      </Empty>
    </div>
  );
}

/** Only registered modules expose real controls; fixture panels require the host opt-in. */
export function ModuleManagementPage() {
  const modules = useModules();
  return (
    <div className="module-management-page">
      <header className="desktop-page-heading">
        <h2>模块管理</h2>
        <p>查看已接入的能力，分别管理各模块的运行状态。</p>
      </header>
      {modules.length ? (
        <ModulesPanel />
      ) : (
        <>
          <p className="module-registry-note">当前还没有可启用的模块。</p>
          <ul className="planned-module-list" aria-label="计划接入的模块">
            {Object.entries(plannedModules).map(([id, { title, icon: Icon, description }]) => (
              <li key={id}>
                <Icon aria-hidden="true" />
                <div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </div>
                <p>尚未接入</p>
              </li>
            ))}
          </ul>
          <p className="module-extension-note">后续模块会沿用同一个入口，独立启停与配置。</p>
        </>
      )}
    </div>
  );
}
