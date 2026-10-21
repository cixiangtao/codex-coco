import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyTheme } from "@codex-coco/ui/theme";
import { App } from "./app";
import { initializeSettings } from "./client/settings";
import { initializeModules } from "./client/modules";
import "./styles.css";

async function start() {
  const unsubscribeSettings = await initializeSettings();
  const unsubscribeModules = await initializeModules();
  window.addEventListener(
    "beforeunload",
    () => {
      unsubscribeSettings();
      unsubscribeModules();
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
      <App />
    </StrictMode>,
  );
}
void start().catch(() => {
  const root = document.getElementById("root");
  if (root) root.textContent = "Codex Coco 无法加载设置，请关闭窗口后重试。";
  window.codexCoco?.ready();
});
