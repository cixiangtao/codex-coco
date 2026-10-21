import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../", import.meta.url));
const exec = promisify(execFile);
it("rejects relative, builtin, type-only, and dynamic renderer imports", async () => {
  const directory = await mkdtemp(join(root, "apps/desktop/src/renderer/__boundary-"));
  const path = join(directory, "probe.ts");
  try {
    await writeFile(
      path,
      'import type { SettingsStore } from "../../application/settings-store";\nvoid import("node:fs");\nexport type Probe = SettingsStore;\n',
    );
    const result = await exec(process.execPath, ["scripts/check-boundaries.mjs"], {
      cwd: root,
    }).catch((error: unknown) => error);
    expect(result).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("renderer cannot import"),
    });
    expect(result).toMatchObject({ stderr: expect.stringContaining("node:fs") });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("rejects cross-module imports and module access to the Electron adapter", async () => {
  const one = await mkdtemp(join(root, "apps/desktop/src/modules/__boundary-one-"));
  const two = await mkdtemp(join(root, "apps/desktop/src/modules/__boundary-two-"));
  try {
    await writeFile(join(two, "runtime.ts"), 'export const id = "fixture";');
    await writeFile(
      join(one, "runtime.ts"),
      `import { id } from "../${basename(two)}/runtime";\nimport { isTrustedPage } from "../../desktop/main/security";\nexport { id, isTrustedPage };`,
    );
    const result = await exec(process.execPath, ["scripts/check-boundaries.mjs"], {
      cwd: root,
    }).catch((error: unknown) => error);
    expect(result).toMatchObject({
      code: 1,
      stderr: expect.stringContaining("cross-module imports are forbidden"),
    });
    expect(result).toMatchObject({ stderr: expect.stringContaining("modules cannot import") });
  } finally {
    await Promise.all(
      [one, two].map((directory) => rm(directory, { recursive: true, force: true })),
    );
  }
});
