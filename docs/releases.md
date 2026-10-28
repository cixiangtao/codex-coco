# Releases and signing

Codex Coco uses one manually dispatched [Preview release workflow](../.github/workflows/preview-release.yml). A source push never publishes. `publish=false` builds and verifies only; `publish=true` additionally creates a GitHub Pre-release after every gate succeeds. Only the default branch of cixiangtao/codex-coco is accepted.

The root and desktop package manifests own the application version together. Preview versions use `X.Y.Z-preview.N`; the private UI package is not a separately published product. Prepare and commit the version and matching English release notes before dispatching. Actions tags the exact tested commit, uploads already inspected artifacts to a draft, then publishes it with `prerelease=true` and `latest=false`. It refuses conflicting tags or assets rather than overwriting them. Retry with identical inspected artifacts, or prepare a new preview version if a rebuilt archive differs.

## Free self-signed identity

A project-owned RSA code-signing certificate provides update identity continuity without an Apple Developer membership. No Apple timestamp service is used (`timestamp=none`). This is separate from Developer ID and notarization: users still receive macOS first-launch checks. Ad-hoc signing alone is not the update identity.

The public certificate and fingerprint are committed in `apps/desktop/resources/signing/`. The application verifies the complete bundle and requires this certificate and the expected bundle identifier. It does not accept any arbitrary self-signed app or a missing signature. Squirrel.Mac continues to verify downloaded bundles against the running app's designated requirement.

`scripts/create-release-identity.mjs` creates or reuses the long-term identity in `~/Library/Application Support/Codex Coco/release-signing/` with directory mode 0700 and private-file mode 0600. It never rotates a key automatically. Keep an encrypted offline backup of this directory. Losing or replacing the identity can require users to reinstall manually; rotation needs a separately designed bridge release.

GitHub Actions Secrets `COCO_SIGNING_P12` (Base64 PKCS#12) and `COCO_SIGNING_PASSWORD` contain the identity. They must never be committed, printed, pasted into chat, or exposed to pull requests. The public certificate is trusted for code signing only on the disposable GitHub runner. No trust settings or certificates are installed on the maintainer's Mac or end-user machines.

## Gates and artifacts

The workflow runs the normal check, actual Squirrel.Mac two-version replacement and negative tests, a self-signed DMG/ZIP build, signature and production-launch verification, desktop/worker regression, and SHA-256 artifact inspection. Only the publish job has contents write permission. The local build always uses `--publish never`.

The release contains arm64 DMG/ZIP, production dependency notices, a source/signing manifest and SHA256SUMS.txt. Electron's own license notices remain in the bundle; project, asset and shadcn notices are also included. There is no paid Apple certificate, notarization, npm publication, separate update server, or automatically released stable version.

The current application follows stable Releases. A preview is excluded from that channel; it is downloaded manually. Verification fixtures exercise two isolated versions using the exact Electron runtime without touching the installed Codex client or real account data.

## Source references

The self-signed identity approach was checked against [BDIH Launcher's certificate tooling](https://github.com/Bob-Ddong-Iri-Hoyo/BDIH-Launcher/blob/eeff14d893554fb0226cb575da290b583bbf1cf3/scripts/createP12.sh) and [Apple's code-signing guidance](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html). The scripts here are independently implemented. Electron 44.9.2 pins Squirrel.Mac at fffea30e4a339a7f7d69a3391314b72548d209bd, whose SQRLCodeSignature uses the running app's designated requirement. No upstream scripts or trust-store operations were copied to the maintainer's machine.
