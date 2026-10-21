import { lazy, type ComponentType } from "react";
import type { ModuleSnapshot } from "../contracts/modules";

/** UI registration is separate from runtime registration and never imports backend code. */
const fixturePage = lazy(() => import("../modules/foundation-fixture/renderer/page"));
export const modulePages: Readonly<Record<string, ComponentType<{ snapshot: ModuleSnapshot }>>> = {
  "desktop-tools": lazy(() => import("../modules/desktop-tools/renderer/page")),
  appearance: lazy(() => import("../modules/appearance/renderer/page")),
  usage: lazy(() => import("../modules/usage/renderer/page")),
  "foundation-fixture": fixturePage,
  "foundation-peer": fixturePage,
};
