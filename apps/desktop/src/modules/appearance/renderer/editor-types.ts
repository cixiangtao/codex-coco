import type { AppearanceFailure } from "../contract";

export type Layer = "wallpaper" | "main" | "sidebar";
export const labels = { wallpaper: "全局壁纸", main: "主面板插画", sidebar: "侧栏插画" };
export type AppearanceRun = (
  operation: string,
  layer?: Layer,
  input?: Record<string, string>,
) => Promise<void>;

/** User-initiated launch feedback survives background module projection updates. */
export interface AppearanceLaunchFeedback {
  operation: "launch-application" | "restart-application";
  phase: "pending" | "ready" | "error" | "cancelled";
  reason: AppearanceFailure | null;
  applied?: boolean;
}
