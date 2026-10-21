# Codex Coco

A Codex desktop companion, shaped around personal workflows.

[中文](README.md)

**Status: runnable local foundation verification build.** The previous prototype was removed and archived. Electron, React, TypeScript, a shared UI package, theme preferences and engineering checks have now been built from scratch. Usage and appearance business modules are not implemented. The verification page is not the approved product design.

## Development

Use Node.js 24 and pnpm 12.14.0. Initial installation downloads the platform Electron binary.

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run check
pnpm run verify:desktop
pnpm run verify:modules
```

`check` runs Oxfmt, Oxlint, AST dependency-boundary checks, separate TypeScript configurations, contract tests and the production build. `verify:desktop` launches real Electron with temporary application data and checks production loading, theme preview/save/cancel, IPC validation, window synchronization and restart persistence.

`pnpm run build` builds production files; `pnpm run start` opens them. `pnpm run pack` creates an unsigned local macOS application directory. `pnpm run verify:packaged` packages and tests the application itself, currently on macOS arm64. Use the explicit `run` syntax so `pack` does not invoke pnpm's npm-package archive command.

`verify:modules` exercises two synthetic built-in modules through real Electron: whitelisted operations, progress, cancellation, independent versioned configuration, cross-window conflicts, window reopening, restart persistence and backed-up recovery. It uses temporary data. Fixtures require an explicit opt-in in unpackaged environments and are always disabled in packaged builds. Business registrations remain empty. See [module development](docs/module-development.md).

## Structure and themes

`apps/desktop` owns Electron integration, module lifecycles, settings and the renderer. The private `packages/ui` package owns customized shadcn components, Tailwind semantic tokens and a controlled ThemeProvider. It has no Electron, Node, IPC or storage dependency.

Themes support light/dark/system modes, engineering presets and custom HEX primary colors. Preview drafts remain local to their window; saving persists and broadcasts a validated revision. Conflicting writes are rejected. Invalid or future-version settings are preserved, and explicit recovery backs up the original. Theme settings are separate from future external Codex appearance customization.

Default application settings live under `~/Library/Application Support/Codex Coco/foundation/`, isolated from the archived prototype. Override this with `CODEX_COCO_DATA_DIR` for development. Automated desktop verification uses and removes temporary directories.

There is no account access, usage request, appearance injection, telemetry or cloud synchronization. The old repositories and existing application data are untouched. This remains a local-only repository. The generated application uses Electron's default icon, is unsigned and unnotarized, and has no public release or update channel.

See the [architecture](docs/architecture.md), [theme proposal and implementation status](docs/ui-package-and-theme.md), [verification record](docs/verification.md), and [foundation plan](docs/foundation-plan.md).

MIT. Codex Coco is an independent project and is not affiliated with OpenAI.
