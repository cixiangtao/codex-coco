import { z } from "zod";
import {
  latestReleaseApi,
  releasesUrl,
  stableVersionSchema,
  type ReleaseCheck,
} from "../contracts/updates";

const releaseSchema = z.object({
  tag_name: z.string().max(81),
  draft: z.literal(false),
  prerelease: z.literal(false),
});
const maxReleaseBytes = 1024 * 1024;

/** Stable releases alone are supported; the same core outranks a development prerelease. */
export function parseGithubRelease(input: unknown, currentVersion: string): ReleaseCheck {
  const release = releaseSchema.parse(input);
  const version = stableVersionSchema.parse(release.tag_name.replace(/^v/, ""));
  const current =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      currentVersion,
    );
  if (!current) throw new Error("INVALID_VERSION");
  const candidate = version.split(".").map(BigInt);
  const installed = current.slice(1, 4).map(BigInt);
  let available = Boolean(current[4]);
  for (let i = 0; i < 3; i++) {
    if (candidate[i] !== installed[i]) {
      available = candidate[i]! > installed[i]!;
      break;
    }
  }
  return { version, available, releaseUrl: `${releasesUrl}/tag/${release.tag_name}` };
}

/** Anonymous, bounded metadata-only request. No release means 404; other HTTP failures remain errors. */
export async function readGithubRelease(
  request: typeof fetch,
  currentVersion: string,
  signal: AbortSignal,
): Promise<ReleaseCheck | null> {
  const response = await request(latestReleaseApi, {
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
    return parseGithubRelease(JSON.parse(text), currentVersion);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
