import { z } from "zod";

export const mainPages = ["usage", "appearance", "modules", "settings"] as const;
export const openMainPageSchema = z.strictObject({ page: z.enum(mainPages).optional() });
export type MainPage = (typeof mainPages)[number];
/** Window roles come from the host registration, never from a renderer URL or input. */
export type WindowContext = { kind: "main"; page: MainPage } | { kind: "glance" };
