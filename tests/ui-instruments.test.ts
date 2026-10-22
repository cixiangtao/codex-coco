import { describe, expect, it } from "vitest";
import { glanceDetailSchema } from "../apps/desktop/src/contracts/glance";

describe("capacity presentation contract", () => {
  it("accepts only bounded public numeric display values, never configuration or source fields", () => {
    const metric = {
      id: "quota",
      label: "额度",
      value: "剩余 75%",
      detail: "一小时后恢复",
      progress: 75,
      numericValue: 100,
    };
    expect(glanceDetailSchema.safeParse({ description: "摘要", metrics: [metric] }).success).toBe(
      true,
    );
    for (const patch of [
      { progress: -1 },
      { progress: 101 },
      { progress: Infinity },
      { numericValue: -1 },
      { source: "PRIVATE_DIRECTORY" },
      { token: "PRIVATE_TOKEN" },
    ]) {
      expect(
        glanceDetailSchema.safeParse({ description: "摘要", metrics: [{ ...metric, ...patch }] })
          .success,
      ).toBe(false);
    }
  });
});
