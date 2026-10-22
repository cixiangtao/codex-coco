import { describe, it, expect } from "vitest";
import { formatTokens, formatExactTokens } from "../apps/desktop/src/renderer/lib/token-format";
describe("token presentation", () => {
  it("keeps unknown token counts distinct from zero and abbreviates scale changes", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1234)).toBe("1.2K");
    expect(formatTokens(1_234_567)).toBe("1.2M");
    expect(formatTokens(999_950)).toBe("1M");
    expect(formatExactTokens(1_234_567)).toBe("1,234,567");
    for (const value of [null, undefined, NaN, Infinity, -1]) expect(formatTokens(value)).toBe("—");
  });
});
