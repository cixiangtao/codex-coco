# Codex Coco

A Codex desktop companion, shaped around personal workflows.

[中文](README.md)

**Status: local development build with phase-two core features implemented.** The source is public on GitHub. There is no official binary release, update feed, code signing or notarization. UI refinement follows core functionality. Controlled tests do not substitute for real-account, current-Codex, signed-update or Widget registration acceptance; see the [phase-two checklist](docs/phase-two.md).

## Features

- Usage: CLI App Server quota windows, reset timing, opt-in background refresh and notifications, incremental local JSONL trends, deduplication, account scoping and read-only SQLite estimates.
- Usage tools: explicitly confirmed reset-card redemption with persisted idempotent recovery, model/effort discovery, structured fixed samples, cancellation, summary history and CLI maintenance.
- Appearance: three independent layers, content-addressed image imports, licensed gallery, named presets, local composition preview, pointer/keyboard positioning and separate save/apply actions.
- Connections: fixed or allocated loopback ports, private application selection, explicit launch/restart, multi-window/reload synchronization, opt-in recovery, computed-style verification and revocation.
- Menu bar: read-only cross-module summaries, quota labels, native/custom icons, 19 licensed GIFs, per-icon speed and optional CPU-linked animation.
- Settings: light/dark/system modes, custom primary color, explicit packaged-app login-item changes, public shared snapshots and update preferences.
- WidgetKit: native extension source and shared-state contract, typechecked but not signed or registered.
- Application updates: version checks, confirmed download/checksum validation, cancellation and explicit native installation/relaunch. Unsigned builds reject replacement; no feed is configured by default.

## Contributing and support

Report bugs and propose improvements in [GitHub Issues](https://github.com/cixiangtao/codex-coco/issues). See [CONTRIBUTING.md](CONTRIBUTING.md) for development requirements and [SECURITY.md](SECURITY.md) for private vulnerability reports. The Chinese README is the primary entry point; this English companion covers core features, development and data boundaries.

## Development

Use Node.js 24 and pnpm 12.14.0.

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run check
pnpm run verify:packaged
```

`check` runs Oxfmt, Oxlint, Oxc AST dependency checks, process-specific TypeScript checks, contract tests and production builds. `verify:packaged` builds a local unsigned macOS arm64 directory and runs the controlled desktop workflows listed in package.json. `pnpm run pack` never publishes; keep `run` to avoid pnpm's npm-package command.

Optional `verify:appearance-launcher` and `verify:widget` require an existing Swift compiler and macOS SDK; they do not install a toolchain. See package.json for individual desktop and usage verification commands. Run production files using `pnpm run build` followed by `pnpm run start`.

## Architecture and data

`apps/desktop` owns the Electron host, application services, contracts, renderer and independent `usage`, `appearance`, `desktop-tools` modules. `packages/ui` owns Tailwind/shadcn components and theme primitives without Node, Electron, IPC or storage dependencies. `native/widget` contains the native extension source. Task workers have static build entries, bounded messages and real cancellation/exit verification.

Business modules are disabled by default. Enabled usage modules read on startup; recurring reads and failure fallback use separately saved policies. Model inference, credit redemption and CLI updates require their own confirmations. Credentials stay with the CLI. Sample answers are excluded from persisted history, diagnostics and menu-bar projections.

Usage stays disabled by default. An enabled module reads once on startup; recurring refresh is a separate setting. Restart restores only the last successful public quota, labeled as historical until refreshed. New windows share the same runtime.

The main window hosts full operations; the menu-bar popover receives only public summaries and cannot write. Failures hide old quota values. Appearance saving and previewing do not apply changes. Opt-in restoration reconnects without automatically launching or restarting Codex; shutdown removes only Codex Coco styles.

Settings default to `~/Library/Application Support/Codex Coco/foundation/`; override with `CODEX_COCO_DATA_DIR` for isolated development. Old repositories, settings and services are untouched. Diagnostics exclude private paths, account data, configuration contents and raw exceptions. There is no telemetry or cloud synchronization.

Update checks are manual by default; opt-in checks never download automatically, and downloaded packages are not installed on ordinary quit. Native signed installation and Widget App Group registration still need a future authorized distribution setup. The current application uses Electron's default icon and remains unsigned/unnotarized. See [updates](docs/updates.md), [appearance](docs/appearance.md), [verification](docs/verification.md), [architecture](docs/architecture.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

Performance scripts provide isolated machine-specific measurements. No new performance baseline was established for this feature batch.

MIT. Codex Coco is an independent project and is not affiliated with OpenAI.
