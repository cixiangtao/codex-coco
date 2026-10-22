import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUsageCache } from "../apps/desktop/src/modules/usage/cache";
import { createUsageModule } from "../apps/desktop/src/modules/usage/runtime";
import { usageDefaults, type UsageSnapshot } from "../apps/desktop/src/modules/usage/contract";
import { UsageReadError } from "../apps/desktop/src/modules/usage/normalize";

const directories: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
const data = (): UsageSnapshot => ({
  account: { label: "p***@example.com", plan: "plus" },
  credits: null,
  resetCredits: null,
  capturedAt: Date.now(),
  source: "codex-app-server",
  buckets: [
    {
      id: "codex",
      windows: [{ kind: "primary", usedPercent: 25, windowMinutes: 300, resetsAt: null }],
    },
  ],
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codex-coco-cache-"));
  directories.push(directory);
  const file = join(directory, "state.json");
  let home = join(directory, "home");
  const cache = createUsageCache(file, { environment: async () => ({ CODEX_HOME: home }) });
  return {
    cache,
    file,
    changeHome: () => {
      home = join(directory, "another");
    },
  };
}
it("restores only bounded successful public quota and isolates the selected source", async () => {
  const { cache, file, changeHome } = await fixture();
  const quota = data();
  quota.resetCredits = {
    availableCount: 1,
    credits: [{ reference: "f".repeat(64), expiresAt: 2_000_000_000 }],
  };
  await cache.save(quota, "a".repeat(64));
  const contents = await readFile(file, "utf8");
  expect(contents).not.toContain("home");
  expect(contents).not.toContain("f".repeat(64));
  expect(JSON.parse(contents).data.resetCredits).toBeNull();
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  expect(await cache.load()).toMatchObject({
    scope: "a".repeat(64),
    data: { account: quota.account },
  });
  changeHome();
  expect(await cache.load()).toBeNull();
  await cache.clear();
  expect(await cache.load()).toBeNull();
});
it("ignores malformed, oversized, future, expired, extra-field and symbolic-link caches", async () => {
  const { cache, file } = await fixture();
  await cache.save(data(), null);
  const valid = JSON.parse(await readFile(file, "utf8"));
  for (const contents of [
    "{broken",
    "x".repeat(256 * 1024 + 1),
    JSON.stringify({ ...valid, token: "private-token" }),
    JSON.stringify({ ...valid, data: { ...valid.data, capturedAt: Date.now() + 60_000 } }),
    JSON.stringify({ ...valid, data: { ...valid.data, capturedAt: Date.now() - 8 * 86_400_000 } }),
  ]) {
    await writeFile(file, contents);
    expect(await cache.load()).toBeNull();
  }
  const target = file + ".target";
  await writeFile(target, JSON.stringify(valid));
  await rm(file);
  await symlink(target, file);
  expect(await cache.load()).toBeNull();
});
it("keeps startup cache separate from live quota and preserves it after refresh failure", async () => {
  const { cache } = await fixture();
  await cache.save(data(), null);
  const definition = createUsageModule(
    async () => {
      throw new UsageReadError("READ_FAILED");
    },
    undefined,
    undefined,
    undefined,
    undefined,
    cache,
  );
  const signal = new AbortController();
  const runtime = await definition.start(signal.signal, {
    configuration: () => usageDefaults,
    requestOperation: () => true,
  });
  try {
    expect(runtime.state?.()).toMatchObject({ status: "cached", trend: null, reset: null });
    await runtime.execute(
      "refresh",
      {},
      { signal: signal.signal, config: usageDefaults, report: () => undefined },
    );
    expect(runtime.state?.()).toMatchObject({
      status: "error",
      previous: { account: { plan: "plus" } },
    });
    expect(await cache.load()).not.toBeNull();
  } finally {
    await runtime.stop();
  }
});
it("isolates cache I/O failures from live successful reads", async () => {
  const unavailable = async () => {
    throw new Error("PRIVATE_PATH");
  };
  const definition = createUsageModule(
    async () => ({ rateLimits: { primary: { usedPercent: 25 } } }),
    undefined,
    undefined,
    undefined,
    undefined,
    { load: unavailable, save: unavailable, clear: unavailable },
  );
  const signal = new AbortController();
  const runtime = await definition.start(signal.signal, {
    configuration: () => usageDefaults,
    requestOperation: () => true,
  });
  try {
    expect(
      await runtime.execute(
        "refresh",
        {},
        { signal: signal.signal, config: usageDefaults, report: () => undefined },
      ),
    ).toMatchObject({ status: "ready" });
  } finally {
    await runtime.stop();
  }
});
