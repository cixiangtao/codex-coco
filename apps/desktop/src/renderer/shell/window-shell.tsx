import type { ReactNode } from "react";
import { cn } from "cn";
import { Button } from "@codex-coco/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@codex-coco/ui/components/tooltip";
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
  return (
    <TooltipProvider delay={300}>
      <div className="desktop-shell">
        <a className="desktop-skip-link" href="#desktop-content">
          跳到内容
        </a>
        <header className="desktop-titlebar">
          <div aria-hidden="true" />
          <h1>Codex Coco</h1>
          <span className="desktop-draft-indicator">{dirty ? "主题预览中" : ""}</span>
        </header>
        <aside className="desktop-sidebar">
          <nav id="desktop-navigation" aria-label="应用导航">
            {navigation.map(({ id, label, icon: Icon, group }) => (
              <Tooltip key={id}>
                <TooltipTrigger
                  render={
                    <Button
                      variant={page === id ? "secondary" : "ghost"}
                      size="icon-lg"
                      className={cn("desktop-nav-item", id === "modules" && "desktop-nav-utility")}
                      aria-label={label}
                      aria-current={page === id ? "page" : undefined}
                      aria-describedby={
                        id === "settings" && dirty ? "theme-draft-status" : undefined
                      }
                      data-group={group}
                      onClick={() => onPage(id)}
                    />
                  }
                >
                  <Icon />
                  <span className="sr-only">{label}</span>
                  {id === "settings" && dirty && (
                    <i className="desktop-draft-dot" aria-hidden="true" />
                  )}
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {label}
                </TooltipContent>
              </Tooltip>
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
    </TooltipProvider>
  );
}
