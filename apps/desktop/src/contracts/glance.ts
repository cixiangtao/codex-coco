import type { MainPage } from "./windows";

export type GlancePhase =
  | "unavailable"
  | "disabled"
  | "starting"
  | "running"
  | "stopping"
  | "error";
/** Public presentation only; module configuration, task results and credentials stay out. */
export interface GlanceItem {
  id: string;
  title: string;
  phase: GlancePhase;
  description: string;
  page: MainPage;
}
export interface GlanceSnapshot {
  /** Monotonic within this host session, independent of settings and module revisions. */
  revision: number;
  items: GlanceItem[];
}
