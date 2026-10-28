import { z } from "zod";
import {
  latestReleaseApi,
  previewReleasesApi,
  releasesUrl,
  releaseVersionSchema,
  isPreviewVersion,
  type ReleaseCheck,
} from "../contracts/updates";

const releaseSchema = z.object({
  tag_name: z.string().max(81),
  draft: z.literal(false),
  prerelease: z.boolean(),
});
const maxReleaseBytes = 1024 * 1024;

/** Numeric semantic ordering, including preview.10 after preview.9 and stable after preview. */
function compareVersions(candidate: string, current: string) {
  const pattern =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
  const left = pattern.exec(candidate);
  const right = pattern.exec(current);
  if (!left || !right) throw new Error("INVALID_VERSION");
  for (let i = 1; i <= 3; i++) {
    const difference = BigInt(left[i]!) - BigInt(right[i]!);
    if (difference) return difference > 0n ? 1 : -1;
  }
  if (!left[4] || !right[4]) return left[4] ? -1 : right[4] ? 1 : 0;
  if (left[4] === right[4]) return 0;
  const a = /^preview\.([1-9]\d*)$/.exec(left[4]);
  const b = /^preview\.([1-9]\d*)$/.exec(right[4]);
  if (!a || !b) return a ? 1 : -1;
  return BigInt(a[1]!) > BigInt(b[1]!) ? 1 : -1;
}
/** Only project preview tags are accepted, and only by preview installations. */
export function parseGithubRelease(input: unknown, currentVersion: string): ReleaseCheck {
  const release = releaseSchema.parse(input);
  const version = releaseVersionSchema.parse(release.tag_name.replace(/^v/, ""));
  if (
    release.prerelease !== isPreviewVersion(version) ||
    (release.prerelease && !isPreviewVersion(currentVersion))
  )
    throw new Error("INVALID_CHANNEL");
  return {
    version,
    available: compareVersions(version, currentVersion) > 0,
    releaseUrl: `${releasesUrl}/tag/${release.tag_name}`,
  };
}

/** Anonymous, bounded metadata-only request. No release means 404; other HTTP failures remain errors. */
export async function readGithubRelease(
  request: typeof fetch,
  currentVersion: string,
  signal: AbortSignal,
): Promise<ReleaseCheck | null> {
  const preview = isPreviewVersion(currentVersion);
  const response = await request(preview ? previewReleasesApi : latestReleaseApi, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    credentials: "omit",
    redirect: "error",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error("CHECK_FAILED");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxReleaseBytes) throw new Error("RELEASE_TOO_LARGE");
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    signal.throwIfAborted();
    const input: unknown = JSON.parse(text);
    if (!preview) return parseGithubRelease(input, currentVersion);
    const releases = z.array(z.unknown()).max(100).parse(input);
    let latest: ReleaseCheck | null = null;
    for (const value of releases) {
      let candidate: ReleaseCheck;
      try {
        candidate = parseGithubRelease(value, currentVersion);
      } catch {
        continue;
      }
      if (!latest || compareVersions(candidate.version, latest.version) > 0) latest = candidate;
    }
    return latest;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
