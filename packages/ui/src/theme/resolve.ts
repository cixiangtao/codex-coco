import { normalizePrimaryColor, type ResolvedMode, type ThemePreference } from "./contract";

const colors = {
  light: {
    background: "#fafafa",
    foreground: "#202020",
    card: "#ffffff",
    "card-foreground": "#202020",
    popover: "#ffffff",
    "popover-foreground": "#202020",
    muted: "#f0f0f0",
    "muted-foreground": "#626262",
    border: "#d8d8d8",
    input: "#8a8a8a",
    secondary: "#eeeeee",
    "secondary-foreground": "#202020",
    destructive: "#b42318",
    success: "#197042",
    warning: "#845400",
  },
  dark: {
    background: "#171717",
    foreground: "#f5f5f5",
    card: "#202020",
    "card-foreground": "#f5f5f5",
    popover: "#262626",
    "popover-foreground": "#f5f5f5",
    muted: "#292929",
    "muted-foreground": "#b0b0b0",
    border: "#454545",
    input: "#858585",
    secondary: "#333333",
    "secondary-foreground": "#f5f5f5",
    destructive: "#ff9b92",
    success: "#76d9a1",
    warning: "#edc46b",
  },
} as const;

const primaryColors = {
  neutral: { light: "#343434", dark: "#e6e6e6" },
  blue: { light: "#245dd8", dark: "#8cafff" },
  violet: { light: "#7042c1", dark: "#c5a4ff" },
} as const;

function rgb(hex: string) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex: string) {
  const [r = 0, g = 0, b = 0] = rgb(hex).map((part) => {
    const value = part / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

/** WCAG relative-luminance contrast ratio for canonical opaque HEX colors. */
export function contrastRatio(first: string, second: string) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function mix(first: string, second: string, weight: number) {
  const right = rgb(second);
  return `#${rgb(first)
    .map((part, index) =>
      Math.round(part * (1 - weight) + (right[index] ?? 0) * weight)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function readableText(background: string) {
  return contrastRatio(background, "#000000") > contrastRatio(background, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/** Produces semantic tokens, including readable primary states and a visible focus ring. */
export function resolveTheme(preference: ThemePreference, mode: ResolvedMode) {
  const base = colors[mode];
  const custom =
    preference.primaryColor === null ? null : normalizePrimaryColor(preference.primaryColor);
  if (preference.primaryColor !== null && custom === null) throw new Error("Invalid primary color");
  const primary = custom ?? primaryColors[preference.presetId][mode];
  const text = readableText(primary);
  // Move away from the chosen text color so hover/pressed cannot lose contrast.
  const shade = text === "#000000" ? "#ffffff" : "#000000";
  let ring = primary;
  for (let step = 1; contrastRatio(ring, base.background) < 3 && step <= 10; step++) {
    ring = mix(primary, mode === "light" ? "#000000" : "#ffffff", step / 10);
  }
  return {
    ...base,
    primary,
    "primary-foreground": text,
    "primary-hover": mix(primary, shade, 0.12),
    "primary-pressed": mix(primary, shade, 0.22),
    accent: mix(base.background, primary, mode === "light" ? 0.1 : 0.18),
    "accent-foreground": base.foreground,
    ring,
  };
}
