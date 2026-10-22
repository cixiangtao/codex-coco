import { initializeGlanceLayout } from "./client/glance-layout";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme } from "@codex-coco/ui/theme";
import { GlancePage } from "./pages/glance-page";
import { initializeGlance } from "./client/glance";
import { App } from "./app";
import { initializeSettings } from "./client/settings";
import { initializeModules } from "./client/modules";
import "./styles.css";

async function start() {
  const context = await window.codexCoco.windowContext();
  if (!context.ok) throw new Error("WINDOW_CONTEXT_UNAVAILABLE");
  document.body.dataset.window = context.value.kind;
  const unsubscribeSettings = await initializeSettings();
  const unsubscribeLayout =
    context.value.kind === "main" ? await initializeGlanceLayout() : () => {};
  const unsubscribeSurface =
    context.value.kind === "main" ? await initializeModules() : await initializeGlance();
  window.addEventListener(
    "beforeunload",
    () => {
      unsubscribeSettings();
      unsubscribeLayout();
      unsubscribeSurface();
    },
    { once: true },
  );
  const result = await window.codexCoco.bootstrap();
  if (!result.ok) throw new Error(result.error.message);
  const theme = result.value.settings.theme;
  applyTheme(
    document.documentElement,
    theme,
    theme.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme.mode,
  );
  const root = document.getElementById("root");
  if (!root) throw new Error("ROOT_MISSING");
  createRoot(root).render(
    <StrictMode>
      {context.value.kind === "main" ? <App initialPage={context.value.page} /> : <GlancePage />}
    </StrictMode>,
  );
}
void start().catch(() => {
  const root = document.getElementById("root");
  if (root) root.textContent = "Codex Coco 无法加载设置，请关闭窗口后重试。";
  window.codexCoco?.ready();
});
