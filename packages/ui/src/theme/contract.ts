/** Pure theme contract. This entry is safe to consume outside React and the DOM. */
export const themeModes = ["light", "dark", "system"] as const;
export const themePresetIds = ["neutral", "blue", "violet"] as const;
export type ThemeMode = (typeof themeModes)[number];
export type ThemePresetId = (typeof themePresetIds)[number];
export type ResolvedMode = Exclude<ThemeMode, "system">;

/** A null primary color follows the preset; custom values use six-digit HEX. */
export interface ThemePreference {
  mode: ThemeMode;
  presetId: ThemePresetId;
  primaryColor: string | null;
}

export const defaultTheme: ThemePreference = {
  mode: "system",
  presetId: "neutral",
  primaryColor: null,
};

/** Accepts only opaque RGB input; returns a canonical HEX value or null. */
export function normalizePrimaryColor(input: string): string | null {
  const value = input.trim();
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(value)) {
    return `#${value
      .slice(1)
      .split("")
      .map((part) => part + part)
      .join("")}`.toLowerCase();
  }
  return null;
}
