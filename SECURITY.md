# Security policy

Codex Coco is in development and distributes self-signed macOS previews. These are not Apple Developer ID signed or notarized. Security fixes target the current default branch. No support window for older development snapshots or response-time guarantee is promised.

## Private reports

Use [GitHub private vulnerability reporting](https://github.com/cixiangtao/codex-coco/security/advisories/new). Do not disclose unpatched exploit details, login tokens, account data, private local paths, or raw logs in public issues.

Include the affected version or commit, operating system, minimal reproduction steps, expected impact, and sanitized evidence. Coordinate public disclosure with the maintainer after acknowledgement.

## Trust and data boundaries

Business modules are disabled by default. Credentials stay in backend services or the Codex CLI. Renderer IPC and menu bar views receive validated public projections. Appearance changes target a user-selected local CDP application. Update checks, downloads, and installation are controlled separately. See the [README](README.md), [menu bar boundaries](docs/menu-bar.md), and [update documentation](docs/updates.md).

CI uses temporary data and controlled services. It must not require real accounts or signing private keys. The MIT license does not imply that every runtime scenario has received a security audit.
