# Contributing

Codex Coco is a personal desktop companion focused on daily use, learning, and steady refinement. macOS is the first supported platform. Public entry points and community files use English, with a [Simplified Chinese README](README.zh-CN.md). The application UI and detailed engineering documentation currently use Chinese.

## Development

Use Node.js 24 and the pinned pnpm 12.14.0. Do not change global package-manager settings.

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run check
```

Set `CODEX_COCO_DATA_DIR` to an isolated directory for development and verification. See the [README](README.md) and [verification record](docs/verification.md) for controlled Electron checks. Tests must use fixtures instead of consuming real reset cards, running paid model requests, or upgrading the installed CLI.

## Changes and pull requests

- Open an issue before substantial behavior or architecture changes. Describe the use case and acceptance criteria.
- Keep each PR focused on one intent. Explain the resulting behavior, checks actually run, and remaining limits. Include sanitized screenshots for UI changes.
- Use Conventional Commits, for example `fix(usage): 🐛 correct quota recovery state`. Existing commit history uses Chinese descriptions; concise English descriptions are also welcome.
- Add contract tests for lifecycle, parsing, or IPC changes. Verify UI interactions in real Electron.
- Follow the process, module, and privacy boundaries in [AGENTS.md](AGENTS.md) and the [architecture](docs/architecture.md).
- Never commit credentials, account data, model responses, local configuration, raw logs, or generated builds. Record sources, licenses, and modifications when reusing code or assets.

CI checks formatting, lint, dependency boundaries, types, contract tests, and production builds. It does not publish applications or prove code signing, notarization, real update installation, or compatibility with every macOS version.

## Dependencies and releases

Pin exact dependency versions and keep only pnpm-lock.yaml. Routine upgrades remain a maintainer decision. Security fixes still require review and checks; they are not automatically merged. Source pushes do not publish versions. There is no signed release pipeline yet; GitHub Actions will be the sole publisher for future automated release targets.

Report security problems privately using [SECURITY.md](SECURITY.md).
