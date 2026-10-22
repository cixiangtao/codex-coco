import { describe, it, expect } from "vitest";
import { recoveryLabel, freshnessLabel } from "../apps/desktop/src/renderer/lib/presentation-time";
import { buildGlanceItems } from "../apps/desktop/src/application/glance";
import { glanceDetailSchema } from "../apps/desktop/src/contracts/glance";
import type { ModuleSnapshot } from "../apps/desktop/src/contracts/modules";

describe("read-only presentation", () => {
  it("does not turn unknown or elapsed reset times into confirmed replenishment", () => {
    const now = 1_000_000;
    expect(recoveryLabel(null, now)).toBe("恢复时间未知");
    expect(recoveryLabel(undefined, now)).toBe("恢复时间未知");
    expect(recoveryLabel(now - 1, now)).toBe("等待刷新确认");
    expect(recoveryLabel(now + 30_000, now)).toBe("1 分钟后恢复");
    expect(recoveryLabel(now + 3_601_000, now)).toBe("约 1 小时后恢复");
    expect(freshnessLabel(now, now)).toBe("刚刚更新");
    expect(freshnessLabel(now - 120_000, now)).toBe("2 分钟前更新");
  });
  it("validates public identity and reset metadata, and omits it from unavailable modules", () => {
    const detail = {
      description: "公开摘要",
      identity: { label: "p***e@example.com", plan: "ChatGPT Plus" },
      metrics: [
        {
          id: "codex:primary",
          group: "通用额度",
          label: "5 小时窗口",
          value: "剩余 75%",
          detail: "恢复时间",
          progress: 75,
          resetsAt: 1_000_000,
        },
      ],
    };
    expect(glanceDetailSchema.safeParse(detail).success).toBe(true);
    expect(
      glanceDetailSchema.safeParse({
        ...detail,
        identity: { ...detail.identity, token: "PRIVATE" },
      }).success,
    ).toBe(false);
    for (const resetsAt of [-1, Infinity, 8_640_000_000_000_001])
      expect(
        glanceDetailSchema.safeParse({ ...detail, metrics: [{ ...detail.metrics[0], resetsAt }] })
          .success,
      ).toBe(false);
    const snapshot: ModuleSnapshot = {
      id: "usage",
      title: "用量",
      revision: 1,
      generation: 1,
      phase: "running",
      error: null,
      config: {
        schemaVersion: 1,
        revision: 1,
        enabled: true,
        health: "ok",
        value: { secret: "PRIVATE_CONFIG" },
      },
      operations: [],
      operation: null,
    };
    expect(buildGlanceItems([snapshot], new Map([["usage", detail]]))[0]?.identity).toEqual(
      detail.identity,
    );
    snapshot.phase = "disabled";
    expect(buildGlanceItems([snapshot], new Map([["usage", detail]]))[0]?.identity).toBeUndefined();
    expect(JSON.stringify(buildGlanceItems([snapshot]))).not.toContain("PRIVATE");
  });
});
