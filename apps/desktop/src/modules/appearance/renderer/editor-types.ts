export type Layer = "wallpaper" | "main" | "sidebar";
export const labels = { wallpaper: "全局壁纸", main: "主面板插画", sidebar: "侧栏插画" };
export type AppearanceRun = (
  operation: string,
  layer?: Layer,
  input?: Record<string, string>,
) => Promise<void>;
