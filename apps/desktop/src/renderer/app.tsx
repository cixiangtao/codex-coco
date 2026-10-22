import { useEffect, useState } from "react";
import { Button } from "@codex-coco/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import { ThemeProvider } from "@codex-coco/ui/theme";
import { GlanceLayoutRecovery } from "./components/glance-layout-recovery";
import { WindowShell } from "./shell/window-shell";
import type { PageId } from "./shell/navigation";
import { SettingsPage } from "./pages/settings-page";
import { ModuleManagementPage } from "./pages/module-status";
import { useThemeEditor } from "./client/theme-editor";
import { RegisteredModulePage } from "./modules-panel";

/** Product entry: the accepted shell uses real host settings and keeps preview drafts per window. */
export function App({ initialPage }: { initialPage: PageId }) {
  const [page, setPage] = useState<PageId>(initialPage);
  const editor = useThemeEditor();
  useEffect(() => {
    const unsubscribe = window.codexCoco.onNavigate(setPage);
    window.codexCoco.ready();
    return unsubscribe;
  }, []);
  return (
    <ThemeProvider preference={editor.theme}>
      <WindowShell page={page} onPage={setPage} dirty={editor.dirty}>
        {editor.unavailable && (
          <Alert variant="destructive" className="desktop-recovery">
            <AlertTitle>原配置需要处理</AlertTitle>
            <AlertDescription>
              <p>配置损坏或来自更新版本，原文件保持不变。你可以备份原文件并恢复默认设置。</p>
              <Button
                variant="outline"
                disabled={editor.busy}
                onClick={() => {
                  void editor.recover();
                }}
              >
                备份并恢复默认设置
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <GlanceLayoutRecovery />
        <section className="desktop-page" aria-label="外观页面" hidden={page !== "appearance"}>
          <RegisteredModulePage moduleId="appearance" />
        </section>
        <section className="desktop-page" aria-label="用量页面" hidden={page !== "usage"}>
          <RegisteredModulePage moduleId="usage" />
        </section>
        <section className="desktop-page" aria-label="模块管理页面" hidden={page !== "modules"}>
          <ModuleManagementPage />
        </section>
        <section className="desktop-page" aria-label="设置页面" hidden={page !== "settings"}>
          <SettingsPage editor={editor} />
        </section>
        {page !== "settings" && editor.recoveryMessage && (
          <output aria-live="polite" className="desktop-recovery-message">
            {editor.message}
          </output>
        )}
      </WindowShell>
    </ThemeProvider>
  );
}
