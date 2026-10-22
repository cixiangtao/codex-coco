import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopSession } from "./verify-desktop.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = await mkdtemp(join(tmpdir(), "codex-coco-tray-colors-"));
const packaged = process.argv.includes("--packaged");
const output = join(root, packaged ? "work/tray-colors-packaged" : "work/tray-colors");
await mkdir(output, { recursive: true });
let session;
async function task(page) {
  let response;
  const until = Date.now() + 15000;
  do {
    response = await page.evaluate(() =>
      window.codexCoco.runModuleOperation({
        moduleId: "desktop-tools",
        operation: "apply-menu-bar",
        input: {},
      }),
    );
    if (!response.ok) await delay(40);
  } while (!response.ok && Date.now() < until);
  assert.equal(response.ok, true);
  const id = response.value.operation.id;
  do {
    const s = await page.evaluate(
      async () =>
        (await window.codexCoco.modules()).value.find((m) => m.id === "desktop-tools").operation,
    );
    if (s?.id === id && s.phase === "succeeded") {
      assert.equal(s.result.status, "ready");
      return;
    }
    await delay(20);
  } while (Date.now() < until);
  assert.fail("Icon task did not complete");
}
async function configure(page, iconId, animate = false) {
  const response = await page.evaluate(
    async ({ iconId, animate }) => {
      const s = (await window.codexCoco.modules()).value.find((m) => m.id === "desktop-tools");
      return window.codexCoco.saveModuleConfig({
        moduleId: "desktop-tools",
        expectedRevision: s.config.revision,
        value: { ...s.config.value, iconId, animate, followsCpu: false, speed: 3 },
      });
    },
    { iconId, animate },
  );
  assert.equal(response.ok, true);
  await task(page);
}
/** Independent browser codec and exact sampling coordinates; transparent RGB is irrelevant. */
async function compareGifFrames({ gif, actual, allFrames }) {
  const sourceDecoder = new ImageDecoder({
    type: "image/gif",
    data: Uint8Array.from(atob(gif), (c) => c.charCodeAt(0)),
  });
  const expected = [];
  try {
    await sourceDecoder.tracks.ready;
    const count = allFrames ? sourceDecoder.tracks.selectedTrack.frameCount : 1;
    for (let index = 0; index < count; index++) {
      const { image } = await sourceDecoder.decode({ frameIndex: index });
      const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight),
        ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0);
      image.close();
      const source = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const scaled = new Uint8Array(36 * 36 * 4),
        scale = Math.min(36 / canvas.width, 36 / canvas.height),
        dw = Math.max(1, Math.round(canvas.width * scale)),
        dh = Math.max(1, Math.round(canvas.height * scale)),
        ox = Math.floor((36 - dw) / 2),
        oy = Math.floor((36 - dh) / 2);
      for (let y = 0; y < dh; y++)
        for (let x = 0; x < dw; x++) {
          const at =
            (Math.min(canvas.height - 1, Math.floor(y / scale)) * canvas.width +
              Math.min(canvas.width - 1, Math.floor(x / scale))) *
            4;
          scaled.set(source.subarray(at, at + 4), ((oy + y) * 36 + ox + x) * 4);
        }
      expected.push(scaled);
    }
  } finally {
    sourceDecoder.close();
  }
  let mismatches = 0,
    transparent = 0,
    width = 0,
    height = 0;
  const covered = new Set();
  for (const frame of actual) {
    const image = await createImageBitmap(
      new Blob([Uint8Array.from(atob(frame.png), (c) => c.charCodeAt(0))], { type: "image/png" }),
    );
    const canvas = new OffscreenCanvas(image.width, image.height),
      ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    image.close();
    width = canvas.width;
    height = canvas.height;
    const pixels = ctx.getImageData(0, 0, width, height).data;
    transparent = 0;
    for (let at = 3; at < pixels.length; at += 4) if (pixels[at] === 0) transparent++;
    let best = 36 * 36;
    expected.forEach((expected, index) => {
      let differences = 0;
      for (let at = 0; at < pixels.length; at += 4)
        if (
          pixels[at + 3] !== expected[at + 3] ||
          (pixels[at + 3] > 0 &&
            [0, 1, 2].some((c) => Math.abs(pixels[at + c] - expected[at + c]) > 2))
        ) {
          differences++;
        }
      best = Math.min(best, differences);
      if (differences === 0) covered.add(index);
    });
    mismatches += best;
  }
  return {
    mismatches,
    transparent,
    width,
    height,
    expectedFrames: expected.length,
    coveredFrames: covered.size,
  };
}

try {
  session = await createDesktopSession(
    join(directory, "data"),
    { ...process.env, CODEX_COCO_FIXTURES: "0" },
    packaged
      ? join(root, "apps/desktop/release/mac-arm64/Codex Coco.app/Contents/MacOS/Codex Coco")
      : undefined,
  );
  const { page, application, errors } = session;
  await application.evaluate(({ Tray }) => {
    globalThis.colorFrames = [];
    const setImage = Tray.prototype.setImage;
    Tray.prototype.setImage = function (image) {
      globalThis.colorFrames.push({
        png: image.toPNG({ scaleFactor: 2 }).toString("base64"),
        template: image.isTemplateImage(),
        size: image.getSize(),
      });
      if (globalThis.colorFrames.length > 400) globalThis.colorFrames.shift();
      return setImage.call(this, image);
    };
  });
  await page.evaluate(() =>
    window.codexCoco.enableModule({ moduleId: "desktop-tools", enabled: true }),
  );
  await delay(600);
  await task(page);
  const manifest = await readFile(
    join(root, "apps/desktop/src/modules/desktop-tools/contract.ts"),
    "utf8",
  );
  const icons = Array.from(manifest.matchAll(/id: "builtin:([^"]+)"/g), (m) => m[1]);
  assert.equal(icons.length, 19);
  const comparisons = [];
  // Chromium's GIF decoder is independent of gifuct-js and the worker's compositor.
  for (const icon of icons) {
    await configure(page, `builtin:${icon}`);
    const actual = await application.evaluate(() => globalThis.colorFrames.at(-1));
    const gif = (await readFile(join(root, `apps/desktop/resources/tray/${icon}.gif`))).toString(
      "base64",
    );
    const compared = await page.evaluate(compareGifFrames, {
      gif,
      actual: [actual],
      allFrames: false,
    });
    if (compared.mismatches) console.error(icon, JSON.stringify(compared));
    assert.equal(compared.mismatches, 0, `${icon}: worker pixels differ from Chromium GIF decoder`);
    assert.deepEqual(actual.size, { width: 18, height: 18 });
    comparisons.push({ icon, template: actual.template, ...compared });
  }
  assert.equal(comparisons.find((x) => x.icon === "zhiyin_basketball").template, true);
  assert(comparisons.find((x) => x.icon === "zhiyin_basketball").transparent > 900);
  await configure(page, "builtin:zhiyin_basketball", true);
  const start = await application.evaluate(() => globalThis.colorFrames.length);
  await delay(2800);
  const animated = await application.evaluate(
    (_electron, start) => globalThis.colorFrames.slice(start),
    start,
  );
  assert(animated.length > 4);
  assert(animated.every((frame) => frame.template));
  const animationCompared = await page.evaluate(compareGifFrames, {
    gif: (await readFile(join(root, "apps/desktop/resources/tray/zhiyin_basketball.gif"))).toString(
      "base64",
    ),
    actual: animated,
    allFrames: true,
  });
  assert.equal(animationCompared.mismatches, 0, JSON.stringify(animationCompared));
  assert.equal(animationCompared.coveredFrames, animationCompared.expectedFrames);
  await configure(page, "builtin:zhiyin_basketball");
  const basketball = await application.evaluate(() => globalThis.colorFrames.at(-1));
  // Render the actual production alpha mask on both contrast backgrounds for review.
  await page.evaluate(({ png }) => {
    document.body.innerHTML = "";
    document.body.style.cssText = "margin:0;display:flex";
    for (const color of ["#f4f4f4", "#202020"]) {
      const panel = document.createElement("div");
      panel.style.cssText = `width:300px;height:180px;background:${color};display:grid;place-items:center`;
      const icon = document.createElement("div");
      icon.style.cssText = `width:108px;height:108px;background:${color === "#202020" ? "#fff" : "#111"};mask:url(data:image/png;base64,${png}) center/contain no-repeat`;
      panel.append(icon);
      document.body.append(panel);
    }
  }, basketball);
  await page.screenshot({ path: join(output, "basketball-mask.png"), scale: "css" });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        ok: true,
        packaged,
        nativeMenuBarScreenshot: false,
        chromiumFirstFrameComparisons: comparisons,
        animatedTemplateFrames: animated.length,
        animationCompared,
      },
      null,
      2,
    ),
  );
} finally {
  await session?.application.close();
  await rm(directory, { recursive: true, force: true });
}
