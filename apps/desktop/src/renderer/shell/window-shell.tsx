import { useState, type ReactNode } from "react";
import { cn } from "cn";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@codex-coco/ui/components/button";
import { navigation, type PageId } from "./navigation";

/** Application-owned layout; native window controls remain owned by Electron. */
export function WindowShell({
  page,
  onPage,
  dirty,
  children,
}: {
  page: PageId;
  onPage(page: PageId): void;
  dirty: boolean;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={cn("desktop-shell", collapsed && "desktop-sidebar-collapsed")}>
      <a className="desktop-skip-link" href="#desktop-content">
        跳到内容
      </a>
      <header className="desktop-titlebar">
        <div className="desktop-window-tools">
          <Button
            variant="ghost"
            size="icon"
            aria-label={collapsed ? "展开侧栏" : "收起侧栏"}
            title={collapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!collapsed}
            aria-controls="desktop-navigation"
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
        <h1>Codex Coco</h1>
        <span className="desktop-draft-indicator">{dirty ? "主题预览中" : ""}</span>
      </header>
      <aside className="desktop-sidebar">
        <nav id="desktop-navigation" aria-label="应用导航">
          {navigation.map(({ id, label, icon: Icon, group }) => (
            <Button
              key={id}
              variant={page === id ? "secondary" : "ghost"}
              className={cn("desktop-nav-item", id === "modules" && "desktop-nav-utility")}
              aria-label={label}
              aria-current={page === id ? "page" : undefined}
              aria-describedby={id === "settings" && dirty ? "theme-draft-status" : undefined}
              title={label}
              data-group={group}
              onClick={() => onPage(id)}
            >
              <Icon data-icon="inline-start" />
              <span>{label}</span>
              {id === "settings" && dirty && <i className="desktop-draft-dot" aria-hidden="true" />}
            </Button>
          ))}
        </nav>
        {dirty && (
          <span id="theme-draft-status" className="sr-only">
            设置有未保存的主题预览
          </span>
        )}
      </aside>
      <main id="desktop-content" className="desktop-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
