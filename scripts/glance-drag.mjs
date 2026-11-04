import assert from "node:assert/strict";

/** A pointer gesture with a distinct activation move, as opposed to native HTML drag-and-drop. */
export async function beginCardDrag(page, handle) {
  await handle.locator("xpath=ancestor::*[@data-sort-id]").scrollIntoViewIfNeeded();
  await handle.hover();
  const source = await handle.locator("xpath=ancestor::*[@data-sort-id]").boundingBox();
  const viewport = await page.locator(".glance-content").boundingBox();
  const grip = await handle.boundingBox();
  assert(source && grip);
  const pointer = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  const expectedX =
    source.width > viewport.width / 2 ? source.x : Math.max(viewport.x, source.x - 8);
  await page.mouse.move(pointer.x, pointer.y);
  await page.mouse.down();
  await page.mouse.move(pointer.x - 8, pointer.y + 3, { steps: 3 });
  const overlay = page.locator("[data-drag-overlay]");
  await overlay.waitFor({ timeout: 8000 });
  // The distance-crossing event activates the sensor; the next pointer sample moves the overlay.
  await page.mouse.move(pointer.x - 8, pointer.y + 3);
  await page.waitForFunction(
    ({ x, y }) => {
      const preview = document.querySelector("[data-drag-overlay]")?.getBoundingClientRect();
      return preview && Math.abs(preview.x - x) < 2 && Math.abs(preview.y - y) < 2;
    },
    { x: expectedX, y: source.y + 3 },
    { timeout: 3000 },
  );
  const preview = await overlay.boundingBox();
  assert(Math.abs(preview.width - source.width) < 1, "The preview is the full Card width");
  assert(Math.abs(preview.height - source.height) < 1, "The preview is the full Card height");
  assert(
    Math.abs(preview.x - expectedX) < 2,
    "Full rows stay in their column; small Cards preserve the bounded horizontal grab offset",
  );
  assert(Math.abs(preview.y - source.y - 3) < 2, "The Card keeps the actual vertical grab offset");
  return { source, pointer };
}

/** Drops inside a visible target without using the OS drag image or changing the stored order directly. */
export async function dragCardTo(page, handle, target, { x = 0.5, y = 0.5 } = {}) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((node) => {
    if (node.closest(".glance-content")) node.scrollIntoView({ block: "center" });
  });
  await beginCardDrag(page, handle);
  const bounds = await target.boundingBox();
  assert(bounds);
  await page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y, { steps: 16 });
  const scrollTop = await page.locator(".glance-content").evaluate((node) => node.scrollTop);
  await page.mouse.up();
  await page.locator("[data-drag-overlay]").waitFor({ state: "detached" });
  return { scrollTop };
}
