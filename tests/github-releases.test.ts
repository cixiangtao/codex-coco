import { expect, it, vi } from "vitest";
import {
  parseGithubRelease,
  readGithubRelease,
} from "../apps/desktop/src/application/github-releases";
import { latestReleaseApi, releasesUrl } from "../apps/desktop/src/contracts/updates";
const release = { tag_name: "v1.2.0", draft: false, prerelease: false };
it("compares stable versions numerically, permits v tags, and upgrades same-core development builds", () => {
  expect(parseGithubRelease(release, "1.1.99")).toMatchObject({
    available: true,
    version: "1.2.0",
  });
  expect(parseGithubRelease(release, "1.2.0").available).toBe(false);
  expect(parseGithubRelease(release, "1.2.0-dev.1").available).toBe(true);
  expect(parseGithubRelease(release, "1.2.0+build.1").available).toBe(false);
  expect(parseGithubRelease(release, "1.10.0").available).toBe(false);
  expect(parseGithubRelease({ ...release, tag_name: "1.2.0" }, "0.1.0").releaseUrl).toBe(
    `${releasesUrl}/tag/1.2.0`,
  );
});
it("rejects drafts, prereleases, malformed tags, and ignores arbitrary URLs and release body", () => {
  for (const patch of [
    { draft: true },
    { prerelease: true },
    { tag_name: "v1.2.0-beta.1" },
    { tag_name: "v01.2.0" },
    { tag_name: "../../secret" },
  ])
    expect(() => parseGithubRelease({ ...release, ...patch }, "0.1.0")).toThrow();
  expect(
    parseGithubRelease({ ...release, html_url: "file:///PRIVATE", body: "PRIVATE" }, "0.1.0"),
  ).toEqual({ version: "1.2.0", available: true, releaseUrl: `${releasesUrl}/tag/v1.2.0` });
});
it("uses the fixed anonymous API, handles no release, and rejects HTTP failures and oversized bodies", async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify(release)))
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response("PRIVATE", { status: 403 }))
    .mockResolvedValueOnce(new Response("x".repeat(1024 * 1024 + 1)));
  const signal = new AbortController().signal;
  expect(await readGithubRelease(request, "0.1.0", signal)).toMatchObject({ available: true });
  expect(request).toHaveBeenCalledWith(
    latestReleaseApi,
    expect.objectContaining({
      credentials: "omit",
      redirect: "error",
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    }),
  );
  expect(await readGithubRelease(request, "0.1.0", signal)).toBe(null);
  await expect(readGithubRelease(request, "0.1.0", signal)).rejects.toThrow("CHECK_FAILED");
  await expect(readGithubRelease(request, "0.1.0", signal)).rejects.toThrow("RELEASE_TOO_LARGE");
});
it("does not publish a release after cancellation", async () => {
  const controller = new AbortController();
  const request = vi.fn<typeof fetch>().mockImplementation(async () => {
    controller.abort();
    return new Response(JSON.stringify(release));
  });
  await expect(readGithubRelease(request, "0.1.0", controller.signal)).rejects.toThrow();
});
