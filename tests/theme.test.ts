import { describe, expect, it } from "vitest";
import {
  normalizePrimaryColor,
  themePresetIds,
  type ThemePreference,
} from "../packages/ui/src/theme/contract";
import { contrastRatio, resolveTheme } from "../packages/ui/src/theme/resolve";

describe("theme contract", () => {
  it("normalizes only opaque HEX and rejects CSS injection", () => {
    expect(normalizePrimaryColor(" #AbC ")).toBe("#aabbcc");
    for (const input of ["red", "#ffffff00", "var(--secret)", "#fff; color:red", ""])
      expect(normalizePrimaryColor(input)).toBeNull();
  });
  for (const mode of ["light", "dark"] as const) {
    for (const presetId of themePresetIds) {
      it(`${mode}/${presetId}: readable primary, body, status, and focus tokens`, () => {
        for (const primaryColor of [
          null,
          "#ffffff",
          "#000000",
          "#ffff00",
          "#00ff00",
          "#777777",
          "#ff00ff",
          "#123456",
        ]) {
          const preference: ThemePreference = { mode, presetId, primaryColor };
          const theme = resolveTheme(preference, mode);
          for (const background of [
            theme.primary,
            theme["primary-hover"],
            theme["primary-pressed"],
          ]) {
            expect(contrastRatio(background, theme["primary-foreground"])).toBeGreaterThanOrEqual(
              4.5,
            );
          }
          expect(contrastRatio(theme.ring, theme.background)).toBeGreaterThanOrEqual(3);
          expect(contrastRatio(theme.input, theme.background)).toBeGreaterThanOrEqual(3);
          for (const text of [
            theme.foreground,
            theme["muted-foreground"],
            theme.destructive,
            theme.success,
            theme.warning,
          ]) {
            expect(contrastRatio(text, theme.background)).toBeGreaterThanOrEqual(4.5);
          }
          expect(theme.destructive).toBe(
            resolveTheme({ ...preference, primaryColor: null }, mode).destructive,
          );
        }
      });
    }
  }
  it("rejects invalid preferences before producing CSS", () => {
    expect(() =>
      resolveTheme({ mode: "light", presetId: "neutral", primaryColor: "invalid" }, "light"),
    ).toThrow();
  });
  it("keeps instrument tracks visible and text readable across theme and custom primary changes", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const presetId of themePresetIds) {
        for (const primaryColor of [null, "#ffffff", "#000000", "#ffff00", "#00ff00", "#f400fc"]) {
          const theme = resolveTheme({ mode, presetId, primaryColor }, mode);
          for (const tone of ["primary", "success", "warning"] as const) {
            expect(
              contrastRatio(theme[`data-${tone}`], theme[`data-${tone}-surface`]),
            ).toBeGreaterThanOrEqual(3);
            expect(
              contrastRatio(theme.foreground, theme[`data-${tone}-surface`]),
            ).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
});
