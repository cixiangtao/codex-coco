import { expect, it } from "vitest";
import { isTrustedPage } from "../apps/desktop/src/desktop/main/security";

it("accepts only the exact renderer entry and rejects lookalike hosts and changed paths", () => {
  expect(isTrustedPage("app://codex-coco/index.html", "app://codex-coco/index.html")).toBe(true);
  for (const url of [
    "app://other/index.html",
    "app://codex-coco/other.html",
    "https://codex-coco/index.html",
    "invalid",
  ]) {
    expect(isTrustedPage(url, "app://codex-coco/index.html")).toBe(false);
  }
  expect(isTrustedPage("http://127.0.0.1:5174/", "http://127.0.0.1:5173/")).toBe(false);
});
