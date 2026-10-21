import { z } from "zod";
/** Opaque content-addressed identifiers are safe to persist as public image preferences. */
export const imageAssetIdSchema = z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp|gif|avif)$/);
