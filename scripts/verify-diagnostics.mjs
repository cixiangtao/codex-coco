import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDesktopSession } from "./verify-desktop.mjs";

const directory = await mkdtemp(join(tmpdir(), "codex-coco-diagnostic-desktop-"));
let session;
try {
  session = await createDesktopSession(directory, { ...process.env, CODEX_COCO_FIXTURES: "0" });
  const privateValue = "sk-synthetic-private-payload";
  const result = await session.page.evaluate(
    (privateValue) =>
      window.codexCoco.saveTheme({ expectedRevision: 0, theme: { mode: privateValue } }),
    privateValue,
  );
  assert.equal(result.error.code, "INVALID_INPUT");
  assert.match(result.error.correlationId, /^[0-9a-f-]{36}$/);
  // ready is idempotent: repeated renderer calls must not emit a flood of window milestones.
  await session.page.evaluate(() => {
    for (let index = 0; index < 20; index++) window.codexCoco.ready();
  });
  assert.deepEqual(session.errors, []);
  await session.application.close();
  session = undefined;
  const logDirectory = join(directory, "diagnostics");
  const names = await readdir(logDirectory);
  assert.ok(names.length <= 3);
  for (const name of names) assert.ok((await stat(join(logDirectory, name))).size <= 256 * 1024);
  const text = (
    await Promise.all(names.map((name) => readFile(join(logDirectory, name), "utf8")))
  ).join("");
  assert.equal(text.includes(privateValue), false);
  const records = text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(records.filter((item) => item.event === "window.ready").length, 1);
  assert.ok(
    records.some(
      (item) =>
        item.correlationId === result.error.correlationId && item.errorCode === "INVALID_INPUT",
    ),
  );
  assert.ok(records.some((item) => item.event === "app.shutdown" && item.outcome === "ok"));

  await rm(logDirectory, { recursive: true });
  await writeFile(logDirectory, "preserve unavailable logging path");
  session = await createDesktopSession(directory, { ...process.env, CODEX_COCO_FIXTURES: "0" });
  const response = await session.page.evaluate(() => window.codexCoco.modules());
  assert.deepEqual(response, { ok: true, value: [] });
  assert.deepEqual(session.errors, []);
  await session.application.close();
  session = undefined;
  assert.equal(await readFile(logDirectory, "utf8"), "preserve unavailable logging path");
  console.log(
    JSON.stringify(
      {
        ok: true,
        privacyAllowlist: true,
        correlation: true,
        readyIdempotent: true,
        unavailableLogDoesNotBlockApplication: true,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
